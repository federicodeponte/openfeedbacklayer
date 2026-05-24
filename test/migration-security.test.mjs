import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')

function migration(name) {
  return readFileSync(join(repoRoot, 'supabase/migrations', name), 'utf8')
}

test('feedback table migration is service-route only by default', () => {
  const sql = migration('001_create_feedback.sql')

  assert.match(sql, /ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;/)
  assert.match(sql, /ALTER TABLE feedback FORCE ROW LEVEL SECURITY;/)
  assert.match(sql, /REVOKE ALL ON TABLE feedback FROM anon;/)
  assert.match(sql, /REVOKE ALL ON TABLE feedback FROM authenticated;/)
  assert.doesNotMatch(sql, /Allow anyone to insert feedback/i)
  assert.doesNotMatch(sql, /ON feedback FOR INSERT\s+WITH CHECK \(true\)/i)
})

test('screenshot storage migration does not allow direct public uploads', () => {
  const sql = migration('003_screenshot_storage.sql')

  assert.doesNotMatch(sql, /FOR INSERT\s+WITH CHECK \(bucket_id = 'feedback'\)/i)
  assert.match(sql, /server-only/i)
  assert.match(sql, /Allow public reads from feedback bucket/)
})
