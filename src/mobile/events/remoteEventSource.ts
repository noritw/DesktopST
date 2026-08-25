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

/**
 * 連續失敗這麼多次之後，退避上限放寬到 `LONG_BACKOFF_MS`。
 *
 * owner 2026-08-13 問「反覆重連會有不好影響嗎」——原本不論斷多久都固定每 8 秒
 * 試一次，而且**永遠不會停**（原生殼沒有 `onNeedsReload`，不會走重載那條路）。
 * 電腦關機一整晚就是整晚每 8 秒一次 TCP 連線嘗試：單次成本很小，但會週期性
 * 喚醒網路介面，對電池不是零。
 *
 * 前 10 次維持原本的快節奏（約一分鐘內），讓「電腦重開機」「Wi-Fi 換頻段」
 * 這類短暫中斷能立刻接回來；超過之後才降頻到 30 秒 —— 那時多半是電腦真的關了，
 * 使用者也已經看過詢問視窗，晚幾秒接上完全無感。
 */
const LONG_BACKOFF_AFTER_RETRIES = 10
const LONG_BACKOFF_MS = 30_000

export class RemoteEventSource implements EventSource {
  private hub = new EventHub()
  private socket: WebSocketLike | null = null
  private started = false
  private everConnected = false
  private retryCount = 0
  private failCount = 0
  private reconnectTimer: number | null = null
  /**
   * 逾時保險：**每個角色各一個**。
   *
   * 群組接龍會有多位角色同時在思考（`ipcHandlers.setThinking`）。
   * 早期只留一個計時器，第二位開始思考時會把第一位的保險清掉 ——
   * 若第一位的 `thinking-done` 剛好沒送到，它的動畫就永遠轉下去。
   */
  private thinkingTimers = new Map<string, number>()

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

    const url = this.opts.wsUrl()
    // eslint-disable-next-line no-console -- 暫時診斷（S2 M1「連線中斷」追查用，見 CLAUDE.md §5）
    console.info('[RemoteEventSource] connecting', url)

    let socket: WebSocketLike
    try {
      socket = create(url)
    } catch (e) {
      console.info('[RemoteEventSource] create() threw', e)
      this.handleClose()
      return
    }
    this.socket = socket

    socket.addEventListener('open', () => {
      console.info('[RemoteEventSource] open')
      this.retryCount = 0
      this.failCount = 0
      this.hub.setStatus('online')
      // 重連後必須對帳：斷線期間 push 的訊息不會補送，不重抓畫面會停在舊狀態。
      if (this.everConnected) this.hub.emit({ kind: 'state-invalidated', reason: 'reconnect' })
      this.everConnected = true
    })

    socket.addEventListener('message', (e) => this.handleMessage(e.data))
    socket.addEventListener('close', (e) => {
      const ce = e as unknown as { code?: number; reason?: string; wasClean?: boolean }
      console.info('[RemoteEventSource] close', { code: ce.code, reason: ce.reason, wasClean: ce.wasClean })
      this.handleClose()
    })
    socket.addEventListener('error', (e) => {
      console.info('[RemoteEventSource] error', e)
      socket.close()
    })
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
    const ceiling = this.retryCount >= LONG_BACKOFF_AFTER_RETRIES ? LONG_BACKOFF_MS : MAX_BACKOFF_MS
    const delay = Math.min(500 * Math.pow(2, this.retryCount), ceiling)
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
      case 'thinking': {
        const id = String(d.characterId ?? '')
        this.armThinkingTimeout(id)
        this.hub.emit({ kind: 'thinking', characterId: id })
        return
      }
      case 'thinking-done': {
        const id = String(d.characterId ?? '')
        this.clearThinkingTimer(id)
        this.hub.emit({ kind: 'thinking-done', characterId: id })
        return
      }
      case 'reminder':
        this.hub.emit({ kind: 'reminder', content: String(d.content ?? '') })
        return
      case 'desktop-updated':
        this.hub.emit({ kind: 'state-invalidated', reason: 'desktop' })
        return
      case 'remote-control-state':
        this.hub.emit({ kind: 'state-invalidated', reason: 'remote-control' })
        return
      case 'reminders-sync-available':
        this.hub.emit({ kind: 'reminders-sync-available' })
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
    this.clearThinkingTimer(characterId)
    const handle = this.setTimer(() => {
      this.thinkingTimers.delete(characterId)
      this.hub.emit({ kind: 'thinking-done', characterId })
      this.hub.emit({ kind: 'state-invalidated', reason: 'reconnect' })
    }, this.thinkingTimeoutMs)
    this.thinkingTimers.set(characterId, handle)
  }

  /** 不給 id ＝ 全部清掉（斷線與 stop 時用）。 */
  private clearThinkingTimer(characterId?: string): void {
    if (characterId === undefined) {
      for (const handle of this.thinkingTimers.values()) this.clearTimer(handle)
      this.thinkingTimers.clear()
      return
    }
    const handle = this.thinkingTimers.get(characterId)
    if (handle !== undefined) {
      this.clearTimer(handle)
      this.thinkingTimers.delete(characterId)
    }
  }

  private cancelReconnect(): void {
    if (this.reconnectTimer !== null) {
      this.clearTimer(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}
