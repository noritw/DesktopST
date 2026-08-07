import type { HttpAdapter } from '../../core/adapters'

/**
 * Capacitor 端的 HTTP adapter。
 *
 * `capacitor.config.ts` 已開 `CapacitorHttp: { enabled: true }`，
 * 會接管全域 `fetch` 繞過 WebView CORS（Gemini SDK／RSS 都靠這條）。
 * 因此這裡直接轉發全域 fetch 即可。
 *
 * ⚠️ `supportsStreaming` 必須是 `false`——原生 HTTP 對 ReadableStream
 * 支援不佳（roadmap §4.3）；呼叫端應改走非串流路徑。
 */
export const capacitorHttp: HttpAdapter = {
  fetch: globalThis.fetch.bind(globalThis),
  supportsStreaming: false
}
