import { useEffect, useLayoutEffect, useRef } from 'react'
import type { MessageSnapshot } from '@core/data'
import { isOptimistic, useAppStore } from '../stores/appStore'
import { MessageImages } from './MessageImages'
import { formatRandomBadge } from './randomLabels'
import { Avatar } from '../characters/Avatar'
import { useUiStore } from '../stores/uiStore'

/**
 * 訊息串（清單 A1、A9）。
 *
 * 三種樣式：使用者（右、藍底）／角色（左、白底＋名字）／系統（置中、細字）。
 * 對應桌面的 LogWindow ＋ 對話泡泡。
 */

export function MessageList(): JSX.Element {
  const messages = useAppStore((s) => s.messages)
  const thinkingIds = useAppStore((s) => s.thinkingIds)
  const snapshot = useAppStore((s) => s.snapshot)
  const endRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  /**
   * 自動捲到底（清單 A9），但**只有在使用者本來就在底部時**。
   *
   * 少了這個條件，使用者往上翻舊訊息時只要有新訊息進來就會被拉回底部 ——
   * 群組聊天時角色接連發話，那等於完全沒辦法讀歷史。
   */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = (): void => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight
      stickToBottom.current = distance < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useLayoutEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, thinkingIds])

  const nameOf = (id?: string): string =>
    snapshot?.presentCharacters.find((c) => c.id === id)?.name ?? ''

  return (
    <div ref={containerRef} className="scroll-y flex-1 px-4 py-3">
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} characterName={nameOf(m.characterId)} />
      ))}
      {thinkingIds.map((id) => (
        <ThinkingRow key={`thinking:${id}`} name={nameOf(id)} />
      ))}
      <div ref={endRef} />
    </div>
  )
}

function MessageRow({ message, characterName }: { message: MessageSnapshot; characterName: string }): JSX.Element {
  if (message.role === 'system') {
    return (
      <div className="my-2 px-6 text-center text-xs leading-relaxed text-[var(--text-sub)]">
        {message.content}
      </div>
    )
  }

  const isUser = message.role === 'user'
  return (
    <div className={`mb-2.5 flex items-start gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && message.characterId && (
        <div className="mt-4 shrink-0">
          <Avatar characterId={message.characterId} size={30} />
        </div>
      )}
      <div className={`min-w-0 max-w-[78%] ${isUser ? '' : 'flex-1'}`}>
        {!isUser && characterName && (
          <div className="mb-0.5 ml-1 text-xs text-[var(--text-sub)]">{characterName}</div>
        )}
        <div
          className={`anim-pop-in whitespace-pre-wrap break-words rounded-[16px] px-3.5 py-2.5 text-[15px] leading-relaxed ${
            isUser
              ? 'bg-[var(--user-bubble)] text-[var(--text)]'
              : 'border border-[var(--border)] bg-[var(--surface)] text-[var(--text)]'
          } ${isOptimistic(message) ? 'opacity-60' : ''}`}
        >
          {/* 結果徽章（清單 C5）。放在內容之前，與桌面版及 mobile.html 一致 ——
              「先看擲出什麼、再看說了什麼」才是這條訊息的閱讀順序。
              `randomResult` 是舊欄位，只有舊對話還帶著它。 */}
          {(message.randomResults ?? (message.randomResult ? [message.randomResult] : [])).map(
            (r, i) => (
              <div key={i} className="mb-1 text-[13px] text-[var(--text-sub)]">
                {formatRandomBadge(r)}
              </div>
            )
          )}
          {message.content}
          {message.imageCount ? (
            <MessageImages messageId={message.id} count={message.imageCount} />
          ) : null}
        </div>
      </div>

      {/* 訊息選單入口（清單 A6）。
          **樂觀渲染那則不給** —— 伺服器還不認得那個 id，按下去一定失敗。
          常駐而不是長按叫出：長按在 WebView 裡會跟系統的選字選單打架，
          而且沒有任何提示告訴使用者「這裡可以長按」。 */}
      {!isOptimistic(message) && (
        <button
          type="button"
          aria-label="訊息選單"
          onClick={() => useUiStore.getState().push('message-menu', message.id)}
          className="mt-3 shrink-0 px-1 text-sm leading-none text-[var(--text-sub)] opacity-45 active:opacity-100"
        >
          ⋯
        </button>
      )}
    </div>
  )
}

/** 思考中（清單 A3）。 */
function ThinkingRow({ name }: { name: string }): JSX.Element {
  return (
    <div className="mb-2.5 flex justify-start">
      <div>
        {name && <div className="mb-0.5 ml-1 text-xs text-[var(--text-sub)]">{name}</div>}
        <div className="flex items-center gap-1 rounded-[16px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-[var(--text-sub)]"
              style={{ animation: `thinking-bounce 1.2s ${i * 0.16}s infinite ease-in-out` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
