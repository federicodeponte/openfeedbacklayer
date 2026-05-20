import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: dirname,
  // Permit cross-host dev access (e.g. via a cloudflared tunnel host that
  // differs from localhost). The public-demo tunnel needs this in Next 15.
  allowedDevOrigins: ['*.trycloudflare.com', '*'],
}

export default nextConfig
