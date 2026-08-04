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
  | 'characters'
  | 'character-editor'
  | 'presets'
  | 'settings'
  | 'news'
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
  confirmLabel?: string
  destructive?: boolean
  /** 回傳：confirm 給 boolean，prompt 給字串或 null（取消）。 */
  resolve: (value: string | boolean | null) => void
}

interface UiState {
  theme: ColorTheme
  setTheme: (theme: ColorTheme) => void

  stack: ViewEntry[]
  push: (kind: ViewKind, param?: string) => void
  pop: () => void
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

  stack: [],
  push: (kind, param) => set((s) => ({ stack: [...s.stack, { id: nextId(), kind, param }] })),
  pop: () => set((s) => ({ stack: s.stack.slice(0, -1) })),
  popAll: () => set({ stack: [] }),

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
 * 順序有意義：對話框 > 畫面堆疊 —— 對話框疊在最上面，先關它。
 */
export function handleBack(): boolean {
  const s = useUiStore.getState()
  if (s.dialog) {
    s.closeDialog(null)
    return true
  }
  if (s.stack.length > 0) {
    s.pop()
    return true
  }
  return false
}
