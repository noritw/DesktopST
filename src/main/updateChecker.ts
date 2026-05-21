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

function isNewer(latestDate: string, currentDate?: string): boolean {
  const latest = new Date(latestDate)
  const current = currentDate ? new Date(currentDate) : new Date(0)
  return latest > current
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

    if (!isNewer(latestPublishedAt, opts.currentPublishedAt)) {
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

    // Silent startup check: skip if user already dismissed this version
    if (opts.silent && opts.dismissedVersion === latest) {
      return { hasUpdate: true, currentVersion: current, latestVersion: latest, dismissed: false }
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
