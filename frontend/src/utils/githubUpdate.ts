/** Check latest app version from GitHub Releases: https://github.com/stephenyin/Ear2Finger/releases */

export const GITHUB_RELEASES_URL = 'https://github.com/stephenyin/Ear2Finger/releases'

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

function semverFromTag(tag: string): string | null {
  const m = String(tag).match(/v?(\d+\.\d+\.\d+)/i)
  return m ? m[1] : null
}

/**
 * Prefer GET .../releases/latest; if 404 or no semver, scan GET .../releases
 * (e.g. when nothing is marked "Latest" on GitHub).
 */
async function fetchLatestSemverFromReleases(): Promise<string | null> {
  const latestUrl = `${GITHUB_API}/repos/${OWNER}/${REPO}/releases/latest`
  const latestRes = await fetch(latestUrl, { headers: HEADERS })
  if (latestRes.ok) {
    const data = (await latestRes.json()) as { tag_name?: string }
    const tag = data.tag_name
    if (typeof tag === 'string') {
      const v = semverFromTag(tag)
      if (v) return v
    }
  }

  const listUrl = `${GITHUB_API}/repos/${OWNER}/${REPO}/releases?per_page=40`
  const listRes = await fetch(listUrl, { headers: HEADERS })
  if (!listRes.ok) return null
  const list = (await listRes.json()) as { tag_name?: string; draft?: boolean; prerelease?: boolean }[]
  if (!Array.isArray(list) || !list.length) return null

  let best: string | null = null
  for (const rel of list) {
    if (rel.draft) continue
    const tag = rel.tag_name
    if (typeof tag !== 'string') continue
    const v = semverFromTag(tag)
    if (!v) continue
    if (!best || compareSemver(v, best) > 0) best = v
  }
  return best
}

export type UpdateCheckResult =
  | {
      ok: true
      latest: string
      upToDate: boolean
    }
  | { ok: false; message: string }

export async function checkGitHubForUpdate(currentSemver: string): Promise<UpdateCheckResult> {
  try {
    const latest = await fetchLatestSemverFromReleases()
    if (!latest) {
      return {
        ok: false,
        message: 'No release found yet. See GitHub Releases for published builds.',
      }
    }
    const upToDate = compareSemver(currentSemver, latest) >= 0
    return { ok: true, latest, upToDate }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Network error'
    return { ok: false, message: msg }
  }
}
