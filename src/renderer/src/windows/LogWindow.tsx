import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, selectMessages } from '../stores/useAppStore'
import type { Message, NewsDebugInfo, NewsLinkInfo } from '../types'
// 排版與圖片剝除跟手機版共用同一份（`core/prompt/debugPromptView`），不要在這裡另抄。
import { renderDebugPrompt, stripImageData } from '@core/prompt/debugPromptView'
import { MESSAGE_REACTION_EMOJIS } from '../types'
import MessageText from '@shared/MessageText'
import NewsContextPanel from '../components/NewsContextPanel'
import MonoIcon, { type MonoIconName } from '../components/MonoIcon'
import { buildSpriteEntries, EMOTION_OPTIONS, stemFromFilename } from '../utils/emotionUtils'
import { formatLlmHoverTitle, llmBadgeGlyph, messageLlmMeta } from '../utils/llmMeta'
import { formatResultBadgeText, getToolEmoji } from '../utils/randomTools'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function parseLogImagePlaceholder(src: string): { messageId: string; index: number } | null {
  const match = /^desktopst-log-image:([^:]+):(\d+)$/.exec(src)
  if (!match) return null
  return {
    messageId: decodeURIComponent(match[1]),
    index: Number(match[2])
  }
}

function stripInjectedTime(content: string): string {
  return String(content ?? '')
    .replace(/\n{0,2}【目前時間】[^\n\r]*(?:\r?\n)?/g, '')
    .trim()
}

function stripLeadingEmotionTag(content: string): string {
  return String(content ?? '')
    .replace(/^\[\s*[a-z_一-鿿㐀-䶿]+\s*\]\s*/i, '')
    .replace(/^(?:emotion|mood|feeling|情緒)\s*[:=：]\s*[a-z_一-鿿㐀-䶿]+\s*/i, '')
    .replace(/^([a-z_]+)(?=\s|$|[：:,.!?，。！？])\s*/i, (_, raw: string) => {
      const emo = raw.toLowerCase()
      const known = new Set([
        'admiration', 'amusement', 'anger', 'annoyance', 'approval',
        'caring', 'confusion', 'curiosity', 'desire', 'disappointment',
        'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
        'gratitude', 'grief', 'joy', 'love', 'nervousness',
        'optimism', 'pride', 'realization', 'relief', 'remorse',
        'sadness', 'surprise', 'neutral'
      ])
      return known.has(emo) ? '' : raw
    })
    .replace(/^[：:,\-–—\s]+/, '')
    .trim()
}

// ── 新聞 debug パネル ─────────────────────────────────────────────────────────

const MODE_LABEL: Record<NewsDebugInfo['mode'], { label: string; color: string }> = {
  news:   { label: '純新聞', color: 'bg-mint text-primary' },
  topic:  { label: '釘住話題', color: 'bg-aqua text-primary' },
  survey: { label: '新聞＋便利貼（角色選）', color: 'bg-butter text-primary' },
  notes:  { label: '只有便利貼', color: 'bg-lavender text-primary' },
  none:   { label: '沒有素材', color: 'bg-surface text-secondary border border-border' }
}

function NewsDebugPanel({ info }: { info: NewsDebugInfo }) {
  const mode = MODE_LABEL[info.mode] ?? MODE_LABEL.none
  return (
    <div className="p-4 space-y-4 overflow-auto bg-surface text-xs text-primary">
      {/* 發話模式 */}
      <div className="flex items-center gap-2">
        <span className="text-secondary shrink-0">發話模式</span>
        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${mode.color}`}>{mode.label}</span>
        {info.fromTopic && <span className="text-[10px] text-secondary">（主題泡泡優先）</span>}
      </div>

      {/* 情境組 */}
      <div className="flex items-start gap-2">
        <span className="text-secondary shrink-0 w-16">情境組</span>
        <span className="font-medium">{info.groupName}</span>
      </div>

      {/* 角色卡關鍵字 */}
      <div className="flex items-start gap-2">
        <span className="text-secondary shrink-0 w-16">角色關鍵字</span>
        {info.characterKeywords.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {info.characterKeywords.map(kw => (
              <span key={kw} className="px-2 py-0.5 rounded-full bg-[#F0BBFF]/60 text-primary border border-[#F0BBFF]">{kw}</span>
            ))}
          </div>
        ) : (
          <span className="text-secondary">（角色沒有設定）</span>
        )}
      </div>

      {/* 有效興趣詞池 */}
      <div className="flex items-start gap-2">
        <span className="text-secondary shrink-0 w-16">興趣詞池</span>
        {info.interestTerms.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {info.interestTerms.map(kw => {
              const isCharKw = info.characterKeywords.includes(kw)
              return (
                <span
                  key={kw}
                  title={isCharKw ? '來自角色卡' : '來自情境組'}
                  className={`px-2 py-0.5 rounded-full ${isCharKw ? 'bg-[#F0BBFF]/50 border border-[#F0BBFF] text-primary' : 'bg-mint text-primary'}`}
                >
                  {kw}
                  {isCharKw && <span className="ml-1 text-[10px] opacity-60">角</span>}
                </span>
              )
            })}
          </div>
        ) : (
          <span className="text-secondary">（沒有可用的興趣詞）</span>
        )}
      </div>

      {/* 選中的新聞 */}
      <div className="flex items-start gap-2">
        <span className="text-secondary shrink-0 w-16">選中新聞</span>
        {info.item ? (
          <div className="flex-1 rounded-xl border border-border bg-bg p-3 space-y-1 min-w-0">
            <p className="font-semibold leading-snug">{info.item.title}</p>
            {info.item.summary && (
              <p className="text-secondary leading-snug">{info.item.summary}</p>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-secondary pt-1">
              <span>來源：{info.item.source}</span>
              {info.item.keyword && <span>關鍵字：<span className="text-teal">{info.item.keyword}</span></span>}
              {typeof info.item.subjectivityScore === 'number' && (
                <span
                  title="標題用詞主觀／情緒程度（輔助模型輕量評分，僅供觀察，不影響抽選與角色語氣）"
                >
                  主觀／情緒：<span className="text-teal font-medium">{info.item.subjectivityScore}/5</span>
                  {info.item.subjectivityReason && <span>（{info.item.subjectivityReason}）</span>}
                </span>
              )}
            </div>
          </div>
        ) : (
          <span className="text-secondary">{info.fromTopic ? '（主題模式，沿用釘住話題）' : '（未抓到符合條件的新聞）'}</span>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function LogWindow() {
  const messages = useAppStore(selectMessages)
  const characters = useAppStore(s => s.characters)
  const settings = useAppStore(s => s.settings)
  const conversation = useAppStore(s => s.conversation)
  const deleteMessage = useAppStore(s => s.deleteMessage)
  const editMessage = useAppStore(s => s.editMessage)
  const setMessageReaction = useAppStore(s => s.setMessageReaction)
  const newConversation = useAppStore(s => s.newConversation)
  const listConversations = useAppStore(s => s.listConversations)
  const loadConversation = useAppStore(s => s.loadConversation)
  const renameConversation = useAppStore(s => s.renameConversation)
  const deleteCurrentConversation = useAppStore(s => s.deleteCurrentConversation)

  const bottomRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const [convList, setConvList] = useState<Array<{ id: string; title: string; updatedAt: number; createdAt: number }>>([])
  const [titleDraft, setTitleDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [editEmotion, setEditEmotion] = useState<string>('neutral')
  const [promptMessage, setPromptMessage] = useState<Message | null>(null)
  const [promptTab, setPromptTab] = useState<'main' | 'utility' | 'conv-search' | 'news'>('main')
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryDraft, setSummaryDraft] = useState('')
  const [summaryDirty, setSummaryDirty] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [summaryNotice, setSummaryNotice] = useState<string | null>(null)
  const [newsCtxMsg, setNewsCtxMsg] = useState<Message | null>(null)
  const [newsCtxDraft, setNewsCtxDraft] = useState('')
  const [newsCtxLoading, setNewsCtxLoading] = useState(false)

  const focusTitleInputTimer = useRef<number>(0)
  const focusTitleInput = () => {
    clearTimeout(focusTitleInputTimer.current)
    focusTitleInputTimer.current = window.setTimeout(async () => {
      await window.api.invoke('log:focus-window')
      requestAnimationFrame(() => {
        titleInputRef.current?.focus()
        titleInputRef.current?.select()
      })
    }, 60)
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' })
    }, 0)
    return () => window.clearTimeout(t)
  }, [messages.length])

  useEffect(() => {
    const onDown = () => window.api.invoke('ui:aux-activated')
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('focus', onDown, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('focus', onDown, true)
    }
  }, [])

  useEffect(() => {
    const unsub = window.api.on('log:focus-title-input', () => focusTitleInput())
    return () => unsub()
  }, [])

  useEffect(() => {
    setTitleDraft(conversation?.title ?? '新對話')
  }, [conversation?.id, conversation?.title])

  useEffect(() => {
    focusTitleInput()
  }, [conversation?.id])

  useEffect(() => {
    listConversations().then(setConvList).catch(() => setConvList([]))
  }, [conversation?.id, conversation?.title, listConversations])

  // 記憶摘要草稿與對話同步；使用者編輯中（dirty）時不被自動摘要的廣播蓋掉
  useEffect(() => {
    setSummaryDirty(false)
    setSummaryNotice(null)
  }, [conversation?.id])
  useEffect(() => {
    if (!summaryDirty) setSummaryDraft(conversation?.summary ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, conversation?.summary])

  const keepRecentN = Math.max(1, settings?.memory.keepRecentN ?? 20)
  // 近期記憶切點：這個 index 之前的訊息已不在角色的 prompt 上下文內
  // （被排除的訊息不佔 keepRecentN 名額，從尾端只數未排除的）
  const memoryBoundaryIndex = useMemo(() => {
    let count = 0
    for (let i = messages.length - 1; i >= 0; i--) {
      if (!messages[i].excludeFromContext) {
        count++
        if (count >= keepRecentN) return i
      }
    }
    return 0
  }, [messages, keepRecentN])
  const summaryCoveredCount = useMemo(() => {
    const ts = conversation?.summaryCoversTs ?? 0
    if (!ts) return 0
    return messages.filter(m => m.timestamp <= ts).length
  }, [messages, conversation?.summaryCoversTs])

  const runSummarizeNow = async () => {
    setSummarizing(true)
    setSummaryNotice(null)
    try {
      const r = await window.api.invoke('conversation:summarize-now') as { ok: boolean; noNew?: boolean; error?: string }
      if (!r.ok) setSummaryNotice(r.error ?? '摘要失敗')
      else if (r.noNew) setSummaryNotice('目前沒有需要摘要的舊訊息')
      else {
        setSummaryDirty(false)
        setSummaryNotice('摘要已更新')
      }
    } catch {
      setSummaryNotice('摘要失敗')
    } finally {
      setSummarizing(false)
    }
  }
  const saveSummary = async () => {
    await window.api.invoke('conversation:update-summary', summaryDraft)
    setSummaryDirty(false)
    setSummaryNotice('已儲存')
  }
  const clearSummary = async () => {
    if (!window.confirm('確定要清除記憶摘要嗎？角色將不再記得已被濃縮的舊對話內容。')) return
    await window.api.invoke('conversation:clear-summary')
    setSummaryDraft('')
    setSummaryDirty(false)
    setSummaryNotice(null)
  }

  const personaPresets = useAppStore(s => s.personaPresets)
  const activePersona = personaPresets.find(p => p.id === settings?.activePersonaId)

  const userName = useMemo(() => (
    activePersona?.displayName?.trim()
    || activePersona?.nickname?.trim()
    || '你'
  ), [activePersona])

  const getCharName = (id?: string) => {
    if (!id) return '系統'
    return characters.find(c => c.id === id)?.name ?? '角色'
  }

  const lastCharacterMessageId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'character') return messages[i].id
    }
    return null
  }, [messages])

  // 最後一則訊息是使用者發言且尚未收到角色回覆時，提供「重新發送」按鈕
  const lastPendingUserMessageId = useMemo(() => {
    const last = messages[messages.length - 1]
    return last?.role === 'user' ? last.id : null
  }, [messages])

  const resendLastUserMessage = () => {
    void window.api.invoke('message:resend-last')
  }

  const toggleExcluded = (msg: Message) => {
    void window.api.invoke('conversation:set-message-excluded', {
      messageId: msg.id,
      excluded: !msg.excludeFromContext
    })
  }

  const startEdit = (msg: Message) => {
    setPromptMessage(null)
    setEditingId(msg.id)
    setEditDraft(msg.role === 'user' ? stripInjectedTime(msg.content) : msg.content)
    setEditEmotion(msg.emotion ?? 'neutral')
  }

  const saveEdit = async () => {
    if (!editingId) return
    const msg = messages.find(m => m.id === editingId)
    if (msg?.role === 'character' || msg?.role === 'system') {
      // 只有角色和系統訊息才能有表情
      await editMessage(editingId, editDraft.trim(), editEmotion)
    } else {
      // 使用者訊息只編輯內容
      await editMessage(editingId, editDraft.trim())
    }
    setEditingId(null)
    setEditDraft('')
    setEditEmotion('neutral')
  }

  // 只有實際保留 debug prompt 的訊息才顯示按鈕（超過保留則數的舊訊息會被剪掉 → 不顯示、也不會去抓 debug）。
  const messageMayHaveDebug = (msg: Message) => msg.hasDebugPrompt === true || msg.hasNewsDebug === true

  const openPrompt = async (msg: Message) => {
    setEditingId(null)
    setPromptMessage(msg)
    setPromptTab('main')
    try {
      const debug = await window.api.invoke('conversation:get-message-debug', msg.id) as {
        debugPrompt?: string | null
        utilityDebugPrompt?: string | null
        newsDebug?: NewsDebugInfo | null
        convSearchDebugPrompt?: string | null
      } | null
      if (debug) {
        setPromptMessage({
          ...msg,
          debugPrompt: debug.debugPrompt ?? undefined,
          utilityDebugPrompt: debug.utilityDebugPrompt ?? undefined,
          newsDebug: debug.newsDebug ?? undefined,
          convSearchDebugPrompt: debug.convSearchDebugPrompt ?? undefined
        })
      }
    } catch (e) {
      console.error('[LogWindow] load message debug failed:', e)
    }
  }

  const [copied, setCopied] = useState(false)
  const copyPrompt = () => {
    const src = promptTab === 'utility' ? promptMessage?.utilityDebugPrompt
      : promptTab === 'conv-search' ? promptMessage?.convSearchDebugPrompt
      : promptTab === 'news' ? (promptMessage?.newsDebug ? JSON.stringify(promptMessage.newsDebug, null, 2) : null)
      : promptMessage?.debugPrompt
    if (!src) return
    const stripped = stripImageData(src)
    navigator.clipboard.writeText(stripped).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const LlmBadge = ({ msg }: { msg: Message }) => {
    const { provider, model } = messageLlmMeta(msg)
    // 手機設定頁的「顯示生成模型小圖示」是同一個開關，桌面也要跟著關
    if (settings?.ui.showLlmBadge === false) return null
    if (!provider && !model) return null
    return (
      <span
        title={formatLlmHoverTitle(provider, model)}
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full border border-border bg-surface text-[9px] text-secondary select-none"
      >
        {llmBadgeGlyph(provider)}
      </span>
    )
  }

  const ActionButton = ({
    title,
    icon,
    onClick,
    danger = false
  }: {
    title: string
    icon: MonoIconName
    onClick: () => void
    danger?: boolean
  }) => (
    <button
      type="button"
      className={`inline-flex w-6 h-6 items-center justify-center rounded-full border transition-colors ${
        danger
          ? 'border-danger-border bg-danger-soft-80 text-danger hover:bg-danger-soft'
          : 'border-border bg-surface text-secondary hover:text-primary hover:bg-teal-20'
      }`}
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      <MonoIcon name={icon} className="w-3.5 h-3.5" />
    </button>
  )

  const confirmDeleteMessage = (id: string) => {
    if (!window.confirm('確定要刪除這則訊息嗎？這個動作無法復原。')) return
    deleteMessage(id)
  }

  const openMessageImage = async (src: string, fallbackMessageId: string, fallbackIndex: number) => {
    const placeholder = parseLogImagePlaceholder(src)
    if (!placeholder) {
      setPreviewImage(src)
      return
    }
    const messageId = placeholder.messageId || fallbackMessageId
    const index = Number.isFinite(placeholder.index) ? placeholder.index : fallbackIndex
    const images = await window.api.invoke('log:get-message-images', messageId) as string[]
    const image = Array.isArray(images) ? images[index] : null
    if (image) setPreviewImage(image)
  }

  const renderMessage = (msg: Message) => {
    const isUser = msg.role === 'user'
    const isCharacter = msg.role === 'character'
    const displayContent = isUser
      ? stripInjectedTime(msg.content)
      : (isCharacter ? stripLeadingEmotionTag(msg.content) : msg.content)
    const isEditing = editingId === msg.id
    const isLatestCharacter = isCharacter && msg.id === lastCharacterMessageId

    return (
      <div key={msg.id} className="group flex flex-col gap-1">
        <div className={`flex items-center gap-2 ${isUser ? 'justify-end' : ''}`}>
          {isUser ? (
            <>
              {!isEditing && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {msg.id === lastPendingUserMessageId && (
                    <ActionButton title="重新發送" icon="resend" onClick={resendLastUserMessage} />
                  )}
                  {messageMayHaveDebug(msg) && <ActionButton title="查看完整 Prompt" icon="prompt" onClick={() => { void openPrompt(msg) }} />}
                  <ActionButton
                    title={msg.excludeFromContext ? '恢復進入記憶' : '排除於記憶外（不進上下文與摘要）'}
                    icon={msg.excludeFromContext ? 'eye' : 'eye-off'}
                    onClick={() => toggleExcluded(msg)}
                  />
                  <ActionButton title="編輯訊息" icon="edit" onClick={() => startEdit(msg)} />
                  <ActionButton title="刪除訊息" icon="trash" danger onClick={() => confirmDeleteMessage(msg.id)} />
                </div>
              )}
              {msg.excludeFromContext && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-secondary leading-none">已排除</span>
              )}
              <span className="text-xs text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                {formatTime(msg.timestamp)}
              </span>
              <span className="text-xs font-bold text-user">
                {`【${userName}】`}
                <LlmBadge msg={msg} />
                {(msg.randomResults ?? (msg.randomResult ? [msg.randomResult] : [])).map((r, i) => (
                  <span
                    key={i}
                    className="ml-1 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none bg-surface border border-border text-secondary"
                    title="隨機工具結果"
                  >
                    {getToolEmoji(r.tool)} {formatResultBadgeText(r)}
                  </span>
                ))}
              </span>
            </>
          ) : (
            <>
              <span className={`text-xs font-semibold ${isCharacter ? 'text-primary' : 'text-secondary'}`}>
                {isCharacter ? `【${getCharName(msg.characterId)}】` : '【系統】'}
                <LlmBadge msg={msg} />
              </span>
              {msg.excludeFromContext && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-secondary leading-none">已排除</span>
              )}
              {isCharacter && msg.emotion && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-teal-20 text-teal font-medium">
                  {msg.emotion}
                </span>
              )}
              {isCharacter && msg.outputTokens != null && (
                <span
                  className="text-[10px] text-secondary/70 opacity-0 group-hover:opacity-100 transition-opacity"
                  title={`輸出 ${msg.outputTokens} tokens${msg.utilityOutputTokens != null ? `，輔助 ${msg.utilityOutputTokens}` : ''}`}
                >
                  {msg.outputTokens}t{msg.utilityOutputTokens != null ? `+${msg.utilityOutputTokens}t` : ''}
                </span>
              )}
              <span className="text-xs text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                {formatTime(msg.timestamp)}
              </span>
              {!isEditing && (
                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isCharacter && (
                    <ActionButton
                      title="按個表情"
                      icon="react"
                      onClick={() => setReactionPickerId(prev => (prev === msg.id ? null : msg.id))}
                    />
                  )}
                  {messageMayHaveDebug(msg) && <ActionButton title="查看完整 Prompt" icon="prompt" onClick={() => { void openPrompt(msg) }} />}
                  {isCharacter && (
                    <ActionButton
                      title={msg.excludeFromContext ? '恢復進入記憶' : '排除於記憶外（不進上下文與摘要）'}
                      icon={msg.excludeFromContext ? 'eye' : 'eye-off'}
                      onClick={() => toggleExcluded(msg)}
                    />
                  )}
                  <ActionButton title="編輯訊息" icon="edit" onClick={() => startEdit(msg)} />
                  <ActionButton title="刪除訊息" icon="trash" danger onClick={() => confirmDeleteMessage(msg.id)} />
                </div>
              )}
            </>
          )}
        </div>

        {isCharacter && reactionPickerId === msg.id && !isEditing && (
          <div className="flex gap-1">
            {MESSAGE_REACTION_EMOJIS.map(emoji => (
              <button
                key={emoji}
                type="button"
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[14px] leading-none transition-colors ${
                  msg.reaction === emoji
                    ? 'border-teal bg-mint'
                    : 'border-border bg-surface hover:bg-mint-20'
                }`}
                title={msg.reaction === emoji ? '取消這個表情' : `按 ${emoji}`}
                onClick={() => {
                  void setMessageReaction(msg.id, msg.reaction === emoji ? null : emoji)
                  setReactionPickerId(null)
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}

        <div
          className={`relative rounded-2xl px-3 py-2 text-sm leading-relaxed max-w-[85%] ${
            msg.excludeFromContext ? 'opacity-45' : ''
          } ${
            isUser
              ? 'bg-teal-20 text-primary self-end ml-auto cursor-pointer'
              : isCharacter
              ? `bg-surface border text-primary cursor-pointer ${
                  isLatestCharacter ? 'dst-log-latest-character' : 'border-border'
                }`
              : 'bg-butter/40 text-primary text-xs italic'
          }`}
          title={
            !isEditing && isCharacter
              ? '點擊可在角色頭上顯示這句話及表情'
              : !isEditing && isUser
              ? '點擊可顯示這句使用者對白'
              : undefined
          }
          onClick={() => {
            if (isEditing) return
            if (isCharacter && msg.characterId) {
              window.api.invoke('bubble:debug-show', {
                characterId: msg.characterId,
                speakerName: getCharName(msg.characterId),
                text: String(msg.content ?? ''),
                emotion: msg.emotion ?? 'neutral',
                newsLink: msg.newsLink ?? null,
                messageId: msg.id,
                reaction: msg.reaction ?? null
              })
              // 同時切換角色視窗的表情
              if (msg.emotion) {
                window.api.invoke('character:set-emotion', {
                  characterId: msg.characterId,
                  emotion: msg.emotion
                })
              }
              return
            }
            if (isUser) {
              window.api.invoke('user-bubble:debug-show', {
                speakerName: userName,
                text: String(displayContent ?? '')
              })
            }
          }}
        >
          {isEditing ? (
            <div className="space-y-2" onClick={event => event.stopPropagation()}>
              <textarea
                className="input-field min-h-[120px] text-sm leading-relaxed resize-y"
                value={editDraft}
                onChange={event => setEditDraft(event.target.value)}
                autoFocus
              />
              {isCharacter && (() => {
                const char = characters.find(c => c.id === msg.characterId)
                const entries = char ? buildSpriteEntries(char.emotions ?? {}, char.spriteIds) : []
                const spriteOptions = entries.length > 0
                  ? entries.map(e => ({
                      value: char?.spriteIds?.[e.imagePath]?.trim() || stemFromFilename(e.filename),
                      label: char?.spriteIds?.[e.imagePath]?.trim() || stemFromFilename(e.filename)
                    }))
                  : EMOTION_OPTIONS.map(o => ({ value: o.en, label: `${o.zh}（${o.en}）` }))
                return (
                  <div>
                    <label className="text-xs text-secondary block mb-1">表情：</label>
                    <select
                      className="input-field !py-1.5 !px-2 !text-xs w-full"
                      value={editEmotion}
                      onChange={event => {
                        const newEmotion = event.target.value
                        setEditEmotion(newEmotion)
                        if (msg.characterId) {
                          window.api.invoke('character:set-emotion', {
                            characterId: msg.characterId,
                            emotion: newEmotion
                          })
                        }
                      }}
                    >
                      {spriteOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                )
              })()}
              <div className="flex justify-end gap-2">
                <button type="button" className="tab-btn text-xs" onClick={() => setEditingId(null)}>取消</button>
                <button type="button" className="tab-btn text-xs active" onClick={saveEdit}>儲存</button>
              </div>
            </div>
          ) : (
            <>
              <MessageText text={displayContent} />
              {msg.newsLink?.title && (
                <button
                  type="button"
                  className="mt-1 block max-w-full truncate text-left text-[11px] text-teal underline decoration-dotted underline-offset-2"
                  title="檢視／編輯寫進 Prompt 的新聞上下文"
                  onClick={(event) => {
                    event.stopPropagation()
                    const link = msg.newsLink as NewsLinkInfo
                    setNewsCtxMsg(msg)
                    // `??` 不是 `||`：清成空字串是使用者的決定，重開面板不該把 summary 補回來
                    setNewsCtxDraft(link.promptContext ?? link.summary ?? '')
                  }}
                >
                  📰 {msg.newsLink.title}
                </button>
              )}
              {msg.images && msg.images.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {msg.images.map((img, i) => (
                    <button
                      key={i}
                      type="button"
                      className="block rounded-lg border border-border overflow-hidden hover:border-teal transition-colors"
                      title="預覽圖片"
                      onClick={(event) => {
                        event.stopPropagation()
                        void openMessageImage(img, msg.id, i)
                      }}
                    >
                      {parseLogImagePlaceholder(img)
                        ? <span className="block px-2 py-1 text-xs text-secondary">[圖片]</span>
                        : <img src={img} className="w-16 h-16 object-cover" alt="" />}
                    </button>
                  ))}
                </div>
              )}
              {isCharacter && msg.reaction && (
                <button
                  type="button"
                  className="absolute -bottom-2.5 right-2 rounded-full border border-border bg-surface px-1.5 py-0.5 text-[11px] leading-none transition-colors hover:bg-mint-20"
                  title="點擊更換或取消表情"
                  onClick={(event) => {
                    event.stopPropagation()
                    setReactionPickerId(prev => (prev === msg.id ? null : msg.id))
                  }}
                >
                  {msg.reaction}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-bg">
      <div className="drag-region flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 no-drag">
          <span className="font-semibold text-primary">記錄</span>
          <select
            className="input-field !py-1.5 !px-2 !text-xs w-[200px] no-drag"
            value={conversation?.id ?? ''}
            onChange={event => loadConversation(event.target.value)}
            title="切換對話"
          >
            {convList.length === 0 && <option value="">{conversation?.title ?? '新對話'}</option>}
            {convList.map(c => (
              <option key={c.id} value={c.id}>
                {c.title || '新對話'}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2 no-drag">
          <button
            type="button"
            className="tab-btn text-sm text-danger hover:text-danger hover:bg-danger-soft"
            onClick={async () => {
              const ok = window.confirm('確定要刪除目前對話嗎？這個動作無法復原。')
              if (!ok) return
              await deleteCurrentConversation()
              focusTitleInput()
            }}
            title="刪除目前對話"
          >
            刪除
          </button>
          <button
            type="button"
            className="tab-btn text-sm"
            onClick={async () => {
              await newConversation()
              focusTitleInput()
            }}
            title="建立新對話"
          >
            新對話
          </button>
          <button type="button" className="btn-round w-7 h-7 text-sm" onClick={() => window.api.invoke('window:close-self')}>
            <MonoIcon name="close" className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="px-4 pt-3 no-drag">
        <div className="flex items-center gap-2">
          <span className="text-xs text-secondary shrink-0">對話名稱</span>
          <input
            ref={titleInputRef}
            className="input-field !py-1.5 no-drag"
            value={titleDraft}
            onChange={event => setTitleDraft(event.target.value)}
            onKeyDown={async event => {
              if (event.key === 'Enter') {
                await renameConversation(titleDraft.trim())
              }
            }}
            placeholder="對話名稱..."
          />
          <button
            type="button"
            className="tab-btn text-sm whitespace-nowrap no-drag"
            onClick={async () => {
              await renameConversation(titleDraft.trim())
              titleInputRef.current?.focus()
            }}
            title="儲存對話名稱"
          >
            改名
          </button>
        </div>
      </div>

      <div className="px-4 pt-2 no-drag">
        <div className="rounded-2xl border border-border overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 text-xs text-secondary hover:text-primary"
            onClick={() => setSummaryOpen(o => !o)}
            title="舊訊息的濃縮記憶，會附在每次對話的 prompt 裡；可手動編輯"
          >
            <span>
              🧠 記憶摘要
              {conversation?.summary?.trim()
                ? summaryCoveredCount > 0 ? ` · 已涵蓋 ${summaryCoveredCount} 則舊訊息` : ' · 手動筆記'
                : ' · 尚未建立'}
            </span>
            <span>{summaryOpen ? '▾' : '▸'}</span>
          </button>
          {summaryOpen && (
            <div className="px-3 pb-3 space-y-2">
              <textarea
                className="input-field w-full !text-xs min-h-[96px] resize-y"
                value={summaryDraft}
                placeholder="還沒有摘要。按「立即摘要」讓 AI 整理超出近期記憶的舊訊息，或直接手寫想讓角色記住的事。"
                onChange={e => {
                  setSummaryDraft(e.target.value)
                  setSummaryDirty(true)
                }}
              />
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  className="tab-btn text-xs"
                  disabled={summarizing}
                  onClick={() => void runSummarizeNow()}
                  title="把超出近期記憶範圍、尚未涵蓋的舊訊息濃縮進摘要"
                >
                  {summarizing ? '摘要中…' : '立即摘要'}
                </button>
                <button
                  type="button"
                  className="tab-btn text-xs"
                  disabled={!summaryDirty}
                  onClick={() => void saveSummary()}
                >
                  儲存
                </button>
                <button
                  type="button"
                  className="tab-btn text-xs text-danger hover:text-danger hover:bg-danger-soft"
                  onClick={() => void clearSummary()}
                >
                  清除
                </button>
                {summaryNotice && <span className="text-xs text-secondary">{summaryNotice}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-secondary text-sm text-center py-8">還沒有對話記錄</p>
        )}
        {messages.map((msg, index) => (
          <div key={msg.id} className="space-y-3">
            {index === memoryBoundaryIndex && memoryBoundaryIndex > 0 && (
              <div className="flex items-center gap-2 py-1 text-[11px] text-secondary select-none">
                <div className="flex-1 border-t border-border" />
                <span>
                  {conversation?.summary?.trim()
                    ? '以上訊息已超出近期記憶，由記憶摘要涵蓋'
                    : '以上訊息已超出近期記憶（角色看不到）'}
                </span>
                <div className="flex-1 border-t border-border" />
              </div>
            )}
            {renderMessage(msg)}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {promptMessage && (
        <div
          className="fixed inset-0 z-50 bg-primary/20 flex items-center justify-center p-5 no-drag"
          onMouseDown={event => event.stopPropagation()}
        >
          <div className="w-full max-w-[760px] max-h-[82vh] bg-bg border border-border rounded-2xl shadow-lg flex flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-primary">完整 Prompt</div>
                <div className="text-xs text-secondary truncate">
                  {promptMessage.role === 'character' ? getCharName(promptMessage.characterId) : userName} · {formatTime(promptMessage.timestamp)}
                </div>
                {(promptMessage.inputTokens != null || promptMessage.outputTokens != null) && (
                  <div className="text-[11px] text-secondary mt-0.5 flex flex-wrap gap-x-2">
                    {promptMessage.inputTokens != null && (
                      <span>主模型 in: {promptMessage.inputTokens.toLocaleString()}</span>
                    )}
                    {promptMessage.outputTokens != null && (
                      <span>out: {promptMessage.outputTokens.toLocaleString()}</span>
                    )}
                    {(promptMessage.utilityInputTokens != null || promptMessage.utilityOutputTokens != null) && (
                      <>
                        {promptMessage.utilityInputTokens != null && (
                          <span className="text-teal">輔助 in: {promptMessage.utilityInputTokens.toLocaleString()}</span>
                        )}
                        {promptMessage.utilityOutputTokens != null && (
                          <span className="text-teal">out: {promptMessage.utilityOutputTokens.toLocaleString()}</span>
                        )}
                      </>
                    )}
                    {(promptMessage.convSearchInputTokens != null || promptMessage.convSearchOutputTokens != null) && (
                      <>
                        {promptMessage.convSearchInputTokens != null && (
                          <span className="text-[#AAEEFF]">對話搜尋 in: {promptMessage.convSearchInputTokens.toLocaleString()}</span>
                        )}
                        {promptMessage.convSearchOutputTokens != null && (
                          <span className="text-[#AAEEFF]">out: {promptMessage.convSearchOutputTokens.toLocaleString()}</span>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-round w-7 h-7 text-sm"
                  title="複製此分頁 Prompt"
                  onClick={copyPrompt}
                >
                  <MonoIcon name={copied ? 'check' : 'copy'} className="w-3.5 h-3.5" />
                </button>
                <button type="button" className="btn-round w-7 h-7 text-sm" onClick={() => setPromptMessage(null)}>
                  <MonoIcon name="close" className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {(promptMessage.utilityDebugPrompt || promptMessage.convSearchDebugPrompt || promptMessage.newsDebug) && (
              <div className="flex gap-0 border-b border-border bg-surface px-4">
                <button
                  type="button"
                  className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${promptTab === 'main' ? 'border-primary text-primary' : 'border-transparent text-secondary hover:text-primary'}`}
                  onClick={() => setPromptTab('main')}
                >
                  主要 LLM
                </button>
                {promptMessage.utilityDebugPrompt && (
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${promptTab === 'utility' ? 'border-teal text-teal' : 'border-transparent text-secondary hover:text-primary'}`}
                    onClick={() => setPromptTab('utility')}
                  >
                    輔助 LLM
                  </button>
                )}
                {promptMessage.convSearchDebugPrompt && (
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${promptTab === 'conv-search' ? 'border-[#AAEEFF] text-[#4499CC]' : 'border-transparent text-secondary hover:text-primary'}`}
                    onClick={() => setPromptTab('conv-search')}
                  >
                    🔍 對話搜尋
                  </button>
                )}
                {promptMessage.newsDebug && (
                  <button
                    type="button"
                    className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${promptTab === 'news' ? 'border-[#AAEEDD] text-teal' : 'border-transparent text-secondary hover:text-primary'}`}
                    onClick={() => setPromptTab('news')}
                  >
                    🗞️ 新聞
                  </button>
                )}
              </div>
            )}
            <div className="px-4 pt-3 bg-surface">
              {promptTab === 'news' ? (
                <div className="rounded-lg border border-[#AAEEDD]/60 bg-[#AAEEDD]/10 px-3 py-2 text-[11px] leading-relaxed text-secondary">
                  <span className="font-semibold text-teal">新聞陪聊 debug</span>：抽選時用了哪些關鍵字、選中哪則新聞。只保留最近一則發話的記錄。
                </div>
              ) : promptTab === 'conv-search' ? (
                <div className="rounded-lg border border-[#AAEEFF]/60 bg-[#AAEEFF]/10 px-3 py-2 text-[11px] leading-relaxed text-secondary">
                  <span className="font-semibold text-[#4499CC]">對話新聞搜尋</span>：使用者訊息觸發關鍵詞後，送輔助（或主要）模型判斷是否為時事查詢、萃取搜尋詞的完整 prompt。輸出＝搜尋詞或 null。
                </div>
              ) : promptTab === 'utility' && promptMessage.utilityDebugPrompt ? (
                <div className="rounded-lg border border-teal/40 bg-teal/10 px-3 py-2 text-[11px] leading-relaxed text-secondary">
                  <span className="font-semibold text-teal">輔助 LLM 負責的指令</span>：表情判斷、群組次要角色、提醒發話、新聞陪聊（新聞設定選「輔助」時）、未來的對話摘要。
                  <span className="block mt-0.5">輸入＝各任務專用 prompt（如表情分類），輸出＝分類 ID 或角色台詞。</span>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-bg px-3 py-2 text-[11px] leading-relaxed text-secondary">
                  <span className="font-semibold text-primary">主要 LLM 負責的指令</span>：玩家直接對話的主回覆；新聞陪聊（新聞設定選「主要」時，預設）；未啟用模型分流時的所有發話。
                  <span className="block mt-0.5">輸入＝四層 system prompt＋最近對話歷史，輸出＝角色台詞。</span>
                </div>
              )}
            </div>
            {promptTab === 'news' && promptMessage.newsDebug ? (
              <NewsDebugPanel info={promptMessage.newsDebug} />
            ) : (
              <pre className="m-0 p-4 overflow-auto text-xs leading-relaxed text-primary whitespace-pre-wrap bg-surface">
                {promptTab === 'conv-search' && promptMessage.convSearchDebugPrompt
                  ? renderDebugPrompt(promptMessage.convSearchDebugPrompt)
                  : promptTab === 'utility' && promptMessage.utilityDebugPrompt
                  ? renderDebugPrompt(promptMessage.utilityDebugPrompt)
                  : promptMessage.debugPrompt
                    ? renderDebugPrompt(promptMessage.debugPrompt)
                    : '這則訊息沒有保存 Prompt。只有新的 LLM 回應會記錄完整 Prompt。'}
              </pre>
            )}
          </div>
        </div>
      )}

      {newsCtxMsg?.newsLink && (
        <NewsContextPanel
          open={!!newsCtxMsg}
          title={newsCtxMsg.newsLink.title}
          url={newsCtxMsg.newsLink.url}
          source={newsCtxMsg.newsLink.source}
          promptContext={newsCtxDraft}
          loading={newsCtxLoading}
          mode="edit"
          onClose={() => setNewsCtxMsg(null)}
          onSave={async (pc) => {
            await window.api.invoke('news:update-prompt-context', {
              messageId: newsCtxMsg.id,
              promptContext: pc
            })
            setNewsCtxMsg(null)
          }}
          onClear={async () => {
            await window.api.invoke('news:update-prompt-context', {
              messageId: newsCtxMsg.id,
              promptContext: ''
            })
            setNewsCtxMsg(null)
          }}
          onRefresh={async () => {
            const link = newsCtxMsg.newsLink!
            setNewsCtxLoading(true)
            try {
              const r = await window.api.invoke('news:enrich-for-chat', {
                item: {
                  id: link.id,
                  title: link.title,
                  summary: link.summary,
                  url: link.url,
                  source: link.source,
                  sourceId: link.sourceId,
                  keyword: link.keyword
                },
                forceRefresh: true
              }) as { ok: boolean; promptContext?: string }
              if (r.ok && typeof r.promptContext === 'string') setNewsCtxDraft(r.promptContext)
            } finally {
              setNewsCtxLoading(false)
            }
          }}
          onOpenOriginal={newsCtxMsg.newsLink.url ? () => {
            void window.api.invoke('shell:open-external', newsCtxMsg.newsLink!.url)
            if (newsCtxMsg.newsLink!.sourceId) {
              void window.api.invoke('news:mark-opened', newsCtxMsg.newsLink!.sourceId)
            }
          } : undefined}
        />
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-[60] bg-primary/30 flex items-center justify-center p-6 no-drag"
          onMouseDown={() => setPreviewImage(null)}
        >
          <div className="relative max-w-[90vw] max-h-[88vh]" onMouseDown={event => event.stopPropagation()}>
            <button
              type="button"
              className="btn-round absolute -top-3 -right-3 w-8 h-8 text-sm"
              onClick={() => setPreviewImage(null)}
              title="關閉圖片預覽"
            >
              <MonoIcon name="close" className="w-4 h-4" />
            </button>
            <img
              src={previewImage}
              className="max-w-[90vw] max-h-[88vh] rounded-2xl border border-border bg-surface shadow-panel object-contain"
              alt=""
            />
          </div>
        </div>
      )}
    </div>
  )
}
