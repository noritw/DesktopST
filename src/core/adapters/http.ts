/**
 * HTTP adapter —— 平台各自實作
 * （Electron: Node 原生 `fetch`；Capacitor: 原生 HTTP plugin，可繞過 CORS）。
 *
 * ## 為什麼做成 `fetch` 的形狀
 *
 * 四家 LLM 目前是透過各自的官方 SDK 呼叫的
 * （`openai`、`@anthropic-ai/sdk`、`@google/generative-ai`），**不是**自己打 HTTP。
 * 三家 SDK 都接受注入自訂的 fetch 實作，所以只要這個介面與 `fetch` 同形，
 * 就能把平台的 HTTP 直接餵給 SDK，不必為了跨平台重寫四家的請求／回應對映。
 *
 * 同時，日後若真的要拿掉 SDK 自己打 HTTP，這個介面**一行都不用改**。
 * 兩條路都留著。
 *
 * ## 串流
 *
 * Capacitor 的原生 HTTP 對 fetch streaming 支援不佳（roadmap §4.3）。
 * 因此**串流是加分項，不是前提**：呼叫端一律先問 `supportsStreaming`，
 * 為 false 時走非串流路徑（等完整回應再一次顯示）。
 * 不要寫出「假設一定拿得到 ReadableStream」的程式碼。
 */
export interface HttpAdapter {
  /**
   * 與 WHATWG `fetch` 同形，可直接交給各家 SDK 的 `fetch` 選項。
   *
   * 型別直接取自環境的 `fetch`，不要自己收窄成 `(url: string, ...)`——
   * SDK 內部會傳 `Request` 物件進來，收窄會讓它不能指派給 SDK 的 `fetch` 選項，
   * 也就失去這個介面存在的意義。實作端負責把各種輸入正規化。
   */
  fetch: typeof globalThis.fetch

  /**
   * 此平台的 fetch 是否支援讀取串流回應主體。
   * false 時呼叫端必須改走非串流路徑，不可退化成錯誤。
   */
  readonly supportsStreaming: boolean
}
