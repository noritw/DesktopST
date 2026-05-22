import { useEffect, useMemo, useRef, useState } from 'react'
import MessageText from '../components/MessageText'
import MonoIcon from '../components/MonoIcon'
import { useAppStore } from '../stores/useAppStore'

interface Props {
  characterId: string
}

interface BubbleSourceRect {
  x: number
  y: number
  width: number
  height: number
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

export default function BubbleWindow({ characterId }: Props) {
  const [visible, setVisible] = useState(false)
  const [speakerName, setSpeakerName] = useState('')
  const [text, setText] = useState('')
  const [confirmPin, setConfirmPin] = useState(false)
  const [outlineMode, setOutlineMode] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPinArgsRef = useRef<{ title: string; pos: { x: number; y: number }; content: string } | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const lastSizeRef = useRef<{ width: number; height: number }>({ width: 280, height: 120 })

  const settings = useAppStore(s => s.settings)
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
    // 如果系統設定角色不在最上層，關閉對白時順便降層
    if (settings && !settings.ui.alwaysOnTop) {
      window.api.invoke('character:set-always-on-top', characterId, false).catch(e => {
        console.error('[Lower character layer] Error:', e)
      })
    }
  }

  const confirmLimitWarning = (level?: string, count?: number) => {
    const n = Number.isFinite(count) ? count : 0
    if (level === 'double') {
      return window.confirm(`目前已有 ${n} 張便利貼，繼續新增可能讓桌面變慢。確定還要新增嗎？`) &&
        window.confirm('再次確認：便利貼不會被自動清理，電腦撐不住就要自己收拾喔。')
    }
    return window.confirm(`目前已有 ${n} 張便利貼。可以繼續新增，但太多會影響效能。要繼續嗎？`)
  }

  const pinBubble = async (force = false) => {
    const textToCopy = displayText
    const titleToCopy = speakerName || '便利貼'
    const containerEl = containerRef.current
    if (!containerEl || !textToCopy) { closeBubble(); return }
    const rect = containerEl.getBoundingClientRect()
    const pos = { x: rect.x, y: rect.y }
    const sourceRect: BubbleSourceRect = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.ceil(rect.width),
      height: Math.ceil(rect.height)
    }
    try {
      const result = await window.api.invoke('pinned-note:create', characterId, titleToCopy, pos, textToCopy, force, sourceRect) as { needsConfirm?: boolean; level?: string; count?: number; noteId?: string }
      if (result?.needsConfirm) {
        clearTimer()
        if (confirmLimitWarning(result.level, result.count)) {
          pinBubble(true)
        } else {
          timerRef.current = setTimeout(closeBubble, 8000)
        }
        return
      }
    } catch (e) {
      console.error('[Pin bubble error]', e)
    }
    closeBubble()
  }

  const confirmPinAndClose = () => {
    setConfirmPin(false)
    pinBubble(true)
  }

  const cancelConfirmPin = () => {
    setConfirmPin(false)
    // 重啟自動關閉計時器（8 秒）
    timerRef.current = setTimeout(closeBubble, 8000)
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
      setConfirmPin(false)
      setSpeakerName(p.speakerName ?? '')
      setText(p.text ?? '')
      setVisible(true)

      if (!p.persistUntilClosed) {
        // 優先使用設定中的自動消失時間
        let autoCloseMs = 8000
        if (settings?.ui.chatBubbleAutoClose?.enabled) {
          const seconds = settings.ui.chatBubbleAutoClose.seconds
          autoCloseMs = Math.max(1000, seconds * 1000)
        } else if (Number(p.autoCloseMs)) {
          autoCloseMs = Math.max(8000, Number(p.autoCloseMs))
        }
        timerRef.current = setTimeout(closeBubble, autoCloseMs)
      }
    })

    const unsubPersist = window.api.on('bubble:persist', (payload) => {
      const p = payload as { characterId: string }
      if (p.characterId !== characterId) return
      clearTimer()
    })

    const unsubHide = window.api.on('bubble:hide', (payload) => {
      const p = payload as { characterId: string }
      if (p.characterId !== characterId) return
      clearTimer()
      setConfirmPin(false)
      setOutlineMode(false)
      setVisible(false)
    })

    const unsubOutline = window.api.on('bubble:outline-mode', (payload) => {
      const p = payload as { characterId: string; enabled?: boolean }
      if (p.characterId !== characterId) return
      setOutlineMode(!!p.enabled)
    })

    return () => {
      clearTimer()
      unsubShow()
      unsubPersist()
      unsubHide()
      unsubOutline()
    }
  }, [characterId, settings?.ui.chatBubbleAutoClose])

  useEffect(() => {
    if (!visible || outlineMode) return
    const el = contentRef.current
    if (!el) return

    const measure = () => {
      const approxW = 180 + clamp(Math.floor(displayText.length / 14) * 30, 0, 220)
      const width = clamp(approxW, 200, 420)

      if (containerRef.current) containerRef.current.style.width = `${width}px`

      const contentH = el.scrollHeight
      const height = Math.min(32000, Math.max(78, Math.ceil(contentH + 50)))
      lastSizeRef.current = { width, height }
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
  }, [characterId, visible, displayText, confirmPin, outlineMode])

  if (!visible) return null

  if (outlineMode) {
    const { width, height } = lastSizeRef.current
    return (
      <div
        className="flex h-full min-h-0 w-full select-none pointer-events-none"
        style={{ background: 'transparent' }}
      >
        <div
          aria-hidden
          className="rounded-2xl rounded-bl-sm border-2 border-dashed border-teal/70 bg-transparent box-border shadow-none"
          style={{
            width: Math.max(200, width),
            height: Math.max(78, height),
            minWidth: 200,
            minHeight: 78
          }}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col select-none" style={{ background: 'transparent' }}>
      <div
        ref={containerRef}
        className="relative flex min-h-0 max-w-[420px] flex-col rounded-2xl rounded-bl-sm border border-border bg-surface-95 px-3 py-2 text-sm leading-snug text-primary shadow-panel"
      >
        <div className="drag-region mb-1 flex shrink-0 items-center justify-between gap-2">
          <div className="text-[10px] font-medium text-secondary">
            {speakerName || '角色'}
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className="no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface-80 text-secondary transition-colors hover:bg-mint hover:text-primary"
              title="釘選為便利貼"
              onClick={() => pinBubble()}
            >
              <MonoIcon name="pin" className="w-3 h-3" />
            </button>
            <button
              type="button"
              className="no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface-80 text-secondary transition-colors hover:bg-mint hover:text-primary"
              title="關閉對話泡泡"
              onClick={closeBubble}
            >
              <MonoIcon name="close" className="w-3 h-3" />
            </button>
          </div>
        </div>
        {confirmPin ? (
          <div className="no-drag mt-1 rounded-xl border border-mint bg-mint-20 px-3 py-2 text-xs text-primary">
            <p className="mb-2 leading-snug">此角色的便利貼已達上限（10 張）。<br />確定釘選後，將清理最舊的幾張。</p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                className="rounded-full border border-border bg-surface-80 px-3 py-0.5 text-xs text-secondary transition-colors hover:bg-surface"
                onClick={cancelConfirmPin}
              >取消</button>
              <button
                type="button"
                className="rounded-full bg-mint px-3 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-teal"
                onClick={confirmPinAndClose}
              >確定清理</button>
            </div>
          </div>
        ) : (
          <div ref={contentRef} className="no-drag min-h-0 flex-1 overflow-y-auto break-words">
            <MessageText text={displayText} />
          </div>
        )}
        <div
          className="absolute -bottom-2 left-4 w-3 h-3 overflow-hidden"
          style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.05))' }}
        >
          <div className="w-3 h-3 bg-surface border-b border-r border-border rotate-45 -translate-y-1.5" />
        </div>
      </div>
    </div>
  )
}
