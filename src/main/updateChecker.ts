import { app, dialog, shell } from 'electron'

const GITHUB_OWNER = 'noritw'
const GITHUB_REPO = 'DesktopST'
const RELEASES_PAGE = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
const API_URL = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  latestPublishedAt?: string
  dismissed: boolean
  error?: string
}

/** 將 "0.1.23" 拆成數字陣列，供版本比較用 */
function parseVersionParts(v: string): number[] {
  return v.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0)
}

/**
 * 比較遠端 latest 與本機 current（SemVer 語意：主.次.修）。
 * 回傳值 > 0 表示 latest 較新；0 相同；< 0 表示本機較新。
 */
function compareVersion(latest: string, current: string): number {
  const a = parseVersionParts(latest)
  const b = parseVersionParts(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const ai = a[i] ?? 0
    const bi = b[i] ?? 0
    if (ai !== bi) return ai - bi
  }
  return 0
}

function isPublishNewer(latestDate: string, currentDate: string): boolean {
  return new Date(latestDate) > new Date(currentDate)
}

/**
 * 是否應提示更新：
 * 1. 遠端版本號較高 → 有新版本
 * 2. 版本號相同且本機已記錄過發佈時間、GitHub 發佈時間較新 → 同版重建包
 */
function shouldNotifyUpdate(
  current: string,
  latest: string,
  latestPublishedAt: string,
  currentPublishedAt?: string
): boolean {
  const cmp = compareVersion(latest, current)
  if (cmp > 0) return true
  if (cmp < 0) return false
  if (!currentPublishedAt) return false
  return isPublishNewer(latestPublishedAt, currentPublishedAt)
}

export async function checkForUpdates(opts: {
  silent: boolean
  dismissedVersion?: string
  currentPublishedAt?: string
}): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  try {
    const res = await fetch(API_URL, {
      headers: { 'User-Agent': `DesktopST/${current}` },
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { tag_name: string; published_at: string }
    const latest = data.tag_name.replace(/^v/, '')
    const latestPublishedAt = data.published_at

    if (!shouldNotifyUpdate(current, latest, latestPublishedAt, opts.currentPublishedAt)) {
      if (!opts.silent) {
        await dialog.showMessageBox({
          type: 'info',
          title: '版本檢查',
          message: '已是最新版本',
          detail: `目前版本：v${current}`
        })
      }
      return { hasUpdate: false, currentVersion: current, latestVersion: latest, latestPublishedAt, dismissed: false }
    }

    if (opts.dismissedVersion === latest) {
      return {
        hasUpdate: false,
        currentVersion: current,
        latestVersion: latest,
        latestPublishedAt,
        dismissed: false
      }
    }

    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '有新版本可下載',
      message: `DesktopST 有新版本！`,
      detail: `目前版本：v${current}\n最新版本：v${latest}`,
      buttons: ['前往下載', '略過此版本', '稍後再說'],
      defaultId: 0,
      cancelId: 2
    })

    if (response === 0) void shell.openExternal(RELEASES_PAGE)

    return {
      hasUpdate: true,
      currentVersion: current,
      latestVersion: latest,
      latestPublishedAt,
      dismissed: response === 1
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    if (!opts.silent) {
      await dialog.showMessageBox({
        type: 'error',
        title: '版本檢查失敗',
        message: '無法連線到 GitHub',
        detail: error
      })
    }
    return { hasUpdate: false, currentVersion: current, latestVersion: '', dismissed: false, error }
  }
}
