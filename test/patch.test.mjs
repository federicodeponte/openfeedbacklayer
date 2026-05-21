import test from 'node:test'
import assert from 'node:assert/strict'
import { handlePatch } from '../dist/server.mjs'

const FID = '00000000-0000-4000-8000-000000000001'

function fakeSupabase(initialRow) {
  let row = { ...initialRow, id: FID }
  return {
    from() {
      return this
    },
    select(_cols) {
      return this
    },
    eq(_col, _val) {
      return this
    },
    maybeSingle() {
      // Both reads + the final write go through .maybeSingle()
      return Promise.resolve({ data: row, error: null })
    },
    update(patch) {
      row = { ...row, ...patch }
      return this
    },
    _row: () => row,
  }
}

function patchReq(body) {
  return new Request(`http://test.local/api/feedback/${FID}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('PATCH follow_up with prior aiData -> refine path', async () => {
  const supabase = fakeSupabase({
    message_raw: 'export breaks',
    ai_data: {
      title: 'Export breaks',
      short_summary: 'Export is broken.',
      key_details: [],
      suggested_category: 'bug',
      suggested_feature_area: 'export',
      suggested_priority: 'high',
      steps: [],
      expected: null,
      confidence: 0.9,
      clarifying_questions: [],
    },
    subscribe: false,
  })
  let refineCalled = false
  let analyzeCalled = false
  const refined = {
    title: 'Export needs PDF',
    short_summary: 'You want PDF export.',
    key_details: [],
    suggested_category: 'feature',
    suggested_feature_area: 'export',
    suggested_priority: 'low',
    steps: [],
    expected: null,
    confidence: 0.9,
    clarifying_questions: [],
  }
  const res = await handlePatch(patchReq({ follow_up: 'actually a feature request for PDF' }), FID, {
    supabase,
    env: { GEMINI_API_KEY: 'test' },
    refine: async () => {
      refineCalled = true
      return refined
    },
    analyze: async () => {
      analyzeCalled = true
      return null
    },
  })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(refineCalled, true, 'should have called refine')
  assert.equal(analyzeCalled, false, 'should NOT have called analyze (prior aiData present)')
  assert.equal(body.ai_data.title, 'Export needs PDF')
  assert.equal(body.ai_data.suggested_category, 'feature')
})

test('PATCH follow_up with NO prior aiData -> falls back to analyze (no more 409)', async () => {
  const supabase = fakeSupabase({
    message_raw: 'sync hangs at fetching manifest',
    ai_data: null,
    subscribe: false,
  })
  let refineCalled = false
  let analyzeArg = null
  const fresh = {
    title: 'Sync hangs at fetching manifest',
    short_summary: 'You reported a sync hang.',
    key_details: [],
    suggested_category: 'bug',
    suggested_feature_area: 'sync',
    suggested_priority: 'high',
    steps: [],
    expected: null,
    confidence: 0.9,
    clarifying_questions: [],
  }
  const res = await handlePatch(
    patchReq({ follow_up: 'Actually it is Linux not Mac, times out at 30s' }),
    FID,
    {
      supabase,
      env: { GEMINI_API_KEY: 'test' },
      refine: async () => {
        refineCalled = true
        return fresh
      },
      analyze: async (args) => {
        analyzeArg = args
        return fresh
      },
    },
  )
  assert.equal(res.status, 200, 'should not 409 just because prior aiData is null')
  const body = await res.json()
  assert.equal(refineCalled, false, 'should NOT have called refine (no prior)')
  assert.ok(analyzeArg, 'should have called analyze with combined text')
  assert.match(analyzeArg.messageRaw, /sync hangs at fetching manifest/)
  assert.match(analyzeArg.messageRaw, /Submitter follow-up/)
  assert.match(analyzeArg.messageRaw, /Linux not Mac/)
  assert.equal(body.ai_data.title, 'Sync hangs at fetching manifest')
})

test('PATCH follow_up when AI fails -> still saves text, returns 200 (no dead-end)', async () => {
  // Federico screenshot 2026-05-20 11:18: refine was stuck on "AI
  // refinement failed - please try again or rephrase" because the free
  // Gemini tier was exhausted (20 reqs/day). The user had nowhere to go.
  // Fix: when both refine and the analyze-fallback return null, we still
  // persist the follow-up by appending it to message_raw and return 200.
  // The team sees the added context in DB + GitHub; only the AI metadata
  // doesn't update this turn.
  const supabase = fakeSupabase({
    message_raw: 'sync hangs at fetching manifest',
    ai_data: null,
    subscribe: false,
  })
  const res = await handlePatch(
    patchReq({ follow_up: 'Actually it is Linux not Mac' }),
    FID,
    {
      supabase,
      env: { GEMINI_API_KEY: 'test' },
      refine: async () => null,
      analyze: async () => null, // Gemini fully down
    },
  )
  assert.equal(res.status, 200, 'should NOT 502 when AI fails')
  const body = await res.json()
  assert.equal(body.ai_data, null, 'ai_data stays untouched')
  // Verify the row's message_raw was updated to include the follow-up
  const finalRow = supabase._row()
  assert.match(finalRow.message_raw, /sync hangs at fetching manifest/)
  assert.match(finalRow.message_raw, /\[Submitter follow-up\]:/)
  assert.match(finalRow.message_raw, /Linux not Mac/)
})

test('PATCH follow_up with no GEMINI key -> 503', async () => {
  const supabase = fakeSupabase({ message_raw: 'x', ai_data: null, subscribe: false })
  const res = await handlePatch(patchReq({ follow_up: 'something' }), FID, {
    supabase,
    env: {}, // no GEMINI_API_KEY
    refine: async () => null,
    analyze: async () => null,
  })
  assert.equal(res.status, 503)
})

test('PATCH submitter_email + subscribe still work alongside follow_up plumbing', async () => {
  const supabase = fakeSupabase({ message_raw: 'x', ai_data: null, subscribe: false })
  const res = await handlePatch(
    patchReq({ submitter_email: 'me@example.com', subscribe: true }),
    FID,
    {
      supabase,
      env: { GEMINI_API_KEY: 'test' },
      refine: async () => null,
      analyze: async () => null,
    },
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.subscribe, true)
})

test('PATCH with no mutable fields -> 400', async () => {
  const supabase = fakeSupabase({ message_raw: 'x', ai_data: null, subscribe: false })
  const res = await handlePatch(patchReq({}), FID, {
    supabase,
    env: { GEMINI_API_KEY: 'test' },
    refine: async () => null,
    analyze: async () => null,
  })
  assert.equal(res.status, 400)
})

test('PATCH with invalid follow_up type -> 400', async () => {
  const supabase = fakeSupabase({ message_raw: 'x', ai_data: null, subscribe: false })
  const res = await handlePatch(patchReq({ follow_up: 123 }), FID, {
    supabase,
    env: { GEMINI_API_KEY: 'test' },
    refine: async () => null,
    analyze: async () => null,
  })
  assert.equal(res.status, 400)
})
