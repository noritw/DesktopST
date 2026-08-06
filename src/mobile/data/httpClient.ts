import { DataError } from '@core/data'
import type { DataErrorCode } from '@core/data'
import { encodeNicknameHeader } from './deviceIdentity'
import type { DeviceIdentity } from './deviceIdentity'

/**
 * 遙控模式的 HTTP client。
 *
 * `assets/mobile.html` 的 29 個 `fetch` 呼叫（含 777–791 行的 token 注入）
 * 在這裡收斂成一支型別化的 client。**認證與錯誤翻譯只寫這一次**，
 * `remoteDataSource` 專心做方法對映。
 *
 * ⚠️ 這裡不產生任何 UI 文案：伺服器回的 `error` 字串只當 `detail`（除錯用），
 * 顯示給使用者的訊息由 UI 層依 `DataErrorCode` 決定（roadmap §3.3）。
 */

export interface HttpClientOptions {
  /** 伺服器位址（tunnel 或區網皆可）。每次呼叫都重新取，relay 換 URL 時才拿得到新的。 */
  baseUrl: () => string
  /** 存取權杖；`mobileServer.isAuthorized` 接受 header／bearer／query 三種，這裡用 header。 */
  token: () => string
  /** 測試用；預設走全域 fetch（APK 端由 CapacitorHttp 接管）。 */
  fetchImpl?: typeof globalThis.fetch
  /**
   * 裝置識別（清單 G8）。**不給的話電腦端會把訊息當成「Desktop」送來的**，
   * 角色會以為你在電腦前面打字（見 `deviceIdentity.ts`）。
   */
  device?: () => DeviceIdentity
}

export class HttpClient {
  constructor(private opts: HttpClientOptions) {}

  /** 給圖片類 `<img src>` 用：帶 query token，因為 `<img>` 沒辦法加 header。 */
  url(path: string): string {
    const base = this.opts.baseUrl().replace(/\/$/, '')
    const sep = path.includes('?') ? '&' : '?'
    return `${base}${path}${sep}token=${encodeURIComponent(this.opts.token())}`
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path)
  }

  async post<T>(path: string, body?: unknown, opts?: { headers?: Record<string, string> }): Promise<T> {
    return this.request<T>('POST', path, body, opts?.headers)
  }

  /**
   * 二進位回應（截圖 / 視窗截圖）。**不能走 `request()`**——那支永遠當 JSON 解析。
   * 回傳的 `headers` 給呼叫端讀 `X-Display-Bounds` / `X-Window-Bounds` /
   * `X-Scale-Factor`，座標換算只能用那裡面的值，不可自行假設。
   */
  async getBinary(path: string): Promise<{ blob: Blob; headers: Headers }> {
    return this.requestBinary('GET', path)
  }

  async postBinary(path: string, body?: unknown): Promise<{ blob: Blob; headers: Headers }> {
    return this.requestBinary('POST', path, body)
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch
    const base = this.opts.baseUrl().replace(/\/$/, '')

    // ⚠️ **標頭要在 try 外面組好。**
    //
    // 放進去的話，任何組標頭時的程式錯誤都會被下面那個 catch 收成
    // `unreachable`，UI 就顯示「連不上電腦」—— 使用者跑去查網路與防火牆，
    // 但網路根本沒問題。owner 2026-08-04 實際踩到：`crypto.randomUUID()`
    // 在非安全內容下拋錯，症狀是「手機連不上、桌機正常」，查了半天才發現
    // 與網路無關。**catch 的範圍要剛好只包住真正會有網路問題的那一行。**
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-DesktopST-Token': this.opts.token(),
      ...extraHeaders
    }
    const device = this.opts.device?.()
    if (device) {
      headers['X-Device-Id'] = device.id
      // 中文暱稱必須先編碼 —— header 只能是 ASCII，否則整個請求送不出去。
      headers['X-Device-Nickname'] = encodeNicknameHeader(device.nickname)
    }

    let res: Response
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    } catch (e) {
      // 連不上電腦：關機、離開區網、tunnel 掛掉⋯⋯對 UI 而言都是同一件事。
      throw new DataError('unreachable', String(e))
    }

    if (!res.ok) {
      throw new DataError(statusToCode(res.status), await safeText(res))
    }

    try {
      return (await res.json()) as T
    } catch (e) {
      throw new DataError('unknown', `bad json: ${String(e)}`)
    }
  }

  private async requestBinary(
    method: string,
    path: string,
    body?: unknown
  ): Promise<{ blob: Blob; headers: Headers }> {
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch
    const base = this.opts.baseUrl().replace(/\/$/, '')
    const headers: Record<string, string> = { 'X-DesktopST-Token': this.opts.token() }
    if (body !== undefined) headers['Content-Type'] = 'application/json'

    let res: Response
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    } catch (e) {
      throw new DataError('unreachable', String(e))
    }

    if (!res.ok) {
      throw new DataError(statusToCode(res.status), await safeText(res))
    }

    return { blob: await res.blob(), headers: res.headers }
  }
}

function statusToCode(status: number): DataErrorCode {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not-found'
  if (status === 409) return 'conflict'
  if (status === 501) return 'not-supported'
  // 400 與 413（圖片太大）都是「送的東西不對」，UI 對這兩者的處理相同。
  if (status >= 400 && status < 500) return 'invalid-input'
  // 503（伺服器還沒 ready）歸為連不上：使用者能做的事一樣是等一下再試。
  if (status === 503) return 'unreachable'
  return 'unknown'
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500)
  } catch {
    return `HTTP ${res.status}`
  }
}
