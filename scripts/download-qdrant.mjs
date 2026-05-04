#!/usr/bin/env node
/**
 * Download the official Qdrant binary for the current OS/arch into electron/vendor/qdrant/.
 * Run from repo root: node scripts/download-qdrant.mjs
 * Uses GitHub latest release API (override with QDRANT_VERSION=v1.17.1).
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import https from 'https'
import { execFileSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'electron', 'vendor', 'qdrant')
const MARKER = path.join(OUT_DIR, '.version')

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'Ear2Finger-electron-setup' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location
          if (!loc) return reject(new Error('Redirect without location'))
          return resolve(httpsGetJson(loc))
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        }
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })
}

function downloadFile(url, destFile) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destFile)
    https
      .get(url, { headers: { 'User-Agent': 'Ear2Finger-electron-setup' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const loc = res.headers.location
          file.close()
          fs.unlink(destFile, () => {})
          if (!loc) return reject(new Error('Redirect without location'))
          return resolve(downloadFile(loc, destFile))
        }
        if (res.statusCode !== 200) {
          file.close()
          fs.unlink(destFile, () => {})
          return reject(new Error(`Download HTTP ${res.statusCode}`))
        }
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
      })
      .on('error', (err) => {
        file.close()
        fs.unlink(destFile, () => {})
        reject(err)
      })
  })
}

function pickAsset(platform, arch) {
  if (platform === 'win32') {
    if (arch !== 'x64' && arch !== 'arm64') {
      throw new Error(`Unsupported Windows arch: ${arch}`)
    }
    return 'qdrant-x86_64-pc-windows-msvc.zip'
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'qdrant-aarch64-apple-darwin.tar.gz' : 'qdrant-x86_64-apple-darwin.tar.gz'
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return 'qdrant-aarch64-unknown-linux-musl.tar.gz'
    return 'qdrant-x86_64-unknown-linux-gnu.tar.gz'
  }
  throw new Error(`Unsupported platform: ${platform}`)
}

function extractArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  if (archivePath.endsWith('.zip')) {
    execFileSync('tar', ['-xf', archivePath, '-C', destDir], { stdio: 'inherit' })
  } else {
    execFileSync('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'inherit' })
  }
}

function findQdrantBinary(dir) {
  const win = path.join(dir, 'qdrant.exe')
  if (fs.existsSync(win)) return win
  const unix = path.join(dir, 'qdrant')
  if (fs.existsSync(unix)) return unix
  const nested = fs.readdirSync(dir, { withFileTypes: true })
  for (const d of nested) {
    if (d.isDirectory()) {
      const sub = path.join(dir, d.name)
      const found = findQdrantBinary(sub)
      if (found) return found
    }
  }
  return null
}

async function main() {
  const platform = process.platform
  const arch = process.arch
  const forced = process.env.QDRANT_VERSION?.trim()
  let tag
  let browser_download_url
  if (forced) {
    tag = forced.startsWith('v') ? forced : `v${forced}`
    const assetName = pickAsset(platform, arch)
    browser_download_url = `https://github.com/qdrant/qdrant/releases/download/${tag}/${assetName}`
  } else {
    const rel = await httpsGetJson('https://api.github.com/repos/qdrant/qdrant/releases/latest')
    tag = rel.tag_name
    const assetName = pickAsset(platform, arch)
    const asset = rel.assets?.find((a) => a.name === assetName)
    if (!asset) {
      throw new Error(`No asset ${assetName} in ${tag}. Set QDRANT_VERSION to a release that includes it.`)
    }
    browser_download_url = asset.browser_download_url
  }

  if (fs.existsSync(MARKER)) {
    const prev = fs.readFileSync(MARKER, 'utf8').trim()
    if (prev === `${tag}|${platform}|${arch}`) {
      const bin = findQdrantBinary(OUT_DIR)
      if (bin) {
        console.log(`Qdrant ${tag} already present at ${bin}`)
        return
      }
    }
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const ext = browser_download_url.endsWith('.zip') ? '.zip' : '.tar.gz'
  const tmp = path.join(OUT_DIR, `_download${ext}`)
  console.log(`Downloading Qdrant ${tag} (${path.basename(browser_download_url)})...`)
  await downloadFile(browser_download_url, tmp)
  const extractDir = path.join(OUT_DIR, '_extract')
  fs.mkdirSync(extractDir, { recursive: true })
  extractArchive(tmp, extractDir)
  fs.unlinkSync(tmp)

  const inner = findQdrantBinary(extractDir)
  if (!inner) throw new Error('Could not find qdrant binary after extract')

  const destName = platform === 'win32' ? 'qdrant.exe' : 'qdrant'
  const finalBin = path.join(OUT_DIR, destName)
  fs.copyFileSync(inner, finalBin)
  fs.rmSync(extractDir, { recursive: true, force: true })

  if (platform !== 'win32') {
    try {
      fs.chmodSync(finalBin, 0o755)
    } catch {
      /* ignore */
    }
  }

  fs.writeFileSync(MARKER, `${tag}|${platform}|${arch}`, 'utf8')
  console.log(`Qdrant ready: ${finalBin}`)
}

main().catch((err) => {
  console.error(err.message || err)
  process.exit(1)
})
