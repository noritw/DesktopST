import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  buildSystemPrompt, buildTriggerMessage, buildTriggerTimeStr, buildEmotionIdList, parseEmotion, sanitizePromptText, messageSpeakerLabel, resolveApiKey,
  resolveModel, type ChatLLMParams, type ChatLLMResult
} from '../prompt/promptUtils'
import { parseImageRef, mimeTypeFromPath } from './imageRef'
import type { LLMDeps } from './deps'

/**
 * Gemini（Google）provider。
 *
 * 原 `src/main/llm/geminiAdapter.ts`，差異只有本機圖檔那個分支移除
 * （由平台層先轉 data URI，見 `imageRef.ts`）。
 *
 * ⚠️ **這家 SDK 無法注入自訂 fetch**（`@google/generative-ai` v0.21 沒有該選項，
 * 直接呼叫全域 `fetch`），所以 `deps` 收得到卻用不上。
 * 手機端要靠 Capacitor 的全域 fetch patch 才能繞過 CORS——見 `deps.ts` 的表格。
 * 參數仍然收著，是為了讓四家 provider 簽名一致，日後換 SDK 也不必再改一次。
 *
 * ⚠️ 本檔含刻意寫死的中文 prompt 字串（如「（開始對話）」佔位輪次），非 UI 文案。
 *    依 roadmap §3.3 例外條款保留。
 *
 */

type GeminiPart =
  | { text: string }
  | { inlineData: { data: string; mimeType: string } }

function imageToGeminiPart(imgRef: string): GeminiPart {
  const parsed = parseImageRef(imgRef)
  if (parsed.kind === 'data') {
    return { inlineData: { data: parsed.base64, mimeType: parsed.mimeType } }
  }
  if (parsed.kind === 'remote') {
    // 沿用搬移前的行為：遠端圖不下載，只留文字佔位。
    return { text: `[image: ${parsed.url}]` }
  }
  throw new Error(
    `local image path reached core LLM layer (expected platform to pre-resolve): ${parsed.path} [${mimeTypeFromPath(parsed.path)}]`
  )
}

export async function chatWithGemini(params: ChatLLMParams, _deps: LLMDeps): Promise<ChatLLMResult> {
  const { settings, character, messages, images, speakerNameById, persona, world } = params
  const modelName = resolveModel(settings)

  const genAI = new GoogleGenerativeAI(resolveApiKey(settings))
  const systemPrompt = buildSystemPrompt(settings, character, persona, world, params.desktopCharacterNames, params.extraSystemContext, { splitEmotion: params.splitEmotion || params.omitEmotionTag, minimal: params.minimal, omitSystemTime: !params.isReminder, loreBlock: params.loreBlock })

  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt
  })

  // Build Gemini history (all messages except last user message)
  type GeminiHistoryEntry = { role: 'user' | 'model'; parts: GeminiPart[] }
  const history: GeminiHistoryEntry[] = []

  for (const m of messages) {
    const isOwnChar = m.role === 'character' && !!character.id && m.characterId === character.id
    const role: 'user' | 'model' = isOwnChar ? 'model' : 'user'
    const label = messageSpeakerLabel(m, persona, speakerNameById)
    const cleanContent = sanitizePromptText(m.content)
    const text = isOwnChar ? cleanContent : `${label}: ${cleanContent}`

    const parts: GeminiPart[] = []
    if (m.images && m.images.length > 0) {
      for (const img of m.images) parts.push(imageToGeminiPart(img))
    }
    parts.push({ text })

    // Merge consecutive same-role messages (Gemini requires strict alternation)
    const prev = history[history.length - 1]
    if (prev && prev.role === role) {
      prev.parts.push(...parts)
    } else {
      history.push({ role, parts })
    }
  }

  // Separate last user message to send via sendMessage
  // History must end with 'model' (or be empty); last 'user' turn is the current message
  let currentParts: GeminiPart[] = [{ text: '（繼續對話）' }]
  if (history.length > 0 && history[history.length - 1].role === 'user') {
    const last = history.pop()!
    currentParts = last.parts
  }

  // Attach fresh images to current message
  if (images && images.length > 0) {
    currentParts = [...images.map(imageToGeminiPart), ...currentParts]
  }

  // Trigger injected after conversation history (not for reminders)
  if (!params.isReminder) {
    currentParts.push({ text: '\n\n' + buildTriggerMessage(character.name, params.triggerDirective, buildTriggerTimeStr(settings, messages, params.minimal)) })
  }

  // History must start with 'user' for Gemini
  // If first entry is 'model', prepend a placeholder user turn
  if (history.length > 0 && history[0].role === 'model') {
    history.unshift({ role: 'user', parts: [{ text: '（開始對話）' }] })
  }

  const chat = model.startChat({ history })
  const result = await chat.sendMessage(currentParts as any, { signal: params.signal })
  const raw = result.response.text().trim()

  if (!raw) {
    throw new Error(`Empty response from model: ${modelName}`)
  }
  const inputTokens = result.response.usageMetadata?.promptTokenCount
  const outputTokens = result.response.usageMetadata?.candidatesTokenCount

  // 完整記錄實際送出的 prompt（systemInstruction 以 system role 呈現；圖片只留佔位，不存 base64）
  const partText = (p: GeminiPart) => ('text' in p ? p.text : '[image]')
  const debugPrompt = JSON.stringify({
    provider: 'gemini',
    model: modelName,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      ...history.map(h => ({ role: h.role, content: h.parts.map(partText).join('') })),
      { role: 'user', content: currentParts.map(partText).join('') }
    ]
  }, null, 2)

  return { ...parseEmotion(raw, buildEmotionIdList(params.character)), debugPrompt, inputTokens, outputTokens }
}
