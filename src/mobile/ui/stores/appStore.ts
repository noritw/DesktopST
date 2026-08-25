import { create } from 'zustand'
import type { AppStateSnapshot, DataSource, MessageSnapshot, SendMessageInput } from '@core/data'
import { DataError } from '@core/data'
import type { AppEvent, ConnectionStatus, EventSource } from '@core/events'
import type { Message } from '@core/types'
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
  /**
   * 現在有沒有掛著 `DataSource`／`EventSource`（B-4，2026-08-16）。
   *
   * 切換模式時 `App.tsx` 的 attach effect 會先同步 `detach()` 舊的、再非同步
   * `attach()` 新的，中間有一段 `deps === null` 的空窗。這段時間呼叫
   * `getData()` 會 throw，設定／角色編輯畫面原本把這個 throw 當成「真的失敗」
   * 顯示「載入失敗」——其實只是還沒接上，不是壞掉。這個欄位讓那些畫面能
   * 分辨「還沒接上，等一下自動重試」跟「真的連不上，該顯示失敗＋重試鍵」。
   */
  attached: boolean
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

/**
 * 還沒 `attach()` 完成時安全地問「有沒有連上」，不會 throw。
 *
 * 選單一類的元件理論上只在 `ready` 之後才會被打開，但保險起見還是提供
 * 一支不會炸掉整個 render 的版本 —— 少一個「哪天多一條路徑在 `ready`
 * 之前就摸到這裡」就把全畫面弄白的坑。
 */
export function isAttached(): boolean {
  return deps !== null
}

/** 回前景時補一次對帳／視情況立刻重連（遙控模式才有作用，獨立模式是 no-op）。 */
export function notifyForeground(): void {
  deps?.events.notifyForeground()
}

export const useAppStore = create<AppState>((set, get) => ({
  status: 'idle',
  ready: false,
  attached: false,
  loadError: null,
  snapshot: null,
  messages: [],
  restoreDraft: null,
  thinkingIds: [],
  sending: false,
  localImages: {},

  attach: (d) => {
    deps = d
    set({ attached: true })
    const offEvent = d.events.subscribe((e) => handleEvent(e, set, get))
    const offStatus = d.events.onStatusChange((status) => set({ status }))
    d.events.start()
    void get().refresh()

    return () => {
      offEvent()
      offStatus()
      d.events.stop()
      deps = null
      /*
       * `ready` 也要跟著歸零（B-4）：不歸零的話，切換模式的空窗期間
       * `ready` 還停在上一輪的 `true`，`App.tsx` 頂層的選單按鈕／載入畫面
       * 判斷不出「現在其實接不上」，使用者照樣點得進設定／角色編輯，
       * 才會撞上 `attached` 這個欄位原本要擋的那個空窗。
       */
      set({ attached: false, ready: false })
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
      // `unreachable`：送出當下手機切到背景，系統把連線砍斷讓這個 fetch
      // 失敗 —— 但 LLM 是在電腦那邊獨立跑的，不會因為手機這頭的連線斷了
      // 就停。對帳一次：`refresh()` 拿到的是伺服器權威的訊息列表，
      // 如果這則已經不在裡面（換成真的了，或至少使用者的話已經送達），
      // 代表其實有送到，不該在使用者回來時給一則假的「網路錯誤」。
      // 真的沒送到（電腦真的關機／離線）才會落回下面的錯誤泡泡。
      if (e instanceof DataError && e.code === 'unreachable') {
        await get().refresh().catch(() => {})
        if (!get().messages.some((m) => m.id === optimistic.id)) {
          if (get().sending) set({ sending: false })
          return
        }
      }
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

/**
 * `'message'` 事件的 `message` 欄位型別上寫的是 `Message`，但兩種模式塞進去的
 * 實際形狀不一樣（B-5，2026-08-16）：
 *
 * - 獨立模式（`chat.ts`）塞的是真的完整 `Message`，帶 `images: string[]`，
 *   沒有 `imageCount`。
 * - 遙控模式（`remoteEventSource.ts`）收到的是電腦端 WS 廣播，早就被
 *   `mobileServer.ts` 的 `sanitizeMessage()` 拿掉 `images`、換算成
 *   `imageCount` 送過來——型別標成 `Message`是騙的，運行時其實沒有 `images`。
 *
 * 兩種都要接得住：有 `imageCount` 就直接信，沒有才用 `images.length` 現算。
 * 原本直接 `as MessageSnapshot` 硬轉型，兩條路徑都吃得下去看似沒事，但
 * 獨立模式送出去的使用者訊息回音（`chat.ts` 的 `sendStandaloneMessage`）
 * 完全沒有 `imageCount` 欄位，取代樂觀訊息時把原本正確的 `imageCount`
 * 蓋成 `undefined`，畫面上的縮圖元件因此判定「這則沒有圖」直接不渲染——
 * 圖確實送出去了、角色也正確看得到，只是手機自己的訊息泡泡沒有縮圖，
 * 要等下一次 `state-invalidated` 重抓（`refresh()` 走的是
 * `toMessageSnapshot()`，那支沒有這個問題）才會冒出來。
 */
export function toEventMessageSnapshot(m: Message): MessageSnapshot {
  const raw = m as Message & { imageCount?: number }
  const { images, debugPrompt: _d, utilityDebugPrompt: _u, ...rest } = raw
  return {
    ...rest,
    imageCount: typeof raw.imageCount === 'number' ? raw.imageCount : (images?.length ?? 0)
  }
}

/**
 * 重算桌面小工具快照。
 *
 * ⚠️ **動態 import 是必要的，不要改成頂層 import**：
 * `widgetStore` → `widgetBridge` → `appStore`（`getData`／`isAttached`）
 * 是一個循環，頂層 import 會在模組求值階段拿到還沒初始化完的 binding。
 */
function refreshWidgetSnapshot(): void {
  void import('./widgetStore')
    .then((m) => m.useWidgetStore.getState().refresh())
    .catch(() => {})
}

type Setter = (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void

function handleEvent(e: AppEvent, set: Setter, get: () => AppState): void {
  switch (e.kind) {
    case 'message': {
      const incoming = toEventMessageSnapshot(e.message)
      set((s) => {
        const replacedId = findOptimisticMatch(s.messages, incoming)
        return {
          messages: mergeIncoming(s.messages, incoming),
          // 樂觀那則被取代時，把手上的原圖換掛到新 id 底下 ——
          // 不搬的話畫面上的圖會消失一瞬再從伺服器抓一次同樣的東西。
          localImages: replacedId ? renameKey(s.localImages, replacedId, incoming.id) : s.localImages
        }
      })
      // 桌面小工具（`docs/mobile-android-widget-plan.md` §4.1 觸發點 1）：
      // 角色訊息進來就刷一次快取。獨立模式的提醒背景路徑（headless、appStore
      // 未 attach）不會經過這裡，那條走 `session.ts` 自己的 hook——見那邊的說明。
      if (incoming.role === 'character') void refreshWidgetSnapshot()
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

    case 'reminders-sync-available':
      // 只有遙控模式的 `RemoteEventSource` 會發這個事件，見 core/events/types.ts 的說明。
      void (async () => {
        const { useConnectionStore } = await import('./connectionStore')
        const conn = useConnectionStore.getState().conn
        if (!conn || conn.mode !== 'remote') return
        const { getLocalSessionForSync, runRemindersQuickSync } = await import('../../runtime/remindersQuickSync')
        const session = await getLocalSessionForSync()
        const result = await runRemindersQuickSync({ baseUrl: conn.baseUrl, token: conn.token }, session)
        if (result.ok && result.changed > 0) {
          useUiStore.getState().toast('已同步最新提醒')
        } else if (!result.ok) {
          console.warn('[appStore] reminders quick sync failed:', result.error)
        }
      })()
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
      // 切換對話、電腦端改了東西 —— 小工具顯示的「目前對話最新一則」跟著變。
      refreshWidgetSnapshot()
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
