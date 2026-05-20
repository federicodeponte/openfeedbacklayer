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

export default defineConfig([
  {
    ...SHARED,
    entry: {
      index: 'src/index.ts',
      widget: 'src/components/FeedbackWidget.tsx',
    },
    clean: true,
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
])
