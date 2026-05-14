import { GoogleGenerativeAI } from '@google/generative-ai'
import fs from 'fs'
import path from 'path'
import {
  buildSystemPrompt, buildEmotionIdList, parseEmotion, sanitizePromptText, messageSpeakerLabel, resolveApiKey,
  resolveModel, type ChatLLMParams, type ChatLLMResult
} from './promptUtils'

type GeminiPart =
  | { text: string }
  | { inlineData: { data: string; mimeType: string } }

function imageToGeminiPart(imgPath: string): GeminiPart {
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
  } else if (imgPath.startsWith('http://') || imgPath.startsWith('https://')) {
    // Fetch remote image and convert to base64
    // For now, use a placeholder — remote URLs handled differently
    // In practice this branch is rare; most images are local attachments
    return { text: `[image: ${imgPath}]` }
  } else {
    const filePath = imgPath.startsWith('file://') ? imgPath.slice(7) : imgPath
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg'
    else if (ext === '.gif') mimeType = 'image/gif'
    else if (ext === '.webp') mimeType = 'image/webp'
    base64 = fs.readFileSync(filePath).toString('base64')
  }
  return { inlineData: { data: base64, mimeType } }
}

export async function chatWithGemini(params: ChatLLMParams): Promise<ChatLLMResult> {
  const { settings, character, messages, images, speakerNameById, persona, world } = params
  const modelName = resolveModel(settings)

  const genAI = new GoogleGenerativeAI(resolveApiKey(settings))
  const systemPrompt = buildSystemPrompt(settings, character, persona, world, params.desktopCharacterNames)

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
    const text = isOwnChar ? cleanContent : `【${label}】\n${cleanContent}`

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

  // History must start with 'user' for Gemini
  // If first entry is 'model', prepend a placeholder user turn
  if (history.length > 0 && history[0].role === 'model') {
    history.unshift({ role: 'user', parts: [{ text: '（開始對話）' }] })
  }

  const debugPrompt = JSON.stringify({
    provider: 'gemini',
    model: modelName,
    systemInstruction: systemPrompt.slice(0, 200) + '...',
    historyLength: history.length,
    currentParts: currentParts.length
  }, null, 2)

  const chat = model.startChat({ history })
  const result = await chat.sendMessage(currentParts as any)
  const raw = result.response.text().trim()

  if (!raw) {
    throw new Error(`Empty response from model: ${modelName}`)
  }
  return { ...parseEmotion(raw, buildEmotionIdList(params.character)), debugPrompt }
}
