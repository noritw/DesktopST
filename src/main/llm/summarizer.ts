import { chatWithLLM, applyUtilitySettings } from './index'
import { messageSpeakerLabel } from './promptUtils'
import type { AppSettings, Conversation, Message, PersonaPreset } from '../types'

/** 摘要指令（英文省 Token，輸出強制繁中；比照新聞發話指令慣例） */
const SUMMARIZER_INSTRUCTIONS =
  'You maintain a running memory summary of a long-term chat between a user and desktop companion character(s).\n' +
  'Merge the EXISTING SUMMARY (if any) with the NEW LINES into ONE updated summary. The existing summary may contain user hand-written notes — preserve their meaning.\n' +
  'Keep: stable facts about the user, promises and plans, notable events, emotional or relationship developments, recurring topics or jokes likely to come up again.\n' +
  'Drop: greetings, filler, moment-to-moment small talk with no lasting relevance.\n' +
  'Write in Traditional Chinese (Taiwan usage), concise short sentences, one point per line, aim for under 400 characters total.\n' +
  'Output the summary text only — no headings, no explanations.'

/** 摘要輸出的 token 上限（獨立於聊天回覆長度設定） */
const SUMMARY_MAX_TOKENS = 700

export interface SummarizeConversationResult {
  summary: string
  /** 這次摘要涵蓋到的最後一則訊息 timestamp（呼叫端負責寫回 conv.summaryCoversTs） */
  coversTs: number
  inputTokens?: number
  outputTokens?: number
}

/** 可被摘要的訊息：已超出 keepRecentN 視窗、尚未被既有摘要涵蓋、且是實際對話內容 */
export function listSummarizableMessages(conv: Conversation, keepRecentN: number): Message[] {
  const cutoffIndex = Math.max(0, conv.messages.length - Math.max(1, keepRecentN))
  const coversTs = conv.summaryCoversTs ?? 0
  return conv.messages
    .slice(0, cutoffIndex)
    .filter(m => m.timestamp > coversTs && (m.role === 'user' || m.role === 'character') && !!m.content?.trim())
}

/** 尚未被摘要涵蓋的訊息總數（含仍在 keepRecentN 視窗內的；自動觸發閾值用） */
export function countUncoveredMessages(conv: Conversation): number {
  const coversTs = conv.summaryCoversTs ?? 0
  return conv.messages.filter(m => m.timestamp > coversTs && (m.role === 'user' || m.role === 'character')).length
}

/**
 * 把超出 keepRecentN 視窗、尚未涵蓋的舊訊息與既有摘要濃縮成新摘要（增量式）。
 * 用輔助模型（未啟用分流時 applyUtilitySettings 原樣回傳主模型）。
 * 沒有可摘要的新訊息時回傳 null。
 */
export async function summarizeConversation(params: {
  settings: AppSettings
  conv: Conversation
  persona?: PersonaPreset | null
  speakerNameById?: Record<string, string>
}): Promise<SummarizeConversationResult | null> {
  const { settings, conv, persona, speakerNameById } = params
  const pending = listSummarizableMessages(conv, settings.memory.keepRecentN)
  if (pending.length === 0) return null

  const transcript = pending
    .map(m => `${messageSpeakerLabel(m, persona, speakerNameById)}: ${m.content.trim()}`)
    .join('\n')
  const existing = conv.summary?.trim()
  const userContent = existing
    ? `EXISTING SUMMARY:\n${existing}\n\nNEW LINES:\n${transcript}`
    : `NEW LINES:\n${transcript}`

  const utilitySettings = applyUtilitySettings(settings)
  const result = await chatWithLLM({
    settings: {
      ...utilitySettings,
      llm: { ...utilitySettings.llm, maxResponseTokens: SUMMARY_MAX_TOKENS }
    },
    character: { id: '__summarizer__', name: 'memory', personality: SUMMARIZER_INSTRUCTIONS, emotions: {} },
    messages: [{ id: '__sum', role: 'user', content: userContent, timestamp: Date.now() }],
    persona: null,
    world: null,
    desktopCharacterNames: [],
    isReminder: true,
    minimal: true
  })

  const summary = result.content.trim()
  if (!summary) return null
  return {
    summary,
    coversTs: pending[pending.length - 1].timestamp,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens
  }
}
