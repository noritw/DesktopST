/**
 * 排程 adapter —— 平台各自實作
 * （Electron: `setTimeout` ＋ `powerMonitor`；Capacitor: AlarmManager）。
 *
 * 只負責「時間到了叫我」，**不含任何提醒的業務語意**
 * （daily / interval / once 的換算屬於 core 的排程邏輯，不屬於平台）。
 */
export interface SchedulerAdapter {
  /**
   * 在絕對時刻 `atMs`（Unix ms）觸發 `fn`。
   * 同一個 `id` 重複註冊視為覆蓋前一次。
   * 已過去的時刻不應觸發，由呼叫端自行決定要不要補跑。
   */
  schedule(id: string, atMs: number, fn: () => void): void

  cancel(id: string): void
  cancelAll(): void

  /**
   * 裝置從睡眠／待機恢復時通知（桌面接 `powerMonitor` 的 resume）。
   * 睡眠期間到期的排程可能沒被觸發，呼叫端收到後應重新對時。
   * 平台若無此概念可不實作。
   */
  onResume?(fn: () => void): void
}
