import type { Message } from '../types'

// 圖示字母與 hover 文字改放共用層，手機端用同一份（見 src/shared/llmBadge.ts）
export { formatLlmHoverTitle, llmBadgeGlyph } from '@shared/llmBadge'

export function parseDebugPromptLlmMeta(debugPrompt?: string): {
  provider?: Message['llmProvider']
  model?: string
} | null {
  if (!debugPrompt?.trim()) return null
  try {
    const obj = JSON.parse(debugPrompt) as { provider?: string; model?: string }
    const provider = obj.provider as Message['llmProvider'] | undefined
    const model = typeof obj.model === 'string' ? obj.model.trim() : undefined
    if (!provider && !model) return null
    return { provider, model }
  } catch {
    return null
  }
}

/** Model that actually generated this message (matches 完整 Prompt 扮演模型分頁). */
export function messageLlmMeta(msg: Message): { provider?: Message['llmProvider']; model?: string } {
  const fromDebug = parseDebugPromptLlmMeta(msg.debugPrompt)
  if (fromDebug?.provider || fromDebug?.model) return fromDebug
  return { provider: msg.llmProvider, model: msg.llmModel }
}
