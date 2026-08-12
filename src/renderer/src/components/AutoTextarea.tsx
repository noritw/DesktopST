import { useEffect, useRef } from 'react'
import type { TextareaHTMLAttributes } from 'react'

/**
 * 自動撐高的 textarea：內容增加時高度跟著長，不需要使用者手動拖拉捲軸。
 * 最低高度由 `minHeight` 決定（對齊原本 min-h-[Npx] 設計）。做法比照手機版
 * `mobile/ui/characters/CharacterEditor.tsx` 的 `AutoTextarea`。
 */
export default function AutoTextarea({
  minHeight = 72,
  className = '',
  style,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { minHeight?: number }): React.JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null)

  const grow = (): void => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, minHeight)}px`
  }

  // value 改變時重算高度（受控模式）
  useEffect(() => { grow() })

  return (
    <textarea
      ref={ref}
      rows={1}
      style={{ minHeight, resize: 'none', overflow: 'hidden', ...style }}
      className={`input-field ${className}`}
      onInput={grow}
      {...props}
    />
  )
}
