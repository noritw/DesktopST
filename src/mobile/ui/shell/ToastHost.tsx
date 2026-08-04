import { useUiStore } from '../stores/uiStore'

/**
 * Toast（清單 G2）。
 *
 * ## 位置：跨在 header 與內容的交界線上（owner 2026-08-04 決定）
 *
 * 不放底部，因為底部是輸入框與系統手勢橫條的地盤 —— 蓋上去會擋住正在打的字。
 *
 * 不完全蓋住 header，因為 header 之後要放角色頭像列（清單 D1）：
 * 被蓋住等於看不到誰在說話、誰被禁言。
 *
 * 所以往上壓進 header 一半的高度。這個位置有個附帶好處：
 * 它明顯**跨在兩塊之間**，一看就是浮起來的臨時提示，
 * 不會被誤讀成 header 或內容的一部分。
 */

/**
 * 往上壓多少。用固定值而非 toast 高度的 50%：
 * 高度會隨文字長度變（換行就變兩倍），跟著變的話短訊息與長訊息
 * 會停在不同高度，看起來像在跳。壓一個固定量則位置永遠一致。
 */
const OVERLAP_PX = 18
export function ToastHost(): JSX.Element {
  const toasts = useUiStore((s) => s.toasts)
  const dismiss = useUiStore((s) => s.dismissToast)

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
      // --header-h 由 App 用 ResizeObserver 量出來寫入。
      // fallback 值是 header 沒量到時的估計，不會讓 toast 消失不見。
      style={{ top: `calc(var(--header-h, 56px) - ${OVERLAP_PX}px)` }}
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
