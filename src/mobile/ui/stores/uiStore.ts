import { create } from 'zustand'
import type { ColorTheme } from '@core/types'

/**
 * 介面狀態：畫面堆疊、toast、對話框、主題。
 *
 * **與資料無關的東西才放這裡。** 對話內容、角色、設定一律走 `DataSource`
 * 與另一個 store，兩者不可混在一起 —— 混了之後「換一個資料來源」就會牽動 UI 狀態。
 */

// ── 畫面堆疊（清單 G3）─────────────────────────────────────

/**
 * 疊在主畫面上的畫面種類。
 *
 * 用「字串 kind ＋ 參數」而不是直接把 React 元素塞進 state：
 * state 保持可序列化，才有辦法在除錯時整包印出來看，
 * 也不會因為存了元素而讓 store 抓著舊的 closure。
 */
export type ViewKind =
  | 'conversations'
  | 'presence'
  | 'character-menu'
  | 'message-menu'
  | 'characters'
  | 'character-editor'
  | 'presets'
  | 'preset-editor'
  | 'settings'
  | 'reminders'
  | 'reminder-editor'
  | 'news'
  | 'random-tools'
  | 'theme-picker'

export interface ViewEntry {
  /** 每次 push 都不同，讓 React 的 key 穩定（同一個 kind 可以疊兩層）。 */
  id: number
  kind: ViewKind
  /** 該畫面需要的參數，例如要編輯哪個角色。 */
  param?: string
}

// ── Toast（清單 G2）────────────────────────────────────────

export interface ToastEntry {
  id: number
  text: string
  tone: 'info' | 'error'
}

// ── 對話框（清單 E2：不要用瀏覽器 prompt/confirm）──────────

export interface DialogRequest {
  kind: 'confirm' | 'prompt'
  title: string
  message?: string
  /** prompt 專用 */
  defaultValue?: string
  placeholder?: string
  /**
   * 多行輸入（編輯訊息用，清單 A6）。
   * 單行 `<input>` 編一段角色台詞等於逼使用者在一條縫裡改文章。
   */
  multiline?: boolean
  confirmLabel?: string
  destructive?: boolean
  /** 回傳：confirm 給 boolean，prompt 給字串或 null（取消）。 */
  resolve: (value: string | boolean | null) => void
}

interface UiState {
  theme: ColorTheme
  setTheme: (theme: ColorTheme) => void

  /**
   * 圖片燈箱（清單 B4）。放這裡而不是各自的元件裡，是因為它有兩個來源
   * （附件縮圖列與訊息裡的圖），而且**要吃返回鍵** —— 兩者都需要一個共同的地方。
   *
   * ⚠️ **收的是「整組圖 ＋ 從第幾張開始」而不是單一張。**
   * 一次傳好幾張時，看完一張要先關掉再點下一張很難用（owner 2026-08-05 回報），
   * 所以燈箱本身要能左右換 —— 那就必須在打開的當下知道同組還有誰。
   */
  lightbox: { images: string[]; index: number } | null
  openLightbox: (images: string[], index?: number) => void
  closeLightbox: () => void
  /** 上一張／下一張。到頭就停住，不繞回去（繞回去會分不清有沒有看完）。 */
  stepLightbox: (delta: number) => void

  stack: ViewEntry[]
  push: (kind: ViewKind, param?: string) => void
  pop: () => void
  /**
   * 使用者要求關閉最上層畫面（✕、點遮罩、返回鍵三者共用）。
   *
   * 與 `pop()` 的差別是**會先問 `closeGuard`** —— 例如角色卡編輯器有未儲存的改動時
   * 要先確認，不能讓一次返回手勢把打了半天的人格設定丟掉。
   */
  requestPop: () => void
  /**
   * 攔截關閉。回 `false` 表示「先別關」，由 guard 自己負責之後怎麼收尾
   * （通常是開一個確認對話框，使用者按了「捨棄」再自行呼叫 `pop()`）。
   *
   * ⚠️ **刻意是同步的。** 返回鍵那條路徑（`handleBack`）必須同步回答
   * 「我消化掉了嗎」，改成 async 會讓 history 的深度與畫面堆疊錯位。
   */
  closeGuard: (() => boolean) | null
  setCloseGuard: (fn: (() => boolean) | null) => void
  /** 一路關到主畫面。切換對話之類「情境變了」的場合用。 */
  popAll: () => void

  toasts: ToastEntry[]
  toast: (text: string, tone?: ToastEntry['tone']) => void
  dismissToast: (id: number) => void

  dialog: DialogRequest | null
  confirm: (opts: Omit<DialogRequest, 'kind' | 'resolve'>) => Promise<boolean>
  prompt: (opts: Omit<DialogRequest, 'kind' | 'resolve'>) => Promise<string | null>
  closeDialog: (value: string | boolean | null) => void
}

let seq = 0
const nextId = (): number => ++seq

export const useUiStore = create<UiState>((set, get) => ({
  theme: 'mint',
  setTheme: (theme) => set({ theme }),

  lightbox: null,
  openLightbox: (images, index = 0) => {
    if (images.length === 0) return
    set({ lightbox: { images, index: Math.max(0, Math.min(index, images.length - 1)) } })
  },
  closeLightbox: () => set({ lightbox: null }),
  stepLightbox: (delta) =>
    set((s) => {
      if (!s.lightbox) return {}
      const next = s.lightbox.index + delta
      if (next < 0 || next >= s.lightbox.images.length) return {}
      return { lightbox: { ...s.lightbox, index: next } }
    }),

  stack: [],
  // 疊新畫面時清掉 guard：它屬於底下那一層，留著會讓上層被誤攔。
  push: (kind, param) => set((s) => ({ stack: [...s.stack, { id: nextId(), kind, param }], closeGuard: null })),
  pop: () => set((s) => ({ stack: s.stack.slice(0, -1), closeGuard: null })),
  popAll: () => set({ stack: [], closeGuard: null }),

  closeGuard: null,
  setCloseGuard: (fn) => set({ closeGuard: fn }),
  requestPop: () => {
    const guard = get().closeGuard
    if (guard && !guard()) return
    get().pop()
  },

  toasts: [],
  toast: (text, tone = 'info') => {
    const id = nextId()
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }))
    // 2.5 秒與 mobile.html 相同。自動消失不需要呼叫端管，
    // 但仍留 dismissToast 給「點掉」用。
    setTimeout(() => get().dismissToast(id), 2500)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  dialog: null,
  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      set({ dialog: { ...opts, kind: 'confirm', resolve: (v) => resolve(v === true) } })
    }),
  prompt: (opts) =>
    new Promise<string | null>((resolve) => {
      set({ dialog: { ...opts, kind: 'prompt', resolve: (v) => resolve(typeof v === 'string' ? v : null) } })
    }),
  closeDialog: (value) => {
    const d = get().dialog
    set({ dialog: null })
    // 先清掉再 resolve：呼叫端可能在 then 裡立刻開下一個對話框。
    d?.resolve(value)
  }
}))

/**
 * Android 實體返回鍵 ／ 瀏覽器上一頁的處理。
 *
 * 回傳 true 表示「我消化掉了」，呼叫端就不要讓系統退出 app。
 * 順序有意義：**由上而下關**，燈箱 > 對話框 > 畫面堆疊。
 * 燈箱是全螢幕蓋在最上層的，先關掉它以外的任何東西都會讓畫面看起來沒反應。
 */
export function handleBack(): boolean {
  const s = useUiStore.getState()
  if (s.lightbox) {
    s.closeLightbox()
    return true
  }
  if (s.dialog) {
    s.closeDialog(null)
    return true
  }
  if (s.stack.length > 0) {
    // 走 requestPop 而不是 pop：返回鍵與 ✕ 必須遇到同一道 `closeGuard`，
    // 否則「用 ✕ 會問、用返回手勢直接丟掉」——而手機上多數人用的是後者。
    // 被攔下時仍回 true（我們消化掉了這次返回），畫面留在原地由 guard 收尾。
    s.requestPop()
    return true
  }
  return false
}
