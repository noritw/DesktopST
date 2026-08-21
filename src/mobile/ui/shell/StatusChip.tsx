import MonoIcon from '@shared/MonoIcon'

/**
 * 清單列右側的動作／狀態標籤（使用中／在場／套用／加入……）。
 *
 * owner 2026-08-08：套用／加入比編輯常用，所以這顆放**右邊**、做得稍大一點好按；
 * 左邊留給名稱（點進去編輯）。四個清單畫面共用，樣式才不會各自漂移。
 *
 * ⚠️ **打勾用 `MonoIcon` 不是 `✓` 字元**（2026-08-06 全面單色化）。
 *
 * ⚠️ **只有一種動作可做時不要用這顆。** 例如用語解說清單整列都是「進編輯」，
 * 再加一句「點此編輯內容」等於廢話（owner 2026-08-06 回報）。
 */
export function StatusChip({
  active,
  children,
  onClick,
  disabled,
  ariaLabel
}: {
  active: boolean
  children: React.ReactNode
  /** 有 onClick 時是右邊的動作按鈕；沒有就只是狀態展示。 */
  onClick?: () => void
  disabled?: boolean
  ariaLabel?: string
}): JSX.Element {
  const className = [
    'inline-flex shrink-0 items-center justify-center gap-1 self-center rounded-full px-3 py-1.5 text-[12px]',
    active
      ? 'bg-[var(--mint2)] font-semibold text-[var(--text)]'
      : 'border border-[var(--border)] bg-[var(--bg)] font-medium text-[var(--text)]',
    onClick ? 'active:opacity-80' : '',
    disabled ? 'opacity-40' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const body = (
    <>
      {active && <MonoIcon name="check" className="h-3.5 w-3.5" />}
      {children}
    </>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        className={className}
      >
        {body}
      </button>
    )
  }

  return <span className={className}>{body}</span>
}
