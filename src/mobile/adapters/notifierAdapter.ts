import type { NotifierAdapter, NotifyOptions } from '../../core/adapters'

/**
 * 通知 stub（B5 系統通知之後再接 `@capacitor/local-notifications`）。
 * 獨立聊天主線不依賴這支；先 no-op 讓 `PlatformAdapters` 組得起來。
 */
export const capacitorNotifier: NotifierAdapter = {
  async notify(_opts: NotifyOptions): Promise<void> {
    // 刻意空：本階段不發系統通知
  }
}
