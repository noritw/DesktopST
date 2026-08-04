import { useRef, useState } from 'react'
import { useAppStore } from '../stores/appStore'
import { useUiStore } from '../stores/uiStore'

/**
 * 輸入框（清單 A2、A5）。
 *
 * 兩個手機上的細節，少了都會被立刻察覺：
 *
 *   - **自動長高**：固定一行的話打長訊息看不到自己在寫什麼；
 *     但要設上限，否則鍵盤一彈出來畫面就只剩輸入框
 *   - **Enter 送出／Shift+Enter 換行**：實體鍵盤與外接鍵盤才有意義，
 *     手機軟體鍵盤的 Enter 一律是換行（`enterKeyHint` 也設成 enter），
 *     送出靠按鈕 —— 否則想換行的人會不小心送出半句話
 */

const MAX_HEIGHT_PX = 140

export function Composer(): JSX.Element {
  const send = useAppStore((s) => s.send)
  const sending = useAppStore((s) => s.sending)
  const toast = useUiStore((s) => s.toast)
  const [text, setText] = useState('')
  const areaRef = useRef<HTMLTextAreaElement>(null)

  const grow = (): void => {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }

  const submit = async (): Promise<void> => {
    const content = text.trim()
    if (!content || sending) return
    // 先清空再送：送出後畫面立刻回到空白才像即時通訊。
    // 失敗時不把文字放回去 —— 那則訊息會以系統錯誤留在串裡，
    // 內容看得到，使用者要重試可以複製。放回去反而會與錯誤訊息重複。
    setText('')
    requestAnimationFrame(grow)
    try {
      await send({ content })
    } catch {
      toast('訊息送出失敗', 'error')
    }
  }

  return (
    <div
      className="flex items-end gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-3 pt-2"
      style={{ paddingBottom: 'calc(var(--safe-bottom) + 8px)' }}
    >
      <textarea
        ref={areaRef}
        rows={1}
        value={text}
        placeholder="說點什麼⋯⋯"
        enterKeyHint="enter"
        onChange={(e) => {
          setText(e.target.value)
          grow()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            // 只有實體鍵盤會走到這裡；軟體鍵盤送的是換行不是 Enter 鍵事件。
            // isComposing 檢查是注音／拼音選字中，不可攔截。
            e.preventDefault()
            void submit()
          }
        }}
        className="scroll-y max-h-[140px] flex-1 resize-none rounded-[18px] border border-[var(--border)] bg-[var(--bg)] px-3.5 py-2.5 text-[15px] leading-relaxed text-[var(--text)] outline-none focus:border-[var(--mint2)]"
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!text.trim() || sending}
        aria-label="送出"
        className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--mint)] text-[var(--text)] transition-opacity disabled:opacity-40"
      >
        ➤
      </button>
    </div>
  )
}
