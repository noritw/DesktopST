import * as core from '../../core/llm/summarizer'
import { electronHttp } from '../adapters/httpAdapter'
import type { AppSettings, Conversation, PersonaPreset } from '../types'

/**
 * 記憶摘要的桌面端外殼。
 *
 * 邏輯已搬到 `core/llm/summarizer.ts`（逐字相同），這裡只負責注入 HTTP adapter。
 * 對外簽名維持原樣，`ipcHandlers` 一行未改。
 */

export type { SummarizeConversationResult } from '../../core/llm/summarizer'
export { listSummarizableMessages, countUncoveredMessages } from '../../core/llm/summarizer'

export async function summarizeConversation(params: {
  settings: AppSettings
  conv: Conversation
  persona?: PersonaPreset | null
  speakerNameById?: Record<string, string>
}): ReturnType<typeof core.summarizeConversation> {
  return core.summarizeConversation(params, { http: electronHttp })
}
