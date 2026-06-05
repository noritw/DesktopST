import { useEffect, useState } from 'react'

interface NewsTopic {
  id: string
  title: string
  summary: string
  url: string
  source: string
}

export default function TopicBubbleWindow() {
  const [topic, setTopic] = useState<NewsTopic | null>(null)

  const load = async () => {
    const t = await window.api.invoke('news:get-topic') as NewsTopic | null
    setTopic(t)
  }

  useEffect(() => {
    void load()
    const unsub = window.api.on('topic-bubble:refresh', () => { void load() })
    return unsub
  }, [])

  const close = () => {
    void window.api.invoke('news:clear-topic')
  }

  const openLink = () => {
    if (topic?.url) void window.api.invoke('shell:open-external', topic.url)
  }

  if (!topic) return null

  return (
    <div className="drag-region flex h-screen w-screen items-start gap-2 rounded-2xl border-2 border-teal bg-teal px-3 py-2 shadow-panel">
      <span className="mt-0.5 shrink-0 text-lg" aria-hidden="true">📌</span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-primary opacity-80">後續聊天主題</p>
        <p className="line-clamp-2 break-words text-sm font-semibold leading-snug text-primary" title={topic.title}>
          {topic.title}
        </p>
        {topic.source && <p className="mt-0.5 text-xs text-primary opacity-70">來源：{topic.source}</p>}
      </div>
      <div className="no-drag flex shrink-0 flex-col gap-1">
        {topic.url && (
          <button
            type="button"
            className="rounded-full border border-border bg-surface-80 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-surface"
            title="開啟原文連結"
            onClick={openLink}
          >
            原文
          </button>
        )}
        <button
          type="button"
          className="rounded-full border border-border bg-surface-80 px-2.5 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-blush"
          title="結束這個聊天主題"
          onClick={close}
        >
          關閉
        </button>
      </div>
    </div>
  )
}
