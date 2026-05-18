import Anthropic from '@anthropic-ai/sdk'
import fs from 'fs'
import path from 'path'
import {
  buildSystemPrompt, buildTriggerMessage, buildEmotionIdList, parseEmotion, sanitizePromptText, messageSpeakerLabel, resolveApiKey,
  resolveModel, type ChatLLMParams, type ChatLLMResult
} from './promptUtils'

type ClaudeContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } | { type: 'url'; url: string } }

function imageToClaudePart(imgPath: string): ClaudeContentBlock {
  if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
    return { type: 'image', source: { type: 'url', url: imgPath } }
  }
  let base64: string
  let mimeType = 'image/png'
  if (imgPath.startsWith('data:')) {
    const match = imgPath.match(/^data:([^;]+);base64,(.+)$/)
    if (match) {
      mimeType = match[1]
      base64 = match[2]
    } else {
      base64 = imgPath.split(',')[1] ?? ''
    }
  } else {
    const filePath = imgPath.startsWith('file://') ? imgPath.slice(7) : imgPath
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg'
    else if (ext === '.gif') mimeType = 'image/gif'
    else if (ext === '.webp') mimeType = 'image/webp'
    base64 = fs.readFileSync(filePath).toString('base64')
  }
  return { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } }
}

export async function chatWithClaude(params: ChatLLMParams): Promise<ChatLLMResult> {
  const { settings, character, messages, images, speakerNameById, persona, world } = params
  const model = resolveModel(settings)

  const client = new Anthropic({ apiKey: resolveApiKey(settings) })
  const systemPrompt = buildSystemPrompt(settings, character, persona, world, params.desktopCharacterNames, params.extraSystemContext)

  type ClaudeMessage = { role: 'user' | 'assistant'; content: string | ClaudeContentBlock[] }
  const claudeMessages: ClaudeMessage[] = []

  for (const m of messages) {
    const isOwnChar = m.role === 'character' && !!character.id && m.characterId === character.id
    const role: 'user' | 'assistant' = isOwnChar ? 'assistant' : 'user'
    const label = messageSpeakerLabel(m, persona, speakerNameById)
    const cleanContent = sanitizePromptText(m.content)
    const text = isOwnChar ? cleanContent : `【${label}】\n${cleanContent}`

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
  const trigger = buildTriggerMessage(character.name)
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

  const debugPrompt = JSON.stringify({
    provider: 'claude',
    model,
    system: systemPrompt.slice(0, 200) + '...',
    messages: claudeMessages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 100) : `[${(m.content as ClaudeContentBlock[]).length} parts]`
    }))
  }, null, 2)

  const response = await client.messages.create({
    model,
    max_tokens: settings.llm.maxResponseTokens * 3,
    temperature: settings.llm.temperature,
    system: systemPrompt,
    messages: claudeMessages as Anthropic.MessageParam[]
  })

  const raw = response.content
    .filter(b => b.type === 'text')
    .map(b => (b as Anthropic.TextBlock).text)
    .join('\n')
    .trim()

  if (!raw) {
    throw new Error(`Empty response from model: ${model}`)
  }
  return { ...parseEmotion(raw, buildEmotionIdList(params.character)), debugPrompt }
}
