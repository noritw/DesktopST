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
 * | APK | 獨立（或遙控） | 本機設定（B3 後段） |
 *
 * 網頁版**永遠是遙控模式** —— 網頁由電腦提供，電腦沒開就連不上，
 * 這是拓樸限制不是取捨（roadmap §4.5）。
 */

export interface Connection {
  mode: AppMode
  /** 遙控模式才有意義。不含結尾斜線。 */
  baseUrl: string
  token: string
}

declare global {
  interface Window {
    /** relay 的 Cloudflare Worker 會在頁面注入這個。 */
    __mobileToken?: string
  }
}

/**
 * 從當前網址與注入值推導連線設定。
 *
 * ⚠️ **`?server=` 只是開發用的逃生口**：正式情況下網頁是由 mobileServer
 * 自己提供的，同源即可，不需要也不該讓網址決定要連去哪台電腦。
 * 保留它是因為 `npm run dev:mobile` 跑在 5180、而 mobileServer 在別的埠，
 * 少了它就沒辦法一邊改 UI 一邊對著真的資料驗。
 */
export function resolveConnection(loc: Location = location): Connection {
  const params = new URLSearchParams(loc.search)

  const token = window.__mobileToken || params.get('token') || ''
  const serverOverride = params.get('server')

  const baseUrl = (serverOverride || loc.origin).replace(/\/$/, '')

  return { mode: 'remote', baseUrl, token }
}

/** WebSocket 位址。`http(s)` → `ws(s)`，權杖走 query（WS 不能加 header）。 */
export function wsUrlFor(conn: Connection): string {
  const base = conn.baseUrl.replace(/^http/, 'ws')
  return `${base}/?token=${encodeURIComponent(conn.token)}`
}
