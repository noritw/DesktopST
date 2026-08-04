import * as core from '../../core/llm'
import * as coreLore from '../../core/lore/generate'
import { electronHttp } from '../adapters/httpAdapter'
import { resolveLocalImages } from './imageResolver'
import type { AppSettings } from '../types'
import type { LLMTestErrorCode } from '../../core/llm'

/**
 * LLM 層的桌面端外殼。
 *
 * 主流程與四家 provider 已搬到 `core/llm/`（B1 收尾）。這裡只剩三件桌面專屬的事：
 *
 * 1. 注入 `electronHttp`（Node 原生 fetch）
 * 2. 呼叫前把本機圖片路徑讀成 data URI（`imageResolver`）——core 不碰檔案系統
 * 3. 把 core 回傳的錯誤代碼翻成給使用者看的中文（UI 文案不得進 core）
 *
 * 對外簽名與訊息維持原樣，`ipcHandlers` 等呼叫端一行未改。
 */

export { type ChatLLMParams, type ChatLLMResult, applyUtilitySettings } from '../../core/llm'

const deps: core.LLMDeps = { http: electronHttp }

/** core 錯誤代碼 → 中文文案（維持搬移前的字句）。 */
function testErrorMessage(code: LLMTestErrorCode): string {
  return code === 'no-api-key' ? '尚未填寫 API Key' : '尚未填寫模型名稱'
}

export async function chatWithLLM(rawParams: core.ChatLLMParams): Promise<core.ChatLLMResult> {
  return core.chatWithLLM(resolveLocalImages(rawParams), deps)
}

export async function classifyEmotionWithLLM(params: {
  settings: AppSettings
  character: core.PromptCharacter
  reply: string
  signal?: AbortSignal
}): ReturnType<typeof core.classifyEmotionWithLLM> {
  return core.classifyEmotionWithLLM(params, deps)
}

export async function classifyNewsSubjectivityWithLLM(params: {
  settings: AppSettings
  title: string
  summary?: string
}): ReturnType<typeof core.classifyNewsSubjectivityWithLLM> {
  return core.classifyNewsSubjectivityWithLLM(params, deps)
}

/** 從角色卡自動生成一條用語解說（docs/future-lorebook.md §8）。 */
export async function generateLoreEntryForCharacter(
  params: Parameters<typeof coreLore.generateLoreEntryForCharacter>[0]
): ReturnType<typeof coreLore.generateLoreEntryForCharacter> {
  return coreLore.generateLoreEntryForCharacter(params, deps)
}

export async function testLLMConnection(params: {
  provider: string
  apiKey: string
  apiKeys?: Record<string, string>
  endpoint?: string
}): Promise<{ ok: boolean; models?: string[]; error?: string }> {
  const { errorCode, ...rest } = await core.testLLMConnection(params, deps)
  return errorCode ? { ...rest, error: testErrorMessage(errorCode) } : rest
}

export async function testLLMMessage(params: {
  provider: string
  apiKey: string
  apiKeys?: Record<string, string>
  model: string
  endpoint?: string
}): Promise<{ ok: boolean; reply?: string; error?: string }> {
  const { errorCode, ...rest } = await core.testLLMMessage(params, deps)
  return errorCode ? { ...rest, error: testErrorMessage(errorCode) } : rest
}
