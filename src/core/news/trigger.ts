import { resolvePromptContext } from './enrich'
import { isForeignLanguage } from './filter'
import type { NewsTopic } from './topicState'
import type { NewsItem, NewsModuleSettings, SpeakMode } from './types'

/**
 * 新聞發話的指令組裝（純邏輯）。原 `src/main/modules/news/trigger.ts`。
 *
 * 這裡是**角色怎麼把一則新聞講出來**的全部措辭——桌面與手機必須完全一致，
 * 否則同一則新聞兩邊語氣會慢慢長歪，正是 §4.1 要防的 drift。
 *
 * ⚠️ 本檔含刻意寫死的 prompt 指令字串（英文指令以省 Token，並要求輸出繁中），
 *    非 UI 文案。依 roadmap §3.3 例外條款保留。
 *
 * 讀寫設定與抓取來源的部分留在 `main/`（見該檔說明）。
 */

/** 「說點什麼」依 speakButton 決定這次是否抓新聞（design §8） */
export function shouldGrabNews(mode: SpeakMode, rng: () => number = Math.random): boolean {
  if (mode === 'always') return true
  if (mode === 'off') return false
  // 'sometimes'：偶爾隨機混入（約 45%），讓「有時閒聊有時提則新聞」
  return rng() < 0.45
}

/**
 * 把抽中的新聞 id 記入 seenIds（去重）。上限保護避免無限增長。
 *
 * **純函式：只算出新的設定，不存檔。** 存檔由平台層負責
 * （原本這裡直接呼叫 saveNewsModuleSettings，那是唯一的不純處）。
 * 回傳與傳入相同的物件代表沒有變動，呼叫端可據此略過存檔。
 */
export function markNewsSeen(settings: NewsModuleSettings, id: string): NewsModuleSettings {
  if (settings.seenIds.includes(id)) return settings
  const seenIds = [...settings.seenIds, id].slice(-500)
  return { ...settings, seenIds }
}

/** 組出注入用的背景知識字串（事實 + 約束，放 system context 當背景，design §2 / §15.1）。 */
export function buildNewsContextString(item: NewsItem, settings: NewsModuleSettings): string {
  const lines: string[] = []
  // 不假設角色有手機/裝置（有些世界觀沒有），用中性的「剛得知一則消息」。
  lines.push('[A piece of news you just came across]')
  lines.push(`Title: ${item.title}`)
  // 優先用 enrich／使用者改過的 promptContext；無則退回 RSS summary
  const details = resolvePromptContext(item)
  if (details) {
    lines.push(`Summary: ${details}`)
  }
  if (item.source) lines.push(`Source: ${item.source}`)
  lines.push('')

  const constraints: string[] = [
    "React fully in your character's own personality and voice (snark, curiosity, cool analysis, sharp tongue—whatever fits you). Never slip into a neutral, customer-service, or generic-AI tone.",
    'Make sure the other person roughly gets what happened: bring out the key point in your own words; don\'t just vaguely say "something\'s going on".',
    'Only use what the Title (and Summary) actually say; do not invent details not mentioned. If something is unclear, just say it\'s not clear yet.',
    "Don't read the title verbatim, don't exaggerate the impact, and don't claim you witnessed or experienced it yourself."
  ]
  if (item.breakout) {
    constraints.unshift("This is a topic many people are discussing lately but not necessarily one you'd normally follow; convey a \"lots of people are talking about this\" vibe in your own way.")
  }
  if (settings.langMode === 'translate' && isForeignLanguage(item)) {
    constraints.push('This item is in a foreign language or Simplified Chinese; relay the key point in Traditional Chinese (Taiwan), do not paste the original text.')
  }
  constraints.push('Reply in Traditional Chinese (Taiwan), in character.')
  lines.push(constraints.map(c => `- ${c}`).join('\n'))

  return lines.join('\n')
}

/** 放在 trigger message（對話最末、緊鄰生成）的主動指令；帶上實際標題以強制 grounding、避免腦補。 */
export function buildNewsDirective(item: NewsItem): string {
  const details = resolvePromptContext(item)
  // directive 只帶短節錄，避免把整篇塞進 trigger；長文靠 context 的 Summary
  const brief = details && details.length > 120 ? `${details.slice(0, 117)}…` : details
  const headline = brief && brief !== item.title
    ? `"${item.title}" (${brief})`
    : `"${item.title}"`
  const lead = item.breakout
    ? `Bring up this widely-discussed news on your own this time: ${headline}`
    : `Bring up this news on your own this time: ${headline}`
  return `${lead}\n` +
    "React entirely as your character—keep your usual tone, catchphrases and attitude (snarky, cheeky, aloof, excited—whatever suits you). Never switch to a neutral, customer-service, or generic-AI tone (that breaks character). " +
    "Keep it casual, like mentioning it offhand to a friend; keep it short (about two or three sentences), not a full analysis or summary. " +
    "Make sure they roughly get the gist—don't be vague, but don't lecture in detail either. " +
    'If you want to throw them a question, make it a light one (like "what do you think?" / "could it be that…"), not a tidy either-or or a bulleted list. ' +
    "Transition naturally even if you were talking about something else; don't read the title verbatim and don't add details it doesn't mention. " +
    'Reply in Traditional Chinese (Taiwan), in character.'
}

/** 主題模式：圍繞釘住的那則新聞繼續聊（背景事實） */
export function buildTopicContextString(topic: NewsTopic): string {
  const lines: string[] = ['[The topic you are currently chatting about]']
  lines.push(`Title: ${topic.title}`)
  const details = resolvePromptContext(topic)
  if (details) {
    lines.push(`Details: ${details}`)
  }
  if (topic.source) lines.push(`Source: ${topic.source}`)
  return lines.join('\n')
}

/** 主題模式：放 trigger message 末尾的主動指令，請角色接著這個話題聊。 */
export function buildTopicDirective(topic: NewsTopic): string {
  return `Continue the topic everyone is currently discussing: "${topic.title}". ` +
    "Pick up the conversation entirely in your character's personality and voice (respond to what others just said, add an angle you'd care about, or snark/probe in your own way). Don't repeat points others already made, don't switch to a neutral or generic-AI tone, and don't read the title verbatim or invent details it doesn't mention. " +
    'Reply in Traditional Chinese (Taiwan), in character.'
}

/**
 * 多個候選素材（新聞 / 便利貼）並存時，請角色看過一遍、挑一個來聊（design：survey & pick）。
 * 保留角色個性，不強迫每個都提。
 */
export function buildSurveyDirective(opts: { newsTitle?: string; noteTitles?: string[] }): string {
  const lines: string[] = ['A few things you could bring up right now:']
  if (opts.newsTitle) lines.push(`- A news item: "${opts.newsTitle}"`)
  for (const t of opts.noteTitles ?? []) lines.push(`- A sticky note you wrote: "${t}"`)
  return lines.join('\n') + '\n' +
    "Pick ONE that your character most wants to talk about and open the topic, entirely in your own personality and voice; you don't have to mention every item. " +
    "If you pick the news, make sure they roughly get what happened and don't invent details the title doesn't mention. Never switch to a neutral or generic-AI tone. " +
    'Reply in Traditional Chinese (Taiwan), in character.'
}

/** 只有便利貼當候選時的開話題指令。 */
export function buildNotesDirective(noteTitles: string[]): string {
  const lines = ['You have these sticky notes on your desk:', ...noteTitles.map(t => `- "${t}"`)]
  return lines.join('\n') + '\n' +
    "Pick one you want to chat about or say something about, and open a topic naturally in your own personality and voice; you don't have to mention every note. " +
    'Reply in Traditional Chinese (Taiwan), in character.'
}

export interface NewsInjection {
  /** 放 system context 的背景事實 + 約束 */
  text: string
  /** 放 trigger message 末尾的主動指令 */
  directive: string
  /** 抽中的新聞（主題模式時為 null，因為沒有抽新） */
  item: NewsItem | null
  /** 是否來自「後續聊天主題」（主題模式 → 不顯示泡泡按鈕） */
  fromTopic: boolean
}
