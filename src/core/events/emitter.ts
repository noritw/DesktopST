import type {
  AppEvent,
  AppEventListener,
  ConnectionStatus,
  ConnectionStatusListener,
  Unsubscribe
} from './types'

/**
 * 兩個模式共用的訂閱／派發骨架（純函式層，無平台依賴）。
 *
 * 抽出來的理由：訂閱清單、取消訂閱的冪等、「某個 listener 拋例外不可以害到其他
 * listener」這幾件事兩邊完全一樣，各寫一份必然會有一邊漏掉。
 */
export class EventHub {
  private listeners = new Set<AppEventListener>()
  private statusListeners = new Set<ConnectionStatusListener>()
  private status: ConnectionStatus = 'idle'

  subscribe(listener: AppEventListener): Unsubscribe {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  onStatusChange(listener: ConnectionStatusListener): Unsubscribe {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }

  getStatus(): ConnectionStatus {
    return this.status
  }

  /** 狀態沒變就不通知，避免 UI 重複跳「已連線」。 */
  setStatus(next: ConnectionStatus): void {
    if (this.status === next) return
    this.status = next
    for (const l of [...this.statusListeners]) safely(() => l(next))
  }

  emit(event: AppEvent): void {
    // 複製一份再走訪：listener 可能在收到事件時取消訂閱
    for (const l of [...this.listeners]) safely(() => l(event))
  }

  clear(): void {
    this.listeners.clear()
    this.statusListeners.clear()
  }
}

function safely(fn: () => void): void {
  try {
    fn()
  } catch (e) {
    console.error('[events] listener threw:', e)
  }
}
