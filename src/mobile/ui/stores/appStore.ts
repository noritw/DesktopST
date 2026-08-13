import { create } from 'zustand'
import type { AppStateSnapshot, DataSource, MessageSnapshot, SendMessageInput } from '@core/data'
import { DataError } from '@core/data'
import type { AppEvent, ConnectionStatus, EventSource } from '@core/events'
import { useUiStore } from './uiStore'
import { useNewsStore } from '../news/newsStore'
import { invalidateAllAvatars } from '../characters/useAvatarUrl'

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

  /**
   * 停止生成後還給輸入框的草稿。`Composer` 讀到就套用並清掉。
   * 放這裡是因為停止指令在 store，圖片附件卻在 Composer 本地 state。
   */
  restoreDraft: { content: string; images?: string[] } | null

  /**
   * 訊息 id → 手上已有的圖片 data URI（清單 B3／B4）。
   *
   * 為什麼需要這張表：`MessageSnapshot` 刻意不帶 `images`（base64 太肥不隨快照走），
   * 圖片要另外向 `getMessageImageUrl()` 取。但**剛送出去的那則我們手上就有原圖** ——
   * 不記著的話樂觀渲染的那則會是幾個空框，等伺服器回音才浮現，
   * 看起來像「圖沒送出去」。
   *
   * 伺服器回音取代樂觀那則時，這裡的 key 會一起換過去（見 `handleEvent`），
   * 免得同一張圖為了換個網址再下載一次。
   */
  localImages: Record<string, string[]>

  attach: (deps: { data: DataSource; events: EventSource }) => () => void
  refresh: () => Promise<void>
  send: (input: SendMessageInput) => Promise<void>
  /**
   * 「說點什麼」：強制角色主動發話。跟 `send` 共用 `sending` 鎖與同一顆
   * 停止按鈕 —— 沒有使用者訊息可撤回，但生成中途一樣該能按停止。
   */
  speak: (characterId: string) => Promise<void>
  /** 中止進行中的生成，並把草稿還給輸入框。 */
  stop: () => Promise<void>
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
  restoreDraft: null,
  thinkingIds: [],
  sending: false,
  localImages: {},

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
      const messages = snapshot.conversation?.messages ?? []
      set((s) => ({
        snapshot,
        messages,
        // 重抓會整串換掉（含換對話），留著已經不存在的訊息那份原圖只是漏記憶體。
        localImages: pruneLocalImages(s.localImages, messages),
        ready: true,
        loadError: null
      }))
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
      imageCount: input.images?.length,
      // 擲出的結果要立刻看得到（清單 C5）。等伺服器回音才顯示的話，
      // 「按了送出但骰子沒有結果」的那一秒會讓人以為 token 沒被認出來。
      randomResults: input.randomResults,
      newsLink: input.newsLink ?? undefined
    }
    set((s) => ({
      messages: [...s.messages, optimistic],
      sending: true,
      localImages: input.images?.length
        ? { ...s.localImages, [optimistic.id]: input.images }
        : s.localImages
    }))

    try {
      await deps.data.sendMessage(input)
    } catch (e) {
      // 失敗：把樂觀那則換成系統錯誤訊息（清單 A8）。
      // 錯誤代碼在這裡就翻成中文 —— core 只給代碼（roadmap §3.3）。
      set((s) => ({
        sending: false,
        messages: s.messages.map((m) =>
          m.id === optimistic.id
            ? {
                ...m,
                role: 'system' as const,
                content: describeError(e, 'send'),
                imageCount: undefined
              }
            : m
        ),
        // 圖片由呼叫端放回附件列（清單 B5），這裡不再重複顯示在錯誤泡泡上。
        localImages: pruneKey(s.localImages, optimistic.id)
      }))
      throw e
    }
    // 若使用者中途按了停止，sending 已被 stop() 清掉；勿再蓋掉 restoreDraft。
    if (get().sending) set({ sending: false })
  },

  speak: async (characterId) => {
    if (!deps) return
    set({ sending: true })
    try {
      await deps.data.characters.speak(characterId)
    } catch (e) {
      if (get().sending) set({ sending: false })
      throw e
    }
    // 若使用者中途按了停止，sending 已被 stop() 清掉；勿再蓋掉 restoreDraft。
    if (get().sending) set({ sending: false })
  },

  stop: async () => {
    if (!deps || !get().sending) return
    const draft = await deps.data.stopGenerating()
    set((s) => {
      // 樂觀那則＋已寫入的同內容使用者訊息都先拿掉（對齊桌面撤回未回覆訊息）。
      // 遙控端 abort 清理是非同步的，若不先清，字已還回輸入框時泡泡還會留一瞬。
      let messages = s.messages.filter((m) => !isOptimistic(m))
      if (draft) {
        for (let i = messages.length - 1; i >= 0; i--) {
          const m = messages[i]!
          if (m.role === 'user' && m.content === draft.content) {
            messages = [...messages.slice(0, i), ...messages.slice(i + 1)]
            break
          }
        }
      }
      return {
        sending: false,
        thinkingIds: [],
        messages,
        localImages: Object.fromEntries(
          Object.entries(s.localImages).filter(([id]) => !id.startsWith(OPTIMISTIC_PREFIX))
        ),
        restoreDraft: draft
          ? { content: draft.content, images: draft.images }
          : s.restoreDraft
      }
    })
    // 獨立模式會 push state-invalidated；遙控則靠訊息數減少觸發 desktop-updated。
    await get().refresh()
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
    case 'message': {
      const incoming = e.message as MessageSnapshot
      set((s) => {
        const replacedId = findOptimisticMatch(s.messages, incoming)
        return {
          messages: mergeIncoming(s.messages, incoming),
          // 樂觀那則被取代時，把手上的原圖換掛到新 id 底下 ——
          // 不搬的話畫面上的圖會消失一瞬再從伺服器抓一次同樣的東西。
          localImages: replacedId ? renameKey(s.localImages, replacedId, incoming.id) : s.localImages
        }
      })
      return
    }

    case 'thinking':
      set((s) => ({
        thinkingIds: s.thinkingIds.includes(e.characterId) ? s.thinkingIds : [...s.thinkingIds, e.characterId]
      }))
      return

    case 'thinking-done':
      set((s) => ({ thinkingIds: s.thinkingIds.filter((id) => id !== e.characterId) }))
      return

    case 'reminder':
      // 提醒的內容是角色要說的話，會另外以訊息形式進來，所以**不重複塞進訊息串**。
      // 但仍要跳一則 toast：使用者可能正開著某個 sheet（設定、角色庫⋯⋯），
      // 看不到底下的訊息串就完全不會發現提醒到了。
      // `mobile.html` 本來就有這個行為（1254 行），漏掉等於功能倒退。
      useUiStore.getState().toast(e.content || '收到提醒')
      return

    case 'state-invalidated':
      void get().refresh()
      // 新聞報有自己的快取（`newsStore`），不會因為這個事件自動重抓——
      // 見 `newsStore.invalidate` 的說明（同步關鍵字組進來卻沒反映在畫面上
      // 的那個 bug）。這裡是全站唯一的 `state-invalidated` 訂閱點，
      // 其他 store 要跟著失效也在這裡加，不要各自另開一條訂閱。
      useNewsStore.getState().invalidate()
      // 頭像同理：電腦端換了主圖也是靠這個通用事件通知手機，事件本身不會
      // 講是哪一隻角色，乾脆全部清快取重問一次（owner 2026-08-13 實機回報：
      // 遙控模式下電腦端換的主圖沒有反映到手機畫面，成因就是這裡漏掉）。
      invalidateAllAvatars()
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

  const replacedId = findOptimisticMatch(list, incoming)
  if (replacedId) {
    return list.map((m) => (m.id === replacedId ? incoming : m))
  }
  return [...list, incoming]
}

/**
 * 這則回音是在取代哪一則樂觀訊息？沒有就回 `null`。
 *
 * 抽出來是因為併訊息與搬 `localImages` 兩邊都要問同一個問題，
 * 各寫一份判斷等於埋一個「兩邊哪天不一致」的坑。
 */
export function findOptimisticMatch(
  list: MessageSnapshot[],
  incoming: MessageSnapshot
): string | null {
  if (incoming.role !== 'user') return null
  const hit = list.find((m) => isOptimistic(m) && m.role === 'user' && m.content === incoming.content)
  return hit?.id ?? null
}

function pruneKey(map: Record<string, string[]>, id: string): Record<string, string[]> {
  if (!(id in map)) return map
  const next = { ...map }
  delete next[id]
  return next
}

function renameKey(
  map: Record<string, string[]>,
  from: string,
  to: string
): Record<string, string[]> {
  const value = map[from]
  if (!value) return map
  const next = { ...map }
  delete next[from]
  next[to] = value
  return next
}

function pruneLocalImages(
  map: Record<string, string[]>,
  messages: MessageSnapshot[]
): Record<string, string[]> {
  const keys = Object.keys(map)
  if (keys.length === 0) return map
  const alive = new Set(messages.map((m) => m.id))
  if (keys.every((k) => alive.has(k))) return map
  const next: Record<string, string[]> = {}
  for (const k of keys) if (alive.has(k)) next[k] = map[k]
  return next
}
