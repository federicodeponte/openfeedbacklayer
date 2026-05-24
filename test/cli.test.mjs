import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'

const CLI = new URL('../dist/cli.mjs', import.meta.url).pathname

function run(args, { env = {}, stdin } = {}) {
  // Use async spawn + promise wrapper. spawnSync hangs against a local
  // HTTP server because the global fetch keep-alive agent retains the
  // outbound socket past process.exit, and spawnSync waits on the
  // child's stdio pipes to drain before returning.
  return new Promise((resolve, reject) => {
    const child = spawn('node', [CLI, ...args], {
      env: { ...process.env, ...env },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (c) => (stdout += c.toString()))
    child.stderr.on('data', (c) => (stderr += c.toString()))
    if (stdin !== undefined) child.stdin.end(stdin)
    else child.stdin.end()
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('CLI test timeout after 8s'))
    }, 8000)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

function spawnFakeServer(handler) {
  return new Promise((resolve, reject) => {
    const srv = createServer(async (req, res) => {
      try {
        const chunks = []
        for await (const c of req) chunks.push(c)
        const body = Buffer.concat(chunks).toString('utf8')
        await handler({ req, res, body })
      } catch (err) {
        res.statusCode = 500
        res.end(String(err))
      }
    })
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      resolve({
        url: `http://127.0.0.1:${port}/api/feedback`,
        close: () => new Promise((r) => srv.close(() => r())),
      })
    })
  })
}

test('CLI: --version prints semver', async () => {
  const r = await run(['--version'])
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /openfeedbacklayer \d+\.\d+\.\d+/)
})

test('CLI: --help prints usage', async () => {
  const r = await run(['--help'])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /Usage/)
  assert.match(r.stdout, /send/)
})

test('CLI: no args prints help and exits 0', async () => {
  const r = await run([])
  assert.equal(r.code, 0)
  assert.match(r.stdout, /Usage/)
  assert.match(r.stdout, /send/)
})

test('CLI: unknown command exits 1', async () => {
  const r = await run(['frobnicate'])
  assert.equal(r.code, 1)
  assert.match(r.stderr, /unknown command/i)
})

test('CLI: send with no message exits 1', async () => {
  const r = await run(['send'], { env: { OFL_API_URL: 'http://0.0.0.0:0/' } })
  assert.equal(r.code, 1)
  assert.match(r.stderr, /no message/i)
})

test('CLI: network error exits 2', async () => {
  // Port 1 is reserved on Linux and refuses connections.
  const r = await run(['send', 'hello'], { env: { OFL_API_URL: 'http://127.0.0.1:1/api/feedback' } })
  assert.equal(r.code, 2)
  assert.match(r.stderr, /could not reach/i)
})

test('CLI: invalid --email exits 1 before network fetch', async () => {
  const r = await run(
    ['send', 'hello', '--email', 'not-an-email', '--subscribe'],
    { env: { OFL_API_URL: 'http://127.0.0.1:1/api/feedback' } },
  )
  assert.equal(r.code, 1)
  assert.match(r.stderr, /Error: invalid email address: not-an-email/)
  assert.doesNotMatch(r.stderr, /could not reach/i)
})

test('CLI: server 4xx exits 3', async () => {
  const server = await spawnFakeServer(({ res }) => {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'Message is required' }))
  })
  try {
    const r = await run(['send', 'x'], { env: { OFL_API_URL: server.url } })
    assert.equal(r.code, 3, r.stderr)
    assert.match(r.stderr, /HTTP 400/)
    assert.match(r.stderr, /Message is required/)
  } finally {
    await server.close()
  }
})

test('CLI: 2xx with --json prints the JSON body', async () => {
  const payload = {
    id: 'deadbeef-1234',
    ai_data: { title: 'Sync hangs on Mac', short_summary: 'You reported a sync hang.' },
    github_issue_number: 42,
    github_issue_url: 'https://example.com/issues/42',
  }
  const server = await spawnFakeServer(({ res }) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(payload))
  })
  try {
    const r = await run(['send', '--json', 'hello world'], { env: { OFL_API_URL: server.url } })
    assert.equal(r.code, 0, r.stderr)
    const parsed = JSON.parse(r.stdout)
    assert.equal(parsed.id, 'deadbeef-1234')
    assert.equal(parsed.github_issue_number, 42)
  } finally {
    await server.close()
  }
})

test('CLI: 2xx human output mentions issue number + AI title', async () => {
  const server = await spawnFakeServer(({ res }) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        id: 'x',
        ai_data: { title: 'Dark mode crash' },
        github_issue_number: 7,
        github_issue_url: 'https://example.com/issues/7',
      }),
    )
  })
  try {
    const r = await run(['send', 'dark mode crashed on save'], { env: { OFL_API_URL: server.url } })
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /We got your message/)
    assert.match(r.stdout, /Dark mode crash/)
    assert.match(r.stdout, /issue #7/)
    assert.match(r.stdout, /https:\/\/example.com\/issues\/7/)
  } finally {
    await server.close()
  }
})

test('CLI: 2xx human output surfaces server email warning on stderr', async () => {
  const server = await spawnFakeServer(({ res }) => {
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        id: 'x',
        email_warning: 'Invalid email format; subscribe was skipped',
      }),
    )
  })
  try {
    const r = await run(['send', 'hello'], { env: { OFL_API_URL: server.url } })
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stderr, /Warning: Invalid email format; subscribe was skipped/)
    assert.match(r.stdout, /We got your message/)
  } finally {
    await server.close()
  }
})

test('CLI: reads message from stdin when no positional', async () => {
  let receivedBody = ''
  const server = await spawnFakeServer(({ res, body }) => {
    receivedBody = body
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: 'a', github_issue_number: 1, github_issue_url: 'https://example.com/1' }))
  })
  try {
    const r = await run(['send'], { env: { OFL_API_URL: server.url }, stdin: 'piped message from stdin\n' })
    assert.equal(r.code, 0, r.stderr)
    assert.match(receivedBody, /piped message from stdin/)
  } finally {
    await server.close()
  }
})

test('CLI: --email + --subscribe forwarded in the JSON body', async () => {
  let receivedBody = ''
  let receivedContentType = ''
  const server = await spawnFakeServer(({ req, res, body }) => {
    receivedBody = body
    receivedContentType = req.headers['content-type'] || ''
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ id: 'a' }))
  })
  try {
    const r = await run(
      ['send', 'hi', '--email', 'fede@example.com', '--subscribe'],
      { env: { OFL_API_URL: server.url } },
    )
    assert.equal(r.code, 0, r.stderr)
    assert.match(receivedContentType, /application\/json/)
    const parsed = JSON.parse(receivedBody)
    assert.equal(parsed.email, 'fede@example.com')
    assert.equal(parsed.subscribe, true)
    assert.equal(parsed.message, 'hi')
  } finally {
    await server.close()
  }
})
