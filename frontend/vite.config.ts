import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const gitCommit = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
})()

const appSemver = (() => {
  try {
    const raw = readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
    const v = JSON.parse(raw)?.version
    return typeof v === 'string' && v ? v : '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_COMMIT__: JSON.stringify(gitCommit),
    __APP_SEMVER__: JSON.stringify(appSemver),
  },
  server: {
    // Bind IPv4 explicitly: Windows often serves "localhost" on ::1 only, while
    // scripts/electron-dev.mjs and Electron use 127.0.0.1 — mismatched stacks time out.
    host: '127.0.0.1',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
