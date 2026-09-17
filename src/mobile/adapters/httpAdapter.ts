import type { HttpAdapter } from '../../core/adapters'
import { SOCIAL_BOT_USER_AGENT } from '../../core/util/htmlFetch'

/**
 * Capacitor 端的 HTTP adapter。
 *
 * `capacitor.config.ts` 已開 `CapacitorHttp: { enabled: true }`，
 * 會接管全域 `fetch` 繞過 WebView CORS（Gemini SDK／RSS 都靠這條）。
 *
 * ⚠️ **必須在呼叫當下才讀 `globalThis.fetch`**，不可在模組載入時 bind。
 * CapacitorHttp 是在 plugin 初始化時才 patch 掉 `window.fetch`；
 * 先 bind 就會抓到未 patch 的原生 WebView fetch，CORS 繞道整個失效，
 * 而且只在真機上炸、瀏覽器煙測看不出來。
 *
 * ⚠️ `supportsStreaming` 必須是 `false`——原生 HTTP 對 ReadableStream
 * 支援不佳（roadmap §4.3）；呼叫端應改走非串流路徑。
 */

/**
 * 沒有人傳 signal 時的保底逾時。
 *
 * 純粹是不讓 UI 永遠轉圈，所以放得比任何呼叫端自己的逾時都寬；
 * 真正該等多久由呼叫端用 `signal` 決定（天氣 5 秒、定位 10 秒…）。
 */
const HARD_CEILING_MS = 30_000

/**
 * 把 `AbortSignal` 翻譯成「這個 Promise 會 reject」。
 *
 * ⚠️ **CapacitorHttp 的 fetch patch 完全忽略 `init.signal`。**
 * 原生 plugin 收到的只有 url／method／headers／data，AbortController 對它毫無作用——
 * 於是 core 裡那些 `setTimeout(() => controller.abort(), 5000)` 全部形同虛設，
 * 原生請求一慢就無限等下去。owner 2026-08-09 回報「按抓取位置卡在那邊很久」
 * 就是這個：`detectLocationByIP` 打 `http://ip-api.com` 沒回來，5 秒逾時沒生效。
 *
 * 這裡用 `Promise.race` 讓**等待**中止（原生請求仍會自己跑完，我們只是不再等它）。
 * 呼叫端拿到的行為與標準 fetch 一致：abort 時丟 `AbortError`。
 */
function withAbort<T>(work: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  // 沒有 signal → 套保底天花板，不讓 UI 永遠轉圈。
  if (!signal) {
    const ceiling = new Promise<never>((_, reject) => {
      setTimeout(() => reject(abortError('timeout')), HARD_CEILING_MS)
    })
    return Promise.race([work, ceiling])
  }

  if (signal.aborted) return Promise.reject(abortError('aborted'))

  /*
   * 有 signal 就**只聽呼叫端的**，不再疊那個 30 秒天花板。
   *
   * 原本兩者都 race，等於任何請求最多 30 秒——與上面「放得比任何呼叫端自己的
   * 逾時都寬」的註解自相矛盾，呼叫端想等更久也等不到。
   * 本機 LLM 冷啟動（8B 模型載進記憶體）在一般機器上就可能超過 30 秒，
   * 症狀會是「第一次問一定失敗、之後才正常」，很難聯想到是 HTTP adapter 在攔。
   * OpenAI SDK 本來就會帶自己的逾時 signal 進來，交給它即可。
   */
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(abortError('aborted')), { once: true })
    })
  ])
}

function abortError(reason: string): Error {
  const err = new Error(`The operation was aborted (${reason}).`)
  err.name = 'AbortError'
  return err
}

/**
 * 呼叫端有沒有自己指定 `User-Agent`。
 *
 * `init.headers` 可能是物件、陣列或 `Headers`，三種都要認得
 * （`fetchHtmlDoc` 傳的是物件，SDK 傳的可能是 `Headers`）。
 */
function readUserAgent(headers: HeadersInit | undefined): string | null {
  if (!headers) return null
  try {
    return new Headers(headers).get('user-agent')
  } catch {
    return null
  }
}

/**
 * 直接呼叫原生 `CapacitorHttp`，**繞過被 patch 的全域 `fetch`**。
 *
 * ⚠️ **為什麼非這樣不可**（2026-09-18 真機實測，Pixel 10a）：
 * Capacitor 的 fetch patch 對 **GET 與非 GET 走完全不同的兩條路**
 * （`native-bridge.js`）——非 GET 直接進原生 plugin，headers 原樣送出；
 * **GET 卻是改寫成 proxy 網址、交回 WebView 自己的 fetch**，而 Android WebView
 * 會把 `User-Agent` 拔掉（Chromium bug 40450316）。Capacitor 為此把 UA 抄到
 * `x-cap-user-agent`、再由 `WebViewLocalServer` 在原生端還原，但**這條還原路徑
 * 在實機上沒有生效**：社群站收到的仍是 WebView 自己的瀏覽器 UA。
 *
 * 症狀非常有辨識度：**噗浪成功、FB／Threads 失敗**。因為只有後兩家需要
 * 「不像瀏覽器」的 UA（`core/util/htmlFetch.ts` 的 `SOCIAL_BOT_USER_AGENT`），
 * FB 對瀏覽器 UA 直接回 HTTP 400、Threads 回沒有內容的空殼。
 * 桌面走 Node fetch 完全沒有這個問題，所以**只有手機壞**。
 *
 * 所以只要呼叫端明確指定了 UA，就走這條原生路——它跟 POST 走的是同一條，
 * 而噗浪回應串（POST）在實機上是通的，等於已經驗證過 headers 送得出去。
 */
async function nativeFetch(url: string, init: RequestInit): Promise<Response> {
  // 動態 import：瀏覽器煙測與 vitest 不該在載入時就碰到 Capacitor（CLAUDE.md §5）
  const { CapacitorHttp } = await import('@capacitor/core')
  const headers: Record<string, string> = {}
  if (init.headers) new Headers(init.headers).forEach((v, k) => { headers[k] = v })

  const res = await CapacitorHttp.request({
    url,
    method: (init.method ?? 'GET').toUpperCase(),
    headers,
    // 一律要原始文字：讓原生層自己 parse JSON 會踩到「宣稱 JSON 卻不合法時
    // 多編碼一次」那個坑（CLAUDE.md §5）。呼叫端自己決定怎麼解。
    responseType: 'text',
    data: init.body as string | undefined
  })

  const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data ?? '')
  /*
   * `Response` 建構子不接受 status 0，也不接受「204／304 帶 body」。
   * 原生層在某些錯誤情況下會回 0，硬塞會拋 RangeError ——那會把一個
   * 「對方回了錯誤碼」的情況變成「程式炸了」，兩者該分清楚。
   */
  const status = res.status >= 200 && res.status <= 599 ? res.status : 502
  const noBody = status === 204 || status === 304
  return new Response(noBody ? null : body, { status, headers: new Headers(res.headers ?? {}) })
}

/**
 * 這個請求要不要繞過 patch 過的 `fetch`、直接走原生。
 *
 * ⚠️ **只改道社群那條，不要改道全部。**
 *
 * `fetchHtmlDoc` 對**每一個**請求都會設 `User-Agent`（一般網頁用的是
 * `BROWSER_USER_AGENT`），所以「只要有 UA 就走原生」會把新聞抓取、一般連結
 * 閱讀整批改道——那些本來就是好的，換一條路只是平白引進新風險。
 * 真正壞掉的只有「要求非瀏覽器 UA」這一種，所以比對得明確一點。
 *
 * 匯出是為了測得到：真正的行為要靠真機，但「有沒有挑錯要改道的請求」
 * 是純判斷，該用單元測試守住。
 */
export function shouldUseNativeFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined
): input is string {
  return typeof input === 'string' && readUserAgent(init?.headers) === SOCIAL_BOT_USER_AGENT
}

export const capacitorHttp: HttpAdapter = {
  fetch: ((input, init) => {
    if (!shouldUseNativeFetch(input, init)) {
      return withAbort(globalThis.fetch(input, init), init?.signal)
    }
    return withAbort(nativeFetch(input, init ?? {}), init?.signal)
  }) as typeof globalThis.fetch,
  supportsStreaming: false
}
