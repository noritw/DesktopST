import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MessageSnapshot } from '@core/data'
import { formatLlmHoverTitle, llmBadgeGlyph } from '@shared/llmBadge'
import { renderInline } from '@shared/MessageText'
import { isOptimistic, useAppStore, getData } from '../stores/appStore'
import { MessageImages } from './MessageImages'
import { formatRandomBadge } from './randomLabels'
import { Avatar } from '../characters/Avatar'
import { useUiStore } from '../stores/uiStore'
import { NewsContextSheet } from '../news/NewsContextSheet'

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

  const scrollToEnd = (): void => {
    const el = containerRef.current
    if (!el) return
    // ⚠️ 用容器自己的 scrollTop，不要 scrollIntoView。
    // Capacitor WebView 裡 scrollIntoView 常去捲外層（整個視窗），
    // 訊息串看起來就「角色發話了但畫面沒跟著下去」。
    el.scrollTop = el.scrollHeight
  }

  /**
   * 自動捲到底（清單 A9），但**只有在使用者本來就在底部時**。
   *
   * 少了這個條件，使用者往上翻舊訊息時只要有新訊息進來就會被拉回底部 ——
   * 群組聊天時角色接連發話，那等於完全沒辦法讀歷史。
   *
   * 例外：使用者自己剛送出、或角色正在「思考中」——那代表在等回覆，
   * 一律黏底，不然鍵盤收合／版面抖一下就容易判定「離底」而漏捲。
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
    const last = messages[messages.length - 1]
    if (last && isOptimistic(last) && last.role === 'user') stickToBottom.current = true
    if (thinkingIds.length > 0) stickToBottom.current = true
    if (!stickToBottom.current) return
    scrollToEnd()
    // 圖片／字體晚一拍撐高時再補一次，否則角色泡泡出現後仍差一截
    const t = window.setTimeout(scrollToEnd, 50)
    return () => window.clearTimeout(t)
  }, [messages, thinkingIds])

  const nameOf = (id?: string): string =>
    snapshot?.presentCharacters.find((c) => c.id === id)?.name ?? ''

  /** 點 📰 標題要編的那則訊息。面板本身與新聞報的「聊這個」共用一份。 */
  const [newsMsg, setNewsMsg] = useState<MessageSnapshot | null>(null)
  const link = newsMsg?.newsLink
  const saveNewsCtx = async (pc: string, done: string): Promise<void> => {
    if (!newsMsg) return
    try {
      await getData().news.updatePromptContext(newsMsg.id, pc)
      useUiStore.getState().toast(done)
    } catch {
      useUiStore.getState().toast('儲存失敗', 'error')
    }
    setNewsMsg(null)
  }

  return (
    <div ref={containerRef} className="scroll-y flex-1 px-4 py-3">
      {messages.map((m) => (
        <MessageRow key={m.id} message={m} characterName={nameOf(m.characterId)} onEditNews={setNewsMsg} />
      ))}
      {thinkingIds.map((id) => (
        <ThinkingRow key={`thinking:${id}`} name={nameOf(id)} />
      ))}
      <div ref={endRef} />
      {link && (
        <NewsContextSheet
          target={{
            id: link.id,
            title: link.title,
            summary: link.summary,
            url: link.url,
            source: link.source,
            sourceId: link.sourceId,
            keyword: link.keyword
          }}
          mode="edit"
          // `??` 不是 `||`：清成空字串是使用者按過「清除摘要」，不該把 summary 補回來
          initialDraft={link.promptContext ?? link.summary ?? ''}
          onClose={() => setNewsMsg(null)}
          onSave={(pc) => void saveNewsCtx(pc, '已儲存')}
          onClear={() => void saveNewsCtx('', '已清除摘要')}
        />
      )}
    </div>
  )
}

/**
 * 生成這則回覆的模型（角色名右邊那顆小圓）。
 *
 * 桌面是 hover 顯示 title，手機沒有 hover —— 改成**點一下把型號展開在旁邊**，
 * 再點一下收起。可在設定關掉（`ui.showLlmBadge`，預設開）。
 * 字母與文字格式跟桌面共用 `@shared/llmBadge`，不要另抄一份對照表。
 */
function LlmBadge({ message }: { message: MessageSnapshot }): JSX.Element | null {
  const enabled = useAppStore((s) => s.snapshot?.showLlmBadge !== false)
  const [open, setOpen] = useState(false)
  const provider = message.llmProvider
  const model = message.llmModel

  if (!enabled || (!provider && !model)) return null
  return (
    <>
      <button
        type="button"
        // 視覺是 14px 的小圓，但點擊區用 padding 撐到能按得到（小圓本身太小按不準）
        className="-m-1 inline-flex items-center justify-center p-1"
        aria-label={`生成模型：${formatLlmHoverTitle(provider, model)}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="inline-flex h-[14px] w-[14px] items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-[9px] leading-none text-[var(--text-sub)]">
          {llmBadgeGlyph(provider)}
        </span>
      </button>
      {open && (
        <span className="min-w-0 truncate text-[11px] text-[var(--text-sub)]">
          {formatLlmHoverTitle(provider, model)}
        </span>
      )}
    </>
  )
}

function MessageRow({ message, characterName, onEditNews }: {
  message: MessageSnapshot
  characterName: string
  onEditNews: (m: MessageSnapshot) => void
}): JSX.Element {
  // 未設定＝開啟，與 `showLlmBadge` 同一個慣例。
  const showPersonaName = useAppStore((s) => s.snapshot?.showPersonaName !== false)

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
        /* 頭像＝這個角色的操作選單（提及／說點什麼／禁言／編輯角色）。
           原本是直接跳角色卡，但實機用下來最常想做的其實是「點名他」——
           群組聊天要一直手打名字。與頂部 `AvatarBar` 共用同一個選單，
           免得同一顆頭像在兩個地方點出不同東西。 */
        <button
          type="button"
          aria-label={`${characterName || '角色'}的選單`}
          onClick={() => useUiStore.getState().push('character-menu', message.characterId)}
          className="mt-4 shrink-0"
        >
          <Avatar characterId={message.characterId} size={30} />
        </button>
      )}
      <div className={`min-w-0 ${isUser ? 'max-w-[86%]' : 'flex-1'}`}>
        {!isUser && (characterName || message.llmModel) && (
          <div className="mb-0.5 ml-1 flex items-center gap-1 text-xs text-[var(--text-sub)]">
            {characterName}
            <LlmBadge message={message} />
          </div>
        )}
        {/* 發話身分（清單 A1）。切著好幾個身分玩角色扮演時，回頭看要分得出這句是誰說的。
            名字是**發話當下存進訊息的快照**，不是現在使用中的那個身分 ——
            所以舊訊息（欄位還不存在的年代）沒有就不顯示，不拿目前的去補。 */}
        {isUser && message.personaName && showPersonaName && (
          <div className="mb-0.5 mr-1 text-right text-xs text-[var(--text-sub)]">
            {message.personaName}
          </div>
        )}

        {/*
         * 泡泡與 ⋯ 同一列並 `items-center`，⋯ 才會對齊泡泡的垂直中央。
         *
         * ⚠️ **不能把 ⋯ 放在最外層那個 flex 裡**：那一層是 `items-start`
         * （頭像要對齊第一行，這是聊天 UI 的慣例），於是 ⋯ 會被拉到右上角，
         * 訊息越長看起來越歪 —— owner 2026-08-05 回報的正是這個。
         * 名字那一行留在外面，不然 ⋯ 會被它一起算進去而偏低。
         */}
        <div className={`flex items-center gap-1 ${isUser ? 'justify-end' : ''}`}>
          <div
            className={`anim-pop-in min-w-0 whitespace-pre-wrap break-words rounded-[16px] px-3.5 py-2.5 text-[15px] leading-relaxed ${
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
            {renderInline(message.content)}
            {message.newsLink?.title && (
              <button
                type="button"
                className="mt-1 block max-w-full truncate text-left text-[12px] text-[var(--mint2)] underline decoration-dotted"
                onClick={() => onEditNews(message)}
              >
                📰 {message.newsLink.title}
              </button>
            )}
            {message.imageCount ? (
              <MessageImages messageId={message.id} count={message.imageCount} />
            ) : null}
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
              className="shrink-0 self-center px-1.5 py-2 text-sm leading-none text-[var(--text-sub)] opacity-45 active:opacity-100"
            >
              ⋯
            </button>
          )}
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
