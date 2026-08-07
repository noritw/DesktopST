import Anthropic from '@anthropic-ai/sdk'
import {
  buildSystemPrompt, buildTriggerMessage, buildTriggerTimeStr, buildEmotionIdList, parseEmotion, sanitizePromptText, messageSpeakerLabel, resolveApiKey,
  resolveModel, type ChatLLMParams, type ChatLLMResult
} from '../prompt/promptUtils'
import { parseImageRef, mimeTypeFromPath } from './imageRef'
import type { LLMDeps } from './deps'

/**
 * Claude（Anthropic）provider。
 *
 * 原 `src/main/llm/claudeAdapter.ts`。與搬移前的差異只有兩處：
 * 1. `fs` / `path` 讀本機圖檔的分支移除——本機路徑由平台層在呼叫前轉成 data URI
 *    （見 `imageRef.ts` 的說明）
 * 2. SDK 注入 `deps.http.fetch`
 *
 * 其餘（訊息合併、交替規則、trigger 附加、debugPrompt 格式）逐字沿用。
 *
 * ⚠️ 本檔含刻意寫死的中文 prompt 字串（如「（開始對話）」佔位輪次），非 UI 文案。
 *    依 roadmap §3.3 例外條款保留。
 *
 */

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }

function imageToClaudePart(imgRef: string): ClaudeContentBlock {
  const parsed = parseImageRef(imgRef)
  if (parsed.kind === 'remote') {
    return { type: 'image', source: { type: 'url', url: parsed.url } }
  }
  if (parsed.kind === 'data') {
    return { type: 'image', source: { type: 'base64', media_type: parsed.mimeType, data: parsed.base64 } }
  }
  // 平台層應該已經把本機路徑轉成 data URI；走到這裡代表漏轉了。
  // 沿用搬移前的行為方向（讀不到就讓呼叫端知道），但不在 core 裡碰檔案系統。
  throw new Error(
    `local image path reached core LLM layer (expected platform to pre-resolve): ${parsed.path} [${mimeTypeFromPath(parsed.path)}]`
  )
}

export async function chatWithClaude(params: ChatLLMParams, deps: LLMDeps): Promise<ChatLLMResult> {
  const { settings, character, messages, images, speakerNameById, persona, world } = params
  const model = resolveModel(settings)

  /*
   * `dangerouslyAllowBrowser` 是手機獨立版的必要條件，不是偷懶。
   *
   * SDK 偵測到 `window` 就拒跑，防的是「網站把金鑰發給瀏覽器、被同頁面的第三方
   * 腳本偷走」。APK 裡的 WebView 只跑我們自己這一份 bundle，沒有第三方腳本，
   * 金鑰是使用者自己的、加密存在本機 Keystore，從不離開裝置（roadmap §2 目標③）。
   * 桌面走主行程沒有 `window`，這個旗標對桌面不生效。
   */
  const client = new Anthropic({
    apiKey: resolveApiKey(settings),
    fetch: deps.http.fetch,
    dangerouslyAllowBrowser: true
  })
  const systemPrompt = buildSystemPrompt(settings, character, persona, world, params.desktopCharacterNames, params.extraSystemContext, { splitEmotion: params.splitEmotion, minimal: params.minimal, omitSystemTime: !params.isReminder, loreBlock: params.loreBlock })

  type ClaudeMessage = { role: 'user' | 'assistant'; content: string | ClaudeContentBlock[] }
  const claudeMessages: ClaudeMessage[] = []

  for (const m of messages) {
    const isOwnChar = m.role === 'character' && !!character.id && m.characterId === character.id
    const role: 'user' | 'assistant' = isOwnChar ? 'assistant' : 'user'
    const label = messageSpeakerLabel(m, persona, speakerNameById)
    const cleanContent = sanitizePromptText(m.content)
    const text = isOwnChar ? cleanContent : `${label}: ${cleanContent}`

    const hasImages = m.images && m.images.length > 0
    let content: string | ClaudeContentBlock[]
    if (hasImages) {
      content = [
        ...m.images!.map(imageToClaudePart),
        { type: 'text' as const, text }
      ]
    } else {
      content = text
    }

    // Merge consecutive same-role messages
    const prev = claudeMessages[claudeMessages.length - 1]
    if (prev && prev.role === role) {
      if (typeof prev.content === 'string' && typeof content === 'string') {
        prev.content = prev.content + '\n\n' + content
      } else {
        const prevParts: ClaudeContentBlock[] = typeof prev.content === 'string'
          ? [{ type: 'text', text: prev.content }]
          : prev.content
        const newParts: ClaudeContentBlock[] = typeof content === 'string'
          ? [{ type: 'text', text: content }]
          : content
        prev.content = [...prevParts, ...newParts]
      }
    } else {
      claudeMessages.push({ role, content })
    }
  }

  // Attach fresh images to last user message
  if (images && images.length > 0 && claudeMessages.length > 0) {
    for (let i = claudeMessages.length - 1; i >= 0; i--) {
      if (claudeMessages[i].role === 'user') {
        const existing = claudeMessages[i].content
        const textPart: ClaudeContentBlock = {
          type: 'text',
          text: typeof existing === 'string' ? existing : (existing as ClaudeContentBlock[]).filter(p => p.type === 'text').map(p => (p as { type: 'text'; text: string }).text).join('\n')
        }
        claudeMessages[i].content = [
          ...images.map(imageToClaudePart),
          textPart
        ]
        break
      }
    }
  }

  // Claude requires alternating user/assistant and must start with user
  if (claudeMessages.length === 0 || claudeMessages[0].role !== 'user') {
    claudeMessages.unshift({ role: 'user', content: '（開始對話）' })
  }

  // Append trigger to last user message (Claude requires strict alternation, cannot add a new user turn)
  // Skip trigger for reminders (no instruction injection)
  if (!params.isReminder) {
    const trigger = buildTriggerMessage(character.name, params.triggerDirective, buildTriggerTimeStr(settings, messages, params.minimal))
    const lastMsg = claudeMessages[claudeMessages.length - 1]
    if (lastMsg?.role === 'user') {
      if (typeof lastMsg.content === 'string') {
        lastMsg.content = lastMsg.content + '\n\n' + trigger
      } else {
        ;(lastMsg.content as ClaudeContentBlock[]).push({ type: 'text', text: '\n\n' + trigger })
      }
    } else {
      claudeMessages.push({ role: 'user', content: trigger })
    }
  }

  const response = await client.messages.create({
    model,
    max_tokens: settings.llm.maxResponseTokens * 3,
    temperature: settings.llm.temperature,
    system: systemPrompt,
    messages: claudeMessages as Anthropic.MessageParam[]
  }, { signal: params.signal })

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as Anthropic.TextBlock).text)
    .join('\n')
    .trim()

  if (!raw) {
    throw new Error(`Empty response from model: ${model}`)
  }
  const inputTokens = response.usage?.input_tokens
  const outputTokens = response.usage?.output_tokens

  // 完整記錄實際送出的 prompt（system 以 system role 呈現；圖片只留佔位，不存 base64）
  const debugPrompt = JSON.stringify({
    provider: 'claude',
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      ...claudeMessages.map(m => ({
        role: m.role,
        content: typeof m.content === 'string'
          ? m.content
          : (m.content as ClaudeContentBlock[]).map(p =>
              p.type === 'text' ? { type: 'text', text: (p as { type: 'text'; text: string }).text } : { type: 'image' }
            )
      }))
    ]
  }, null, 2)

  return { ...parseEmotion(raw, buildEmotionIdList(params.character)), debugPrompt, inputTokens, outputTokens }
}
