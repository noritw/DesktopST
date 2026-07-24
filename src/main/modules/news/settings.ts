import { hasModuleSettings, readModuleSettings, writeModuleSettings } from '../moduleSettings'
import type { LangMode, NewsKeywordGroup, NewsLocation, NewsModuleSettings, NewsReplyModel, NewsSource, NewsWeight, SpeakMode } from './types'

export const NEWS_MODULE_ID = 'desktopst.news'

/** 內建「預設組」id；未綁組的情境與沒有 groupId 的關鍵字都落在這裡。 */
export const DEFAULT_KEYWORD_GROUP_ID = 'default'

/** undefined / 空字串視為預設組。 */
export function effectiveGroupId(groupId: string | undefined): string {
  return groupId && groupId.length > 0 ? groupId : DEFAULT_KEYWORD_GROUP_ID
}

/** 該 keyword 來源是否屬於指定情境組（rss/json 不分組，由呼叫端判斷）。 */
export function keywordSourceInGroup(source: NewsSource, sceneGroupId: string | undefined): boolean {
  return effectiveGroupId(source.groupId) === effectiveGroupId(sceneGroupId)
}

/**
 * 新聞報：關鍵字是否落在選中的多組內。
 * `selectedIds` 為 null／空 = 全部組都收。
 */
export function keywordSourceInReaderGroups(
  source: NewsSource,
  selectedIds: string[] | null | undefined
): boolean {
  if (!selectedIds || selectedIds.length === 0) return true
  const gid = effectiveGroupId(source.groupId)
  return selectedIds.some(id => effectiveGroupId(id) === gid)
}

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

/** design §5：常聊 / 普通 / 偶爾 ≈ 3 / 2 / 1 */
export function weightToValue(weight: NewsWeight): number {
  switch (weight) {
    case 'often': return 3
    case 'rarely': return 1
    case 'normal':
    default: return 2
  }
}

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
      const id = typeof g.id === 'string' ? g.id : ''
      const name = typeof g.name === 'string' ? g.name.trim() : ''
      if (!id || !name || seen.has(id)) continue
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
    breakout: { enabled: false, weight: 'normal' },
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
    }
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
      weight: normalizeWeight(raw.breakout?.weight)
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
    }
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
