import test from 'node:test'
import assert from 'node:assert/strict'
import { handleFeedback, feedbackHealthGET } from '../dist/server.mjs'

function fakeDeps(overrides = {}) {
  const inserted = []
  return {
    supabase: {
      from() {
        return this
      },
      insert(payload) {
        inserted.push(payload)
        return this
      },
      select() {
        return this
      },
      single() {
        return Promise.resolve({ data: { id: 'fake-uuid' }, error: null })
      },
      update() {
        return this
      },
      eq() {
        return this
      },
    },
    env: { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k', ...overrides.env },
    analyze: async () => null,
    createIssue: async () => null,
    sendConfirmation: async () => undefined,
    _inserted: inserted,
  }
}

test('handleFeedback accepts application/json body', async () => {
  const deps = fakeDeps()
  const req = new Request('http://test/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'JSON path works',
      website: '',
      subscribe: false,
    }),
  })
  const res = await handleFeedback(req, deps)
  assert.equal(res.status, 200, await res.clone().text())
  const body = await res.json()
  assert.equal(body.id, 'fake-uuid')
  assert.equal(deps._inserted.length, 1)
  assert.equal(deps._inserted[0].message_raw, 'JSON path works')
})

test('handleFeedback honeypot via JSON body still triggers stealth-200', async () => {
  const deps = fakeDeps()
  const req = new Request('http://test/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'bot',
      website: 'http://spam.example/buy-viagra',
    }),
  })
  const res = await handleFeedback(req, deps)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.id, 'fake-id') // stealth response
  assert.equal(deps._inserted.length, 0, 'should not have inserted')
})

test('handleFeedback rejects invalid JSON body', async () => {
  const deps = fakeDeps()
  const req = new Request('http://test/api/feedback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json at all',
  })
  const res = await handleFeedback(req, deps)
  assert.equal(res.status, 400)
})

test('handleFeedback multipart path still works (back-compat)', async () => {
  const deps = fakeDeps()
  const form = new FormData()
  form.append('message', 'Multipart still ok')
  form.append('website', '')
  form.append('subscribe', 'false')
  const req = new Request('http://test/api/feedback', {
    method: 'POST',
    body: form,
  })
  const res = await handleFeedback(req, deps)
  assert.equal(res.status, 200, await res.clone().text())
  assert.equal(deps._inserted[0].message_raw, 'Multipart still ok')
})

test('feedbackHealthGET returns 200 and reports integration presence', async () => {
  // Snapshot then mutate process.env in-place so the inline import reading
  // process.env sees the test config; restore on teardown.
  const saved = { ...process.env }
  process.env.SUPABASE_URL = 'http://test-supabase'
  process.env.GEMINI_API_KEY = 'test-gemini'
  delete process.env.GITHUB_TOKEN
  delete process.env.RESEND_API_KEY
  delete process.env.GITHUB_WEBHOOK_SECRET
  try {
    const req = new Request('http://test/api/feedback/health')
    const res = feedbackHealthGET(req)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.status, 'ok')
    assert.equal(body.integrations.supabase, true)
    assert.equal(body.integrations.gemini, true)
    assert.equal(body.integrations.openai, false)
    assert.equal(body.integrations.ai, true) // either provider counts
    assert.equal(body.integrations.github, false)
    assert.equal(body.integrations.resend, false)
    assert.equal(body.integrations.webhook_secret, false)
    assert.match(body.timestamp, /^\d{4}-\d{2}-\d{2}T/)
  } finally {
    process.env = saved
  }
})
