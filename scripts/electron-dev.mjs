#!/usr/bin/env node
/**
 * Dev orchestrator: embedded Qdrant (local path) → uvicorn → Vite → Electron (window only).
 * Cross-platform (Windows, macOS, Linux).
 */
import { spawn, execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
import http from 'http'
import net from 'net'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const children = []

function killTree(proc) {
  if (!proc || proc.killed) return
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      proc.kill('SIGTERM')
    }
  } catch {
    try {
      proc.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  }
}

function shutdown() {
  for (const c of [...children].reverse()) killTree(c)
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function waitPort(host, port, timeoutMs = 120000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.createConnection({ host, port }, () => {
        sock.end()
        resolve()
      })
      sock.on('error', () => {
        sock.destroy()
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Timeout waiting for ${host}:${port}`))
        }
        setTimeout(tryOnce, 300)
      })
    }
    tryOnce()
  })
}

function waitHttp(url, timeoutMs = 120000) {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const u = new URL(url)
      const req = http.request(
        { hostname: u.hostname, port: u.port || 80, path: u.pathname || '/', method: 'GET', timeout: 2000 },
        (res) => {
          res.resume()
          resolve()
        }
      )
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Timeout waiting for ${url}`))
        }
        setTimeout(tryOnce, 300)
      })
      req.on('timeout', () => {
        req.destroy()
        if (Date.now() - start > timeoutMs) {
          return reject(new Error(`Timeout waiting for ${url}`))
        }
        setTimeout(tryOnce, 300)
      })
      req.end()
    }
    tryOnce()
  })
}

function pythonForBackend() {
  const backend = path.join(ROOT, 'backend')
  if (process.platform === 'win32') {
    const v = path.join(backend, 'venv', 'Scripts', 'python.exe')
    if (fs.existsSync(v)) return v
    return 'python'
  }
  const v = path.join(backend, 'venv', 'bin', 'python')
  if (fs.existsSync(v)) return v
  return 'python3'
}

function toSqliteUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/')
  return `sqlite:///${normalized}`
}

async function main() {
  const userData = path.join(ROOT, '.electron-dev-userdata')
  fs.mkdirSync(userData, { recursive: true })
  const qLocal = path.join(userData, 'qdrant-local')
  fs.mkdirSync(qLocal, { recursive: true })

  const backendRoot = path.join(ROOT, 'backend')
  const py = pythonForBackend()
  const dbFile = path.join(userData, 'ear2finger.db')
  const audioDir = path.join(userData, 'audio')
  const dlDir = path.join(userData, 'downloads')
  fs.mkdirSync(audioDir, { recursive: true })
  fs.mkdirSync(dlDir, { recursive: true })

  const backendEnv = {
    ...process.env,
    QDRANT_LOCAL_PATH: qLocal,
    DATABASE_URL: toSqliteUrl(dbFile),
    EAR2FINGER_AUDIO_DIR: audioDir,
    EAR2FINGER_DOWNLOAD_DIR: dlDir,
  }

  const uvicorn = spawn(py, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000'], {
    cwd: backendRoot,
    stdio: 'inherit',
    env: backendEnv,
  })
  children.push(uvicorn)

  await waitHttp('http://127.0.0.1:8000/api/health', 120000)

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const vite = spawn(npmCmd, ['run', 'dev'], {
    cwd: path.join(ROOT, 'frontend'),
    stdio: 'inherit',
    env: { ...process.env, BROWSER: 'none' },
    shell: process.platform === 'win32',
  })
  children.push(vite)

  await waitPort('127.0.0.1', 3000, 120000)

  /** Real electron.exe / Electron.app binary — avoids Windows cmd + `.bin/electron.cmd` path/quoting bugs. */
  let electronExe
  try {
    electronExe = require('electron')
  } catch {
    electronExe = null
  }
  if (typeof electronExe !== 'string' || !fs.existsSync(electronExe)) {
    throw new Error('Electron not found. From the repo root run: npm install')
  }
  const electronArgs =
    process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox', '.'] : ['.']
  const el = spawn(electronExe, electronArgs, {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_DEV: '1',
      ELECTRON_SKIP_QDRANT: '1',
      ELECTRON_DEV_URL: 'http://127.0.0.1:3000',
    },
    shell: false,
  })
  children.push(el)

  el.on('exit', shutdown)
  uvicorn.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`Uvicorn exited with ${code}`)
    shutdown()
  })
  vite.on('exit', shutdown)
}

main().catch((e) => {
  console.error(e)
  shutdown()
})
