import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')

function isNpmUnavailable(error) {
  const output = `${error.stdout || ''}\n${error.stderr || ''}\n${error.message || ''}`
  return /ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|network|fetch failed|could not resolve/i.test(output)
}

test('published package contract', async (t) => {
  let tarballPath = null
  let tempDir = null

  try {
    execFileSync('npm', ['--version'], { stdio: 'ignore' })
  } catch (error) {
    t.skip(`npm unavailable: ${error.message}`)
    return
  }

  try {
    const tarballName = execFileSync('npm', ['pack', '--silent'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().split('\n').at(-1)
    tarballPath = join(repoRoot, tarballName)
    tempDir = mkdtempSync(join(tmpdir(), 'openfeedbacklayer-consumer-'))

    execFileSync('npm', ['init', '-y'], {
      cwd: tempDir,
      stdio: 'ignore',
    })

    try {
      execFileSync('npm', ['install', '--silent', tarballPath, '@supabase/supabase-js', '@octokit/rest', 'resend'], {
        cwd: tempDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      if (isNpmUnavailable(error)) {
        t.skip(`npm registry unavailable: ${error.message}`)
        return
      }
      throw error
    }

    const output = execFileSync(
      'node',
      ['-e', "import('openfeedbacklayer').then(()=>import('openfeedbacklayer/server')).then(()=>console.log('OK'))"],
      {
        cwd: tempDir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    assert.match(output, /OK/)
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true })
    if (tarballPath) {
      try {
        unlinkSync(tarballPath)
      } catch {
        // Tarball cleanup is best effort.
      }
    }
  }
})

test('browser entry is node-builtin free', () => {
  const browserEntry = readFileSync(join(repoRoot, 'dist/index.mjs'), 'utf8')
  assert.doesNotMatch(browserEntry, /from ?["']node:crypto["']|require\(["']crypto["']\)|["']crypto["']/)
})
