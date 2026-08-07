import type { Conversation, Message } from '@core/types'
import type { ConversationSnapshot, MessageSnapshot } from '@core/data'

/** 與遙控快照同形：剝 images／debug，改報 imageCount。 */
export function toMessageSnapshot(m: Message): MessageSnapshot {
  const { images, debugPrompt: _d, utilityDebugPrompt: _u, ...rest } = m
  return {
    ...rest,
    imageCount: images?.length ?? 0
  }
}

export function toConversationSnapshot(conv: Conversation | null): ConversationSnapshot | null {
  if (!conv) return null
  return {
    id: conv.id,
    title: conv.title,
    messages: conv.messages.map(toMessageSnapshot)
  }
}

export function contextMessages(messages: Message[], keepRecentN: number): Message[] {
  return messages.filter((m) => !m.excludeFromContext).slice(-Math.max(1, keepRecentN))
}
