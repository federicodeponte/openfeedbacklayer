import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeFeedback } from '../dist/index.mjs'

/**
 * Provider-routing tests. We can't call the real OpenAI / Gemini APIs in
 * CI, so these assert the routing decision by intercepting global fetch
 * (OpenAI path) and observing which endpoint — if any — gets hit.
 */

function withFetchSpy(run) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    // Minimal valid OpenAI chat-completions response.
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: 'Export button broken',
                short_summary: "You're reporting the export button does nothing.",
                key_details: ['export', 'button'],
                suggested_category: 'bug',
                suggested_feature_area: 'export',
                suggested_priority: 'medium',
                steps: [],
                expected: null,
                confidence: 0.9,
                clarifying_questions: [],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }
  return Promise.resolve(run(calls)).finally(() => {
    globalThis.fetch = original
  })
}

test('analyzeFeedback routes to OpenAI when openaiApiKey is set', async () => {
  await withFetchSpy(async (calls) => {
    const result = await analyzeFeedback({
      messageRaw: 'The export button does nothing',
      openaiApiKey: 'sk-test',
    })
    assert.equal(calls.length, 1, 'should have made exactly one fetch')
    assert.match(calls[0].url, /api\.openai\.com\/v1\/chat\/completions/)
    assert.equal(result?.title, 'Export button broken')
    assert.equal(result?.suggested_category, 'bug')
  })
})

test('analyzeFeedback OpenAI request uses json_object response_format', async () => {
  await withFetchSpy(async (calls) => {
    await analyzeFeedback({ messageRaw: 'x', openaiApiKey: 'sk-test' })
    const body = JSON.parse(calls[0].init.body)
    assert.equal(body.response_format.type, 'json_object')
    assert.equal(body.model, 'gpt-4o-mini', 'default model')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer sk-test')
  })
})

test('analyzeFeedback OpenAI honours openaiModel override', async () => {
  await withFetchSpy(async (calls) => {
    await analyzeFeedback({
      messageRaw: 'x',
      openaiApiKey: 'sk-test',
      openaiModel: 'gpt-4o',
    })
    const body = JSON.parse(calls[0].init.body)
    assert.equal(body.model, 'gpt-4o')
  })
})

test('analyzeFeedback prefers OpenAI when BOTH keys are set', async () => {
  await withFetchSpy(async (calls) => {
    await analyzeFeedback({
      messageRaw: 'x',
      openaiApiKey: 'sk-test',
      geminiApiKey: 'gemini-test',
    })
    // Exactly one call, and it's OpenAI — Gemini SDK would not hit fetch
    // with this URL.
    assert.equal(calls.length, 1)
    assert.match(calls[0].url, /api\.openai\.com/)
  })
})

test('analyzeFeedback returns null when NO provider key is set', async () => {
  await withFetchSpy(async (calls) => {
    const result = await analyzeFeedback({ messageRaw: 'x' })
    assert.equal(result, null)
    assert.equal(calls.length, 0, 'should not hit any API')
  })
})

test('analyzeFeedback returns null gracefully on OpenAI HTTP error', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    })
  try {
    const result = await analyzeFeedback({ messageRaw: 'x', openaiApiKey: 'sk-test' })
    assert.equal(result, null, 'should fail closed, not throw')
  } finally {
    globalThis.fetch = original
  }
})
