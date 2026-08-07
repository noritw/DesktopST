import type { HttpAdapter } from '../../core/adapters'

/**
 * Capacitor 端的 HTTP adapter。
 *
 * `capacitor.config.ts` 已開 `CapacitorHttp: { enabled: true }`，
 * 會接管全域 `fetch` 繞過 WebView CORS（Gemini SDK／RSS 都靠這條）。
 * 因此這裡直接轉發全域 fetch 即可。
 *
 * ⚠️ **必須在呼叫當下才讀 `globalThis.fetch`**，不可在模組載入時 bind。
 * CapacitorHttp 是在 plugin 初始化時才 patch 掉 `window.fetch`；
 * 先 bind 就會抓到未 patch 的原生 WebView fetch，CORS 繞道整個失效，
 * 而且只在真機上炸、瀏覽器煙測看不出來。
 *
 * ⚠️ `supportsStreaming` 必須是 `false`——原生 HTTP 對 ReadableStream
 * 支援不佳（roadmap §4.3）；呼叫端應改走非串流路徑。
 */
export const capacitorHttp: HttpAdapter = {
  fetch: ((input, init) => globalThis.fetch(input, init)) as typeof globalThis.fetch,
  supportsStreaming: false
}
