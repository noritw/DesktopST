import { create } from 'zustand'
import type { NewsLinkInfo } from '@core/types'

/**
 * 輸入框的草稿狀態。
 *
 * **為什麼不留在 `Composer` 的 `useState`**：有好幾個地方要往輸入框塞東西，
 * 而它們都不是輸入框的子元件 ——
 *
 *   · 隨機工具面板插 token（清單 C3）
 *   · 新聞報的「💬 聊這個」（清單 F10，階段 6）
 *
 * 靠 props 一路傳下去會讓中間每一層都認識輸入框，那才是真正的耦合。
 *
 * ⚠️ **這裡只放「使用者正在編輯的東西」**，不放圖片附件 ——
 * 附件的生命週期跟送出／失敗回填綁在一起（清單 B5），留在 `Composer` 裡才看得懂。
 */

interface ComposerState {
  text: string
  /**
   * 游標位置。插入 token 時要插在**使用者剛才停留的地方**，不是字尾 ——
   * 「先打完一句話再回頭補一顆骰子」是很自然的用法。
   * `null` ＝ 還沒動過，插在最後。
   */
  caret: number | null

  /**
   * 送出後讓角色回應（清單 C4）。取反就是 `skipLlm`（清單 A7）。
   *
   * 預設 true 與 `mobile.html` 一致。**這是每次送出都會用到的旗標，
   * 不是設定** —— 不進 `settings`，也不跨裝置。
   */
  respond: boolean

  /** 「聊這個」確認後暫存；送出時掛到訊息上並清空 */
  pendingNewsLink: NewsLinkInfo | null

  setText: (text: string, caret?: number | null) => void
  setCaret: (caret: number | null) => void
  setRespond: (respond: boolean) => void
  setPendingNewsLink: (link: NewsLinkInfo | null) => void
  /** 在游標處插入一段文字，並把游標移到插入內容之後。 */
  insert: (snippet: string) => void
  /** 送出後清空（`respond` 保留 —— 那是使用者的習慣，不該每次重設）。 */
  clear: () => void
}

export const useComposerStore = create<ComposerState>((set) => ({
  text: '',
  caret: null,
  respond: true,
  pendingNewsLink: null,

  setText: (text, caret) => set((s) => ({ text, caret: caret === undefined ? s.caret : caret })),
  setCaret: (caret) => set({ caret }),
  setRespond: (respond) => set({ respond }),
  setPendingNewsLink: (pendingNewsLink) => set({ pendingNewsLink }),

  insert: (snippet) =>
    set((s) => {
      const at = s.caret ?? s.text.length
      const pos = Math.max(0, Math.min(at, s.text.length))
      return {
        text: s.text.slice(0, pos) + snippet + s.text.slice(pos),
        caret: pos + snippet.length
      }
    }),

  clear: () => set({ text: '', caret: null, pendingNewsLink: null })
}))
