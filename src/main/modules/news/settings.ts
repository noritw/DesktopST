import { hasModuleSettings, readModuleSettings, writeModuleSettings } from '../moduleSettings'
import { DEFAULT_KEYWORD_GROUP_ID } from '../../../core/news/keywordGroups'
import type { LangMode, NewsKeywordGroup, NewsLocation, NewsModuleSettings, NewsReplyModel, NewsSource, NewsWeight, SpeakMode } from './types'

export const NEWS_MODULE_ID = 'desktopst.news'

// 純函式已搬到 core/news/keywordGroups.ts（B1 抽 core）；
// 此處 re-export 保住既有 import 路徑。本檔其餘部分（load/save）走檔案存取，留在 main。
export {
  DEFAULT_KEYWORD_GROUP_ID,
  effectiveGroupId,
  keywordSourceInGroup,
  keywordSourceInReaderGroups,
  weightToValue
} from '../../../core/news/keywordGroups'

/**
 * 解析新聞報要用的關鍵字組。
 * 回傳 null = 全部組；否則為已驗證過的 groupId 清單。
 */
export function resolveReaderKeywordGroupIds(settings: NewsModuleSettings): string[] | null {
  const raw = settings.readerKeywordGroupIds
  if (!raw || raw.length === 0) return null
  const valid = new Set(settings.keywordGroups.map(g => g.id))
  valid.add(DEFAULT_KEYWORD_GROUP_ID)
  const filtered = [...new Set(raw.filter(id => valid.has(id)))]
  return filtered.length > 0 ? filtered : null
}

/** 組裝新聞報抓取用的 SelectionContext */
export function readerSelectionContext(settings: NewsModuleSettings): {
  allKeywordGroups?: boolean
  readerKeywordGroupIds?: string[]
} {
  const ids = resolveReaderKeywordGroupIds(settings)
  if (ids) return { readerKeywordGroupIds: ids }
  return { allKeywordGroups: true }
}

const VALID_WEIGHTS: NewsWeight[] = ['often', 'normal', 'rarely']
const VALID_LANG_MODES: LangMode[] = ['zh-only', 'translate', 'raw']
const VALID_SPEAK_MODES: SpeakMode[] = ['off', 'sometimes', 'always']
const VALID_REPLY_MODELS: NewsReplyModel[] = ['main', 'utility']

function normalizeWeight(value: unknown): NewsWeight {
  return VALID_WEIGHTS.includes(value as NewsWeight) ? (value as NewsWeight) : 'normal'
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

function normalizeSource(raw: Partial<NewsSource> | undefined): NewsSource | null {
  if (!raw || typeof raw.label !== 'string' || !raw.label) return null
  const type = raw.type === 'rss' || raw.type === 'json' ? raw.type : 'keyword'
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `src-${Math.random().toString(36).slice(2, 10)}`,
    type,
    label: raw.label,
    url: typeof raw.url === 'string' && raw.url ? raw.url : undefined,
    weight: normalizeWeight(raw.weight),
    enabled: raw.enabled !== false,
    origin: raw.origin === 'location' || raw.origin === 'builtin' || raw.origin === 'character' ? raw.origin : 'user',
    // groupId 只對 keyword 有意義；rss/json 一律不分組
    groupId: type === 'keyword' && typeof raw.groupId === 'string' && raw.groupId ? raw.groupId : undefined,
    readerQuota: typeof raw.readerQuota === 'number'
      && raw.readerQuota >= 1 && raw.readerQuota <= 20
      ? Math.floor(raw.readerQuota)
      : undefined
  }
}

/** 正規化關鍵字分組清單：必含內建預設組（置頂）、id 去重、name 非空。 */
function normalizeKeywordGroups(value: unknown): NewsKeywordGroup[] {
  const out: NewsKeywordGroup[] = [{ id: DEFAULT_KEYWORD_GROUP_ID, name: '預設組' }]
  const seen = new Set<string>([DEFAULT_KEYWORD_GROUP_ID])
  if (Array.isArray(value)) {
    for (const raw of value) {
      if (!raw || typeof raw !== 'object') continue
      const g = raw as Partial<NewsKeywordGroup>
      const name = typeof g.name === 'string' ? g.name.trim() : ''
      if (!name) continue
      // 沒帶 id 就在這裡生一個——手機端新增組不帶 id 正是故意的
      // （`core/news/keywordGroups.ts` 的 `withNewGroup`，同 `normalizeSource`
      // 對關鍵字來源的做法）。舊版這裡是「沒 id 就整筆丟掉」，等於新增功能
      // 在手機上點了等於沒點，靜靜地什麼都沒發生。
      //
      // ⚠️ **帶了 id 但那個 id 已經出現過（包含 'default'）要跳過，不是重新配一個**——
      // 呼叫端多半是把收到的完整陣列原封不動送回來（例如只是新增了一組），
      // 這時候陣列裡本來就會有一筆 `{id:'default', name:'預設組'}`；當成「id 撞到
      // 已存在的」硬是配一個新 id，會讓預設組憑空多出一份同名複本。
      const hasId = typeof g.id === 'string' && g.id.length > 0
      if (hasId && seen.has(g.id as string)) continue
      let id = hasId ? (g.id as string) : `grp-${Math.random().toString(36).slice(2, 10)}`
      while (seen.has(id)) id = `grp-${Math.random().toString(36).slice(2, 10)}`
      seen.add(id)
      out.push({ id, name })
    }
  }
  return out
}

function normalizeLocation(raw: Partial<NewsLocation> | undefined): NewsLocation | null {
  if (!raw || typeof raw.name !== 'string' || !raw.name) return null
  return {
    name: raw.name,
    weight: normalizeWeight(raw.weight),
    fromDetection: raw.fromDetection === true
  }
}

export function defaultNewsModuleSettings(): NewsModuleSettings {
  return {
    enabled: false,
    sources: [],
    keywordGroups: [{ id: DEFAULT_KEYWORD_GROUP_ID, name: '預設組' }],
    blacklist: [],
    excludedCategories: [],
    excludedSources: [],
    reducedSources: [],
    langMode: 'translate',
    speakButton: 'sometimes',
    replyModel: 'main',
    reminder: { enabled: false },
    breakout: { enabled: false, weight: 'normal', zhOnly: true },
    localNews: { enabled: false, locations: [] },
    feedback: { adjustments: {} },
    seenIds: [],
    maxAgeDays: 30,
    readerMaxItems: 30,
    readerPerKeyword: 3,
    readerBreakoutQuota: 3,
    readerKeywordGroupIds: [],
    conversationSearch: {
      enabled: false,
      triggerWords: [
        '最近', '今天', '昨天', '前天', '這幾天', '剛剛', '剛才',
        '聽說', '看到', '看見', '有沒有', '你知道', '有看到',
        '新聞', '事件', '事情', '消息', '報導',
        '怎麼了', '出事', '發生什麼',
        '知道', '有人說', '網路上說'
      ],
      maxAgeHours: 48
    },
    enrichForChat: true
  }
}

export function normalizeNewsModuleSettings(raw: Partial<NewsModuleSettings> | undefined): NewsModuleSettings {
  const base = defaultNewsModuleSettings()
  if (!raw) return base

  const keywordGroups = normalizeKeywordGroups(raw.keywordGroups)
  const groupIds = new Set(keywordGroups.map(g => g.id))

  const sources = (Array.isArray(raw.sources)
    ? raw.sources.map(normalizeSource).filter((s): s is NewsSource => s !== null)
    : []
  // groupId 指向已不存在的組（組被刪除）→ 落回預設組
  ).map(s => (s.groupId && !groupIds.has(s.groupId) ? { ...s, groupId: undefined } : s))

  const locations = Array.isArray(raw.localNews?.locations)
    ? raw.localNews!.locations.map(normalizeLocation).filter((l): l is NewsLocation => l !== null)
    : []

  const adjustments: Record<string, number> = {}
  if (raw.feedback?.adjustments && typeof raw.feedback.adjustments === 'object') {
    for (const [key, value] of Object.entries(raw.feedback.adjustments)) {
      if (typeof value === 'number' && Number.isFinite(value)) adjustments[key] = value
    }
  }

  return {
    enabled: raw.enabled === true,
    sources,
    keywordGroups,
    blacklist: normalizeStringArray(raw.blacklist),
    excludedCategories: normalizeStringArray(raw.excludedCategories),
    excludedSources: normalizeStringArray(raw.excludedSources),
    reducedSources: normalizeStringArray(raw.reducedSources),
    langMode: VALID_LANG_MODES.includes(raw.langMode as LangMode) ? (raw.langMode as LangMode) : 'translate',
    speakButton: VALID_SPEAK_MODES.includes(raw.speakButton as SpeakMode) ? (raw.speakButton as SpeakMode) : 'sometimes',
    // 舊設定沒有 replyModel → 'main'（把預設行為由輔助改為主要，避免角色口吻被壓平）
    replyModel: VALID_REPLY_MODELS.includes(raw.replyModel as NewsReplyModel) ? (raw.replyModel as NewsReplyModel) : 'main',
    reminder: {
      enabled: raw.reminder?.enabled === true,
      schedule: raw.reminder?.schedule
    },
    breakout: {
      enabled: raw.breakout?.enabled === true,
      weight: normalizeWeight(raw.breakout?.weight),
      // 未設視為 true（舊設定也預設只要中文，避免熱門灌一堆外文）
      zhOnly: raw.breakout?.zhOnly !== false
    },
    localNews: {
      enabled: raw.localNews?.enabled === true,
      locations
    },
    feedback: { adjustments },
    // seenIds 上限保護，避免無限增長
    seenIds: normalizeStringArray(raw.seenIds).slice(-500),
    maxAgeDays: typeof raw.maxAgeDays === 'number' && raw.maxAgeDays >= 0 ? Math.floor(raw.maxAgeDays) : 30,
    readerMaxItems: typeof raw.readerMaxItems === 'number'
      && raw.readerMaxItems >= 5 && raw.readerMaxItems <= 100
      ? Math.floor(raw.readerMaxItems) : 30,
    readerPerKeyword: typeof raw.readerPerKeyword === 'number'
      && raw.readerPerKeyword >= 1 && raw.readerPerKeyword <= 20
      ? Math.floor(raw.readerPerKeyword) : 3,
    readerBreakoutQuota: typeof raw.readerBreakoutQuota === 'number'
      && raw.readerBreakoutQuota >= 0 && raw.readerBreakoutQuota <= 20
      ? Math.floor(raw.readerBreakoutQuota) : 3,
    // 空陣列 = 全部組；指向已刪除組的 id 剔除
    readerKeywordGroupIds: normalizeStringArray(raw.readerKeywordGroupIds)
      .filter(id => groupIds.has(id) || id === DEFAULT_KEYWORD_GROUP_ID),
    conversationSearch: {
      enabled: raw.conversationSearch?.enabled === true,
      triggerWords: normalizeStringArray(raw.conversationSearch?.triggerWords).length > 0
        ? normalizeStringArray(raw.conversationSearch!.triggerWords)
        : base.conversationSearch!.triggerWords,
      // 舊設定有 filterOldArticles: false → maxAgeHours: 0；其餘維持數值或預設 48
      maxAgeHours: (() => {
        const cs = raw.conversationSearch as Record<string, unknown> | undefined
        if (!cs) return 48
        if (typeof cs.maxAgeHours === 'number' && cs.maxAgeHours >= 0) return Math.floor(cs.maxAgeHours)
        if (cs.filterOldArticles === false) return 0
        return 48
      })()
    },
    // 未設視為 true（舊設定也預設開 enrichment）
    enrichForChat: raw.enrichForChat !== false
  }
}

export function hasNewsModuleSettings(): boolean {
  return hasModuleSettings(NEWS_MODULE_ID)
}

export function loadNewsModuleSettings(): NewsModuleSettings {
  const raw = readModuleSettings<Partial<NewsModuleSettings>>(NEWS_MODULE_ID)
  return normalizeNewsModuleSettings(raw)
}

export function saveNewsModuleSettings(settings: Partial<NewsModuleSettings>): NewsModuleSettings {
  const current = loadNewsModuleSettings()
  const normalized = normalizeNewsModuleSettings({ ...current, ...settings })
  writeModuleSettings(NEWS_MODULE_ID, normalized)
  return normalized
}

/** 學習回饋微調：把某來源權重加上 delta（夾在 -1.5 ~ +3）。回話加分 / 設為主題加一點 / 跟我無關扣分共用。 */
export function applyNewsFeedbackDelta(sourceId: string, delta: number): void {
  if (!sourceId) return
  const s = loadNewsModuleSettings()
  if (!s.enabled) return
  const cur = s.feedback.adjustments[sourceId] ?? 0
  const next = Math.round(Math.max(-1.5, Math.min(3, cur + delta)) * 100) / 100
  saveNewsModuleSettings({
    ...s,
    feedback: { adjustments: { ...s.feedback.adjustments, [sourceId]: next } }
  })
}
