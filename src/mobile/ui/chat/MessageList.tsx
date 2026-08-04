import { useEffect, useLayoutEffect, useRef } from 'react'
import type { MessageSnapshot } from '@core/data'
import { isOptimistic, useAppStore } from '../stores/appStore'

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
    <div className={`mb-2.5 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[82%] ${isUser ? '' : 'w-full'}`}>
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
          {message.content}
          {/* 圖片本身在 B 系列（階段 2b）接上；先讓張數看得見，
              避免「送出去的圖不見了」的錯覺。 */}
          {message.imageCount ? (
            <div className="mt-1 text-xs opacity-70">🖼 {message.imageCount} 張圖片</div>
          ) : null}
        </div>
      </div>
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
