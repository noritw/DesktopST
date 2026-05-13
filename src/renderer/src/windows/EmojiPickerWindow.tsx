import { useEffect, useRef } from 'react'
import 'emoji-picker-element'

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'emoji-picker': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement>
    }
  }
}

export default function EmojiPickerWindow() {
  const pickerRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = pickerRef.current
    if (!el) return
    const onPick = (event: Event) => {
      const unicode = (event as CustomEvent).detail?.emoji?.unicode
      if (unicode) window.api.invoke('emoji-picker:select', unicode)
    }
    el.addEventListener('emoji-click', onPick)
    return () => el.removeEventListener('emoji-click', onPick)
  }, [])

  // Close when window loses focus
  useEffect(() => {
    const onBlur = () => window.api.invoke('emoji-picker:close')
    window.addEventListener('blur', onBlur)
    return () => window.removeEventListener('blur', onBlur)
  }, [])

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden' }}>
      <div
        style={{
          height: 10,
          flexShrink: 0,
          background: 'var(--color-surface)',
          borderBottom: '1px solid var(--color-border)',
          WebkitAppRegion: 'drag',
          cursor: 'grab',
          borderRadius: '16px 16px 0 0'
        } as React.CSSProperties}
      />
      <emoji-picker
        ref={pickerRef}
        style={{
          '--border-radius': '0',
          '--border-color': 'var(--color-border)',
          '--background': 'var(--color-surface)',
          width: '100%',
          flex: 1
        } as React.CSSProperties}
      />
    </div>
  )
}
