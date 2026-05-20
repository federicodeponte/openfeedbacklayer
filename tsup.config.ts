import { defineConfig } from 'tsup'

// Two-config build: client entries get a "use client" banner so importing
// FeedbackWidget in a Next App Router server-component layout works. The
// ./server entry must NOT have "use client" - it is server-only Route
// Handler code. (Codex round-6 launch blocker: tsup strips the source-
// level directive during bundling, leaving dist/index.mjs without it.)
const SHARED = {
  format: ['cjs', 'esm'] as const,
  dts: true,
  splitting: false,
  sourcemap: true,
  external: ['react', 'react-dom', '@octokit/rest', '@supabase/supabase-js', 'resend', 'node:crypto'],
  treeshake: true,
}

// `clean: true` on any tsup config wipes the WHOLE dist folder, so when
// multiple configs run in parallel a later config's output can be deleted
// by an earlier config that started after it. We pre-clean once via the
// package.json build script, then every config uses `clean: false`.
export default defineConfig([
  {
    ...SHARED,
    entry: {
      index: 'src/index.ts',
      widget: 'src/components/FeedbackWidget.tsx',
    },
    clean: false,
    // Post-build: prepend "use client" to every emitted client bundle so
    // Next App Router server components can import FeedbackWidget directly.
    // tsup's `banner` option silently no-ops here (8.5.1), so do it
    // deterministically. (Codex round-6 launch blocker.)
    async onSuccess() {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const dir = 'dist'
      const files = ['index.mjs', 'index.js', 'widget.mjs', 'widget.js']
      const directive = '"use client";\n'
      for (const name of files) {
        const p = path.join(dir, name)
        try {
          const body = await fs.readFile(p, 'utf8')
          if (!body.startsWith(directive.trim())) {
            await fs.writeFile(p, directive + body, 'utf8')
          }
        } catch {
          // file missing (e.g. partial format); skip
        }
      }
    },
  },
  {
    ...SHARED,
    entry: { server: 'src/server/index.ts' },
    clean: false,
  },
  {
    // CLI bundle: ESM-only since it targets `npx openfeedbacklayer`.
    // Shipped as dist/cli.mjs which the package.json `bin` entry points
    // at. The shebang gets prepended in onSuccess because tsup's `banner`
    // option emits it INSIDE the bundle where esbuild's post-pass then
    // chokes on the `#!` line.
    ...SHARED,
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'] as const,
    dts: false,
    clean: false,
    async onSuccess() {
      const fs = await import('node:fs/promises')
      const path = await import('node:path')
      const p = path.join('dist', 'cli.mjs')
      try {
        const body = await fs.readFile(p, 'utf8')
        if (!body.startsWith('#!')) {
          await fs.writeFile(p, '#!/usr/bin/env node\n' + body, 'utf8')
        }
        await fs.chmod(p, 0o755)
      } catch {
        // file missing (e.g. partial build) — skip
      }
    },
  },
])
