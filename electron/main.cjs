'use strict'

const { app, BrowserWindow, dialog, shell } = require('electron')

// Linux: avoid setuid chrome-sandbox requirement when the app is not installed setuid-root (typical dev + many user installs).
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-setuid-sandbox')
  // Quiets spurious GetVSyncParametersIfAvailable() GL errors on some Wayland/NVIDIA/driver setups.
  app.commandLine.appendSwitch('disable-gpu-vsync')
}
const path = require('path')
const fs = require('fs')
const { spawn, spawnSync } = require('child_process')
const http = require('http')
const net = require('net')

/** Packaged app listens here so it does not clash with a dev backend on 8000. */
const PACKAGED_BACKEND_PORT = 18712

let mainWindow = null
let qdrantProc = null
let backendProc = null

function isDevShell() {
  return process.env.ELECTRON_DEV === '1'
}

function devLoadUrl() {
  return process.env.ELECTRON_DEV_URL || 'http://127.0.0.1:3000'
}

function skipBundledQdrant() {
  return process.env.ELECTRON_SKIP_QDRANT === '1'
}

/** Legacy: spawn the separate Qdrant HTTP server (default is embedded Qdrant via qdrant-client local mode). */
function useExternalQdrantServer() {
  return process.env.ELECTRON_EXTERNAL_QDRANT === '1'
}

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
          reject(new Error(`Timeout waiting for ${host}:${port}`))
        } else {
          setTimeout(tryOnce, 300)
        }
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
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname || '/',
          method: 'GET',
          timeout: 2000,
        },
        (res) => {
          res.resume()
          resolve()
        }
      )
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for ${url}`))
        } else {
          setTimeout(tryOnce, 300)
        }
      })
      req.on('timeout', () => {
        req.destroy()
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timeout waiting for ${url}`))
        } else {
          setTimeout(tryOnce, 300)
        }
      })
      req.end()
    }
    tryOnce()
  })
}

function startupLog(userData, line) {
  try {
    fs.appendFileSync(
      path.join(userData, 'startup.log'),
      `${new Date().toISOString()} ${line}\n`
    )
  } catch {
    /* ignore */
  }
}

function findQdrantBinary() {
  const name = process.platform === 'win32' ? 'qdrant.exe' : 'qdrant'
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, 'qdrant', name)
    if (fs.existsSync(p)) {
      if (process.platform !== 'win32') {
        try {
          fs.chmodSync(p, 0o755)
        } catch {
          /* ignore */
        }
      }
      return p
    }
  }
  const dev = path.join(__dirname, 'vendor', 'qdrant', name)
  if (fs.existsSync(dev)) return dev
  return null
}

/** Repo backend (dev only; packaged app ships PyInstaller backend-bin only). */
function getDevBackendRoot() {
  return path.join(__dirname, '..', 'backend')
}

/** PyInstaller onedir executable under resources/backend-bin/ (Linux/macOS; Windows .exe). */
function packagedBackendBinaryPath() {
  if (!app.isPackaged) return null
  const base = path.join(process.resourcesPath, 'backend-bin')
  const names =
    process.platform === 'win32'
      ? ['run_electron_backend.exe']
      : ['run_electron_backend', 'run_electron_backend.bin']
  for (const name of names) {
    const p = path.join(base, name)
    if (fs.existsSync(p)) return p
  }
  return null
}

/** Ordered candidates; first probe win is used (important for .deb / GUI sparse PATH). */
function pythonCandidateList(backendRoot) {
  const list = []
  const envPy = process.env.EAR2FINGER_PYTHON
  if (envPy && String(envPy).trim()) list.push(String(envPy).trim())
  if (process.platform === 'win32') {
    list.push(path.join(backendRoot, 'venv', 'Scripts', 'python.exe'))
    list.push('python')
    return [...new Set(list)]
  }
  list.push(path.join(backendRoot, 'venv', 'bin', 'python3'))
  list.push(path.join(backendRoot, 'venv', 'bin', 'python'))
  if (app.isPackaged && process.platform === 'linux') {
    const home = app.getPath('home')
    const data = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share')
    list.push(path.join(data, 'ear2finger', 'venv', 'bin', 'python3'))
    list.push(path.join(data, 'ear2finger', 'venv', 'bin', 'python'))
    list.push(path.join(home, '.venvs', 'ear2finger', 'bin', 'python3'))
    list.push(path.join(home, '.venvs', 'ear2finger', 'bin', 'python'))
    for (const ver of ['3.14', '3.13', '3.12', '3.11', '3.10']) {
      list.push(`python${ver}`)
    }
  }
  list.push('python3', 'python')
  return [...new Set(list)]
}

function enrichLinuxPackagedPath(env) {
  if (!app.isPackaged || process.platform !== 'linux') return { ...env }
  const home = app.getPath('home')
  const extra = [path.join(home, '.local', 'bin'), '/usr/local/bin'].filter((p) => fs.existsSync(p))
  if (!extra.length) return { ...env }
  const prefix = extra.join(':')
  const tail = env.PATH || process.env.PATH || ''
  const next = { ...env, PATH: `${prefix}:${tail}` }
  if (next.PYTHONNOUSERSITE === '1') delete next.PYTHONNOUSERSITE
  return next
}

function resolvePythonForBackend(backendRoot, log, probeEnv) {
  const baseEnv = enrichLinuxPackagedPath({
    ...process.env,
    PYTHONUNBUFFERED: '1',
    ...probeEnv,
  })
  const candidates = pythonCandidateList(backendRoot)
  for (const py of candidates) {
    if (py.includes(path.sep) && !fs.existsSync(py)) {
      log(`skip missing python: ${py}`)
      continue
    }
    const probe = spawnSync(py, ['-c', 'import fastapi, uvicorn; import main'], {
      cwd: backendRoot,
      encoding: 'utf8',
      timeout: 120000,
      env: baseEnv,
    })
    if (probe.status === 0) {
      log(`Python OK: ${py}`)
      return { py, childEnv: baseEnv }
    }
    const errPreview = [probe.stderr, probe.stdout].filter(Boolean).join('\n').trim().slice(0, 400)
    log(`Python probe failed (${py}): ${errPreview}`)
  }
  const req = path.join(backendRoot, 'requirements.txt')
  const hint =
    process.platform === 'linux' && app.isPackaged
      ? '\n\n(.deb / menu launcher often uses a minimal PATH; the same app may work from a terminal if your shell sets PATH to a venv.)\n' +
        'Ubuntu 24+ may need: python3 -m pip install --user --break-system-packages -r "' +
        req +
        '"\n' +
        'Or run the bundled setup script once (see README “Distributing the desktop app”), e.g.:\n' +
        '  bash /opt/Ear2Finger/resources/install-desktop-backend-env.sh\n' +
        '(Use the path shown by: dpkg -L ear2finger | grep install-desktop-backend-env.sh)'
      : ''
  throw new Error(
    'No working Python found for the backend (need fastapi + uvicorn on the interpreter).\n\n' +
      `Tried: ${candidates.join(', ')}\n\n` +
      `Install once, e.g.:\n  python3 -m pip install --user -r "${req}"\n\n` +
      'Or set EAR2FINGER_PYTHON to a Python that already has the backend installed.' +
      hint
  )
}

function toSqliteUrl(filePath) {
  const normalized = path.resolve(filePath).replace(/\\/g, '/')
  return `sqlite:///${normalized}`
}

function readOrCreateSecret(userData) {
  const p = path.join(userData, '.ear2finger_secret')
  try {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf8').trim()
    }
  } catch {
    /* ignore */
  }
  const crypto = require('crypto')
  const s = crypto.randomBytes(32).toString('hex')
  fs.writeFileSync(p, s, 'utf8')
  return s
}

function staticDir() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend-dist')
  }
  return path.join(__dirname, '..', 'frontend', 'dist')
}

/** PNG for BrowserWindow / dock (extraResources when packaged). */
function appIconPath() {
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, 'app-icon.png')
    if (fs.existsSync(p)) return p
  }
  const dev = path.join(__dirname, '..', 'docs', 'assets', 'icon-bg.png')
  if (fs.existsSync(dev)) return dev
  return undefined
}

async function startQdrant(userData, log) {
  if (skipBundledQdrant()) return
  if (!useExternalQdrantServer()) return
  const bin = findQdrantBinary()
  if (!bin) {
    throw new Error(
      'Qdrant binary not found. Run "npm run electron:vendor" before packaging or development.'
    )
  }
  log(`qdrant binary: ${bin}`)
  const storage = path.join(userData, 'qdrant-storage')
  fs.mkdirSync(storage, { recursive: true })
  // Qdrant 1.17+ no longer accepts --storage-path; use config env override.
  const logPath = path.join(userData, 'qdrant.log')
  const qLog = fs.openSync(logPath, 'a')
  qdrantProc = spawn(bin, ['--disable-telemetry'], {
    stdio: ['ignore', qLog, qLog],
    env: {
      ...process.env,
      QDRANT__STORAGE__STORAGE_PATH: storage,
    },
  })
  qdrantProc.on('error', (err) => {
    log(`Qdrant spawn error: ${err.message || err}`)
  })
  qdrantProc.on('exit', (code, sig) => {
    log(`Qdrant exited code=${code} signal=${sig}`)
  })
  await waitHttp('http://127.0.0.1:6333/', 90000)
}

function stopChild(proc) {
  if (!proc || proc.killed) return
  try {
    if (process.platform === 'win32') {
      const { execFileSync } = require('child_process')
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

async function startBackend(userData, log) {
  const devBackendRoot = getDevBackendRoot()
  log(`resourcesPath=${process.resourcesPath} devBackend=${devBackendRoot}`)

  const dbFile = path.join(userData, 'ear2finger.db')
  const audioDir = path.join(userData, 'audio')
  const downloadsDir = path.join(userData, 'downloads')
  const qdrantLocal = path.join(userData, 'qdrant-local')
  fs.mkdirSync(audioDir, { recursive: true })
  fs.mkdirSync(downloadsDir, { recursive: true })
  fs.mkdirSync(qdrantLocal, { recursive: true })

  const probeDirs = {
    EAR2FINGER_AUDIO_DIR: audioDir,
    EAR2FINGER_DOWNLOAD_DIR: downloadsDir,
  }

  const dist = staticDir()
  const port = PACKAGED_BACKEND_PORT
  const uvicornLog = path.join(userData, 'uvicorn.log')
  const uvFd = fs.openSync(uvicornLog, 'a')

  const bundledBin = packagedBackendBinaryPath()
  const useBundledBackend = Boolean(bundledBin)

  let childEnv
  let py
  if (useBundledBackend) {
    log(`backend: PyInstaller bundle ${bundledBin}`)
    childEnv = enrichLinuxPackagedPath({
      ...process.env,
      PYTHONUNBUFFERED: '1',
      ...probeDirs,
    })
  } else {
    if (!app.isPackaged) {
      const r = resolvePythonForBackend(devBackendRoot, log, probeDirs)
      childEnv = r.childEnv
      py = r.py
    } else {
      throw new Error(
        'Packaged app is missing the PyInstaller backend (resources/backend-bin/). Run: npm run electron:build:backend'
      )
    }
  }

  const env = {
    ...childEnv,
    DATABASE_URL: toSqliteUrl(dbFile),
    SECRET_KEY: readOrCreateSecret(userData),
    EAR2FINGER_AUDIO_DIR: audioDir,
    EAR2FINGER_DOWNLOAD_DIR: downloadsDir,
    E2F_HOST: '127.0.0.1',
    E2F_PORT: String(port),
  }
  if (useExternalQdrantServer()) {
    env.QDRANT_URL = 'http://127.0.0.1:6333'
  } else {
    env.QDRANT_LOCAL_PATH = qdrantLocal
  }
  if (app.isPackaged && fs.existsSync(path.join(dist, 'index.html'))) {
    env.ELECTRON_STATIC_DIR = dist
    log(`ELECTRON_STATIC_DIR=${dist}`)
  } else if (app.isPackaged) {
    log(`WARN: no index.html under ${dist}`)
  }

  if (useBundledBackend) {
    const cwd = path.dirname(bundledBin)
    backendProc = spawn(bundledBin, [], {
      cwd,
      stdio: ['ignore', uvFd, uvFd],
      env,
    })
  } else {
    const args = ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(port)]
    backendProc = spawn(py, args, {
      cwd: devBackendRoot,
      stdio: ['ignore', uvFd, uvFd],
      env,
    })
  }

  backendProc.on('error', (err) => {
    log(`Backend spawn error: ${err.message || err}`)
  })
  backendProc.on('exit', (code, sig) => {
    log(`backend exited code=${code} signal=${sig}`)
  })

  await Promise.race([
    waitHttp(`http://127.0.0.1:${port}/api/health`, 180000),
    new Promise((_, reject) => {
      backendProc.once('exit', (code, sig) => {
        reject(
          new Error(
            `Backend exited before /api/health responded (code=${code}, signal=${sig}). See ${uvicornLog}`
          )
        )
      })
    }),
  ])
}

function isLocalAppUrl(url) {
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const h = u.hostname
    return h === '127.0.0.1' || h === 'localhost' || h === '[::1]'
  } catch {
    return false
  }
}

function openExternalLinksInSystemBrowser(win) {
  const wc = win.webContents
  wc.setWindowOpenHandler(({ url }) => {
    if (isLocalAppUrl(url)) return { action: 'allow' }
    try {
      const u = new URL(url)
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        setImmediate(() => {
          shell.openExternal(url).catch(() => {})
        })
      }
    } catch {
      /* ignore */
    }
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => {
    if (isLocalAppUrl(url)) return
    try {
      const u = new URL(url)
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        event.preventDefault()
        shell.openExternal(url).catch(() => {})
      }
    } catch {
      /* ignore */
    }
  })
}

function createWindow(loadUrl) {
  const icon = appIconPath()
  const winOpts = {
    width: 1280,
    height: 840,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  }
  if (icon) winOpts.icon = icon
  mainWindow = new BrowserWindow(winOpts)
  openExternalLinksInSystemBrowser(mainWindow)
  if (process.platform === 'darwin' && app.dock && icon) {
    try {
      app.dock.setIcon(icon)
    } catch {
      /* ignore */
    }
  }
  mainWindow.loadURL(loadUrl)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

async function ready() {
  const userData = app.getPath('userData')
  fs.mkdirSync(userData, { recursive: true })
  const log = (line) => {
    startupLog(userData, line)
    console.error(line)
  }

  if (isDevShell()) {
    log('dev shell: skipping bundled Qdrant/backend')
    createWindow(devLoadUrl())
    return
  }

  log(`packaged=${app.isPackaged} resourcesPath=${process.resourcesPath}`)
  if (useExternalQdrantServer()) {
    await startQdrant(userData, log)
  } else {
    log('using embedded Qdrant (qdrant-client local mode; QDRANT_LOCAL_PATH)')
  }
  await startBackend(userData, log)
  const port = PACKAGED_BACKEND_PORT
  createWindow(`http://127.0.0.1:${port}/`)
  log('window created')
}

app.whenReady().then(async () => {
  try {
    await ready()
  } catch (err) {
    const userData = app.getPath('userData')
    const msg = err && err.message ? err.message : String(err)
    startupLog(userData, `FATAL ${msg}`)
    console.error(err)
    try {
      const logLines = [
        path.join(userData, 'startup.log'),
        path.join(userData, 'uvicorn.log'),
      ]
      if (useExternalQdrantServer()) {
        logLines.push(path.join(userData, 'qdrant.log'))
      }
      await dialog.showMessageBox({
        type: 'error',
        title: 'Ear2Finger',
        message: 'Could not start the application.',
        detail: `${msg}\n\nLogs:\n${logLines.join('\n')}`,
      })
    } catch {
      /* ignore */
    }
    app.quit()
  }
})

app.on('window-all-closed', () => {
  stopChild(backendProc)
  backendProc = null
  stopChild(qdrantProc)
  qdrantProc = null
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  stopChild(backendProc)
  backendProc = null
  stopChild(qdrantProc)
  qdrantProc = null
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (isDevShell()) {
      createWindow(devLoadUrl())
    } else {
      createWindow(`http://127.0.0.1:${PACKAGED_BACKEND_PORT}/`)
    }
  }
})
