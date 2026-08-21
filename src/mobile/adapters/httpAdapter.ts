import type { HttpAdapter } from '../../core/adapters'

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

export const capacitorHttp: HttpAdapter = {
  fetch: ((input, init) =>
    withAbort(globalThis.fetch(input, init), init?.signal)) as typeof globalThis.fetch,
  supportsStreaming: false
}
