import { EventHub } from '@core/events'
import type { AppEvent, ConnectionStatus, EventSource } from '@core/events'

/**
 * 獨立模式的事件來源：本機 core 直接發事件。
 *
 * ⚠️ **目前是刻意的空殼。** 它要等 B3 的本機聊天流程存在才接得上
 * （現在還沒有「手機上跑 LLM」的呼叫端可以發 `message`）。
 * 這階段要證明的只有一件事：**同一個介面兩種實作成立、UI 不必知道差別**。
 *
 * 注意它有多短 —— 那正是重點。重連對帳、退避、逾時保險全部是遙控獨有的問題，
 * 關在 `remoteEventSource.ts` 裡，一行都沒有漏到這邊。
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
   * 給本機流程呼叫的推送入口（B3 接上聊天流程後由它發 message / thinking）。
   * 不在 `EventSource` 介面裡：UI 只訂閱、不推送。
   */
  push(event: AppEvent): void {
    this.hub.emit(event)
  }
}
