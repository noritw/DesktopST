import { Capacitor } from '@capacitor/core'
import type { AppMode } from '../data'

/**
 * 連線設定：這個 app 現在要跟誰講話。
 *
 * 三種進入方式，**同一份 UI**（roadmap §4.5）：
 *
 * | 進入方式 | 模式 | 位址與權杖從哪來 |
 * |---|---|---|
 * | mobileServer 提供的網頁（掃 QR） | 遙控 | 同源 ＋ `?token=` 或 relay 注入 |
 * | 開發時的 `npm run dev:mobile` | 遙控 | `?server=` ＋ `?token=` 明確指定 |
 * | APK（原生殼） | **獨立**（預設） | 本機 Capacitor adapters |
 *
 * 網頁版**永遠是遙控模式** —— 網頁由電腦提供，電腦沒開就連不上，
 * 這是拓樸限制不是取捨（roadmap §4.5）。
 *
 * 原生殼可用 `?server=` 或 `?mode=remote` 強制遙控（除錯用）。
 */

export interface Connection {
  mode: AppMode
  /** 遙控模式才有意義。不含結尾斜線。 */
  baseUrl: string
  token: string
}

declare global {
  interface Window {
    __mobileToken?: string
    __relayDeviceId?: string
    __relayPageUrl?: string
    __tunnelWsUrl?: string
  }
}

export function resolveConnection(loc: Location = location): Connection {
  const params = new URLSearchParams(loc.search)

  const token = window.__mobileToken || params.get('token') || ''
  const serverOverride = params.get('server')
  const modeParam = params.get('mode')
  const forceStandalone = modeParam === 'standalone'
  const forceRemote = modeParam === 'remote'

  const relayDeviceId = window.__relayDeviceId
  const baseUrl = serverOverride
    ? serverOverride.replace(/\/$/, '')
    : relayDeviceId
      ? `/${relayDeviceId}`
      : ''

  /*
   * 原生殼預設獨立；掃 QR／網頁預設遙控。
   * - `?mode=standalone`：瀏覽器也可強制獨立（用 Capacitor web 後備測本機庫）
   * - 原生若帶 `?server=`／`?mode=remote`／relay 注入 → 遙控（對桌面除錯）
   */
  if (forceStandalone) {
    return { mode: 'standalone', baseUrl: '', token: '' }
  }

  const wantRemote =
    !Capacitor.isNativePlatform() ||
    forceRemote ||
    !!serverOverride ||
    !!window.__mobileToken ||
    !!relayDeviceId

  if (!wantRemote) {
    return { mode: 'standalone', baseUrl: '', token: '' }
  }

  return { mode: 'remote', baseUrl, token }
}

export function wsUrlFor(conn: Connection): string {
  if (window.__tunnelWsUrl) return window.__tunnelWsUrl

  const token = encodeURIComponent(conn.token)
  if (/^https?:/i.test(conn.baseUrl)) {
    return `${conn.baseUrl.replace(/^http/, 'ws')}/?token=${token}`
  }
  const wsOrigin = location.origin.replace(/^http/, 'ws')
  return `${wsOrigin}${conn.baseUrl}/?token=${token}`
}

export async function detectLanDirect(conn: Connection): Promise<boolean> {
  if (conn.mode === 'standalone') return false
  try {
    const base = conn.baseUrl.replace(/\/$/, '')
    const res = await fetch(`${base}/api/connection-info`, {
      headers: { 'X-DesktopST-Token': conn.token }
    })
    if (!res.ok) return false
    const data = (await res.json()) as { lanDirect?: boolean }
    return data.lanDirect === true
  } catch {
    return false
  }
}

/** 狀態列顯示用的白話模式標籤。 */
export function modeLabel(conn: Connection, lanDirect: boolean | null): string {
  if (conn.mode === 'standalone') return '本機'
  if (window.__relayDeviceId || window.__tunnelWsUrl) return '電腦 · 中繼'
  if (lanDirect === true) return '電腦 · 區網'
  if (lanDirect === false) return '電腦'
  return '電腦'
}
