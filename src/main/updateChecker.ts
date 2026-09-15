import { app, dialog, shell } from 'electron'
import { detectInstallKind, API_URL, RELEASES_PAGE, compareVersion } from './updater'
import { openUpdaterWindow } from './windowManager'


export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion: string
  latestPublishedAt?: string
  dismissed: boolean
  error?: string
}

/** 是否應提示更新：僅在遠端版本號較高時（版號相同不通知） */
function shouldNotifyUpdate(current: string, latest: string): boolean {
  return compareVersion(latest, current) > 0
}

export async function checkForUpdates(opts: {
  silent: boolean
  dismissedVersion?: string
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

    if (!shouldNotifyUpdate(current, latest)) {
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

    // 開發模式沒有可覆蓋的安裝目錄（見 updater.ts），這時不給「立即更新」這顆按鈕
    const canOneClick = detectInstallKind() !== 'dev'
    const buttons = canOneClick
      ? ['立即更新', '前往下載頁', '略過此版本', '稍後再說']
      : ['前往下載', '略過此版本', '稍後再說']
    const downloadIndex = canOneClick ? 1 : 0
    const dismissIndex = canOneClick ? 2 : 1

    const { response } = await dialog.showMessageBox({
      type: 'info',
      title: '有新版本可下載',
      message: `DesktopST 有新版本！`,
      detail: canOneClick
        ? `目前版本：v${current}\n最新版本：v${latest}\n\n「立即更新」會自動下載並覆蓋安裝，完成後重新啟動；角色與對話不會被動到。`
        : `目前版本：v${current}\n最新版本：v${latest}`,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1
    })

    if (canOneClick && response === 0) openUpdaterWindow()
    else if (response === downloadIndex) void shell.openExternal(RELEASES_PAGE)

    return {
      hasUpdate: true,
      currentVersion: current,
      latestVersion: latest,
      latestPublishedAt,
      dismissed: response === dismissIndex
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
