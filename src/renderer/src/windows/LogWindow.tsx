import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, selectMessages } from '../stores/useAppStore'
import type { Message } from '../types'
import MessageText from '../components/MessageText'
import MonoIcon, { type MonoIconName } from '../components/MonoIcon'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function stripInjectedTime(content: string): string {
  return String(content ?? '')
    .replace(/\n{0,2}【目前時間】[^\n\r]*(?:\r?\n)?/g, '')
    .trim()
}

function stripLeadingEmotionTag(content: string): string {
  return String(content ?? '')
    .replace(/^\[\s*[a-z_]+\s*\]\s*/i, '')
    .replace(/^(?:emotion|mood|feeling|情緒)\s*[:=：]\s*[a-z_]+\s*/i, '')
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

export default function LogWindow() {
  const messages = useAppStore(selectMessages)
  const characters = useAppStore(s => s.characters)
  const settings = useAppStore(s => s.settings)
  const conversation = useAppStore(s => s.conversation)
  const deleteMessage = useAppStore(s => s.deleteMessage)
  const editMessage = useAppStore(s => s.editMessage)
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
  const [promptMessage, setPromptMessage] = useState<Message | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  const focusTitleInput = () => {
    window.api.invoke('ui:aux-activated')
    window.requestAnimationFrame(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.select()
    })
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
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
    setTitleDraft(conversation?.title ?? '新對話')
    focusTitleInput()
  }, [conversation?.id, conversation?.title])

  useEffect(() => {
    listConversations().then(setConvList).catch(() => setConvList([]))
  }, [conversation?.id, conversation?.title, listConversations])

  const userName = useMemo(() => (
    settings?.persona.displayName?.trim()
    || settings?.persona.nickname?.trim()
    || '你'
  ), [settings])

  const getCharName = (id?: string) => {
    if (!id) return '系統'
    return characters.find(c => c.id === id)?.name ?? '角色'
  }

  const startEdit = (msg: Message) => {
    setPromptMessage(null)
    setEditingId(msg.id)
    setEditDraft(msg.role === 'user' ? stripInjectedTime(msg.content) : msg.content)
  }

  const saveEdit = async () => {
    if (!editingId) return
    await editMessage(editingId, editDraft.trim())
    setEditingId(null)
    setEditDraft('')
  }

  const openPrompt = (msg: Message) => {
    setEditingId(null)
    setPromptMessage(msg)
  }

  const LlmBadge = ({ provider, model }: { provider?: string; model?: string }) => {
    if (!provider && !model) return null
    const label = provider === 'openai' ? 'OpenAI' : provider ?? 'LLM'
    const title = model ? `${label} / ${model}` : label
    return (
      <span
        title={title}
        className="ml-1 inline-flex items-center justify-center w-4 h-4 rounded-full border border-border bg-surface text-[9px] text-secondary select-none"
      >
        {provider === 'openai' ? 'O' : 'L'}
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
          ? 'border-[#FFB59F] bg-[#FFE2D8]/80 text-[#E85D3F] hover:bg-[#FFE2D8]'
          : 'border-border bg-surface text-secondary hover:text-primary hover:bg-teal/20'
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

  const renderMessage = (msg: Message) => {
    const isUser = msg.role === 'user'
    const isCharacter = msg.role === 'character'
    const displayContent = isUser
      ? stripInjectedTime(msg.content)
      : (isCharacter ? stripLeadingEmotionTag(msg.content) : msg.content)
    const isEditing = editingId === msg.id

    return (
      <div key={msg.id} className="group flex flex-col gap-1">
        <div className={`flex items-center gap-2 ${isUser ? 'justify-end' : ''}`}>
          {isUser ? (
            <>
              {!isEditing && (
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {msg.debugPrompt && <ActionButton title="查看完整 Prompt" icon="prompt" onClick={() => openPrompt(msg)} />}
                  <ActionButton title="編輯訊息" icon="edit" onClick={() => startEdit(msg)} />
                  <ActionButton title="刪除訊息" icon="trash" danger onClick={() => confirmDeleteMessage(msg.id)} />
                </div>
              )}
              <span className="text-xs text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                {formatTime(msg.timestamp)}
              </span>
              <span className="text-xs font-bold text-[#247566]">
                {`【${userName}】`}
                <LlmBadge provider={msg.llmProvider} model={msg.llmModel} />
              </span>
            </>
          ) : (
            <>
              <span className={`text-xs font-semibold ${isCharacter ? 'text-primary' : 'text-secondary'}`}>
                {isCharacter ? `【${getCharName(msg.characterId)}】` : '【系統】'}
                <LlmBadge provider={msg.llmProvider} model={msg.llmModel} />
              </span>
              <span className="text-xs text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                {formatTime(msg.timestamp)}
              </span>
              {!isEditing && (
                <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {msg.debugPrompt && <ActionButton title="查看完整 Prompt" icon="prompt" onClick={() => openPrompt(msg)} />}
                  <ActionButton title="編輯訊息" icon="edit" onClick={() => startEdit(msg)} />
                  <ActionButton title="刪除訊息" icon="trash" danger onClick={() => confirmDeleteMessage(msg.id)} />
                </div>
              )}
            </>
          )}
        </div>

        <div
          className={`rounded-2xl px-3 py-2 text-sm leading-relaxed max-w-[85%] ${
            isUser
              ? 'bg-teal/20 text-primary self-end ml-auto cursor-pointer'
              : isCharacter
              ? 'bg-surface border border-border text-primary cursor-pointer'
              : 'bg-butter/40 text-primary text-xs italic'
          }`}
          title={
            !isEditing && isCharacter
              ? '點擊可在角色頭上顯示這句話'
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
                text: String(msg.content ?? '')
              })
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
              <div className="flex justify-end gap-2">
                <button type="button" className="tab-btn text-xs" onClick={() => setEditingId(null)}>取消</button>
                <button type="button" className="tab-btn text-xs active" onClick={saveEdit}>儲存</button>
              </div>
            </div>
          ) : (
            <>
              <MessageText text={displayContent} />
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
                        setPreviewImage(img)
                      }}
                    >
                      <img src={img} className="w-16 h-16 object-cover" alt="" />
                    </button>
                  ))}
                </div>
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
            className="tab-btn text-sm text-[#E85D3F] hover:text-[#E85D3F] hover:bg-[#FFE2D8]"
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

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-secondary text-sm text-center py-8">還沒有對話記錄</p>
        )}
        {messages.map(renderMessage)}
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
              </div>
              <button type="button" className="btn-round w-7 h-7 text-sm" onClick={() => setPromptMessage(null)}>
                <MonoIcon name="close" className="w-3.5 h-3.5" />
              </button>
            </div>
            <pre className="m-0 p-4 overflow-auto text-xs leading-relaxed text-primary whitespace-pre-wrap bg-surface">
              {promptMessage.debugPrompt || '這則訊息沒有保存 Prompt。只有新的 LLM 回應會記錄完整 Prompt。'}
            </pre>
          </div>
        </div>
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
