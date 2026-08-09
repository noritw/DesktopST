import { chatWithLLM } from '@core/llm'
import type { PlatformAdapters } from '@core/adapters'
import { stripOtherCharacterSpeakerLines } from '@core/group/dialogueCleanup'
import { normalizeCharacterDialogue } from '@core/prompt/dialogue'
import { messageLlmMeta } from '@core/prompt/promptUtils'
import { getWeatherContextString } from '@core/weather'
import type { Lorebook } from '@core/lore'
import type {
  Character,
  Conversation,
  Message,
  PersonaPreset,
  Reminder,
  ScenePreset,
  WorldPreset
} from '@core/types'
import type { LocalEventSource } from '../events/localEventSource'
import { buildLoreBlockFor } from './chat'
import { newId } from './id'
import { contextMessages } from './messages'

/**
 * 提醒觸發時的「角色發話」（獨立模式）。
 *
 * ⚠️ **提醒不是行事曆通知**。桌面版
 * （`ipcHandlers.ts` 的 `triggerReminderSpeak`）從來就是把提醒內容當成
 * **給角色的指令**餵進 LLM，讓角色用自己的口吻講出來；使用者要的是
 * 「角色提醒我」而不是「一則寫著我自己打的字的通知」。
 * 這支就是那條路徑的獨立版，措辭刻意與桌面逐字對齊 ——
 * 同一則提醒在兩台裝置聽起來不一樣的話，就等於兩套人格。
 *
 * 獨立版沒有的注入（便利貼／日曆／新聞）直接略過，不是 bug；
 * 天氣兩邊共用 `core/weather`，所以有接。
 *
 * 回傳實際講出來的那句話給排程器當通知內容；
 * 沒有可發話的角色時回 `null`（呼叫端就不要發通知）。
 */
export interface ReminderSpeakResult {
  characterId: string
  characterName: string
  text: string
}

export async function speakStandaloneReminder(opts: {
  adapters: PlatformAdapters
  events: LocalEventSource
  settings: import('@core/types').AppSettings
  characters: Character[]
  getActiveConversation: () => Conversation | null
  saveConversation: (conv: Conversation) => Promise<void>
  getPersona: () => PersonaPreset | null
  getWorld: () => WorldPreset | null
  getActiveScene: () => ScenePreset | null
  loadLorebook: (id: string) => Promise<Lorebook | null>
  reminder: Reminder
}): Promise<ReminderSpeakResult | null> {
  const { reminder, settings } = opts
  const charById = (id: string): Character | undefined => opts.characters.find((c) => c.id === id)

  // ── 挑發話角色 ─────────────────────────────────────────
  // 指定的角色還在 → 用它；被刪掉或沒指定 → 從未禁言的在場角色隨機挑。
  // （桌面另有「替補訊息」提示被刪角色的名字，但角色都刪了也拿不到名字，
  //   那段在桌面實際上也不會成立，這裡不照抄。）
  let charId = reminder.characterId
  if (charId && !charById(charId)) charId = undefined
  if (!charId) {
    const candidates = settings.ui.desktopCharacters
      .filter((d) => !d.muted)
      .map((d) => d.characterId)
      .filter((id) => charById(id))
    if (candidates.length === 0) return null
    charId = candidates[Math.floor(Math.random() * candidates.length)]
  }

  const char = charById(charId)
  const conv = opts.getActiveConversation()
  if (!char || !conv) return null

  // ── 組 context（順序與桌面一致）─────────────────────────
  const ctxParts: string[] = []

  if (conv.messages.length === 0 && char.firstMessage?.trim()) {
    ctxParts.push(`[角色開場白]\n${char.firstMessage.trim()}\n\n請基於這個開場白的人格和語氣，自由發揮回應。`)
  }
  if (reminder.prompt?.trim()) {
    ctxParts.push(`[提醒指令]\n${reminder.prompt.trim()}`)
  }

  if (reminder.injectWeather) {
    const weatherStr = await getWeatherContextString(settings, { http: opts.adapters.http })
    if (weatherStr) ctxParts.push(weatherStr)
  }

  const reminderMessages = reminder.injectConversationContext
    ? contextMessages(conv.messages, settings.memory.keepRecentN)
    : []
  if (reminder.injectConversationContext && reminderMessages.length > 0) {
    ctxParts.push('[近期對話紀錄]\n以下僅供參考語境；不要長篇接續聊天。')
  }

  if (reminder.prompt?.trim()) {
    ctxParts.push(
      '[發話重點]\n這次主要是要把上面的「提醒指令」用你自己的個性講出來；天氣如果有，只是順帶提及、別喧賓奪主。換個新鮮的開場，別跟你最近說過的雷同。'
    )
  }

  const presentNames = settings.ui.desktopCharacters
    .map((d) => charById(d.characterId)?.name ?? '')
    .filter(Boolean)
  if (presentNames.length > 0) {
    ctxParts.push(
      ['[Desktop Characters]', `- ${char.name} (you)`, ...presentNames.filter((n) => n !== char.name).map((n) => `- ${n}`)].join('\n')
    )
  }

  const extraSystemContext = ctxParts.join('\n\n') || undefined
  const hasApiKey = !!settings.llm.apiKeys[settings.llm.provider]?.trim()

  // ── 沒有 API Key：退回提醒原文（與桌面同樣的離線行為）──
  if (!hasApiKey) {
    const fallback = reminder.prompt?.trim() || `📢 ${reminder.label || '提醒'}`
    const msg = await appendReminderMessage(opts, conv, { characterId: char.id, content: fallback })
    return { characterId: char.id, characterName: char.name, text: msg.content }
  }

  opts.events.push({ kind: 'thinking', characterId: char.id })
  try {
    const world = opts.getWorld()
    const { content, emotion, debugPrompt, inputTokens, outputTokens } = await chatWithLLM(
      {
        settings,
        character: char,
        messages: reminderMessages,
        speakerNameById: Object.fromEntries(opts.characters.map((c) => [c.id, c.name])),
        persona: opts.getPersona(),
        world,
        desktopCharacterNames: [],
        extraSystemContext,
        memorySummary: reminder.injectConversationContext ? conv.summary : undefined,
        loreBlock: await buildLoreBlockFor(
          char,
          world,
          opts.getActiveScene(),
          {
            summary: reminder.injectConversationContext ? conv.summary : undefined,
            recentContents: reminderMessages.map((m) => m.content ?? '')
          },
          opts.loadLorebook,
          new Map()
        ),
        isReminder: true,
        omitEmotionTag: true
      },
      { http: opts.adapters.http }
    )

    const reply = stripOtherCharacterSpeakerLines(
      normalizeCharacterDialogue(content, char),
      char.id,
      opts.characters
    )
    if (!reply) {
      opts.events.push({ kind: 'thinking-done', characterId: char.id })
      return null
    }

    const llm = messageLlmMeta(debugPrompt, settings)
    const msg = await appendReminderMessage(opts, conv, {
      characterId: char.id,
      content: reply,
      llmProvider: llm.provider,
      llmModel: llm.model,
      debugPrompt,
      emotion,
      inputTokens,
      outputTokens,
      hasDebugPrompt: !!debugPrompt
    })
    opts.events.push({ kind: 'thinking-done', characterId: char.id })
    return { characterId: char.id, characterName: char.name, text: msg.content }
  } catch (e) {
    opts.events.push({ kind: 'thinking-done', characterId: char.id })
    console.error('[Reminder] 角色發話失敗:', e)
    /*
     * 發話失敗**不要**靜靜吞掉——提醒的重點是使用者要被提醒到。
     * 退回提醒原文，至少該響的還是會響（比照無 API Key 的路徑）。
     */
    const fallback = reminder.prompt?.trim() || `📢 ${reminder.label || '提醒'}`
    const msg = await appendReminderMessage(opts, conv, { characterId: char.id, content: fallback })
    return { characterId: char.id, characterName: char.name, text: msg.content }
  }
}

async function appendReminderMessage(
  opts: {
    events: LocalEventSource
    saveConversation: (conv: Conversation) => Promise<void>
  },
  conv: Conversation,
  fields: Omit<Message, 'id' | 'role' | 'timestamp'> & { characterId: string }
): Promise<Message> {
  const msg: Message = {
    id: newId(),
    role: 'character',
    timestamp: Date.now(),
    ...fields
  }
  conv.messages.push(msg)
  conv.updatedAt = Date.now()
  await opts.saveConversation(conv)
  opts.events.push({ kind: 'message', message: msg })
  return msg
}
