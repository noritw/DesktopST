import { EventHub } from '@core/events'
import type { ConnectionStatus, EventSource } from '@core/events'
import type { Message } from '@core/types'

/**
 * 遙控模式的事件來源：包住現行的 WebSocket。
 *
 * 行為逐條沿用 `assets/mobile.html` 1210–1268 行（重連退避、relay 重載、對帳），
 * 只是換成介面的形狀。**遙控獨有的麻煩全部關在這支檔案裡**：
 *
 *   - 重連對帳（手機鎖屏／切背景會被系統斷線，斷線期間 push 的訊息不補送）
 *   - 回前景重抓
 *   - `thinking-done` 沒送到的逾時保險
 *
 * 獨立模式看不到這些（`localEventSource.ts` 幾乎是空的），
 * UI 也不必為它們寫特例 —— 它們一律以 `state-invalidated` 或
 * `thinking-done` 的形式出現，跟正常事件長得一模一樣。
 */

export interface RemoteEventSourceOptions {
  /** WebSocket 位址（tunnel 或本機皆可）。每次連線都重新取，relay 換 URL 時才拿得到新的。 */
  wsUrl: () => string
  /**
   * 連續失敗多次且是走 relay 時，回 relay 頁面重新取得 tunnel URL。
   * 這是**平台動作**（換頁），所以由呼叫端提供；不提供＝不做這件事，繼續退避重連。
   */
  onNeedsReload?: () => void
  /** 思考逾時保險（毫秒）。預設 90 秒，與 `mobile.html` 相同。 */
  thinkingTimeoutMs?: number
  /** 測試用；預設走全域 WebSocket。 */
  createSocket?: (url: string) => WebSocketLike
  setTimer?: (fn: () => void, ms: number) => number
  clearTimer?: (handle: number) => void
}

/**
 * 只用到的那幾個成員，讓測試可以塞假的。
 *
 * 刻意**不用多載**：多載會讓「假的 WebSocket」很難寫得過型別檢查，
 * 而這個介面存在的唯一理由就是要能塞假的。open / close / error 的
 * 事件物件用不到，收一個共同形狀即可。
 */
export interface SocketEventLike {
  data: string
}
export interface WebSocketLike {
  addEventListener(type: 'open' | 'close' | 'error' | 'message', listener: (event: SocketEventLike) => void): void
  close(): void
}

const MAX_BACKOFF_MS = 8000
const RELOAD_AFTER_FAILURES = 4

export class RemoteEventSource implements EventSource {
  private hub = new EventHub()
  private socket: WebSocketLike | null = null
  private started = false
  private everConnected = false
  private retryCount = 0
  private failCount = 0
  private reconnectTimer: number | null = null
  private thinkingTimer: number | null = null
  private thinkingCharacterId = ''

  private readonly setTimer: (fn: () => void, ms: number) => number
  private readonly clearTimer: (handle: number) => void
  private readonly thinkingTimeoutMs: number

  constructor(private opts: RemoteEventSourceOptions) {
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number)
    this.clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h))
    this.thinkingTimeoutMs = opts.thinkingTimeoutMs ?? 90_000
  }

  subscribe = (l: Parameters<EventSource['subscribe']>[0]) => this.hub.subscribe(l)
  onStatusChange = (l: Parameters<EventSource['onStatusChange']>[0]) => this.hub.onStatusChange(l)
  getStatus = (): ConnectionStatus => this.hub.getStatus()

  start(): void {
    if (this.started) return
    this.started = true
    this.connect()
  }

  stop(): void {
    this.started = false
    this.cancelReconnect()
    this.clearThinkingTimer()
    const s = this.socket
    this.socket = null
    s?.close()
    this.hub.setStatus('idle')
  }

  /**
   * 回前景。連線還在就只補一次對帳；斷了就立刻重連（不等退避）——
   * 使用者正盯著畫面，這時候等 8 秒是最糟的體驗。
   */
  notifyForeground(): void {
    if (!this.started) return
    if (this.socket) {
      this.hub.emit({ kind: 'state-invalidated', reason: 'foreground' })
    } else {
      this.cancelReconnect()
      this.retryCount = 0
      this.connect()
    }
  }

  private connect(): void {
    if (!this.started) return
    this.hub.setStatus('connecting')
    const create = this.opts.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike)

    let socket: WebSocketLike
    try {
      socket = create(this.opts.wsUrl())
    } catch {
      this.handleClose()
      return
    }
    this.socket = socket

    socket.addEventListener('open', () => {
      this.retryCount = 0
      this.failCount = 0
      this.hub.setStatus('online')
      // 重連後必須對帳：斷線期間 push 的訊息不會補送，不重抓畫面會停在舊狀態。
      if (this.everConnected) this.hub.emit({ kind: 'state-invalidated', reason: 'reconnect' })
      this.everConnected = true
    })

    socket.addEventListener('message', (e) => this.handleMessage(e.data))
    socket.addEventListener('close', () => this.handleClose())
    socket.addEventListener('error', () => socket.close())
  }

  private handleClose(): void {
    this.socket = null
    this.clearThinkingTimer()
    this.hub.setStatus('offline')
    if (!this.started) return

    this.failCount++
    if (this.failCount >= RELOAD_AFTER_FAILURES && this.opts.onNeedsReload) {
      this.opts.onNeedsReload()
      return
    }
    const delay = Math.min(500 * Math.pow(2, this.retryCount), MAX_BACKOFF_MS)
    this.retryCount++
    this.reconnectTimer = this.setTimer(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  private handleMessage(raw: string): void {
    let d: Record<string, unknown>
    try {
      d = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }

    switch (d.type) {
      case 'message':
        if (d.message) this.hub.emit({ kind: 'message', message: d.message as Message })
        return
      case 'thinking':
        this.armThinkingTimeout(String(d.characterId ?? ''))
        this.hub.emit({ kind: 'thinking', characterId: String(d.characterId ?? '') })
        return
      case 'thinking-done':
        this.clearThinkingTimer()
        this.hub.emit({ kind: 'thinking-done', characterId: String(d.characterId ?? '') })
        return
      case 'reminder':
        this.hub.emit({ kind: 'reminder', content: String(d.content ?? '') })
        return
      case 'desktop-updated':
        this.hub.emit({ kind: 'state-invalidated', reason: 'desktop' })
        return
      case 'remote-control-state':
        this.hub.emit({ kind: 'state-invalidated', reason: 'remote-control' })
        return
      default:
        return
    }
  }

  /**
   * 逾時保險：`thinking-done` 沒送到（連線中斷、電腦端例外）時自行補一則，
   * 否則 UI 的思考動畫會永遠轉下去。順便對帳一次補回可能漏掉的回覆。
   */
  private armThinkingTimeout(characterId: string): void {
    this.clearThinkingTimer()
    this.thinkingCharacterId = characterId
    this.thinkingTimer = this.setTimer(() => {
      this.thinkingTimer = null
      this.hub.emit({ kind: 'thinking-done', characterId: this.thinkingCharacterId })
      this.hub.emit({ kind: 'state-invalidated', reason: 'reconnect' })
    }, this.thinkingTimeoutMs)
  }

  private clearThinkingTimer(): void {
    if (this.thinkingTimer !== null) {
      this.clearTimer(this.thinkingTimer)
      this.thinkingTimer = null
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
