import { useEffect, useMemo, useRef, useState } from 'react'
import MessageText from '../components/MessageText'
import MonoIcon from '../components/MonoIcon'

interface Props {
  characterId: string
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export default function BubbleWindow({ characterId }: Props) {
  const [visible, setVisible] = useState(false)
  const [speakerName, setSpeakerName] = useState('')
  const [text, setText] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
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
    window.api.invoke('bubble:close', characterId)
  }

  useEffect(() => {
    const unsubShow = window.api.on('bubble:show', (payload) => {
      const p = payload as {
        characterId: string
        speakerName: string
        text: string
        autoCloseMs?: number
        persistUntilClosed?: boolean
      }
      if (p.characterId !== characterId) return

      clearTimer()
      setSpeakerName(p.speakerName ?? '')
      setText(p.text ?? '')
      setVisible(true)

      if (!p.persistUntilClosed) {
        const autoCloseMs = Math.max(8000, Number(p.autoCloseMs) || 8000)
        timerRef.current = setTimeout(closeBubble, autoCloseMs)
      }
    })

    const unsubPersist = window.api.on('bubble:persist', (payload) => {
      const p = payload as { characterId: string }
      if (p.characterId !== characterId) return
      clearTimer()
    })

    return () => {
      clearTimer()
      unsubShow()
      unsubPersist()
    }
  }, [characterId])

  useEffect(() => {
    if (!visible) return
    const el = contentRef.current
    if (!el) return

    const measure = () => {
      const approxW = 180 + clamp(Math.floor(displayText.length / 14) * 30, 0, 220)
      const width = clamp(approxW, 200, 420)

      if (containerRef.current) containerRef.current.style.width = `${width}px`

      const contentH = el.scrollHeight
      const height = clamp(Math.ceil(contentH + 50), 78, 1200)
      window.api.invoke('bubble:set-size', characterId, { width, height })
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
  }, [characterId, visible, displayText])

  if (!visible) return null

  return (
    <div className="w-full h-full select-none" style={{ background: 'transparent' }}>
      <div
        ref={containerRef}
        className="relative rounded-2xl rounded-bl-sm bg-white/95 border border-border shadow-panel px-3 py-2 text-sm text-primary leading-snug"
        style={{ maxWidth: 420 }}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <div className="text-[10px] text-secondary font-medium">
            {speakerName || '角色'}
          </div>
          <button
            type="button"
            className="w-5 h-5 rounded-full border border-border bg-white/80 text-secondary hover:text-primary hover:bg-mint transition-colors flex items-center justify-center"
            title="關閉對話泡泡"
            onClick={closeBubble}
          >
            <MonoIcon name="close" className="w-3 h-3" />
          </button>
        </div>
        <div ref={contentRef} className="break-words">
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
