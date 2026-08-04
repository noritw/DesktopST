import type { Message } from '../types'

/**
 * 事件來源（B3 階段 0-②）。
 *
 * 手機 UI 只寫一份，但「新訊息是怎麼來的」在兩種模式下完全不同：
 *
 *   獨立模式：本機 core 跑完 LLM 直接發事件
 *   遙控模式：電腦透過 WebSocket 推過來
 *
 * 這個介面就是那道分界線 —— **UI 元件不應該知道自己在哪種模式**
 * （`docs/mobile-html-feature-inventory.md` §3 決議③）。
 *
 * 形狀比照 §4.4b 的 adapter 慣例：core 定介面，各模式各自實作。
 * 介面裡不得出現任何 UI 文案（roadmap §3.3）——
 * 連線狀態給的是狀態值，「已重新連線」這種字串留在 UI 層。
 */

/** UI 需要反應的事件。刻意只有這五種：現行 WS 推的六種正規化而來。 */
export type AppEvent =
  /** 有新訊息（使用者自己那則的回音也走這裡）。 */
  | { kind: 'message'; message: Message }
  /** 某個角色開始思考。 */
  | { kind: 'thinking'; characterId: string }
  /**
   * 思考結束。
   * ⚠️ 實作**必須保證這則一定會送到**（遙控端靠逾時保險補發），
   * 否則 UI 的「思考中」動畫會永遠轉下去。
   */
  | { kind: 'thinking-done'; characterId: string }
  /** 收到提醒。`content` 是角色要說的話，非 UI 文案。 */
  | { kind: 'reminder'; content: string }
  /**
   * 「你手上的狀態可能過期了，重抓一次」。
   *
   * 現行 WS 的 `desktop-updated` 與 `remote-control-state` 都只是觸發 `fetchState()`，
   * 所以這裡收斂成同一種事件、只帶原因（原因僅供除錯與埋點，UI 一律做同一件事）。
   *
   * **重連對帳也走這裡**：遙控實作在 WS 重新連上時發 `reason: 'reconnect'`。
   * 如此一來「鎖屏期間漏訊息」這個**遙控獨有的問題**完全關在遙控實作內，
   * 不會汙染獨立模式，UI 也不必為它寫任何特例（§3 決議③ 對 G6 的要求）。
   */
  | { kind: 'state-invalidated'; reason: 'desktop' | 'remote-control' | 'reconnect' | 'foreground' }

/**
 * 連線狀態。
 *
 * 獨立模式永遠是 `'online'` —— UI 讀的是同一個欄位，不做 `if (獨立模式)`。
 * 這是「UI 不知道差別」能成立的關鍵之一。
 */
export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'offline'

export type AppEventListener = (event: AppEvent) => void
export type ConnectionStatusListener = (status: ConnectionStatus) => void

/** 取消訂閱。呼叫兩次以上必須無害。 */
export type Unsubscribe = () => void

export interface EventSource {
  /** 開始接收（遙控＝連 WS，獨立＝掛上本機監聽）。重複呼叫必須無害。 */
  start(): void
  /** 停止接收並釋放資源。重複呼叫必須無害。 */
  stop(): void

  subscribe(listener: AppEventListener): Unsubscribe
  onStatusChange(listener: ConnectionStatusListener): Unsubscribe
  getStatus(): ConnectionStatus

  /**
   * UI 回到前景時呼叫（`visibilitychange`）。
   *
   * 遙控實作會藉此確認連線並補一次對帳；獨立實作是 no-op。
   * **由 UI 呼叫、而非各實作自己監聽 document**：core 不碰 DOM，
   * 而且日後 APK 的前景事件來自 Capacitor 而不是 `visibilitychange`。
   */
  notifyForeground(): void
}
