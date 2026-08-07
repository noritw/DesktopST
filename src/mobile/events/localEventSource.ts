import { EventHub } from '@core/events'
import type { AppEvent, ConnectionStatus, EventSource } from '@core/events'

/**
 * 獨立模式的事件來源：本機 runtime 跑完 LLM 後 `push` 進來。
 *
 * 重連對帳、退避、逾時保險全部是遙控獨有的問題，關在 `remoteEventSource.ts`。
 */
export class LocalEventSource implements EventSource {
  private hub = new EventHub()

  subscribe = (l: Parameters<EventSource['subscribe']>[0]) => this.hub.subscribe(l)
  onStatusChange = (l: Parameters<EventSource['onStatusChange']>[0]) => this.hub.onStatusChange(l)
  getStatus = (): ConnectionStatus => this.hub.getStatus()

  /** 本機沒有連線這回事，一開始就是 online——UI 讀同一個欄位，不做模式判斷。 */
  start(): void {
    this.hub.setStatus('online')
  }

  stop(): void {
    this.hub.setStatus('idle')
  }

  /** 本機狀態不會過期，不需要對帳。 */
  notifyForeground(): void {}

  /**
   * 給本機流程呼叫的推送入口（`runtime/chat.ts`）。
   * 不在 `EventSource` 介面裡：UI 只訂閱、不推送。
   */
  push(event: AppEvent): void {
    this.hub.emit(event)
  }
}
