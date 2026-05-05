/** Check latest app version from GitHub Packages (Ear2Finger) or Releases. */

export const GITHUB_PACKAGES_URL =
  'https://github.com/stephenyin?tab=packages&repo_name=Ear2Finger'

const GITHUB_API = 'https://api.github.com'
const OWNER = 'stephenyin'
const REPO = 'Ear2Finger'

const HEADERS = {
  Accept: 'application/vnd.github+json',
}

export function compareSemver(a: string, b: string): number {
  const norm = (s: string) =>
    s
      .replace(/^v/i, '')
      .split(/[.+]/g)
      .map((x) => parseInt(x, 10))
      .filter((n) => !Number.isNaN(n))
  const pa = norm(a)
  const pb = norm(b)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0
    const db = pb[i] ?? 0
    if (da < db) return -1
    if (da > db) return 1
  }
  return 0
}

type GhPackage = {
  name?: string
  package_type?: string
  repository?: { full_name?: string; name?: string }
}

type GhPackageVersion = {
  name?: string
  metadata?: { container?: { tags?: string[] } }
}

function semverFromVersionObject(v: GhPackageVersion): string | null {
  const tags = v.metadata?.container?.tags ?? []
  const candidates = [v.name, ...tags].filter(Boolean) as string[]
  for (const c of candidates) {
    if (/^sha256:/i.test(c)) continue
    const m = String(c).match(/v?(\d+\.\d+\.\d+)/i)
    if (m) return m[1]
  }
  return null
}

function pickLatestSemverFromVersions(versions: GhPackageVersion[]): string | null {
  let best: string | null = null
  for (const v of versions) {
    const s = semverFromVersionObject(v)
    if (!s) continue
    if (!best || compareSemver(s, best) > 0) best = s
  }
  return best
}

function packageMatchesRepo(p: GhPackage): boolean {
  const full = p.repository?.full_name?.toLowerCase()
  if (full === `${OWNER}/${REPO}`.toLowerCase()) return true
  const n = (p.name ?? '').toLowerCase()
  return n.includes('ear2finger')
}

async function fetchLatestFromPackages(): Promise<string | null> {
  for (const packageType of ['container', 'npm'] as const) {
    const listUrl = `${GITHUB_API}/users/${OWNER}/packages?package_type=${packageType}&per_page=100`
    const listRes = await fetch(listUrl, { headers: HEADERS })
    if (!listRes.ok) continue
    const packages = (await listRes.json()) as GhPackage[]
    if (!Array.isArray(packages) || !packages.length) continue

    const match = packages.find(packageMatchesRepo)
    if (!match?.name) continue

    const verUrl = `${GITHUB_API}/users/${OWNER}/packages/${packageType}/${encodeURIComponent(
      match.name,
    )}/versions?per_page=50`
    const verRes = await fetch(verUrl, { headers: HEADERS })
    if (!verRes.ok) continue
    const versions = (await verRes.json()) as GhPackageVersion[]
    if (!Array.isArray(versions) || !versions.length) continue

    const latest = pickLatestSemverFromVersions(versions)
    if (latest) return latest
  }
  return null
}

async function fetchLatestFromReleases(): Promise<string | null> {
  const url = `${GITHUB_API}/repos/${OWNER}/${REPO}/releases/latest`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) return null
  const data = (await res.json()) as { tag_name?: string }
  const tag = data.tag_name
  if (typeof tag !== 'string') return null
  const m = tag.match(/v?(\d+\.\d+\.\d+)/i)
  return m ? m[1] : null
}

export type UpdateCheckResult =
  | {
      ok: true
      latest: string
      source: 'packages' | 'releases'
      upToDate: boolean
    }
  | { ok: false; message: string }

export async function checkGitHubForUpdate(currentSemver: string): Promise<UpdateCheckResult> {
  try {
    let latest = await fetchLatestFromPackages()
    let source: 'packages' | 'releases' = 'packages'
    if (!latest) {
      latest = await fetchLatestFromReleases()
      source = 'releases'
    }
    if (!latest) {
      return {
        ok: false,
        message: 'No published version found yet. See GitHub Packages when a build is published.',
      }
    }
    const upToDate = compareSemver(currentSemver, latest) >= 0
    return { ok: true, latest, source, upToDate }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error'
    return { ok: false, message: msg }
  }
}
