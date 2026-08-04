import { useUiStore } from '../stores/uiStore'

/**
 * Toast（清單 G2）。
 *
 * 放在**頂端**而不是底部：底部是輸入框與系統手勢橫條的地盤，
 * toast 蓋上去會擋住正在打的字，也容易被誤觸。
 */
export function ToastHost(): JSX.Element {
  const toasts = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ top: 'calc(var(--safe-top) + 8px)' }}
      // 螢幕閱讀器要能聽到，但不該打斷正在唸的內容 —— polite 而非 assertive。
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => dismiss(t.id)}
          className={`anim-pop-in pointer-events-auto max-w-full rounded-full px-4 py-2 text-sm shadow-[0_3px_12px_rgba(0,0,0,0.18)] ${
            t.tone === 'error'
              ? 'bg-[#FFBBBB] text-[#5A2A3A]'
              : 'bg-[var(--mint)] text-[var(--text)]'
          }`}
        >
          {t.text}
        </button>
      ))}
    </div>
  )
}
