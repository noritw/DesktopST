/**
 * headless WebView 的原生介面（`HeadlessBridge.java` 注入的 `window.DestHeadless`）。
 *
 * 只有提醒到點時、由 `ReminderForegroundService` 起的那個隱藏 WebView 才有這個物件。
 * 一般前景的 App 沒有——所以任何呼叫前都要先 `hasHeadlessBridge()`。
 */

export interface HeadlessNativeBridge {
  readFile(path: string): string | null
  readFileBase64(path: string): string | null
  writeFile(path: string, data: string): boolean
  exists(path: string): boolean
  /** JSON 陣列字串（純檔名，不含路徑） */
  listDir(path: string): string
  /** base64 的 master key；使用者還沒設過 API Key 時為 null */
  masterKey(): string | null
  httpRequest(requestJson: string, callbackId: string): void
  complete(resultJson: string): void
  log(message: string): void
}

declare global {
  interface Window {
    DestHeadless?: HeadlessNativeBridge
    /** 原生 HTTP 完成時回呼（由 `installHttpCallback()` 掛上） */
    __destHeadlessHttp?: (callbackId: string, responseJson: string) => void
  }
}

export function getHeadlessBridge(): HeadlessNativeBridge | null {
  if (typeof window === 'undefined') return null
  return window.DestHeadless ?? null
}

export function hasHeadlessBridge(): boolean {
  return getHeadlessBridge() !== null
}

/** 這一次載入是不是 headless 提醒（`?headless=reminder&reminderId=…`）。 */
export function headlessReminderParams(): { reminderId: string; screenOn: boolean } | null {
  if (typeof window === 'undefined') return null
  const p = new URLSearchParams(window.location.search)
  if (p.get('headless') !== 'reminder') return null
  const reminderId = p.get('reminderId')
  if (!reminderId) return null
  return { reminderId, screenOn: p.get('screenOn') !== '0' }
}

/**
 * 同時寫進 logcat 與 console。
 *
 * headless 出問題時**只有 logcat 看得到**（沒有畫面、沒有 DevTools），
 * 所以這條路徑上的每一步都要留話。`adb logcat -s ReminderAlarm` 就能追。
 */
export function hlog(message: string): void {
  console.log(`[headless] ${message}`)
  getHeadlessBridge()?.log(message)
}
