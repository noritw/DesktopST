import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

/**
 * 底部 sheet（清單 G3）—— 整個手機 UI 的互動骨架。
 *
 * 所有疊在主畫面上的東西都走這個元件：對話清單、角色管理、設定、新聞報⋯⋯
 * 統一在這裡處理的三件事，各自都是「漏掉會被使用者立刻察覺」的等級：
 *
 *   1. **底部安全區域**（G4）：不留 `--safe-bottom` 的話，最後一個按鈕會被
 *      系統的手勢橫條蓋住，而那通常正是「刪除」或「儲存」
 *   2. **背景鎖捲動**：不鎖的話手指滑到 sheet 邊緣就會捲到後面的訊息串
 *   3. **高度上限**：`85dvh` 而非 `85vh` —— 行動瀏覽器的網址列會伸縮，
 *      `vh` 在網址列收起前算的是較大的值，sheet 底部會被切掉
 */

export interface SheetProps {
  title?: string
  /** 右上角的自訂動作（例如「新增」）。 */
  action?: ReactNode
  onClose: () => void
  children: ReactNode
  /** 內容自己要捲動時給 false，由內容自行處理（例如新聞報有分頁）。 */
  scrollable?: boolean
}

export function Sheet({ title, action, onClose, children, scrollable = true }: SheetProps): JSX.Element {
  const backdropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return (
    <div
      ref={backdropRef}
      className="anim-fade-in fixed inset-0 z-40 flex flex-col justify-end bg-black/35"
      // 只有點到遮罩本身才關；點內容冒泡上來的不算。
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose()
      }}
    >
      <div
        className="anim-sheet-in flex max-h-[85dvh] flex-col rounded-t-[24px] bg-[var(--surface)] shadow-[0_-4px_24px_rgba(0,0,0,0.18)]"
        style={{ paddingBottom: 'var(--safe-bottom)' }}
      >
        {/* 拖曳把手：目前只是視覺提示（告訴使用者這東西是可以關掉的），
            真正的拖曳關閉之後再說——先有正確的關閉方式比先有手勢重要。 */}
        <div className="flex justify-center pt-2.5 pb-1">
          <div className="h-1 w-10 rounded-full bg-[var(--border)]" />
        </div>

        {(title || action) && (
          <div className="flex items-center justify-between px-5 pb-2 pt-1">
            <h2 className="text-[17px] font-semibold text-[var(--text)]">{title}</h2>
            <div className="flex items-center gap-2">
              {action}
              <button
                type="button"
                onClick={onClose}
                aria-label="關閉"
                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--text-sub)] active:bg-[var(--border)]"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <div className={`px-5 pb-4 ${scrollable ? 'scroll-y' : 'flex min-h-0 flex-1 flex-col'}`}>{children}</div>
      </div>
    </div>
  )
}
