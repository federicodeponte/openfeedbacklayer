/**
 * Feedback journey unit tests (no framework - Node built-in test runner).
 * Run: npm test  (builds first, then tests dist artifacts)
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyGitHubSignature, stageFromGitHubEvent } from '../dist/server.mjs'

const secret = 's3cr3t'
const body = JSON.stringify({ hello: 'world' })
const goodSig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')

test('verifyGitHubSignature accepts a valid signature', () => {
  assert.equal(verifyGitHubSignature(secret, body, goodSig), true)
})

test('verifyGitHubSignature rejects a tampered body', () => {
  assert.equal(verifyGitHubSignature(secret, body + 'x', goodSig), false)
})

test('verifyGitHubSignature rejects a wrong secret', () => {
  assert.equal(verifyGitHubSignature('nope', body, goodSig), false)
})

test('verifyGitHubSignature rejects missing / malformed headers', () => {
  assert.equal(verifyGitHubSignature(secret, body, null), false)
  assert.equal(verifyGitHubSignature(secret, body, 'md5=abc'), false)
})

test('verifyGitHubSignature is safe on length mismatch (no throw)', () => {
  assert.equal(verifyGitHubSignature(secret, body, 'sha256=ab'), false)
})

test('verifyGitHubSignature rejects an empty secret', () => {
  assert.equal(verifyGitHubSignature('', body, goodSig), false)
})

test('stageFromGitHubEvent maps close -> shipped', () => {
  assert.equal(
    stageFromGitHubEvent({ action: 'closed', issue: { state: 'closed', state_reason: 'completed' } }),
    'shipped',
  )
})

test('stageFromGitHubEvent maps close not_planned -> wont_fix', () => {
  assert.equal(
    stageFromGitHubEvent({ action: 'closed', issue: { state: 'closed', state_reason: 'not_planned' } }),
    'wont_fix',
  )
})

test('stageFromGitHubEvent maps triage / in-progress labels', () => {
  assert.equal(
    stageFromGitHubEvent({ action: 'labeled', label: { name: 'Triaged' }, issue: { state: 'open' } }),
    'triaged',
  )
  for (const name of ['In Progress', 'in-progress', 'wip']) {
    assert.equal(
      stageFromGitHubEvent({ action: 'labeled', label: { name }, issue: { state: 'open' } }),
      'in_progress',
    )
  }
})

test('stageFromGitHubEvent returns null for unrelated events', () => {
  assert.equal(
    stageFromGitHubEvent({ action: 'labeled', label: { name: 'docs' }, issue: { state: 'open' } }),
    null,
  )
  assert.equal(stageFromGitHubEvent({ action: 'opened', issue: { state: 'open' } }), null)
})
