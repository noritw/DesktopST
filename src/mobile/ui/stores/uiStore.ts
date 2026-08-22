import { create } from 'zustand'
import type { ColorTheme } from '@core/types'
import type { FaceCropRect } from '@core/character/displayImage'
import type { ChoiceMap, PairTable } from '@core/sync/pair'
import type { SettingsChoiceMap, SettingsFieldRow } from '@core/sync/settingsPair'
import type { ConvChoiceMap, ConvFieldChoiceMap, ConvRow } from '@core/sync/convPair'

/** `openSyncCompare` 的成功結果——資料／設定／對話各自一份 map。 */
export interface SyncCompareResult {
  choices: ChoiceMap
  settingsChoices: SettingsChoiceMap
  /** 對話走完全不同的合併模型（聯集，不是二選一），見 `core/sync/convPair.ts`。 */
  convChoices: ConvChoiceMap
  /** 對話裡標題／摘要那些單值欄位的二選一。 */
  convFieldChoices: ConvFieldChoiceMap
}

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
  | 'conversation-editor'
  | 'presence'
  | 'character-menu'
  /** 點聊天泡泡頭像開啟的大圖預覽＋角色操作（`docs/mobile-character-expression-plan.md`）。 */
  | 'message-avatar-panel'
  | 'message-menu'
  /** 這則訊息送出去的完整 prompt（除錯用，從訊息選單進去）。 */
  | 'message-prompt'
  /** 手動指定這則訊息要顯示哪張表情圖（`docs/mobile-character-expression-plan.md` §6.2）。 */
  | 'message-emotion'
  | 'characters'
  | 'character-editor'
  | 'presets'
  | 'preset-editor'
  | 'settings'
  | 'reminders'
  | 'reminder-editor'
  | 'reminder-history'
  | 'news'
  | 'news-settings'
  | 'random-tools'
  | 'theme-picker'
  | 'lorebook-editor'
  /** 遙控電腦（清單 H1–H11，B6）。只有 `capabilities.remoteControl` 為真時入口才會出現。 */
  | 'remote'
  /** 從電腦匯入（S1，roadmap §4.7）。只有獨立模式才有入口。 */
  | 'sync-import'
  /** 頂部那顆 ☰ 展開的主選單（B3 2026-08-06 資訊架構重整）。 */
  | 'menu'
  /** header 左上角兩字標籤點進來的「關於本程式」。 */
  | 'about'

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
  /**
   * 送出／取消之外的額外動作（新聞上下文的「原文 ↗」與「清除摘要」）。
   *
   * 預設**不關閉對話框**——像「原文」是離開去看別的東西，回來還要接著編輯。
   * 自己就是終點的動作（清除）才設 `closeAfter`。
   */
  extraActions?: { label: string; onClick: () => void; closeAfter?: boolean }[]
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

  /**
   * 頭像裁切畫面（選完圖 → 裁切 → 確認才真的存檔）。
   *
   * 跟 `dialog`（`confirm`/`prompt`）同一個 Promise 包裝套路：`openAvatarCrop`
   * 回傳的 Promise 要等到使用者按「完成」或「取消」才 resolve，讓
   * `CharacterEditor.tsx` 的 `changeAvatar()` 能直接 `await` 拿到裁切完的檔案，
   * 不用另外接事件。放在 store 而不是元件內部狀態，理由跟 Lightbox 一樣——
   * 這是一個蓋在最上層的全螢幕畫面，要吃返回鍵。
   */
  avatarCrop: { file: File; resolve: (result: File | null) => void } | null
  openAvatarCrop: (file: File) => Promise<File | null>
  closeAvatarCrop: (result: File | null) => void

  /**
   * 框選臉部顯示範圍（`docs/mobile-character-expression-plan.md` §3.1／§6.3）。
   *
   * 跟 `avatarCrop` 幾乎同一套 Promise 包裝，差別是**這裡只算比例矩形，
   * 不輸出裁切後的檔案**——`imageUrl` 可以是任何已知尺寸的圖片位址
   * （data: URI 或遙控模式的網路位址皆可），不需要先轉成 `File`。
   */
  faceCrop: { imageUrl: string; resolve: (result: FaceCropRect | null) => void } | null
  openFaceCrop: (imageUrl: string) => Promise<FaceCropRect | null>
  closeFaceCrop: (result: FaceCropRect | null) => void

  /**
   * 推送前的同名角色勾選（S2 M3，owner 2026-08-13 拍板）。
   *
   * 與 `avatarCrop` 同一套 Promise 包裝：`openNameConflicts` 要等使用者按完
   * 才 resolve，`syncPush` 才能在推送迴圈開始前拿到答案。回 `null` ＝ 取消整趟推送。
   * 用獨立欄位而不是 `dialog`：`ui.confirm` 只能回是／否，這裡要回一組勾選結果。
   */
  nameConflicts: {
    items: { id: string; name: string }[]
    resolve: (selected: Set<string> | null) => void
  } | null
  openNameConflicts: (items: { id: string; name: string }[]) => Promise<Set<string> | null>
  closeNameConflicts: (selected: Set<string> | null) => void

/**
   * 切換模式前的逐項比對（S2 M4，owner 2026-08-13 指定；S2 M5 加入「設定」分頁）。
   *
   * 取代 M3 那個「帶過去／直接切／取消」的三選一對話框——那個版本只能整包
   * 決定，而且判斷「兩邊是不是同一筆」靠的是壞掉的基準表，結果是每切換一次
   * 兩邊就多一批重複資料。這裡改成把每一筆攤開來讓使用者自己選哪一邊。
   *
   * 資料（角色／使用者設定／世界觀／情境／用語解說）與設定（LLM、記憶、配色、
   * 模組）是兩套獨立的比對系統（`core/sync/pair.ts` 與 `core/sync/settingsPair.ts`），
   * 一起放進同一個畫面、同一趟 resolve，是因為對使用者而言這就是「切換前要
   * 決定的東西」，不該因為實作上的兩套型別而拆成兩個先後彈出的畫面。
   *
   * 與 `nameConflicts` 同一套 Promise 包裝：resolve 一份結果才往下做，
   * 回 `null` ＝ 使用者取消（**呼叫端必須把它和「連不上」分開處理**，
   * 混在一起會讓取消跳出「上次那台電腦連不上了」的假錯誤）。
   */
  syncCompare: {
    table: PairTable
    settingsRows: SettingsFieldRow[]
    convRows: ConvRow[]
    resolve: (result: SyncCompareResult | null) => void
  } | null
  openSyncCompare: (
    table: PairTable,
    settingsRows: SettingsFieldRow[],
    convRows: ConvRow[]
  ) => Promise<SyncCompareResult | null>
  closeSyncCompare: (result: SyncCompareResult | null) => void

  stack: ViewEntry[]
  push: (kind: ViewKind, param?: string) => void
  /**
   * 換掉最上層畫面（不是疊上去）。
   *
   * 主選單專用：從 ☰ 點進「設定」之後，返回應該直接回到聊天，
   * 而不是回到選單再按一次。用 `push` 的話選單會留在堆疊裡變成多一層。
   */
  replace: (kind: ViewKind, param?: string) => void
  /**
   * 改寫堆疊中某一層（不一定是最上層）的 `param`，畫面本身不重推。
   *
   * 用途：畫面把「目前展開哪一分頁」這類 component-local state 寫回自己在堆疊裡
   * 的 entry，這樣被上層畫面蓋住又卸載（`ViewStack` 只畫最上層）、返回時重新掛載，
   * 也能從 `param` 讀回原本展開的分頁，而不是重置成預設值。
   */
  setEntryParam: (id: number, param: string | undefined) => void
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

  avatarCrop: null,
  openAvatarCrop: (file) =>
    new Promise<File | null>((resolve) => {
      set({ avatarCrop: { file, resolve } })
    }),
  closeAvatarCrop: (result) => {
    const c = get().avatarCrop
    set({ avatarCrop: null })
    // 先清掉再 resolve：跟 closeDialog 同理，呼叫端可能在 then 裡立刻做下一步。
    c?.resolve(result)
  },

  faceCrop: null,
  openFaceCrop: (imageUrl) =>
    new Promise<FaceCropRect | null>((resolve) => {
      set({ faceCrop: { imageUrl, resolve } })
    }),
  closeFaceCrop: (result) => {
    const c = get().faceCrop
    set({ faceCrop: null })
    c?.resolve(result)
  },

  nameConflicts: null,
  openNameConflicts: (items) =>
    new Promise<Set<string> | null>((resolve) => {
      set({ nameConflicts: { items, resolve } })
    }),
  closeNameConflicts: (selected) => {
    const c = get().nameConflicts
    set({ nameConflicts: null })
    c?.resolve(selected)
  },

  syncCompare: null,
  openSyncCompare: (table, settingsRows, convRows) =>
    new Promise<SyncCompareResult | null>((resolve) => {
      set({ syncCompare: { table, settingsRows, convRows, resolve } })
    }),
  closeSyncCompare: (result) => {
    const c = get().syncCompare
    set({ syncCompare: null })
    c?.resolve(result)
  },

  stack: [],
  // 疊新畫面時清掉 guard：它屬於底下那一層，留著會讓上層被誤攔。
  push: (kind, param) => set((s) => {
    diagNav('push', kind, s.stack)
    return { stack: [...s.stack, { id: nextId(), kind, param }], closeGuard: null }
  }),
  replace: (kind, param) =>
    set((s) => {
      diagNav('replace', kind, s.stack)
      return { stack: [...s.stack.slice(0, -1), { id: nextId(), kind, param }], closeGuard: null }
    }),
  setEntryParam: (id, param) =>
    set((s) => ({ stack: s.stack.map((e) => (e.id === id ? { ...e, param } : e)) })),
  pop: () => set((s) => {
    diagNav('pop', '', s.stack)
    return { stack: s.stack.slice(0, -1), closeGuard: null }
  }),
  popAll: () => set((s) => {
    diagNav('popAll', '', s.stack)
    return { stack: [], closeGuard: null }
  }),

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
 * 畫面堆疊的變動 log。
 *
 * ⚠️ **這支是為了追「新聞報自己跳回首頁」加的**（owner 2026-08-12 回報，
 * 尚未定位）。堆疊會被清空的路徑有好幾條——`pop`／`popAll`／返回手勢轉成的
 * `popstate`／整個 app 重載——光看畫面分不出是哪一條，
 * 而且只在真機偶發（瀏覽器上那次是 vite 熱重載，不算重現）。
 *
 * `stack` 印出來就能分辨：
 *   - 有 `pop`／`popAll` → 是我們自己關的，往呼叫端追
 *   - 只有 `back` 沒有後續 → 返回手勢被誤觸發
 *   - 什麼都沒有、直接從 `push menu` 重新開始 → WebView 整個重載了
 */
function diagNav(op: string, kind: string, stack: { kind: string }[]): void {
  console.info(`[nav-diag] ${op}${kind ? ' ' + kind : ''} stack=[${stack.map((e) => e.kind).join(',')}]`)
}

/**
 * Android 實體返回鍵 ／ 瀏覽器上一頁的處理。
 *
 * 回傳 true 表示「我消化掉了」，呼叫端就不要讓系統退出 app。
 * 順序有意義：**由上而下關**，燈箱 > 對話框 > 畫面堆疊。
 * 燈箱是全螢幕蓋在最上層的，先關掉它以外的任何東西都會讓畫面看起來沒反應。
 */

export function handleBack(): boolean {
  const s = useUiStore.getState()
  diagNav('back', s.avatarCrop ? 'avatarCrop' : s.nameConflicts ? 'nameConflicts' : s.lightbox ? 'lightbox' : s.dialog ? 'dialog' : 'stack', s.stack)
  // 裁切畫面蓋在最上層（從角色編輯器叫出來的），比燈箱／對話框都優先關。
  if (s.avatarCrop) {
    s.closeAvatarCrop(null)
    return true
  }
  // 返回＝取消整趟推送（等同按取消），不是「當作全都不覆蓋」——
  // 後者會安靜地推一半，使用者不會知道自己漏掉了什麼。
  if (s.nameConflicts) {
    s.closeNameConflicts(null)
    return true
  }
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
