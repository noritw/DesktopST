import { useEffect, useRef } from 'react'
import { useAppStore, selectMessages } from '../stores/useAppStore'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export default function LogWindow() {
  const messages = useAppStore(selectMessages)
  const characters = useAppStore(s => s.characters)
  const conversation = useAppStore(s => s.conversation)
  const deleteMessage = useAppStore(s => s.deleteMessage)
  const newConversation = useAppStore(s => s.newConversation)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const getCharName = (id?: string) => {
    if (!id) return '系統'
    return characters.find(c => c.id === id)?.name ?? '角色'
  }

  return (
    <div className="w-full h-full flex flex-col bg-bg">
      {/* Title bar */}
      <div className="drag-region flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="font-semibold text-primary no-drag">
          📋 {conversation?.title ?? '對話記錄'}
        </span>
        <div className="flex gap-2 no-drag">
          <button
            className="tab-btn text-sm"
            onClick={newConversation}
            title="開新對話"
          >
            ＋ 新對話
          </button>
          <button
            className="btn-round w-7 h-7 text-sm"
            onClick={() => window.api.invoke('window:close-self')}
          >
            ✕
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-secondary text-sm text-center py-8">還沒有對話記錄</p>
        )}
        {messages.map(msg => (
          <div key={msg.id} className="group flex flex-col gap-0.5">
            {/* Header */}
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold ${
                msg.role === 'user' ? 'text-teal' :
                msg.role === 'character' ? 'text-primary' : 'text-secondary'
              }`}>
                {msg.role === 'user' ? '【你】' :
                 msg.role === 'character' ? `【${getCharName(msg.characterId)}】` : '【系統】'}
              </span>
              <span className="text-xs text-secondary opacity-0 group-hover:opacity-100 transition-opacity">
                {formatTime(msg.timestamp)}
              </span>
              <button
                className="text-xs text-blush opacity-0 group-hover:opacity-100 transition-opacity ml-auto"
                onClick={() => deleteMessage(msg.id)}
                title="刪除此訊息"
              >
                🗑
              </button>
            </div>

            {/* Content */}
            <div className={`rounded-2xl px-3 py-2 text-sm leading-relaxed max-w-[85%] ${
              msg.role === 'user'
                ? 'bg-teal/20 text-primary self-end ml-auto'
                : msg.role === 'character'
                ? 'bg-surface border border-border text-primary'
                : 'bg-butter/40 text-primary text-xs italic'
            }`}>
              {msg.content}
              {msg.images && msg.images.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {msg.images.map((img, i) => (
                    <img key={i} src={img} className="w-16 h-16 object-cover rounded-lg" alt="" />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
