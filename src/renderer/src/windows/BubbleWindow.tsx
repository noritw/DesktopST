import { useEffect, useMemo, useRef, useState } from 'react'
import MessageText from '../components/MessageText'
import MonoIcon from '../components/MonoIcon'
import { useAppStore } from '../stores/useAppStore'
import { MESSAGE_REACTION_EMOJIS } from '../types'

interface Props {
  characterId: string
}

interface BubbleNewsMeta {
  id: string
  sourceId: string
  title: string
  url: string
  summary: string
  source: string
  keyword?: string
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

/** 最後發話實心陰影偏移；須與外層 padding、視窗量測一致 */
const LATEST_SHADOW_OFFSET_PX = 5
/** 白框尖角錨點（bottom 負值，相對框底） */
const BUBBLE_TAIL_ANCHOR_BELOW_PX = 11
/** 旋轉尖角在錨點下方還會多伸出的像素 */
const BUBBLE_TAIL_TIP_EXTRA_PX = 4

function bubbleBottomPaddingPx(isLatestSpeaker: boolean, lowPerformanceMode: boolean): number {
  let px = BUBBLE_TAIL_ANCHOR_BELOW_PX + BUBBLE_TAIL_TIP_EXTRA_PX
  if (isLatestSpeaker && !lowPerformanceMode) px += LATEST_SHADOW_OFFSET_PX + 2
  return px
}

export default function BubbleWindow({ characterId }: Props) {
  const [visible, setVisible] = useState(false)
  const [speakerName, setSpeakerName] = useState('')
  const [text, setText] = useState('')
  const [confirmPin, setConfirmPin] = useState(false)
  const [outlineMode, setOutlineMode] = useState(false)
  const [isLatestSpeaker, setIsLatestSpeaker] = useState(false)
  const [news, setNews] = useState<BubbleNewsMeta | null>(null)
  const [showNewsCard, setShowNewsCard] = useState(false)
  const [messageId, setMessageId] = useState<string | null>(null)
  const [reaction, setReaction] = useState<string | null>(null)
  const [showReactionPicker, setShowReactionPicker] = useState(false)
  const [dontWantMenu, setDontWantMenu] = useState(false)
  const [blockKeyword, setBlockKeyword] = useState(false)
  const [blockSource, setBlockSource] = useState(false)
  const [reduceSource, setReduceSource] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPinArgsRef = useRef<{ title: string; pos: { x: number; y: number }; content: string } | null>(null)
  /** 收到 bubble:show 後，等新內容量完尺寸才通知主程序顯示視窗（先畫好再現身） */
  const revealPendingRef = useRef(false)

  const outerRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const tailMeasureRef = useRef<HTMLDivElement>(null)
  const shadowTailMeasureRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const lastSizeRef = useRef<{ width: number; height: number }>({ width: 280, height: 120 })

  const settings = useAppStore(s => s.settings)
  const lowPerformanceMode = settings?.ui.lowPerformanceMode ?? false
  const displayText = useMemo(() => String(text ?? ''), [text])
  const autoCloseSettingsRef = useRef(settings?.ui.chatBubbleAutoClose)
  autoCloseSettingsRef.current = settings?.ui.chatBubbleAutoClose

  const clearTimer = () => {
    if (!timerRef.current) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const closeBubble = () => {
    clearTimer()
    setIsLatestSpeaker(false)
    setVisible(false)
    window.api.invoke('bubble:close', characterId)
    // demoteAfterSpeaking() 在 main process 的 hideSpeechBubble 裡處理降層
  }

  const toggleReaction = (emoji: string) => {
    if (!messageId) return
    const next = reaction === emoji ? null : emoji
    setReaction(next)
    setShowReactionPicker(false)
    void window.api.invoke('conversation:set-reaction', { messageId, reaction: next })
  }

  const setAsTopic = () => {
    if (!news) return
    void window.api.invoke('news:set-topic', news)
    closeBubble()
  }

  const openDontWant = () => {
    setBlockKeyword(false)
    setBlockSource(false)
    setReduceSource(false)
    setDontWantMenu(true)
  }

  const confirmDontWant = () => {
    if (news) {
      void window.api.invoke('news:dont-want', {
        id: news.id,
        sourceId: news.sourceId,
        keyword: news.keyword,
        source: news.source,
        blockKeyword,
        blockSource,
        reduceSource
      })
    }
    setDontWantMenu(false)
    closeBubble()
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
        isLatestSpeaker?: boolean
        news?: BubbleNewsMeta | null
        messageId?: string
        reaction?: string | null
      }
      if (p.characterId !== characterId) return

      clearTimer()
      setConfirmPin(false)
      setShowNewsCard(false)
      setDontWantMenu(false)
      setSpeakerName(p.speakerName ?? '')
      setText(p.text ?? '')
      setNews(p.news ?? null)
      setMessageId(p.messageId ?? null)
      setReaction(p.reaction ?? null)
      setShowReactionPicker(false)
      setIsLatestSpeaker(p.isLatestSpeaker !== false)
      revealPendingRef.current = true
      setVisible(true)

      if (!p.persistUntilClosed) {
        // 優先使用設定中的自動消失時間（ref：避免 settings 載入時重掛 listener 丟事件）
        let autoCloseMs = 8000
        const autoClose = autoCloseSettingsRef.current
        if (autoClose?.enabled) {
          autoCloseMs = Math.max(1000, autoClose.seconds * 1000)
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

    const unsubLatest = window.api.on('bubble:latest-speaker', (payload) => {
      const p = payload as { characterId: string; isLatest?: boolean }
      if (p.characterId !== characterId) return
      setIsLatestSpeaker(!!p.isLatest)
    })

    const unsubHide = window.api.on('bubble:hide', (payload) => {
      const p = payload as { characterId: string }
      if (p.characterId !== characterId) return
      clearTimer()
      setConfirmPin(false)
      setOutlineMode(false)
      setIsLatestSpeaker(false)
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
      unsubLatest()
      unsubHide()
      unsubOutline()
    }
  }, [characterId])

  useEffect(() => {
    if (!visible || outlineMode) return
    const el = contentRef.current
    if (!el) return

    const measure = () => {
      const approxW = 180 + clamp(Math.floor(displayText.length / 14) * 30, 0, 220)
      const contentW = clamp(approxW, 200, 420)
      const padR = isLatestSpeaker && !lowPerformanceMode ? LATEST_SHADOW_OFFSET_PX : 0

      if (containerRef.current) containerRef.current.style.width = `${contentW}px`

      const outer = outerRef.current
      if (!outer) return
      // 取 offset / scroll / 意圖寬度的最大值，避免窄視窗或 overflow:hidden 把量測卡住
      const w = Math.max(
        Math.ceil(outer.offsetWidth),
        Math.ceil(outer.scrollWidth),
        contentW + padR
      ) + 1
      const outerTop = outer.getBoundingClientRect().top
      const tailBottoms = [
        tailMeasureRef.current?.getBoundingClientRect().bottom,
        shadowTailMeasureRef.current?.getBoundingClientRect().bottom
      ].filter((v): v is number => v != null)
      const measuredFromTail = tailBottoms.length > 0
        ? Math.ceil(Math.max(...tailBottoms) - outerTop + 2)
        : 0
      const h = Math.max(
        Math.ceil(outer.offsetHeight),
        Math.ceil(outer.scrollHeight),
        measuredFromTail
      ) + 1
      if (w < 1 || h < 1) return
      lastSizeRef.current = { width: w, height: h }
      // 先等 set-size 完成再 reveal，避免以舊的窄 bounds 現身導致右邊被裁切
      const shouldReveal = revealPendingRef.current
      if (shouldReveal) revealPendingRef.current = false
      void window.api.invoke('bubble:set-size', characterId, { width: w, height: h }).then(() => {
        if (shouldReveal) void window.api.invoke('bubble:reveal', characterId)
      })
    }

    const raf1 = window.requestAnimationFrame(() => {
      measure()
      window.requestAnimationFrame(measure)
    })
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    if (outerRef.current) ro.observe(outerRef.current)
    return () => {
      window.cancelAnimationFrame(raf1)
      ro.disconnect()
    }
  }, [characterId, visible, displayText, confirmPin, outlineMode, isLatestSpeaker])

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
          className={`${lowPerformanceMode ? 'rounded-lg' : 'rounded-2xl rounded-bl-sm'} border-2 border-dashed border-teal/70 bg-transparent box-border shadow-none`}
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
        ref={outerRef}
        className="relative w-fit max-w-[420px]"
        style={{
          paddingRight: isLatestSpeaker && !lowPerformanceMode ? LATEST_SHADOW_OFFSET_PX : 0,
          paddingBottom: bubbleBottomPaddingPx(isLatestSpeaker, lowPerformanceMode)
        }}
      >
        <div className="inline-grid w-fit">
          {isLatestSpeaker && !lowPerformanceMode && (
            <div
              className="pointer-events-none col-start-1 row-start-1 z-0 min-h-0 w-full rounded-2xl rounded-bl-sm bg-teal"
              style={{ transform: `translate(${LATEST_SHADOW_OFFSET_PX}px, ${LATEST_SHADOW_OFFSET_PX}px)` }}
              aria-hidden
            />
          )}
          <div
            ref={containerRef}
            className={`relative z-[1] col-start-1 row-start-1 flex min-h-0 w-full flex-col border border-border text-sm leading-snug text-primary ${
              lowPerformanceMode
                ? 'rounded-lg bg-surface shadow-none'
                : 'rounded-2xl rounded-bl-sm bg-surface-95 shadow-panel'
            }`}
          >
        <div className="drag-region flex shrink-0 items-center justify-between gap-2 px-3 py-1.5">
          <div
            className={`text-[10px] font-medium ${
              isLatestSpeaker ? 'text-primary font-semibold' : 'text-secondary'
            }`}
          >
            {speakerName || '角色'}
          </div>
          <div className="flex gap-1">
            {messageId && (
              <button
                type="button"
                className={`no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-secondary transition-colors hover:bg-mint hover:text-primary ${
                  reaction ? 'border-teal bg-mint-20' : `border-border ${lowPerformanceMode ? 'bg-surface' : 'bg-surface-80'}`
                }`}
                title={reaction ? `已按 ${reaction}，點擊更換或取消` : '按個表情'}
                onClick={() => setShowReactionPicker(v => !v)}
              >
                {reaction
                  ? <span className="text-[10px] leading-none">{reaction}</span>
                  : <MonoIcon name="react" className="w-3 h-3" />}
              </button>
            )}
            <button
              type="button"
              className={`no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-secondary transition-colors hover:bg-mint hover:text-primary ${lowPerformanceMode ? 'bg-surface' : 'bg-surface-80'}`}
              title="釘選為便利貼"
              onClick={() => pinBubble()}
            >
              <MonoIcon name="pin" className="w-3 h-3" />
            </button>
            <button
              type="button"
              className={`no-drag flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-secondary transition-colors hover:bg-mint hover:text-primary ${lowPerformanceMode ? 'bg-surface' : 'bg-surface-80'}`}
              title="關閉對話泡泡"
              onClick={closeBubble}
            >
              <MonoIcon name="close" className="w-3 h-3" />
            </button>
          </div>
        </div>
        {confirmPin ? (
          <div className="no-drag mx-3 mb-2 mt-1 rounded-xl border border-mint bg-mint-20 px-3 py-2 text-xs text-primary">
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
          <div ref={contentRef} className="no-drag min-h-0 flex-1 overflow-y-auto break-words px-3 pb-2 pt-1">
            <MessageText text={displayText} />
            {/* emoji reaction 選單：點標題列的笑臉按鈕才展開，選完自動收合 */}
            {messageId && showReactionPicker && (
              <div className="flex gap-0.5 mt-1.5">
                {MESSAGE_REACTION_EMOJIS.map(emoji => (
                  <button
                    key={emoji}
                    type="button"
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[13px] leading-none transition-colors ${
                      reaction === emoji
                        ? 'bg-mint'
                        : 'hover:bg-mint-20'
                    }`}
                    title={reaction === emoji ? '取消這個表情' : `對這句話按 ${emoji}`}
                    onClick={() => toggleReaction(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            {/* 有新聞素材時，右下角顯示低調的「↗ 新聞」連結 */}
            {news && !showNewsCard && (
              <div className="flex justify-end mt-1">
                <button
                  type="button"
                  className="text-[11px] text-secondary decoration-dotted underline underline-offset-2 transition-colors hover:text-primary"
                  title="點開查看這則新聞的詳情與選項"
                  onClick={() => setShowNewsCard(true)}
                >
                  ↗ 新聞
                </button>
              </div>
            )}
          </div>
        )}
        {/* 新聞小卡：點「↗ 新聞」後展開，含標題、摘要、行動按鈕 */}
        {news && showNewsCard && (
          <div className="no-drag mx-3 mb-2 mt-0.5 rounded-xl border border-border bg-surface px-3 py-2 text-xs text-primary space-y-2">
            {/* 標題列 */}
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold leading-snug break-words">{news.title}</p>
                {news.summary && news.summary !== news.title && (
                  <p className="mt-0.5 text-secondary leading-snug break-words line-clamp-3">{news.summary}</p>
                )}
                {news.source && <p className="mt-0.5 text-secondary opacity-70">來源：{news.source}</p>}
              </div>
              <button
                type="button"
                className="shrink-0 mt-0.5 text-secondary opacity-60 hover:opacity-100 transition-opacity"
                title="收起"
                onClick={() => { setShowNewsCard(false); setDontWantMenu(false) }}
              >
                ✕
              </button>
            </div>
            {/* 沒興趣選單（展開後）*/}
            {dontWantMenu ? (
              <div className="space-y-1.5">
                <p className="leading-snug">這則略過就好，還是要順便封鎖？</p>
                {news.keyword && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={blockKeyword} onChange={e => setBlockKeyword(e.target.checked)} className="accent-teal" />
                    <span>封鎖關鍵字「{news.keyword}」</span>
                  </label>
                )}
                {news.source && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={blockSource}
                      onChange={e => {
                        setBlockSource(e.target.checked)
                        if (e.target.checked) setReduceSource(false)
                      }}
                      className="accent-teal"
                    />
                    <span>封鎖來源「{news.source}」（以後完全不顯示）</span>
                  </label>
                )}
                {news.source && (
                  <label className={`flex items-center gap-2 ${blockSource ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={reduceSource}
                      disabled={blockSource}
                      onChange={e => setReduceSource(e.target.checked)}
                      className="accent-teal"
                    />
                    <span>降低顯示來源「{news.source}」（少抽到，不會完全消失）</span>
                  </label>
                )}
                <div className="flex justify-end gap-2 pt-0.5">
                  <button
                    type="button"
                    className="rounded-full border border-border bg-surface-80 px-3 py-0.5 text-secondary transition-colors hover:bg-surface"
                    onClick={() => setDontWantMenu(false)}
                  >取消</button>
                  <button
                    type="button"
                    className="rounded-full bg-mint px-3 py-0.5 font-medium text-primary transition-colors hover:bg-teal"
                    onClick={confirmDontWant}
                  >確認</button>
                </div>
              </div>
            ) : (
              /* 行動按鈕列 */
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                <button
                  type="button"
                  className="rounded-full bg-mint px-2.5 py-0.5 font-medium text-primary transition-colors hover:bg-teal"
                  onClick={setAsTopic}
                >
                  📌 作為聊天主題
                </button>
                <button
                  type="button"
                  className="rounded-full border border-border bg-surface-80 px-2.5 py-0.5 text-secondary transition-colors hover:bg-blush hover:text-primary"
                  onClick={openDontWant}
                >
                  🙅 沒興趣
                </button>
                {news.url && (
                  <button
                    type="button"
                    className="rounded-full border border-border bg-surface-80 px-2.5 py-0.5 text-secondary transition-colors hover:bg-mint hover:text-primary"
                    title="在瀏覽器開啟原文"
                    onClick={() => {
                      void window.api.invoke('shell:open-external', news.url)
                      // 點開原文 = 有好奇感，微加分（+0.1，低於回話的 +0.5）
                      if (news.sourceId) void window.api.invoke('news:mark-opened', news.sourceId)
                    }}
                  >
                    原文 ↗
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {isLatestSpeaker && !lowPerformanceMode && (
          <div
            ref={shadowTailMeasureRef}
            className="pointer-events-none absolute left-4 z-0 h-3 w-3 overflow-visible"
            style={{ bottom: `-${BUBBLE_TAIL_ANCHOR_BELOW_PX + LATEST_SHADOW_OFFSET_PX}px` }}
            aria-hidden
          >
            <div className="h-3 w-3 -translate-y-1.5 rotate-45 bg-teal" />
          </div>
        )}
        <div
          ref={tailMeasureRef}
          className="absolute left-4 z-[2] h-3 w-3 overflow-visible"
          style={{
            bottom: `-${BUBBLE_TAIL_ANCHOR_BELOW_PX}px`,
            filter: lowPerformanceMode ? 'none' : 'drop-shadow(0 1px 1px rgba(0,0,0,0.05))'
          }}
        >
          <div className={`relative z-[1] h-3 w-3 -translate-y-1.5 rotate-45 border-b border-r border-border ${lowPerformanceMode ? 'bg-surface' : 'bg-surface-95'}`} />
        </div>
          </div>
        </div>
      </div>
    </div>
  )
}
