import type { Message } from '../types'

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok'
}

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

export function formatLlmHoverTitle(provider?: string, model?: string): string {
  const label = provider ? (PROVIDER_LABELS[provider] ?? provider) : 'LLM'
  return model ? `${label} / ${model}` : label
}

export function llmBadgeGlyph(provider?: string): string {
  if (provider === 'openai') return 'O'
  if (provider === 'claude') return 'C'
  if (provider === 'gemini') return 'G'
  if (provider === 'grok') return 'X'
  return 'L'
}
