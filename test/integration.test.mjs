import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import {
  feedbackPOST,
  handleFeedback,
  handleWebhook,
  realFeedbackDeps,
  realWebhookDeps,
  webhookPOST,
} from '../dist/server.mjs'
import { buildFeedbackIssuePayload } from '../dist/server.mjs'

const aiData = {
  title: 'Export breaks for leak@example.com',
  short_summary: 'The export flow is broken.',
  key_details: ['export', 'download'],
  suggested_category: 'bug',
  suggested_feature_area: 'export',
  suggested_priority: 'high',
  steps: ['Open export', 'Click download'],
  expected: 'A CSV downloads',
  confidence: 0.95,
  clarifying_questions: [],
}

function createFakeSupabase(initialRows = []) {
  const rows = initialRows.map((row) => ({ ...row }))
  const inserts = []
  const updates = []
  let nextId = 1

  function matchesFilters(row, filters) {
    return filters.every((filter) => row[filter.column] === filter.value)
  }

  function matchesOr(row, expression) {
    if (!expression) return true
    if (expression === 'last_emailed_stage.is.null,last_emailed_stage.neq.triaged') {
      return row.last_emailed_stage === null || row.last_emailed_stage !== 'triaged'
    }
    const stage = expression.match(/last_emailed_stage\.neq\.([^,]+)/)?.[1]
    return row.last_emailed_stage === null || row.last_emailed_stage !== stage
  }

  function clone(row) {
    return row ? { ...row, ai_data: row.ai_data ? { ...row.ai_data } : row.ai_data } : row
  }

  const client = {
    storage: {
      from() {
        return {
          async upload() {
            return { data: { path: 'feedback.png' }, error: null }
          },
          getPublicUrl() {
            return { data: { publicUrl: 'https://storage.test/feedback.png' } }
          },
        }
      },
    },
    // Models migration 004 claim_feedback_stage: one atomic UPDATE ... WHERE
    // last_emailed_stage IS DISTINCT FROM p_stage RETURNING id. Synchronous
    // mutation == the DB statement's atomicity; a concurrent second caller
    // sees the already-claimed row and gets zero rows.
    // Models migration 004 claim_feedback_stage: one atomic UPDATE guarded by
    // last_emailed_stage IS DISTINCT FROM p_stage AND rank(p_stage) >
    // rank(journey_stage) (forward-only). Synchronous mutation == the DB
    // statement's atomicity; a concurrent / duplicate / backward caller sees
    // the guard fail and gets zero rows.
    async rpc(fn, params) {
      assert.equal(fn, 'claim_feedback_stage')
      const rank = (s) =>
        ({ received: 0, triaged: 1, in_progress: 2, shipped: 3, wont_fix: 3 }[s] ?? -1)
      const row = rows.find((r) => r.id === params.p_id)
      if (
        !row ||
        row.last_emailed_stage === params.p_stage ||
        rank(params.p_stage) <= rank(row.journey_stage ?? 'received')
      ) {
        return { data: [], error: null }
      }
      row.journey_stage = params.p_stage
      row.last_emailed_stage = params.p_stage
      updates.push({ rpc: fn, params })
      return { data: [{ id: row.id }], error: null }
    },
    from(table) {
      assert.equal(table, 'feedback')

      return {
        insert(values) {
          return {
            select() {
              return {
                async single() {
                  const row = { id: `feedback-${nextId++}`, ...values }
                  rows.push(row)
                  inserts.push(values)
                  return { data: { id: row.id }, error: null }
                },
              }
            },
          }
        },
        update(values) {
          const filters = []
          let orExpression = null

          function applyUpdate() {
            const matched = rows.filter((row) => matchesFilters(row, filters) && matchesOr(row, orExpression))
            for (const row of matched) {
              Object.assign(row, values)
            }
            updates.push({ values, filters: [...filters], orExpression, count: matched.length })
            return matched
          }

          const builder = {
            eq(column, value) {
              filters.push({ column, value })
              return builder
            },
            or(expression) {
              orExpression = expression
              return builder
            },
            async select() {
              const matched = applyUpdate()
              return { data: matched.map((row) => ({ id: row.id })), error: null }
            },
            then(resolve, reject) {
              try {
                resolve({ error: null, data: applyUpdate() })
              } catch (error) {
                reject(error)
              }
            },
          }

          return builder
        },
        select() {
          const filters = []
          const builder = {
            eq(column, value) {
              filters.push({ column, value })
              return builder
            },
            async maybeSingle() {
              const row = rows.find((candidate) => matchesFilters(candidate, filters)) || null
              return { data: clone(row), error: null }
            },
          }

          return builder
        },
      }
    },
  }

  return { client, rows, inserts, updates }
}

function feedbackRequest(fields, headers = {}) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value)
  }

  return new Request('https://example.test/api/feedback', {
    method: 'POST',
    headers: {
      'x-page-url': 'https://app.test/export?email=page@example.com',
      'x-real-ip': `127.0.0.${Math.floor(Math.random() * 200) + 1}`,
      'user-agent': 'node-test',
      ...headers,
    },
    body: formData,
  })
}

function feedbackDeps(options = {}) {
  const supabase = options.supabase || createFakeSupabase()
  const createIssueCalls = []
  const confirmations = []

  return {
    supabase,
    createIssueCalls,
    confirmations,
    deps: {
      supabase: supabase.client,
      env: {
        SUPABASE_URL: 'https://supabase.test',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role',
        GEMINI_API_KEY: 'gemini',
        GITHUB_TOKEN: 'github-token',
        GITHUB_FEEDBACK_REPO: 'owner/repo',
        RESEND_API_KEY: 'resend-token',
        ...options.env,
      },
      analyze: options.analyze || (async () => aiData),
      createIssue: options.createIssue || (async (params) => {
        const payload = buildFeedbackIssuePayload(params)
        createIssueCalls.push({ params, payload })
        return { number: 1, url: 'https://x/1' }
      }),
      sendConfirmation: async (params) => {
        confirmations.push(params)
      },
    },
  }
}

function webhookRequest(payload, secret, headers = {}) {
  const raw = JSON.stringify(payload)
  const signature = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')

  return new Request('https://example.test/api/feedback/webhook', {
    method: 'POST',
    headers: {
      'x-github-event': 'issues',
      'x-hub-signature-256': signature,
      ...headers,
    },
    body: raw,
  })
}

function webhookDeps(rows, options = {}) {
  const supabase = createFakeSupabase(rows)
  const stages = []

  return {
    supabase,
    stages,
    deps: {
      supabase: supabase.client,
      env: {
        GITHUB_WEBHOOK_SECRET: 'secret',
        RESEND_API_KEY: 'resend-token',
        ...options.env,
      },
      sendStage: async (params) => {
        stages.push(params)
      },
    },
  }
}

const triagedPayload = {
  action: 'labeled',
  label: { name: 'triaged' },
  repository: { full_name: 'owner/repo' },
  issue: {
    number: 1,
    state: 'open',
    html_url: 'https://github.test/owner/repo/issues/1',
    title: 'Export issue',
  },
}

test('feedbackPOST and webhookPOST thin adapters match direct route handlers', async () => {
  const previousEnv = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
  }

  process.env.SUPABASE_URL = 'https://supabase.test'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
  process.env.GITHUB_WEBHOOK_SECRET = 'secret'

  try {
    const feedbackAdapterResponse = await feedbackPOST(feedbackRequest({ website: '' }))
    const feedbackDirectResponse = await handleFeedback(
      feedbackRequest({ website: '' }),
      realFeedbackDeps(process.env),
    )

    assert.equal(feedbackAdapterResponse.status, feedbackDirectResponse.status)
    assert.equal(feedbackAdapterResponse.status, 400)

    const webhookAdapterResponse = await webhookPOST(
      new Request('https://example.test/api/feedback/webhook', {
        method: 'POST',
        headers: { 'x-github-event': 'issues' },
        body: JSON.stringify(triagedPayload),
      }),
    )
    const webhookDirectResponse = await handleWebhook(
      new Request('https://example.test/api/feedback/webhook', {
        method: 'POST',
        headers: { 'x-github-event': 'issues' },
        body: JSON.stringify(triagedPayload),
      }),
      realWebhookDeps(process.env),
    )

    assert.equal(webhookAdapterResponse.status, webhookDirectResponse.status)
    assert.equal(webhookAdapterResponse.status, 401)
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  }
})

test('submit feedback stores row, creates GitHub issue, updates row, and sends confirmation', async () => {
  const setup = feedbackDeps()
  const response = await handleFeedback(
    feedbackRequest({
      message: 'The export button does nothing',
      email: 'person@example.com',
      subscribe: 'true',
      website: '',
      project: 'demo',
    }),
    setup.deps,
  )

  assert.equal(response.status, 200)
  assert.equal(setup.supabase.inserts.length, 1)
  assert.equal(setup.supabase.rows[0].status, 'new')
  assert.equal(setup.supabase.rows[0].journey_stage, 'received')
  assert.equal(setup.supabase.rows[0].submitter_email, 'person@example.com')
  assert.equal(setup.supabase.rows[0].subscribe, true)
  assert.equal(setup.createIssueCalls.length, 1)
  assert.equal(setup.supabase.rows[0].github_issue_number, 1)
  assert.equal(setup.supabase.rows[0].github_issue_url, 'https://x/1')
  assert.equal(setup.confirmations.length, 1)
})

test('submit feedback redacts sensitive data from GitHub issue title and body', async () => {
  const setup = feedbackDeps()
  const response = await handleFeedback(
    feedbackRequest({
      message: 'My email is leak@example.com and phone 555-123-4567, the export breaks',
      email: 'submitter@example.com',
      subscribe: 'true',
      website: '',
    }),
    setup.deps,
  )

  assert.equal(response.status, 200)
  const payload = setup.createIssueCalls[0].payload
  const githubText = `${payload.title}\n${payload.body}`
  assert.equal(githubText.includes('leak@example.com'), false)
  assert.equal(githubText.includes('555-123-4567'), false)
  assert.equal(githubText.includes('submitter@example.com'), false)
})

test('submit feedback without GITHUB_TOKEN still stores feedback', async () => {
  const setup = feedbackDeps({
    env: {
      GITHUB_TOKEN: undefined,
    },
  })
  const response = await handleFeedback(
    feedbackRequest({ message: 'Save this', website: '' }),
    setup.deps,
  )

  assert.equal(response.status, 200)
  assert.equal(setup.supabase.inserts.length, 1)
  assert.equal(setup.createIssueCalls.length, 0)
})

test('submit feedback continues when GitHub issue creation returns null', async () => {
  const setup = feedbackDeps({
    createIssue: async () => null,
  })
  const response = await handleFeedback(
    feedbackRequest({
      message: 'GitHub is down',
      email: 'person@example.com',
      subscribe: 'true',
      website: '',
    }),
    setup.deps,
  )

  assert.equal(response.status, 200)
  assert.equal(setup.supabase.inserts.length, 1)
  assert.equal(setup.confirmations.length, 0)
})

test('submit feedback stores invalid email as null and disables subscribe', async () => {
  const setup = feedbackDeps()
  const response = await handleFeedback(
    feedbackRequest({
      message: 'Email is invalid',
      email: 'notanemail',
      subscribe: 'true',
      website: '',
    }),
    setup.deps,
  )

  assert.equal(response.status, 200)
  assert.equal(setup.supabase.rows[0].submitter_email, null)
  assert.equal(setup.supabase.rows[0].subscribe, false)
})

test('honeypot returns fake success without inserting', async () => {
  const setup = feedbackDeps()
  const response = await handleFeedback(
    feedbackRequest({
      message: 'Bot submission',
      website: 'https://spam.test',
    }),
    setup.deps,
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.id, 'fake-id')
  assert.equal(setup.supabase.inserts.length, 0)
})

test('webhook rejects forged or missing signature without email', async () => {
  const setup = webhookDeps([])
  const response = await handleWebhook(
    new Request('https://example.test/api/feedback/webhook', {
      method: 'POST',
      headers: { 'x-github-event': 'issues' },
      body: JSON.stringify(triagedPayload),
    }),
    setup.deps,
  )

  assert.equal(response.status, 401)
  assert.equal(setup.stages.length, 0)
})

test('webhook sends triaged update and records emailed stage', async () => {
  const setup = webhookDeps([
    {
      id: 'feedback-1',
      submitter_email: 'person@example.com',
      subscribe: true,
      github_issue_number: 1,
      github_issue_url: 'https://x/1',
      github_repo: 'owner/repo',
      journey_stage: 'received',
      last_emailed_stage: null,
      ai_data: { title: 'Export issue' },
    },
  ])

  const response = await handleWebhook(webhookRequest(triagedPayload, 'secret'), setup.deps)

  assert.equal(response.status, 200)
  assert.equal(setup.stages.length, 1)
  assert.equal(setup.stages[0].stage, 'triaged')
  assert.equal(setup.supabase.rows[0].journey_stage, 'triaged')
  assert.equal(setup.supabase.rows[0].last_emailed_stage, 'triaged')
})

test('webhook is idempotent for the same event', async () => {
  const setup = webhookDeps([
    {
      id: 'feedback-1',
      submitter_email: 'person@example.com',
      subscribe: true,
      github_issue_number: 1,
      github_issue_url: 'https://x/1',
      github_repo: 'owner/repo',
      journey_stage: 'received',
      last_emailed_stage: null,
      ai_data: { title: 'Export issue' },
    },
  ])

  await handleWebhook(webhookRequest(triagedPayload, 'secret'), setup.deps)
  await handleWebhook(webhookRequest(triagedPayload, 'secret'), setup.deps)

  assert.equal(setup.stages.length, 1)
})

test('webhook ignores lower ranked stages', async () => {
  const setup = webhookDeps([
    {
      id: 'feedback-1',
      submitter_email: 'person@example.com',
      subscribe: true,
      github_issue_number: 1,
      github_issue_url: 'https://x/1',
      github_repo: 'owner/repo',
      journey_stage: 'in_progress',
      last_emailed_stage: null,
      ai_data: { title: 'Export issue' },
    },
  ])

  const response = await handleWebhook(webhookRequest(triagedPayload, 'secret'), setup.deps)

  assert.equal(response.status, 200)
  assert.equal(setup.stages.length, 0)
})

test('webhook ignores unsubscribed rows', async () => {
  const setup = webhookDeps([
    {
      id: 'feedback-1',
      submitter_email: 'person@example.com',
      subscribe: false,
      github_issue_number: 1,
      github_issue_url: 'https://x/1',
      github_repo: 'owner/repo',
      journey_stage: 'received',
      last_emailed_stage: null,
      ai_data: { title: 'Export issue' },
    },
  ])

  const response = await handleWebhook(webhookRequest(triagedPayload, 'secret'), setup.deps)

  assert.equal(response.status, 200)
  assert.equal(setup.stages.length, 0)
})

test('GitHub issue payload redacts adversarial PII and sanitizes screenshot URLs', () => {
  const secrets = [
    'user＠example.com',
    'alice [at] example [dot] com',
    'bob(at)mail(dot)co',
    '555[.]123[.]4567',
    '+1 (555) 123 4567',
    'https://u:p@host.com/x?token=abc#frag',
    'access_token=SEKRET123',
  ]

  for (const secret of secrets) {
    const payload = buildFeedbackIssuePayload({
      token: 'token',
      repo: 'owner/repo',
      aiData: {
        ...aiData,
        title: `Problem ${secret}`,
        short_summary: `Summary ${secret}`,
        key_details: [`Detail ${secret}`],
      },
      messageRaw: `Message ${secret}`,
      pageUrl: `https://u:p@app.test/path?token=${encodeURIComponent(secret)}#frag`,
      screenshotUrl: 'https://storage.test/feedback.png?X-Amz-Signature=SEKRET123#frag',
    })

    const text = `${payload.title}\n${payload.body}`
    assert.equal(text.includes(secret), false, secret)
    assert.equal(text.includes(secret.normalize('NFKC')), false, secret)
    assert.equal(text.includes('SEKRET123'), false)
    assert.equal(text.includes('X-Amz-Signature'), false)
    assert.equal(text.includes('u:p@'), false)
  }

  const unsafeScreenshotPayload = buildFeedbackIssuePayload({
    token: 'token',
    repo: 'owner/repo',
    aiData,
    messageRaw: 'Screenshot path token',
    pageUrl: 'https://app.test/path',
    screenshotUrl: 'https://storage.test/feedback/0123456789abcdef0123456789abcdef.png?X-Amz-Signature=SEKRET123',
  })

  assert.equal(unsafeScreenshotPayload.body.includes('[screenshot omitted: unsafe URL]'), true)
  assert.equal(unsafeScreenshotPayload.body.includes('0123456789abcdef0123456789abcdef'), false)
})

test('GitHub issue body defangs markdown / mention / control-char injection', () => {
  const mk = (s) => buildFeedbackIssuePayload({
    token: 't', repo: 'o/r',
    aiData: { ...aiData, title: s, short_summary: s, key_details: [s] },
    messageRaw: s, pageUrl: 'https://app.test/x',
  })
  // @mention must not stay a live GitHub mention
  let b = `${mk('ping @federicodeponte now').title}\n${mk('ping @federicodeponte now').body}`
  assert.equal(/@federicodeponte/.test(b.replace(/\u200B/g, '')) && !b.includes('@\u200Bfedericodeponte'), false)
  assert.equal(b.includes('@\u200Bfedericodeponte'), true)
  // issue cross-ref / auto-close keyword defanged
  b = mk('Closes #1 and fixes #2').body
  assert.equal(b.includes('#\u200B1') && b.includes('#\u200B2'), true)
  // fenced code breakout defanged
  assert.equal(mk('```js\\nx\\n```').body.includes('`\u200B`\u200B`\u200B'), true)
  // raw HTML escaped (no live tag)
  b = mk('<img src=x onerror=alert(1)>').body
  assert.equal(/<img|<script/i.test(b), false)
  assert.equal(b.includes('&lt;img'), true)
  // inline link / image (phishing + tracking pixel) defanged
  b = mk('![p](https://evil.test/t.png) and [go](https://evil.test)').body
  assert.equal(/!\[[^\]]*\]\(http/.test(b), false)
  assert.equal(/\[[^\]]*\]\(https?:/.test(b), false)
  // control / bidi (Trojan-Source) stripped
  const evil = `a${String.fromCharCode(0)}b${String.fromCharCode(0x202e)}c${String.fromCharCode(0xfeff)}d`
  b = mk(evil).body
  const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/
  assert.equal(CTRL.test(b), false)
  assert.equal(b.includes('abcd'), true)
})

test('Codex 2026-05-19 findings: ReDoS-bounded, Unicode-email, phone-extension, comprehensive control-strip, URL no-autolink', () => {
  const mk = (s) => buildFeedbackIssuePayload({
    token: 't', repo: 'o/r',
    aiData: { ...aiData, title: s, short_summary: s, key_details: [s] },
    messageRaw: s, pageUrl: 'https://app.test/x',
  })
  // #1 ReDoS: 10KB pathological input must complete fast (<500ms)
  const huge = '@'.repeat(10000) + 'a@b' + '.'.repeat(10000)
  const t0 = Date.now()
  mk(huge)
  const ms = Date.now() - t0
  assert.ok(ms < 500, `ReDoS guard: redaction took ${ms}ms on 10KB pathological input`)

  // #3 Unicode-dot email (U+3002 ideographic full stop)
  let b = mk('contact user@example。com today').body
  assert.equal(b.includes('user@example'), false, 'U+3002 email leaked')
  assert.equal(b.includes('[redacted email]'), true)
  // #3 CJK domain email
  b = mk('mail 例え@例え.テスト thanks').body
  assert.equal(b.includes('[redacted email]'), true, 'CJK-domain email not redacted')
  // #3 phone+extension glued
  b = mk('call 5558675309x123 today').body
  assert.equal(b.includes('5558675309'), false, 'phone-with-extension leaked')
  assert.equal(b.includes('[redacted phone]'), true)

  // #4 invisible-format chars beyond the old allowlist
  const invis = `AB${String.fromCharCode(0x2028)}C${String.fromCharCode(0x2029)}D${String.fromCharCode(0x180E)}E${String.fromCharCode(0x2060)}F${String.fromCharCode(0xFEFF)}G`
  b = mk(invis).body
  for (const cp of [0x2028, 0x2029, 0x180E, 0x2060, 0xFEFF]) {
    const ch = String.fromCharCode(cp)
    assert.equal(b.includes(ch), false, `control char U+${cp.toString(16)} survived strip`)
  }
  assert.equal(b.includes('ABCDEFG'), true, 'legitimate letters preserved')

  // #2 URLs must NOT autolink: sanitizeUrl inserts a zwsp after protocol
  b = mk('see https://evil.test/path for details').body
  // bare "https://evil.test" should no longer appear without a zwsp inside
  assert.equal(/https:\/\/evil\.test/.test(b), false, 'bare URL still autolinks')
  assert.ok(b.includes('https:'+String.fromCharCode(0x200B)+'//'), 'expected defanged URL with zwsp after protocol')
})

test('Codex round-6 findings: legit multi-segment URL renders; non-http scheme omits; paren-in-URL cannot break out', () => {
  const ai = { ...aiData }
  const mk = (ss) => buildFeedbackIssuePayload({
    token: 't', repo: 'o/r', aiData: ai, messageRaw: 'm', pageUrl: 'https://app.test/x', screenshotUrl: ss,
  }).body
  // #1 regression guard: a realistic Supabase public URL must STILL render
  // (the round-5 entropy regex was too greedy across slashes)
  const b1 = mk('https://project.supabase.co/storage/v1/object/public/feedback/1700000000000-abcde.png')
  assert.ok(/!\[Feedback screenshot\]\(http/.test(b1), 'legitimate Supabase URL should render')
  // #2 non-http schemes never embed (data: payload leak; javascript:)
  for (const u of ['data:image/png;base64,U0VDUkVUX1RPS0VO', 'javascript:alert(1)', 'mailto:x@y']) {
    const b = mk(u)
    assert.equal(b.includes(u.split(':')[1]?.slice(0, 10) || u), false, `non-http URL embedded: ${u}`)
    assert.equal(b.includes('[screenshot omitted: unsafe URL]'), true)
  }
  // #3 markdown image breakout via `)` in URL must not yield extra images
  const b3 = mk('https://cdn.test/a)![x](https://evil.test/pixel.png')
  assert.equal(/!\[x\]\(https:\/\/evil/.test(b3), false, 'paren-injection rendered extra image')
})

test('Codex round-5 findings: localized-digit phones redact; base32/percent-encoded screenshot URLs omitted', () => {
  const mk = (s, ss) => buildFeedbackIssuePayload({
    token: 't', repo: 'o/r',
    aiData: { ...aiData, title: s, short_summary: s, key_details: [s] },
    messageRaw: s, pageUrl: 'https://app.test/x', screenshotUrl: ss,
  }).body
  // Localized digit scripts (Arabic-Indic, Devanagari, Bengali) must redact
  // as phone like ASCII.
  for (const ph of ['٥٥٥١٢٣٤٥٦٧', '५५५१२३४५६७']) {
    const b = mk(`call ${ph} now`)
    assert.equal(b.includes(ph), false, `localized digits leaked: ${ph}`)
    assert.equal(b.includes('[redacted phone]'), true)
  }
  // Screenshot path with base32 padding or percent-encoding must be omitted.
  for (const ss of [
    'https://cdn.test/files/MFRGGZDFMZTWQ2LKNNWG23TPOI======.png',
    'https://cdn.test/files/abcdEFGHijklMNOPqrstUVWX%2Fyz012345%2B6789%3D.png',
  ]) {
    const b = mk('shot', ss)
    assert.equal(/!\[Feedback screenshot\]\(http/.test(b), false, `unsafe screenshot URL rendered: ${ss}`)
    assert.equal(b.includes('[screenshot omitted: unsafe URL]'), true)
  }
})

test('Codex round-4 findings: attacker default-ignorable inside email/URL must be stripped BEFORE redaction; bare GTIN-length phones must redact', () => {
  const mk = (s) => buildFeedbackIssuePayload({
    token: 't', repo: 'o/r',
    aiData: { ...aiData, title: s, short_summary: s, key_details: [s] },
    messageRaw: s, pageUrl: 'https://app.test/x',
  }).body
  const ZWSP = String.fromCharCode(0x200B)
  // attacker inserts U+200B inside the email -> stripControl runs BEFORE
  // EMAIL_RE so redaction still fires (Codex round 4 #1)
  for (const evil of [
    `contact leak@example.${ZWSP}com now`,
    `contact leak@exa${ZWSP}mple.com now`,
    `mail user${ZWSP}@example.com x`,
  ]) {
    const b = mk(evil)
    assert.equal(b.includes('leak@'), false, `mid-zwsp email leaked: ${JSON.stringify(evil)}`)
    assert.equal(b.includes('example.com'), false, `mid-zwsp email domain leaked`)
  }
  // bare 8/12/13/14 digit numbers must redact (GTIN_RE removed; phone-vs-GTIN
  // indistinguishable, redaction wins - Codex round 4 #2)
  for (const ph of ['55512345', '447911123456', '4915112345678', '00012345600012']) {
    const b = mk(`call ${ph}`)
    assert.equal(b.includes(ph), false, `bare ${ph.length}-digit number leaked as phone`)
    assert.equal(b.includes('[redacted phone]'), true)
  }
})

test('Codex round-3 findings: combining-mark emails, punycode TLD, www. defang, date/IPv4/ISBN/GTIN survive, default-ignorable stripped, cap-after-NFKC', () => {
  const mk = (s) => buildFeedbackIssuePayload({
    token: 't', repo: 'o/r',
    aiData: { ...aiData, title: s, short_summary: s, key_details: [s] },
    messageRaw: s, pageUrl: 'https://app.test/x',
  })
  for (const eml of ['عَرَبِيّ@example.com', 'user@مِثال.إختبار', 'user@example.xn--p1ai']) {
    const b = mk(eml).body
    assert.equal(b.includes(eml), false, `email ${eml} leaked`)
    assert.equal(b.includes('[redacted email]'), true, `${eml} not redacted`)
  }
  let b = mk('see www.evil.test/path').body
  assert.equal(/\bwww\.evil\.test/.test(b), false, 'bare www. still autolinks')
  // Hyphenated ISO date / IPv4 / hyphenated ISBN-13 survive (have shape).
  // Bare GTIN (no separators) is intentionally NOT kept: indistinguishable
  // from international phones; redaction wins (Codex round 4 #2).
  for (const id of ['2026-05-19', '192.168.100.200', '978-0-306-40615-7']) {
    b = mk(`reference ${id} here`).body
    assert.equal(b.includes(id), true, `identifier ${id} was over-redacted`)
  }
  const evil = `A${String.fromCharCode(0x034F)}B${String.fromCharCode(0xFE0F)}C${String.fromCharCode(0xFE00)}D`
  b = mk(evil).body
  for (const cp of [0x034F, 0xFE00, 0xFE0F]) {
    assert.equal(b.includes(String.fromCharCode(cp)), false, `U+${cp.toString(16)} survived`)
  }
  assert.equal(b.includes('ABCD'), true, 'legitimate letters preserved')
  const big = 'ﷺ'.repeat(8192)
  const t0 = Date.now()
  mk(big)
  const ms = Date.now() - t0
  assert.ok(ms < 500, `cap-after-NFKC: ${ms}ms (expected < 500)`)
})

test('phone redaction preserves alphanumeric ids but still redacts real phones', () => {
  // Defensible contract: identifiers where digits are glued to letters (the
  // real reported case, e.g. CMB1779152387) must survive so the issue stays
  // actionable. Residual (documented, by design): a PURE numeric group split
  // by separators (e.g. ORD-2024-998877 -> the 2024-998877 part) is
  // indistinguishable from a phone by pattern alone, so it stays redacted as
  // the privacy-safe default. Glued alphanumerics are the precision win.
  const keepIds = ['CMB1779152387', 'ABC123456789', 'sha256:9f8e7d6c5b4a3210', 'v12345678', 'INV-2024-X7Q9']
  const realPhones = ['555-867-5309', '+1 (555) 123 4567', '5558675309', '555.867.5309', '+44 20 7946 0958']

  for (const id of keepIds) {
    const p = buildFeedbackIssuePayload({
      token: 't', repo: 'o/r', aiData: { ...aiData, title: `Broken ${id}`, short_summary: `re ${id}`, key_details: [`id ${id}`] },
      messageRaw: `The export for ${id} fails`, pageUrl: 'https://app.test/x',
    })
    const text = `${p.title}\n${p.body}`
    assert.equal(text.includes(id), true, `id should survive: ${id}`)
  }

  for (const ph of realPhones) {
    const p = buildFeedbackIssuePayload({
      token: 't', repo: 'o/r', aiData: { ...aiData, title: 'Call me', short_summary: `reach ${ph}`, key_details: [`phone ${ph}`] },
      messageRaw: `Please call ${ph} about this`, pageUrl: 'https://app.test/x',
    })
    const text = `${p.title}\n${p.body}`
    assert.equal(text.includes(ph), false, `phone should be redacted: ${ph}`)
    assert.equal(text.includes('[redacted phone]'), true, `expected redaction marker for: ${ph}`)
  }
})

test('webhook ignores signed issue events from a different configured repo', async () => {
  const setup = webhookDeps([
    {
      id: 'feedback-1',
      submitter_email: 'person@example.com',
      subscribe: true,
      github_issue_number: 1,
      github_issue_url: 'https://x/1',
      github_repo: 'owner/repo',
      journey_stage: 'received',
      last_emailed_stage: null,
      ai_data: { title: 'Export issue' },
    },
  ], {
    env: {
      GITHUB_FEEDBACK_REPO: 'owner/repo',
    },
  })

  const response = await handleWebhook(
    webhookRequest({
      ...triagedPayload,
      repository: { full_name: 'attacker/repo' },
    }, 'secret'),
    setup.deps,
  )
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(body, { ignored: true })
  assert.equal(setup.stages.length, 0)
  assert.equal(setup.supabase.rows[0].journey_stage, 'received')
})

test('webhook concurrent duplicate deliveries send one stage email', async () => {
  const setup = webhookDeps([
    {
      id: 'feedback-1',
      submitter_email: 'person@example.com',
      subscribe: true,
      github_issue_number: 1,
      github_issue_url: 'https://x/1',
      github_repo: 'owner/repo',
      journey_stage: 'received',
      last_emailed_stage: null,
      ai_data: { title: 'Export issue' },
    },
  ])

  await Promise.all([
    handleWebhook(webhookRequest(triagedPayload, 'secret'), setup.deps),
    handleWebhook(webhookRequest(triagedPayload, 'secret'), setup.deps),
  ])

  assert.equal(setup.stages.length, 1)
  assert.equal(setup.supabase.rows[0].journey_stage, 'triaged')
  assert.equal(setup.supabase.rows[0].last_emailed_stage, 'triaged')
})
