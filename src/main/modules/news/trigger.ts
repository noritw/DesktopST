import { fetchAllSources } from './sources'
import { filterAndPick, isForeignLanguage } from './filter'
import { loadNewsModuleSettings, saveNewsModuleSettings } from './settings'
import { getActiveNewsTopic, type NewsTopic } from './topicState'
import type { NewsItem, NewsModuleSettings, SpeakMode } from './types'

/**
 * 待結算的正向回饋：角色剛講完一則新聞後，記住它的來源；
 * 若使用者接著回了話（送出訊息），就視為對該來源有興趣 → 加分（design §9）。
 */
let pendingNewsCreditSourceId: string | null = null

export function setPendingNewsCredit(sourceId: string | null): void {
  pendingNewsCreditSourceId = sourceId
}

/** 取出並清掉待結算的正向回饋來源（沒有則回 null） */
export function consumePendingNewsCredit(): string | null {
  const v = pendingNewsCreditSourceId
  pendingNewsCreditSourceId = null
  return v
}

/** 「說點什麼」依 speakButton 決定這次是否抓新聞（design §8） */
export function shouldGrabNews(mode: SpeakMode, rng: () => number = Math.random): boolean {
  if (mode === 'always') return true
  if (mode === 'off') return false
  // 'sometimes'：偶爾隨機混入（約 45%），讓「有時閒聊有時提則新聞」
  return rng() < 0.45
}

/** 把抽中的新聞 id 記入 seenIds（去重），並存檔。上限保護避免無限增長。 */
export function markNewsSeen(settings: NewsModuleSettings, id: string): NewsModuleSettings {
  if (settings.seenIds.includes(id)) return settings
  const seenIds = [...settings.seenIds, id].slice(-500)
  const next = { ...settings, seenIds }
  saveNewsModuleSettings(next)
  return next
}

/** 組出注入用的背景知識字串（事實 + 約束，放 system context 當背景，design §2 / §15.1）。 */
export function buildNewsContextString(item: NewsItem, settings: NewsModuleSettings): string {
  const lines: string[] = []
  lines.push('[你剛剛滑手機看到的一則消息]')
  lines.push(`標題：${item.title}`)
  // 摘要與標題重複時不重覆顯示（Google News 常見）
  if (item.summary && item.summary !== item.title && !item.title.includes(item.summary)) {
    lines.push(`摘要：${item.summary}`)
  }
  if (item.source) lines.push(`（來源：${item.source}）`)
  lines.push('')

  const constraints: string[] = [
    '完全保持你的角色個性與語氣來反應這則消息——傲嬌就酸、好奇就追問、冷靜就分析、毒舌就吐槽，怎麼像「你」就怎麼講；絕對不要變成中立、客服或一般 AI 的口吻。',
    '前提是讓對方大概聽懂發生什麼事：用你自己的說法把重點帶出來，不要只說「好像有事」這種含糊帶過。',
    '只能講標題（及補充）裡有的內容，不要腦補沒提到的細節；細節不明就照實說還不清楚。',
    '不要逐字照念標題、不要誇大影響、不要說成是你親眼看到或親身經歷的事。'
  ]
  if (item.breakout) {
    constraints.unshift('這是一則最近很多人在討論、但不一定是你平常會關注的話題，用你自己的方式帶出「最近很多人在聊這個」的感覺即可。')
  }
  if (settings.langMode === 'translate' && isForeignLanguage(item)) {
    constraints.push('這則是外語或簡體中文，請用繁體中文（台灣用語）轉述重點，不要直接貼原文。')
  }
  lines.push(constraints.map(c => `- ${c}`).join('\n'))

  return lines.join('\n')
}

/** 放在 trigger message（對話最末、緊鄰生成）的主動指令；帶上實際標題以強制 grounding、避免腦補。 */
export function buildNewsDirective(item: NewsItem): string {
  const headline = item.summary && item.summary !== item.title
    ? `「${item.title}」（${item.summary}）`
    : `「${item.title}」`
  const lead = item.breakout
    ? `這次請主動聊這則最近很多人在討論的消息：${headline}`
    : `這次請主動聊這則消息：${headline}`
  return `${lead}\n` +
    '請完全用「你這個角色」的個性和講話方式來反應——維持你平常的語氣、口頭禪、態度，該酸、該皮、該冷淡、該興奮都照你的性格來，絕對不要切換成中立、客服或通用 AI 的口吻（那樣就破壞角色了）。' +
    '同時要讓對方大概聽懂發生什麼事：用你自己的方式把重點講出來，別含糊帶過。' +
    '就算剛才在聊別的也自然轉過去；不要逐字照念標題，也不要講出標題沒提到的細節。'
}

/** 主題模式：圍繞釘住的那則新聞繼續聊（背景事實） */
export function buildTopicContextString(topic: NewsTopic): string {
  const lines: string[] = ['[你們現在正在聊的話題]']
  lines.push(`標題：${topic.title}`)
  if (topic.summary && topic.summary !== topic.title && !topic.title.includes(topic.summary)) {
    lines.push(`補充：${topic.summary}`)
  }
  if (topic.source) lines.push(`（來源：${topic.source}）`)
  return lines.join('\n')
}

/** 主題模式：放 trigger message 末尾的主動指令，請角色接著這個話題聊。 */
export function buildTopicDirective(topic: NewsTopic): string {
  return `這次請接著大家正在聊的這個話題講：「${topic.title}」。` +
    '完全用你這個角色的個性和語氣接話（回應別人剛說的、補一個你會在意的角度、或用你的方式吐槽 / 追問），別重複別人講過的點，別切換成中立或通用 AI 的口吻，也別照念或腦補標題沒提到的細節。'
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

/**
 * 為「說點什麼」取得一則新聞素材。
 * 回傳 null 代表：模組停用 / 這次不抓 / 沒有可用候選。
 * 會把抽中的新聞記入 seenIds。
 */
export async function getNewsInjectionForSpeak(
  options: { force?: boolean; rng?: () => number } = {}
): Promise<NewsInjection | null> {
  const settings = loadNewsModuleSettings()
  if (!settings.enabled) return null

  // 主題模式優先：有釘住的話題時，主動發話一律圍繞它聊（覆寫 speakButton、不抽新）。
  const topic = getActiveNewsTopic()
  if (topic) {
    return {
      text: buildTopicContextString(topic),
      directive: buildTopicDirective(topic),
      item: null,
      fromTopic: true
    }
  }

  const rng = options.rng ?? Math.random
  if (!options.force && !shouldGrabNews(settings.speakButton, rng)) return null

  const items = await fetchAllSources(settings)
  const { picked } = filterAndPick(items, settings, { rng })
  if (!picked) return null

  markNewsSeen(settings, picked.id)
  return {
    text: buildNewsContextString(picked, settings),
    directive: buildNewsDirective(picked),
    item: picked,
    fromTopic: false
  }
}
