import { useEffect, useMemo, useRef, useState } from 'react'
import MessageText from '../components/MessageText'
import MonoIcon from '../components/MonoIcon'

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export default function UserBubbleWindow() {
  const [visible, setVisible] = useState(false)
  const [speakerName, setSpeakerName] = useState('你')
  const [text, setText] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const displayText = useMemo(() => String(text ?? ''), [text])

  const clearTimer = () => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const closeBubble = () => {
    clearTimer()
    setVisible(false)
    window.api.invoke('user-bubble:close')
  }

  useEffect(() => {
    const unsubShow = window.api.on('user-bubble:show', (payload) => {
      const p = payload as {
        speakerName?: string
        text?: string
        autoCloseMs?: number
        persistUntilClosed?: boolean
      }
      clearTimer()
      setSpeakerName(String(p.speakerName ?? '你'))
      setText(String(p.text ?? ''))
      setVisible(true)

      if (!p.persistUntilClosed) {
        const autoCloseMs = Math.max(8000, Number(p.autoCloseMs) || 8000)
        timerRef.current = setTimeout(closeBubble, autoCloseMs)
      }
    })

    return () => {
      clearTimer()
      unsubShow()
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    const el = contentRef.current
    if (!el) return

    const measure = () => {
      const width = clamp(Math.round(window.innerWidth), 220, 1200)
      const contentH = el.scrollHeight
      const height = Math.min(32000, Math.max(78, Math.ceil(contentH + 50)))
      window.api.invoke('user-bubble:set-size', { width, height })
    }

    const raf1 = window.requestAnimationFrame(() => {
      measure()
      window.requestAnimationFrame(measure)
    })
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => {
      window.cancelAnimationFrame(raf1)
      ro.disconnect()
    }
  }, [visible, displayText])

  if (!visible) return null

  return (
    <div className="flex h-full min-h-0 w-full flex-col select-none" style={{ background: 'transparent' }}>
      <div
        className="relative flex min-h-0 w-full flex-col rounded-2xl rounded-bl-sm border border-border bg-white/95 px-3 py-2 text-sm leading-snug text-primary shadow-panel"
      >
        <div className="drag-region mb-1 flex shrink-0 items-center justify-between gap-2">
          <div className="text-[10px] font-medium text-secondary">
            {speakerName || '你'}
          </div>
          <button
            type="button"
            className="no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-white/80 text-secondary transition-colors hover:bg-mint hover:text-primary"
            title="關閉對話泡泡"
            onClick={closeBubble}
          >
            <MonoIcon name="close" className="w-3 h-3" />
          </button>
        </div>
        <div ref={contentRef} className="no-drag min-h-0 flex-1 overflow-y-auto break-words">
          <MessageText text={displayText} />
        </div>
        <div
          className="absolute -bottom-2 left-4 w-3 h-3 overflow-hidden"
          style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.05))' }}
        >
          <div className="w-3 h-3 bg-white border-b border-r border-border rotate-45 -translate-y-1.5" />
        </div>
      </div>
    </div>
  )
}
