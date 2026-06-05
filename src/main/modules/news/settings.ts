import { hasModuleSettings, readModuleSettings, writeModuleSettings } from '../moduleSettings'
import type { LangMode, NewsLocation, NewsModuleSettings, NewsReplyModel, NewsSource, NewsWeight, SpeakMode } from './types'

export const NEWS_MODULE_ID = 'desktopst.news'

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
    origin: raw.origin === 'location' || raw.origin === 'builtin' ? raw.origin : 'user'
  }
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
    blacklist: [],
    excludedCategories: [],
    excludedSources: [],
    langMode: 'translate',
    speakButton: 'sometimes',
    replyModel: 'main',
    reminder: { enabled: false },
    breakout: { enabled: false, weight: 'normal' },
    localNews: { enabled: false, locations: [] },
    feedback: { adjustments: {} },
    seenIds: [],
    maxAgeDays: 30
  }
}

export function normalizeNewsModuleSettings(raw: Partial<NewsModuleSettings> | undefined): NewsModuleSettings {
  const base = defaultNewsModuleSettings()
  if (!raw) return base

  const sources = Array.isArray(raw.sources)
    ? raw.sources.map(normalizeSource).filter((s): s is NewsSource => s !== null)
    : []

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
    blacklist: normalizeStringArray(raw.blacklist),
    excludedCategories: normalizeStringArray(raw.excludedCategories),
    excludedSources: normalizeStringArray(raw.excludedSources),
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
    maxAgeDays: typeof raw.maxAgeDays === 'number' && raw.maxAgeDays >= 0 ? Math.floor(raw.maxAgeDays) : 30
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
  const normalized = normalizeNewsModuleSettings(settings)
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
