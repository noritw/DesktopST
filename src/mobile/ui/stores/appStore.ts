import { create } from 'zustand'
import type { AppStateSnapshot, DataSource, MessageSnapshot, SendMessageInput } from '@core/data'
import { DataError } from '@core/data'
import type { AppEvent, ConnectionStatus, EventSource } from '@core/events'

/**
 * 應用資料狀態。**聊天元件唯一的資料入口。**
 *
 * 兩個外界接觸面都由外部注入：
 *
 *   `DataSource`  —— 我要讀資料／下指令（拉取）
 *   `EventSource` —— 事情發生了（推播）
 *
 * 元件因此完全不知道自己在獨立還是遙控模式（決議③ 與階段 0-③ 的整個重點）。
 * ⚠️ **元件不得直接 import `RemoteDataSource` 或任何實作**，只能透過這裡。
 */

interface AppState {
  status: ConnectionStatus
  ready: boolean
  /** 首次載入失敗（例如電腦沒開）。UI 顯示重試，不是空白畫面。 */
  loadError: DataError | null

  snapshot: AppStateSnapshot | null
  messages: MessageSnapshot[]
  /** 正在思考的角色 id；空集合＝沒人在想。用 Set 是因為群組聊天會同時有多位。 */
  thinkingIds: string[]
  /** 送出中（樂觀渲染那則還沒被伺服器回音取代）。 */
  sending: boolean

  attach: (deps: { data: DataSource; events: EventSource }) => () => void
  refresh: () => Promise<void>
  send: (input: SendMessageInput) => Promise<void>
}

/**
 * 樂觀渲染的暫時 id 前綴（清單 A4）。
 *
 * 送出後立刻上畫面，之後伺服器把真正那則推回來時要能認出並取代它 ——
 * 靠的是「內容與時間相近」而不是 id（暫時 id 伺服器不認得）。
 */
const OPTIMISTIC_PREFIX = 'optimistic:'

export const isOptimistic = (m: MessageSnapshot): boolean => m.id.startsWith(OPTIMISTIC_PREFIX)

let deps: { data: DataSource; events: EventSource } | null = null

/** 元件用這支拿 DataSource 下指令（改名、禁言⋯⋯），不必自己接線。 */
export function getData(): DataSource {
  if (!deps) throw new Error('appStore not attached')
  return deps.data
}

export const useAppStore = create<AppState>((set, get) => ({
  status: 'idle',
  ready: false,
  loadError: null,
  snapshot: null,
  messages: [],
  thinkingIds: [],
  sending: false,

  attach: (d) => {
    deps = d
    const offEvent = d.events.subscribe((e) => handleEvent(e, set, get))
    const offStatus = d.events.onStatusChange((status) => set({ status }))
    d.events.start()
    void get().refresh()

    return () => {
      offEvent()
      offStatus()
      d.events.stop()
      deps = null
    }
  },

  refresh: async () => {
    if (!deps) return
    try {
      const snapshot = await deps.data.getState()
      set({
        snapshot,
        messages: snapshot.conversation?.messages ?? [],
        ready: true,
        loadError: null
      })
    } catch (e) {
      // 已經載入過就不要把畫面清掉 —— 斷線時保留使用者正在讀的內容，
      // 比換成一張錯誤畫面有用得多。
      if (get().ready) return
      set({ loadError: e instanceof DataError ? e : new DataError('unknown', String(e)) })
    }
  },

  send: async (input) => {
    if (!deps) return
    const optimistic: MessageSnapshot = {
      id: `${OPTIMISTIC_PREFIX}${Date.now()}`,
      role: 'user',
      content: input.content,
      timestamp: Date.now(),
      imageCount: input.images?.length
    }
    set((s) => ({ messages: [...s.messages, optimistic], sending: true }))

    try {
      await deps.data.sendMessage(input)
    } catch (e) {
      // 失敗：把樂觀那則換成系統錯誤訊息（清單 A8）。
      // 錯誤代碼在這裡就翻成中文 —— core 只給代碼（roadmap §3.3）。
      set((s) => ({
        sending: false,
        messages: s.messages.map((m) =>
          m.id === optimistic.id
            ? { ...m, role: 'system' as const, content: describeError(e, 'send') }
            : m
        )
      }))
      throw e
    }
    set({ sending: false })
  }
}))

/**
 * 錯誤代碼 → 使用者看得懂的話。**這層翻譯只能在 UI，不能在 core**（roadmap §3.3）。
 *
 * `context` 決定開頭那句。同一個 `unreachable` 在「送訊息失敗」與「開啟時載不到」
 * 底下要講的話不一樣 —— 前者使用者剛打完字、關心的是「我這句沒送出去」，
 * 後者則是整個畫面空的、關心的是「為什麼沒東西」。
 */
export function describeError(e: unknown, context: 'send' | 'load'): string {
  const code = e instanceof DataError ? e.code : 'unknown'
  const lead = context === 'send' ? '送不出去' : '載入失敗'

  switch (code) {
    case 'unreachable':
      return `${lead}：連不上電腦。請確認電腦已開機、DeST 正在執行，且兩台在同一個網路。`
    case 'unauthorized':
      return `${lead}：連線權杖失效，請重新掃描 QR code。`
    case 'invalid-input':
      return context === 'send'
        ? '送不出去：內容或圖片不符合限制（可能是圖片太大或張數太多）。'
        : '載入失敗：伺服器不接受這個請求。'
    case 'not-supported':
      return '這個功能在目前的連線方式下還不支援。'
    default:
      return `${lead}：發生未預期的錯誤。`
  }
}

type Setter = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void

function handleEvent(e: AppEvent, set: Setter, get: () => AppState): void {
  switch (e.kind) {
    case 'message':
      set((s) => ({ messages: mergeIncoming(s.messages, e.message as MessageSnapshot) }))
      return

    case 'thinking':
      set((s) => ({
        thinkingIds: s.thinkingIds.includes(e.characterId) ? s.thinkingIds : [...s.thinkingIds, e.characterId]
      }))
      return

    case 'thinking-done':
      set((s) => ({ thinkingIds: s.thinkingIds.filter((id) => id !== e.characterId) }))
      return

    case 'reminder':
      // 提醒的內容是角色要說的話，會另外以訊息形式進來；
      // 這裡不重複塞進訊息串，交給 UI 決定要不要跳提示。
      return

    case 'state-invalidated':
      void get().refresh()
      return
  }
}

/**
 * 併入推播進來的訊息。
 *
 * 兩件事要處理：
 *
 * 1. **取代樂觀那則**（清單 A4）：伺服器回音的是同一句話，但 id 不同。
 *    比對 role 與內容，取代最舊的那則相符的樂觀訊息。
 *    不比對時間戳 —— 伺服器的時間與手機的時間不會一致。
 * 2. **去重**：重連對帳（`state-invalidated`）之後可能同一則進來兩次。
 */
export function mergeIncoming(list: MessageSnapshot[], incoming: MessageSnapshot): MessageSnapshot[] {
  if (list.some((m) => m.id === incoming.id)) return list

  if (incoming.role === 'user') {
    const idx = list.findIndex(
      (m) => isOptimistic(m) && m.role === 'user' && m.content === incoming.content
    )
    if (idx >= 0) {
      const next = [...list]
      next[idx] = incoming
      return next
    }
  }
  return [...list, incoming]
}
