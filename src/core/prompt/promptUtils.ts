import type { AppSettings, Message, PersonaPreset, WorldPreset } from '../types'
import { stemFromFilename, buildSpriteIdMap } from '../character/emotionCatalog'

/** Returns the API key for the active provider, falling back to legacy apiKey field */
/**
 * 這個供應商需不需要 API Key。
 *
 * `local`（使用者自架的 OpenAI 相容端點）不需要——多數本地伺服器沒有 auth，
 * 逼使用者填一把假的只會讓人以為自己設定錯了。
 */
export function providerNeedsApiKey(provider: string): boolean {
  return provider !== 'local'
}

/**
 * 「現在能不能發請求」。**所有擋在 LLM 呼叫前面的檢查都要用這支**，
 * 不要各自寫 `apiKeys[provider]?.trim()`——那樣寫的地方目前有十幾處，
 * 漏掉任何一處，本機模型就會在那條路徑上被擋下並顯示
 * 「尚未設定 API Key」（而使用者根本不需要金鑰，訊息本身就是錯的）。
 */
export function hasUsableApiKey(settings: AppSettings): boolean {
  if (!providerNeedsApiKey(settings.llm.provider)) return true
  return !!settings.llm.apiKeys?.[settings.llm.provider]?.trim()
}

export function resolveApiKey(settings: AppSettings): string {
  const key = settings.llm.apiKeys?.[settings.llm.provider] || settings.llm.apiKey || ''
  // 自架端點通常不驗金鑰，但 OpenAI SDK 不接受空字串。塞個 placeholder，
  // 伺服器一律忽略；使用者若真的設了金鑰（LiteLLM、有 auth 的反向代理）照樣走上面。
  if (!key && settings.llm.provider === 'local') return 'local'
  return key
}

/** Returns the model for the active provider, falling back to the legacy single model field */
export function resolveModel(settings: AppSettings): string {
  return settings.llm.models?.[settings.llm.provider] || settings.llm.model || ''
}

/** Parse provider/model recorded in a debugPrompt JSON blob (actual API call). */
export function parseDebugPromptLlmMeta(debugPrompt?: string): {
  provider?: AppSettings['llm']['provider']
  model?: string
} | null {
  if (!debugPrompt?.trim()) return null
  try {
    const obj = JSON.parse(debugPrompt) as { provider?: string; model?: string }
    const provider = obj.provider as AppSettings['llm']['provider'] | undefined
    const model = typeof obj.model === 'string' ? obj.model.trim() : undefined
    if (!provider && !model) return null
    return { provider, model }
  } catch {
    return null
  }
}

/** Prefer debugPrompt metadata; fall back to the settings snapshot passed into chatWithLLM. */
export function messageLlmMeta(
  debugPrompt: string | undefined,
  chatSettings: AppSettings
): { provider: AppSettings['llm']['provider']; model: string } {
  const parsed = parseDebugPromptLlmMeta(debugPrompt)
  if (parsed?.provider || parsed?.model) {
    return {
      provider: parsed?.provider ?? chatSettings.llm.provider,
      model: parsed?.model || resolveModel(chatSettings)
    }
  }
  return {
    provider: chatSettings.llm.provider,
    model: resolveModel(chatSettings)
  }
}

export const EMOTION_LIST = [
  'admiration', 'amusement', 'anger', 'annoyance', 'approval',
  'caring', 'confusion', 'curiosity', 'desire', 'disappointment',
  'disapproval', 'disgust', 'embarrassment', 'excitement', 'fear',
  'gratitude', 'grief', 'joy', 'love', 'nervousness',
  'optimism', 'pride', 'realization', 'relief', 'remorse',
  'sadness', 'surprise', 'neutral'
]

const EMOTION_ALIASES: Record<string, string> = {
  admire: 'admiration',
  admired: 'admiration',
  amused: 'amusement',
  angry: 'anger',
  annoyed: 'annoyance',
  approving: 'approval',
  caring: 'caring',
  confused: 'confusion',
  curious: 'curiosity',
  disappointed: 'disappointment',
  disapproving: 'disapproval',
  disgusted: 'disgust',
  embarrassed: 'embarrassment',
  excited: 'excitement',
  fearful: 'fear',
  afraid: 'fear',
  grateful: 'gratitude',
  grieving: 'grief',
  joyful: 'joy',
  loving: 'love',
  nervous: 'nervousness',
  optimistic: 'optimism',
  proud: 'pride',
  realized: 'realization',
  relieved: 'relief',
  remorseful: 'remorse',
  sad: 'sadness',
  surprised: 'surprise',
  calm: 'neutral',
  normal: 'neutral'
}

export function normalizeEmotion(raw: string | undefined | null): string | null {
  const normalized = String(raw ?? '').trim().toLowerCase()
  if (EMOTION_LIST.includes(normalized)) return normalized
  return EMOTION_ALIASES[normalized] ?? null
}

export type PromptCharacter = {
  id?: string
  name: string
  nicknames?: string[]
  description?: string
  personality: string
  scenario?: string
  systemPromptOverride?: string
  exampleDialogue?: string
  creatorNotes?: string
  emotions?: Record<string, string>
  spriteIds?: Record<string, string>
}

export type ChatLLMParams = {
  settings: AppSettings
  character: PromptCharacter
  messages: Message[]
  images?: string[]
  speakerNameById?: Record<string, string>
  persona?: PersonaPreset | null
  world?: WorldPreset | null
  desktopCharacterNames?: string[]
  /** 附加到 system prompt 末尾的額外上下文（提醒指令、便利貼等） */
  extraSystemContext?: string
  /** 記憶摘要（conv.summary）；chatWithLLM 單一入口注入為 [Memory Summary] 區塊 */
  memorySummary?: string
  /**
   * 用語解說注入區塊（`formatLoreBlock()` 的結果，已含 `[Glossary]` 標籤）。
   * 由平台層掃描後傳入；空字串／未給＝完全不注入（docs/future-lorebook.md §6.1）。
   */
  loreBlock?: string
  /** 是否為提醒模式（不注入 trigger message） */
  isReminder?: boolean
  /** 附加在 trigger message 之後的指令（最末、緊鄰生成處；用於「主動聊新聞」這類需要高 recency 的指示） */
  triggerDirective?: string
  /** 是否省略情緒輸出合約（由後續獨立情緒分類呼叫處理） */
  splitEmotion?: boolean
  /**
   * 呼叫端根本不需要情緒標籤，省略情緒輸出合約。
   *
   * 與 `splitEmotion` 的差別在於**沒有**後續的分類呼叫：手機獨立版是單張主圖、
   * 不做表情差分，情緒合約（表情 id 清單＋逐項說明）送出去也沒有東西會用，
   * 只是白花 token。角色卡帶著表情圖時那段可能長達數十行。
   */
  omitEmotionTag?: boolean
  /** 輕量工具 call（意圖萃取等）：跳過角色扮演規則、輸出格式、系統時間、輸入來源等與角色扮演相關的段落 */
  minimal?: boolean
  /** 可用於中途取消本次 LLM 請求 */
  signal?: AbortSignal
}

export type ChatLLMResult = {
  content: string
  emotion: string
  debugPrompt: string
  inputTokens?: number
  outputTokens?: number
}

/** 使用者對角色訊息按的 reaction → 注入 prompt 的英文語意標籤（省 token；不影響輸出語言）。 */
const REACTION_PROMPT_LABELS: Record<string, string> = {
  '❤️': 'loved it',
  '👍': 'acknowledged / agrees',
  '😂': 'found it funny',
  '🥺': 'touched by it',
  '😮': 'surprised',
  '😒': 'unimpressed'
}

/**
 * 把帶有 reaction 的角色訊息展開：在其後插入一則合成的使用者訊息，
 * 讓角色知道使用者對哪句話按了什麼表情。沒有任何 reaction 時原陣列直接回傳。
 * 😒 + 新聞訊息時改用「對這則新聞主題沒興趣」措辭，避免角色誤會是針對自己。
 */
export function expandReactionAnnotations(messages: Message[]): Message[] {
  if (!messages.some(m => m.role === 'character' && m.reaction)) return messages
  const result: Message[] = []
  for (const m of messages) {
    result.push(m)
    if (m.role !== 'character' || !m.reaction) continue
    const label = REACTION_PROMPT_LABELS[m.reaction] ?? ''
    const note = m.reaction === '😒' && m.newsLink
      ? `(reacted ${m.reaction} to the message above — not interested in this news topic, drop it naturally)`
      : `(reacted ${m.reaction} to the message above${label ? ` — ${label}` : ''})`
    result.push({ id: `${m.id}:reaction`, role: 'user', content: note, timestamp: m.timestamp })
  }
  return result
}

/**
 * 使用者訊息若掛了 newsLink：聊天 UI 只存標題，Prompt 需補上 promptContext。
 * 角色訊息的新聞背景在發話當下已由 system context 注入，這裡不重寫角色 content。
 */
export function expandNewsLinkForPrompt(messages: Message[]): Message[] {
  if (!messages.some(m => m.role === 'user' && m.newsLink)) return messages
  return messages.map(m => {
    if (m.role !== 'user' || !m.newsLink) return m
    const link = m.newsLink
    // ⚠️ 空字串與 undefined **意義不同**：`''` 是使用者按了「清除摘要」，
    // `undefined` 是從來沒整理過（那時仍該退回 summary）。
    // 所以這裡是 `??` 不是 `||`——寫成 falsy 判斷的話清除按鈕等於沒作用。
    const pc = (link.promptContext ?? link.summary ?? '').trim()
    const title = (link.title || m.content).trim()
    if (!title && !pc) return m

    // 摘要被清空＝「這則聊過了，留個紀錄就好」（owner 2026-08-12）。
    // 只留一行標題，**來源與說明句都不要**：角色當時的回覆本來就還在對話裡，
    // 脈絡不缺；而指著不存在的 Details 說「用上面的背景」只會讓模型自己編。
    // 之後按「重新摘要」把 promptContext 補回來，下面的完整格式就會回來。
    const lines = pc
      ? [
          '[Sharing a news item with you]',
          ...(title ? [`Title: ${title}`] : []),
          ...(pc !== title ? [`Details: ${pc}`] : []),
          ...(link.source ? [`Source: ${link.source}`] : []),
          '',
          '(The chat bubble only shows the title; use the Details above as background. Reply in character.)'
        ]
      : [`[Shared News] ${title}`]

    // 若使用者在標題外還打了別的字，保留在後面
    const extra = m.content.trim()
    const body = extra && extra !== title ? `${lines.join('\n')}\n\n${extra}` : lines.join('\n')
    return { ...m, content: body }
  })
}

/** 間隔超過這個值才標註時間斷層（訊息之間、以及最後一則到現在） */
const TIME_GAP_ANNOTATE_MS = 60 * 60 * 1000

/** 粗略時距字串（"6h" / "2d"）——模型只需要斷層感，不需要精確值 */
function formatTimeGap(ms: number): string {
  const hours = Math.round(ms / 3_600_000)
  if (hours < 48) return `${hours}h`
  return `${Math.round(ms / 86_400_000)}d`
}

/** 相鄰訊息間隔超過 1 小時時，插入 "(6h later)" 系統標註讓角色知道對話有時間斷層。 */
export function annotateTimeGaps(messages: Message[]): Message[] {
  const result: Message[] = []
  let prevTs: number | undefined
  for (const m of messages) {
    if (prevTs !== undefined && m.timestamp - prevTs >= TIME_GAP_ANNOTATE_MS) {
      result.push({
        id: `${m.id}:timegap`,
        role: 'system',
        content: `(${formatTimeGap(m.timestamp - prevTs)} later)`,
        timestamp: m.timestamp
      })
    }
    result.push(m)
    prevTs = m.timestamp
  }
  return result
}

export function sanitizePromptText(text: string | undefined | null): string {
  return String(text ?? '')
    .replace(/\[object Object\]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function applyStStyleTags(
  text: string | undefined | null,
  vars: { userName: string; charName: string }
): string {
  const clean = sanitizePromptText(text)
  return clean
    .replace(/\{\{\s*user\s*\}\}/gi, vars.userName)
    .replace(/\{\{\s*char\s*\}\}/gi, vars.charName)
}

/**
 * Builds the emotion ID list for the Output Contract.
 * If the character has sprites with assigned emotions, returns custom IDs with descriptions.
 * Otherwise returns the default 28-emotion list string.
 */
export function buildEmotionContract(char: PromptCharacter): { ids: string; descriptions: string[] } {
  const emotions = char.emotions ?? {}
  const spriteIds = char.spriteIds ?? {}

  // Group emotions by imagePath
  const pathToEmotions = new Map<string, string[]>()
  for (const [emo, p] of Object.entries(emotions)) {
    if (!p?.trim()) continue
    const list = pathToEmotions.get(p) ?? []
    list.push(emo)
    pathToEmotions.set(p, list)
  }

  if (pathToEmotions.size === 0) {
    return { ids: EMOTION_LIST.join(', '), descriptions: [] }
  }

  const entries: { id: string; emotions: string[] }[] = []
  for (const [imagePath, assignedEmotions] of pathToEmotions) {
    const filename = imagePath.split(/[/\\]/).pop() ?? imagePath
    const id = spriteIds[imagePath]?.trim() || stemFromFilename(filename)
    entries.push({ id, emotions: assignedEmotions })
  }

  const ids = entries.map(e => e.id).join(', ')
  const descriptions = entries.map(e => `  - ${e.id}: use for ${e.emotions.join(', ')}`)
  return { ids, descriptions }
}

/**
 * 把模型回傳的情緒 id（可能是 `buildEmotionContract()` 給的自訂 id／檔名主幹，
 * 也可能剛好就是 canonical 的 28 個情緒 key）換算回 canonical key，再存進
 * `message.emotion`。
 *
 * ⚠️ **這是手機獨立版／遙控版聊天記錄同步之後才會踩到的坑**（2026-08-23
 * owner 實機回報：遙控版剛發的訊息表情正常，同步到本機版之後同一則卻變
 * 沒有表情，要在本機版再發一則新的才又正常）。成因：自訂 id／檔名主幹是
 * **裝置本地的**——同一個情緒圖片在兩台裝置上各自存檔案，檔名／自訂 id
 * 不保證一樣（獨立版存檔用 `<key>-<timestamp>.ext`，桌面版可能是另一個
 * 時間戳或另一個自訂 id）。如果 `message.emotion` 直接存這個裝置本地 id，
 * 同一則訊息換一台裝置檢視、用**那一台自己的** `character.emotions`／
 * `spriteIds` 反查，字串對不上，永遠會判定「沒對到表情」退回主圖——即使
 * 那台裝置的角色卡明明也有同一個情緒的圖。
 *
 * 修法：**訊息一落地就把 id 換成 canonical key 存**（canonical key 是
 * `EMOTION_OPTIONS` 那 28 個固定英文字，兩邊永遠一致，不依賴檔名／自訂 id），
 * 換裝置檢視時 `resolveDisplayImagePath()` 的第一層（`emotions[emotion]`）
 * 就能直接命中該裝置自己指派的圖，不需要靠會漂移的自訂 id 去反查。
 */
export function canonicalizeEmotionId(char: PromptCharacter, id: string): string {
  const emotions = char.emotions ?? {}
  if (emotions[id]?.trim()) return id
  const imagePath = buildSpriteIdMap(emotions, char.spriteIds).get(id)
  if (!imagePath) return id
  const canonicalKey = Object.entries(emotions).find(([, p]) => p === imagePath)?.[0]
  return canonicalKey ?? id
}

export function buildTimeMoodGuideline(hours: number): string {
  if (hours < 5) return 'Late night / early morning — tone may lean toward companionship and tenderness.'
  if (hours < 8) return 'Early morning — naturally reference waking up or not having slept.'
  if (hours < 11) return 'Morning — tone may reflect the start of a new day.'
  if (hours < 14) return 'Around noon / lunchtime — can naturally mention meals or taking a break.'
  if (hours < 18) return 'Afternoon — tone may reflect being mid-day or busy with routine.'
  if (hours < 22) return 'Evening — tone may lean toward winding down, relaxing, or spending time together.'
  return 'Late evening (around 10–11 PM) — tone may relax slightly, but keep it natural.'
}

// 自訂 sprite id 常含時間戳數字（如 1779213835889_KT_rpg_default）；不可只吃字母。
const EMOTION_TOKEN = /[a-z0-9_一-鿿㐀-䶿]+/i

/** Returns the flat list of effective emotion IDs for a character (used to parse bare CJK tags). */
export function buildEmotionIdList(char: PromptCharacter): string[] {
  const { ids } = buildEmotionContract(char)
  return ids.split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * knownEmotionIds — pass the character's sprite ID list so bare CJK tags on their own line
 * (e.g. "閉眼臉紅\n...") can be identified and stripped. Without this list the function will
 * not attempt to parse bare CJK tokens (safe fallback).
 */
export function parseEmotion(text: string, knownEmotionIds?: string[]): { emotion: string; content: string } {
  const source = sanitizePromptText(text)
  let detectedEmotion = 'neutral'
  let content = source

  for (let i = 0; i < 3; i++) {
    const before = content

    // Match "[amused]" or "[emotion: 微笑]" etc.
    const bracketRe = new RegExp(
      `^\\s*\\[\\s*(?:(?:emotion|mood|feeling|情緒)\\s*[:=：]\\s*)?(${EMOTION_TOKEN.source})\\s*\\]\\s*`,
      'i'
    )
    const bracketMatch = content.match(bracketRe)
    if (bracketMatch) {
      const raw = bracketMatch[1]
      detectedEmotion = normalizeEmotion(raw) ?? raw
      content = content.slice(bracketMatch[0].length).trim()
      continue
    }

    // Match "emotion: xxx" or "emotion: 微笑" on the first line.
    const kvRe = new RegExp(
      `^\\s*(?:emotion|mood|feeling|情緒)\\s*[:=：]\\s*(${EMOTION_TOKEN.source})\\s*(?:\\r?\\n|$)`,
      'i'
    )
    const kvMatch = content.match(kvRe)
    if (kvMatch) {
      const raw = kvMatch[1]
      detectedEmotion = normalizeEmotion(raw) ?? raw
      content = content.slice(kvMatch[0].length).trim()
      continue
    }

    // Match a bare leading ASCII emotion token (e.g. "amused會。") — intentionally no CJK
    // to avoid consuming the start of Chinese dialogue.
    const bareMatch = content.match(/^\s*([a-z_]+)(?=$|[\s:=,，.。!！?？;；\-]|[㐀-鿿])/i)
    const bareEmotion = normalizeEmotion(bareMatch?.[1])
    if (bareMatch && bareEmotion) {
      detectedEmotion = bareEmotion
      content = content
        .slice(bareMatch[0].length)
        .replace(/^\s*[:=,，.。!！?？;；\-]?\s*/, '')
        .trim()
      continue
    }

    // Match a bare CJK-only token on its own line — only when it exactly matches a known sprite ID.
    // No heuristic fallback to avoid accidentally stripping the start of Chinese dialogue.
    if (knownEmotionIds && knownEmotionIds.length > 0) {
      const bareCjkMatch = content.match(/^\s*([一-鿿㐀-䶿]{1,12})\s*(?:\r?\n)/)
      if (bareCjkMatch && knownEmotionIds.includes(bareCjkMatch[1])) {
        detectedEmotion = bareCjkMatch[1]
        content = content.slice(bareCjkMatch[0].length).trim()
        continue
      }
    }

    if (content === before) break
  }

  return {
    emotion: detectedEmotion,
    content: content || source
  }
}

export function messageSpeakerLabel(
  message: Message,
  persona?: PersonaPreset | null,
  speakerNameById?: Record<string, string>
): string {
  if (message.role === 'user') {
    return persona?.displayName?.trim() || persona?.nickname?.trim() || '使用者'
  }
  if (message.role === 'character') {
    return (message.characterId && speakerNameById?.[message.characterId]) || '其他角色'
  }
  return '系統'
}

/** Returns settings with the utility provider/model substituted in (reminders, emotion classify). */
export function applyUtilitySettings(settings: AppSettings): AppSettings {
  if (!settings.llm.utilityEnabled) return settings
  const utilityProvider = settings.llm.utilityProvider ?? settings.llm.provider
  const utilityModel = settings.llm.utilityModels?.[utilityProvider] ?? ''
  return {
    ...settings,
    llm: {
      ...settings.llm,
      provider: utilityProvider,
      models: {
        ...(settings.llm.models ?? {}),
        [utilityProvider]: utilityModel
      },
      // 端點跟著 provider 走：主模型與輔助模型共用 `endpoints` 表，換 provider
      // 就自然換到那家的端點，這是「主＝雲端／輔助＝本機」成立的機制。
      // ⚠️ 舊的單一 `endpoint` 欄位必須清掉——否則主模型的端點會被輔助模型沿用，
      // 拿著雲端 URL 去找本機模型（或反過來）。
      endpoint: settings.llm.endpoints?.[utilityProvider]
    }
  }
}

/** Minimal system prompt for a single emotion-classification call. */
export function buildEmotionClassifierSystemPrompt(char: PromptCharacter): string {
  const { ids: emotionIds, descriptions: emotionDescs } = buildEmotionContract(char)
  const lines = [
    'You are an emotion classifier for a visual novel character.',
    `Given a reply by "${char.name}", output ONLY the single emotion ID that best fits the reply.`,
    `Valid IDs: ${emotionIds}`
  ]
  if (emotionDescs.length > 0) lines.push(`Guide:\n${emotionDescs.join('\n')}`)
  lines.push('Output the ID and nothing else.')
  return lines.join('\n')
}

/**
 * Minimal system prompt for rating how subjective/emotionally loaded a news headline's WORDING reads
 * (not whether the underlying claim is true). Debug-only signal — never used to filter or alter tone.
 */
export function buildNewsSubjectivityClassifierSystemPrompt(): string {
  return [
    'You are a news headline analyst.',
    "Rate how subjective, emotionally loaded, or one-sided the WORDING of the given headline (and summary, if any) is — not whether the claim itself is true or important.",
    '0 = purely factual, neutral wording. 5 = strongly opinionated, emotionally charged, or one-sided framing.',
    'Reply with ONLY a single digit (0, 1, 2, 3, 4, or 5), then a "|" character, then a short reason written in Traditional Chinese (under 20 characters). Do not add any other words, labels, brackets, or punctuation.',
    'Example output (copy this exact shape, but with your own digit and reason):',
    '2|語氣中性，僅敘述事實',
    '3|用詞稍帶評價意味'
  ].join('\n')
}

/** Formats the current local time as "YYYY-MM-DD HH:mm 時段"（e.g. "2026-07-05 14:03 下午"）. */
export function formatSystemTimeStr(): string {
  const now = new Date()
  const hours = now.getHours()
  const timeLabel =
    hours < 5 ? '深夜' : hours < 8 ? '清晨' : hours < 12 ? '上午' :
    hours < 13 ? '中午' : hours < 18 ? '下午' : hours < 19 ? '傍晚' :
    hours < 23 ? '晚上' : '深夜'
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(hours).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} ${timeLabel}`
}

export function buildSystemPrompt(
  settings: AppSettings,
  char: PromptCharacter,
  persona?: PersonaPreset | null,
  world?: WorldPreset | null,
  desktopCharacterNames?: string[],
  extraSystemContext?: string,
  opts?: { splitEmotion?: boolean; minimal?: boolean; omitSystemTime?: boolean; loreBlock?: string }
): string {

  const displayName = sanitizePromptText(persona?.displayName) || '使用者'
  const nickname = sanitizePromptText(persona?.nickname) || displayName
  const tagVars = {
    userName: nickname || displayName,
    charName: sanitizePromptText(char.name) || '角色'
  }

  const override = applyStStyleTags(char.systemPromptOverride, tagVars)
  const description = applyStStyleTags(char.description, tagVars)
  const personality = applyStStyleTags(char.personality, tagVars)
  const scenario = applyStStyleTags(char.scenario, tagVars)
  const exampleDialogue = applyStStyleTags(char.exampleDialogue, tagVars)
  const creatorNotes = applyStStyleTags(char.creatorNotes, tagVars)
  const worldSetting = applyStStyleTags(world?.worldSetting, tagVars)
  const interactionExample = applyStStyleTags(world?.interactionExample, tagVars)
  const nicknames = (char.nicknames ?? [])
    .map(n => sanitizePromptText(n))
    .filter(Boolean)

  const others = (desktopCharacterNames ?? []).filter(n => n !== char.name)
  const isGroup = others.length > 0

  const { ids: emotionIds, descriptions: emotionDescs } = buildEmotionContract(char)
  const hasCustomSprites = emotionDescs.length > 0

  const parts: string[] = []

  // ── [1] WHO ──────────────────────────────────────────────────────────────
  {
    let whoStatement = `You are "${char.name}"`
    if (nicknames.length > 0) {
      whoStatement += ` (also known as ${nicknames.map(n => `"${n}"`).join(', ')})`
    }
    const who: string[] = [whoStatement + '.']
    if (override) who.push(override)
    if (description) who.push(`[Description]\n${description}`)
    if (personality) who.push(personality)
    if (exampleDialogue) who.push(`[Style Examples]\n${exampleDialogue}`)
    parts.push(who.join('\n\n'))
  }

  // ── [2] CONTEXT ──────────────────────────────────────────────────────────
  {
    const ctx: string[] = []
    if (worldSetting) ctx.push(`[World]\n${worldSetting}`)
    // 用語解說：[World] 之後、[Scene] 之前（docs/future-lorebook.md §5.3）。
    // 沒有任何條目時 loreBlock 是空字串 → 連空標籤都不出現（§6.1）
    if (opts?.loreBlock?.trim()) ctx.push(opts.loreBlock.trim())
    if (scenario) ctx.push(`[Scene]\n${scenario}`)
    if (persona?.displayName?.trim() || persona?.nickname?.trim() || persona?.description?.trim()) {
      const description = sanitizePromptText(persona?.description)
      const personaNicknames = (persona?.nicknames ?? []).map(n => sanitizePromptText(n)).filter(Boolean)
      const lines = ['[User]', `name: ${displayName}`, `preferred_name: ${nickname}`]
      if (personaNicknames.length > 0) lines.push(`other_names: ${personaNicknames.join(', ')}`)
      if (description) lines.push(`notes: ${description}`)
      ctx.push(lines.join('\n'))
    }
    if (interactionExample) ctx.push(`[Interaction Hints]\n${interactionExample}`)
    if (isGroup) ctx.push(
      `Group Members: ${char.name} (you), ${others.join(', ')}\n` +
      `Conversation uses "Name: content" format — ${nickname}: = user`
    )
    if (creatorNotes) ctx.push(`[Author Notes]\n${creatorNotes}`)
    // 一般聊天時間改注入 trigger 結尾（omitSystemTime），只有提醒路徑（無 trigger）留在這裡
    if (!opts?.minimal && !opts?.omitSystemTime && settings.injectSystemTime) ctx.push(`[System Time]\n${formatSystemTimeStr()}`)
    if (!opts?.minimal && settings.mobile?.enabled) {
      ctx.push('[Input Source]\n[from: device] marks the device the user sent from. Treat it as context, not spoken text.')
    }
    if (extraSystemContext?.trim()) ctx.push(extraSystemContext.trim())
    if (ctx.length > 0) parts.push(ctx.join('\n\n'))
  }

  if (opts?.minimal) return parts.join('\n\n')

  // ── [3] BEHAVIOR ─────────────────────────────────────────────────────────
  {
    const behaviorParts: string[] = [
      [
        '[Roleplay Rules]',
        'Stay in character at all times. Character consistency takes priority over generic helpful tone.',
        'Do not mention AI, model, or system prompt.',
        'Never offer to help, suggest actions, or adopt a service/consultant tone (e.g. no "要不要我幫你", "你可以試試", "我建議你").',
        'If the user mentions a personal milestone (birthday, achievement, life event) anywhere in their message — even as a passing remark — acknowledge it in character before moving on.'
      ].join('\n')
    ]
    if (isGroup) {
      behaviorParts.push(
        [
          '[Group Conversation]',
          'Read the full conversation and decide naturally what to respond to — it may be something the user said, something another character said, or both.',
          'Do not always direct replies at the user. Treat this as a group conversation where any remark is fair game to pick up on.',
          'Do not repeat the emotional beat or core message already expressed by the other character(s).'
        ].join('\n')
      )
    }
    parts.push(behaviorParts.join('\n\n'))
  }

  // ── [4] OUTPUT CONTRACT ──────────────────────────────────────────────────
  {
    const outputLines: string[] = ['[Output Format]']
    if (hasCustomSprites && !opts?.splitEmotion) {
      outputLines.push(
        `- First line MUST be a bracket tag "[{emotion_id}]" where emotion_id is one of: ${emotionIds}\n  Emotion guide:\n${emotionDescs.join('\n')}\n  Example first line: [${emotionIds.split(',')[0].trim()}]`
      )
    }
    outputLines.push(
      '- Spoken dialogue only. No narration, stage directions, or inner monologue.',
      '- No environmental descriptions (e.g. no "陽光灑落"). No character name prefix before lines.',
      '- Do not wrap the reply in outer quotation marks (「」/『』/""). Use quotes only when quoting someone.',
      '- Multiple sentences: one per line.',
      '- Keep replies short: 1–3 sentences max. Terse characters lean toward 1; expressive characters may use up to 3.',
      '- Write entirely in Traditional Chinese (Taiwan usage).'
    )
    parts.push(outputLines.join('\n'))
  }

  // ── [5] USER-DEFINED EXTRA INSTRUCTION ──────────────────────────────────
  // 放在最後：使用者的補充規則理應蓋過前面的通用規則，而不是被稀釋。
  const extra = sanitizePromptText(settings.llm.extraInstruction)
  if (extra) parts.push(extra)

  return parts.join('\n\n')
}

/**
 * Trigger 用的時間字串：injectSystemTime 開啟時回傳現在時間；
 * 距離最後一則訊息超過 1 小時再附註間隔（深夜聊到一半、隔天下午續聊的斷層就在這裡）。
 */
export function buildTriggerTimeStr(settings: AppSettings, messages: Message[], minimal?: boolean): string | undefined {
  if (minimal || !settings.injectSystemTime) return undefined
  let str = formatSystemTimeStr()
  const lastTs = messages.length > 0 ? messages[messages.length - 1].timestamp : undefined
  if (lastTs !== undefined) {
    const gap = Date.now() - lastTs
    if (gap >= TIME_GAP_ANNOTATE_MS) str += ` (last message ${formatTimeGap(gap)} ago)`
  }
  return str
}

/**
 * Trigger line injected as the final user message, after conversation history.
 * timeStr（injectSystemTime 開啟時傳入）放在這裡而不是只放 system prompt 中段：
 * prompt 結尾的注意力最強，才能壓過舊訊息裡的時間語境（例如深夜聊到一半隔天下午續聊）。
 */
export function buildTriggerMessage(charName: string, directive?: string, timeStr?: string): string {
  const lines: string[] = []
  if (timeStr) {
    lines.push(`[Current time: ${timeStr}]`)
  }
  lines.push(`[Write the next in-character reply as "${charName}" only.]`)
  if (directive?.trim()) lines.push(directive.trim())
  return lines.join('\n')
}
