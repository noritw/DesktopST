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
    /**
     * relay 的 Cloudflare Worker 注入的四個值。
     *
     * relay 是**反向代理**（不是轉址），且每個請求都要「`/<deviceId>` 路徑 ＋ token」。
     * Worker 會在它代理的 HTML 裡注入這些，並 patch `window.fetch` 幫忙補上前綴與 header。
     * ⚠️ 但**只有 `fetch` 被 patch** —— `<img src>` 與 WebSocket 都得自己處理，見下。
     */
    __mobileToken?: string
    __relayDeviceId?: string
    __relayPageUrl?: string
    __tunnelWsUrl?: string
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

  /*
   * ⚠️ **同源時 `baseUrl` 必須是「相對路徑」而不是 `loc.origin`**
   * （2026-08-06 實機打臉後改）。
   *
   * 舊寫法組出 `https://relay.nori.tw/api/state` 這種**完整網址**，
   * 而 relay Worker 的 fetch patch 只改寫「`/` 開頭的字串」：
   *
   *     input.startsWith('/') && !input.startsWith('/' + deviceId)
   *
   * 完整網址不符合條件 → 不補 deviceId → relay 不知道要轉給哪台電腦 → 503。
   *
   * 改成相對路徑後：
   *   - relay：`baseUrl = '/<deviceId>'`，組出 `/<deviceId>/api/state`。
   *     已經帶前綴，Worker 的 `!startsWith` 判斷會跳過（不會變成兩層），
   *     而 `<img src>` 這類**不經 fetch** 的請求也因此自帶前綴 —— 這是關鍵，
   *     Worker 幫不了圖片，只能我們自己組對。
   *   - 區網直連：`baseUrl = ''`，組出 `/api/state`，同源本來就對。
   *   - 開發（`?server=`）：維持完整網址，那條路沒有 Worker。
   */
  const relayDeviceId = window.__relayDeviceId
  const baseUrl = serverOverride
    ? serverOverride.replace(/\/$/, '')
    : relayDeviceId
      ? `/${relayDeviceId}`
      : ''

  return { mode: 'remote', baseUrl, token }
}

/**
 * WebSocket 位址。`http(s)` → `ws(s)`，權杖走 query（WS 不能加 header）。
 *
 * ⚠️ **經 relay 時一定要用 Worker 注入的 `__tunnelWsUrl`。**
 * relay 只代理 HTTP，WebSocket 得直接連 cloudflared tunnel；
 * 自己從 `location` 推會得到 `wss://relay.nori.tw/...`，那是連不上的
 * （`mobile.html` 1220 行本來就是這樣處理，這裡照抄同一個優先順序）。
 */
export function wsUrlFor(conn: Connection): string {
  if (window.__tunnelWsUrl) return window.__tunnelWsUrl

  const token = encodeURIComponent(conn.token)
  // baseUrl 現在可能是相對路徑（''／'/<deviceId>'），沒有 protocol 可以換，
  // 這種情況要拿當前頁面的 origin 來組。
  if (/^https?:/i.test(conn.baseUrl)) {
    return `${conn.baseUrl.replace(/^http/, 'ws')}/?token=${token}`
  }
  const wsOrigin = location.origin.replace(/^http/, 'ws')
  return `${wsOrigin}${conn.baseUrl}/?token=${token}`
}

/**
 * 是不是區網直連（`Capabilities.apiKeyAccess` 的依據，roadmap §4.7）。
 *
 * 判定**由電腦端做**（檢查來源 IP，見 `mobileServer.ts` 的 `isLanDirectRequest`）——
 * 手機端只是把答案問回來，不可以自己猜。查不到（電腦還沒開、逾時⋯⋯）保守回 false，
 * 這與 `RemoteDataSource` 建構時的預設值一致（不確定就不給 API Key 存取）。
 */
export async function detectLanDirect(conn: Connection): Promise<boolean> {
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
