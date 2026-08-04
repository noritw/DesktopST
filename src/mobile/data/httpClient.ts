import { DataError } from '@core/data'
import type { DataErrorCode } from '@core/data'

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

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const fetchImpl = this.opts.fetchImpl ?? globalThis.fetch
    const base = this.opts.baseUrl().replace(/\/$/, '')

    let res: Response
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-DesktopST-Token': this.opts.token()
        },
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
