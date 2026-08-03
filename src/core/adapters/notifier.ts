/**
 * 通知 adapter —— 平台各自實作
 * （Electron: `Notification`；Capacitor: Local Notifications）。
 *
 * ⚠️ 介面只收**已組好的內容字串**，這些字串一律由 UI 層產生，
 * 不得在 `core/` 裡組中文文案（roadmap §3.3；prompt 字串的例外不適用於通知）。
 */
export interface NotifierAdapter {
  notify(opts: NotifyOptions): Promise<void>
}

export interface NotifyOptions {
  title: string
  body: string
  /** 同 id 的通知視為更新而非新增；省略則每次都是新通知。 */
  id?: string
  /** 是否發出音效。實際音量等偏好由平台端讀設定決定，core 不管。 */
  silent?: boolean
}
