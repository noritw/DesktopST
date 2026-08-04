import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '../stores/uiStore'

/**
 * 確認／輸入對話框（清單 E2）。
 *
 * `mobile.html` 用的是瀏覽器內建的 `prompt()` / `confirm()`。那在 APK 裡
 * 會跳出帶著網址的系統彈窗，一看就露餡不是原生 app，而且**不能取消**
 * （Android WebView 的 confirm 沒有返回鍵處理）。所以自己做一份。
 *
 * 呼叫端用法是 `await ui.confirm({...})`，與原本的 `confirm()` 幾乎一樣，
 * 只差一個 await —— 換掉時不必重寫邏輯。
 */
export function DialogHost(): JSX.Element | null {
  const dialog = useUiStore((s) => s.dialog)
  const close = useUiStore((s) => s.closeDialog)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!dialog) return
    setValue(dialog.defaultValue ?? '')
    if (dialog.kind === 'prompt') {
      // 稍等一拍再 focus：sheet 動畫進行中就 focus 會讓鍵盤把畫面推歪。
      const t = setTimeout(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      }, 120)
      return () => clearTimeout(t)
    }
    return
  }, [dialog])

  if (!dialog) return null

  const submit = (): void => close(dialog.kind === 'prompt' ? value : true)

  return (
    <div className="anim-fade-in fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-8">
      <div
        className="anim-pop-in w-full max-w-[340px] rounded-[20px] bg-[var(--surface)] p-5 shadow-[0_8px_32px_rgba(0,0,0,0.24)]"
        role="dialog"
        aria-modal="true"
      >
        <h3 className="text-[16px] font-semibold text-[var(--text)]">{dialog.title}</h3>
        {dialog.message && (
          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-sub)]">{dialog.message}</p>
        )}

        {dialog.kind === 'prompt' && (
          <input
            ref={inputRef}
            value={value}
            placeholder={dialog.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            className="mt-3 w-full rounded-[12px] border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5 text-[15px] text-[var(--text)] outline-none focus:border-[var(--mint2)]"
          />
        )}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => close(null)}
            className="flex-1 rounded-full border border-[var(--border)] py-2.5 text-[15px] text-[var(--text-sub)] active:bg-[var(--border)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={submit}
            className={`flex-1 rounded-full py-2.5 text-[15px] font-medium active:opacity-80 ${
              dialog.destructive ? 'bg-[var(--danger)] text-[var(--danger-text)]' : 'bg-[var(--mint)] text-[var(--text)]'
            }`}
          >
            {dialog.confirmLabel ?? '確定'}
          </button>
        </div>
      </div>
    </div>
  )
}
