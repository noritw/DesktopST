import type { HttpAdapter } from '../../core/adapters'

/**
 * Electron 端的 HTTP adapter。
 *
 * Node 18+ 的原生 `fetch`，直接轉發即可——桌面端沒有 CORS 問題、串流也完整支援。
 * 手機端（Capacitor 原生 HTTP）才需要真正的實作，且 `supportsStreaming` 會是 false。
 *
 * 綁定 `globalThis` 是必要的：拆下來的 fetch 直接呼叫會拋 Illegal invocation。
 */
export const electronHttp: HttpAdapter = {
  fetch: (input: string, init?: RequestInit) => globalThis.fetch(input, init),
  supportsStreaming: true
}
