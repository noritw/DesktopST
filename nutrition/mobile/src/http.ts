import type { HttpAdapter } from '@core/adapters'

/**
 * Capacitor 端的 HTTP adapter（與 DeST 主 App 的 `src/mobile/adapters/httpAdapter.ts`
 * 同一套處理，兩個 App 各自建置所以各留一份）。
 *
 * `capacitor.config.ts` 已開 `CapacitorHttp: { enabled: true }`，會接管全域 `fetch`
 * 繞過 WebView 的 CORS —— 接本機模型（Ollama／LM Studio 預設不送 CORS 標頭）
 * 完全靠這條路，少了它就是 `Failed to fetch`。
 *
 * ⚠️ **必須在呼叫當下才讀 `globalThis.fetch`**，不可在模組載入時 bind。
 * CapacitorHttp 是在 plugin 初始化時才 patch 掉 `window.fetch`；先 bind 會抓到
 * 未 patch 的原生 WebView fetch，CORS 繞道整個失效，而且**只在真機上炸、
 * 瀏覽器預覽看不出來**。
 *
 * ⚠️ `supportsStreaming` 必須是 `false` —— 原生 HTTP 對 ReadableStream 支援不佳。
 */

/**
 * 沒有人傳 signal 時的保底逾時，純粹是不讓 UI 永遠轉圈。
 * 放得比任何呼叫端自己的逾時都寬；真正該等多久由呼叫端用 `signal` 決定。
 */
const HARD_CEILING_MS = 60_000

function abortError(reason: string): Error {
  const err = new Error(`The operation was aborted (${reason}).`)
  err.name = 'AbortError'
  return err
}

/**
 * 把 `AbortSignal` 翻譯成「這個 Promise 會 reject」。
 *
 * ⚠️ **CapacitorHttp 的 fetch patch 完全忽略 `init.signal`。** 原生 plugin 收到的
 * 只有 url／method／headers／data，`AbortController` 對它毫無作用——於是
 * `photoEstimateLlm.ts` 裡那些 `setTimeout(() => controller.abort(), 12000)`
 * 在真機上全部形同虛設，模型一慢就無限等、UI 永遠停在「估算中...」。
 *
 * 這裡用 `Promise.race` 讓**等待**中止（原生請求仍會自己跑完，我們只是不再等它）。
 * 呼叫端拿到的行為與標準 fetch 一致：abort 時丟 `AbortError`。
 */
function withAbort<T>(work: Promise<T>, signal: AbortSignal | null | undefined): Promise<T> {
  if (!signal) {
    return Promise.race([
      work,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(abortError('timeout')), HARD_CEILING_MS)
      })
    ])
  }

  if (signal.aborted) return Promise.reject(abortError('aborted'))

  // 有 signal 就只聽呼叫端的，不再疊保底天花板——本機模型冷啟動（把模型載進
  // 記憶體）可能要好幾十秒，疊上去會變成「第一次問一定失敗、之後才正常」。
  return Promise.race([
    work,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(abortError('aborted')), { once: true })
    })
  ])
}

export const nutritionMobileHttp: HttpAdapter = {
  fetch: ((input, init) =>
    withAbort(globalThis.fetch(input, init), init?.signal)) as typeof globalThis.fetch,
  supportsStreaming: false
}
