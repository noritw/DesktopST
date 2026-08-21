/**
 * 個人新聞報的模組設定：正規化 + 讀寫（B1 抽 core，
 * news-standalone-kickoff §4 步驟④／⑤）。
 *
 * 正規化本身一直是純函式（沒有 fs／electron 依賴），這次順便把讀寫也搬進來——
 * `core/news/readerFetch.ts` 抓新聞前一定要先讀到設定，兩邊不能各自一套。
 *
 * 桌面既有呼叫端（`ipcHandlers.ts`／`readerFetch.ts`／`mobileRoutes.ts`…）都是同步的，
 * 所以沿用 `SyncStorageAdapter` 版本；手機獨立版新路徑用非同步版。
 */
import type { StorageAdapter, SyncStorageAdapter } from '../adapters/storage'
import {
  hasModuleSettings,
  hasModuleSettingsSync,
  readModuleSettings,
  readModuleSettingsSync,
  writeModuleSettings,
  writeModuleSettingsSync
} from '../store/moduleSettings'
import { NEWS_MODULE_ID } from './moduleId'
import {
  DEFAULT_KEYWORD_GROUP_ID,
  effectiveGroupId,
  keywordSourceInGroup,
  keywordSourceInReaderGroups,
  weightToValue
} from './keywordGroups'
import type {
  LangMode,
  NewsKeywordGroup,
  NewsLocation,
  NewsModuleSettings,
  NewsReplyModel,
  NewsSource,
  NewsWeight,
  SpeakMode
} from './types'

export { NEWS_MODULE_ID, DEFAULT_KEYWORD_GROUP_ID, effectiveGroupId, keywordSourceInGroup, keywordSourceInReaderGroups, weightToValue }

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
      // 沒帶 id 就在這裡生一個——手機端新增組不帶 id 正是故意的。
      //
      // ⚠️ 帶了 id 但那個 id 已經出現過（包含 'default'）要跳過，不是重新配一個——
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

/** 遷移後的縣市關鍵字落在這一組。 */
export const LOCAL_KEYWORD_GROUP_ID = 'local'
const LOCAL_KEYWORD_GROUP_NAME = '地方'

/**
 * 把舊的「地方新聞」縣市清單併成一般關鍵字（`docs/news-local-merge-plan.md`）。
 *
 * 地方新聞本來就是 `type: 'keyword'`、縣市名直接當查詢字，唯一的差別只有
 * `origin: 'location'` 以及散在 9 個檔案裡的特例。這支把資料搬平，特例才刪得掉。
 *
 * ⚠️ **必須冪等**：靠 `localNews.migratedAt` 這個旗標，**不是**靠「locations 空不空」。
 * 用後者的話，使用者把縣市關鍵字刪光之後下次開 App 會被整批建回來。
 * 沒有縣市可搬時也要蓋旗標，讓它變成終態。
 *
 * ⚠️ **`id` 沿用 `loc-<縣市>` 不換新的**：`feedback.adjustments` 以 sourceId 當鍵，
 * 換 id 等於把使用者累積的學習權重丟掉。`loc-` 這個前綴原本被 `filter.ts`／
 * `reader.ts` 拿來分桶，那些判斷在這次一起刪掉了，所以前綴留著只是歷史痕跡、
 * 不再有任何行為。
 */
export function migrateLocalNewsToKeywords(input: {
  sources: NewsSource[]
  keywordGroups: NewsKeywordGroup[]
  localNews: NewsModuleSettings['localNews']
}): {
  sources: NewsSource[]
  keywordGroups: NewsKeywordGroup[]
  localNews: NewsModuleSettings['localNews']
} {
  const { sources, keywordGroups, localNews } = input
  if (localNews.migratedAt) return input

  const locations = localNews.locations
  if (locations.length === 0) {
    return { sources, keywordGroups, localNews: { ...localNews, locations: [], migratedAt: Date.now() } }
  }

  const existingLabels = new Set(
    sources.filter(s => s.type === 'keyword').map(s => s.label.trim())
  )
  const added: NewsSource[] = []
  for (const loc of locations) {
    const label = loc.name.trim()
    if (!label || existingLabels.has(label)) continue
    existingLabels.add(label)
    added.push({
      id: `loc-${label}`,
      type: 'keyword',
      label,
      weight: loc.weight,
      // 使用者原本把地方新聞整個關掉時，不可以趁遷移全部打開——
      // 那等於替他做了沒答應過的決定。關著的就加進去但停用。
      enabled: localNews.enabled,
      origin: 'user',
      groupId: LOCAL_KEYWORD_GROUP_ID
    })
  }

  // ⚠️ **一個都沒加就不要建組。** 使用者很可能早就自己把縣市建成關鍵字了
  // （owner 的機器上正是如此，四個縣市都已在他自己的「地方」組裡），
  // 那時候去重會全部跳過，先建好的組就變成一個空的同名複本卡在管理畫面上。
  const nextGroups = added.length === 0 || keywordGroups.some(g => g.id === LOCAL_KEYWORD_GROUP_ID)
    ? keywordGroups
    : [...keywordGroups, { id: LOCAL_KEYWORD_GROUP_ID, name: LOCAL_KEYWORD_GROUP_NAME }]

  return {
    sources: [...sources, ...added],
    keywordGroups: nextGroups,
    localNews: {
      enabled: false,
      locations: [],
      migratedAt: Date.now(),
      migratedFrom: locations
    }
  }
}

/**
 * 這次讀取有沒有真的做了地方新聞遷移？有的話必須**立刻寫回磁碟**。
 *
 * ⚠️ 光在 `normalizeNewsModuleSettings` 裡遷移是不夠的：正規化是純函式、只作用在
 * 記憶體，磁碟上要等到下次有人存設定才會被覆蓋。在那之前每次讀都會重跑一次遷移，
 * **`migratedAt` 這個冪等旗標永遠不會生效** —— 使用者把縣市關鍵字刪掉，
 * 下次讀又被建回來，正是這支遷移最該避免的事。
 *
 * 真機驗證時就是這樣抓到的（2026-08-12）：APK 裡設定檔仍是 4 個縣市、
 * 沒有 `migratedAt`、也沒有 `loc-` 來源，畫面卻已經正常顯示縣市欄。
 */
function needsMigrationWriteBack(
  raw: Partial<NewsModuleSettings> | undefined,
  normalized: NewsModuleSettings
): boolean {
  // 沒有設定檔就不要為了遷移憑空建一份（模組還沒被用過）。
  if (!raw) return false
  return !raw.localNews?.migratedAt && !!normalized.localNews.migratedAt
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

  // 地方新聞 → 一般關鍵字（一次性、冪等）。放在正規化裡而不是各平台各寫一份：
  // 桌面與手機讀的是同一支，兩邊自動都會遷移。
  const migrated = migrateLocalNewsToKeywords({
    sources,
    keywordGroups,
    localNews: {
      enabled: raw.localNews?.enabled === true,
      locations,
      migratedAt: typeof raw.localNews?.migratedAt === 'number' ? raw.localNews.migratedAt : undefined,
      migratedFrom: raw.localNews?.migratedFrom
    }
  })

  const adjustments: Record<string, number> = {}
  if (raw.feedback?.adjustments && typeof raw.feedback.adjustments === 'object') {
    for (const [key, value] of Object.entries(raw.feedback.adjustments)) {
      if (typeof value === 'number' && Number.isFinite(value)) adjustments[key] = value
    }
  }

  return {
    enabled: raw.enabled === true,
    sources: migrated.sources,
    keywordGroups: migrated.keywordGroups,
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
    localNews: migrated.localNews,
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

// ── 同步版：桌面沿用 ─────────────────────────────────────────

export function hasNewsModuleSettingsSync(adapter: SyncStorageAdapter): boolean {
  return hasModuleSettingsSync(adapter, NEWS_MODULE_ID)
}

export function loadNewsModuleSettingsSync(adapter: SyncStorageAdapter): NewsModuleSettings {
  const raw = readModuleSettingsSync<Partial<NewsModuleSettings>>(adapter, NEWS_MODULE_ID)
  const normalized = normalizeNewsModuleSettings(raw)
  // ⚠️ **遷移必須寫回**，見 `needsMigrationWriteBack` 的說明。
  if (needsMigrationWriteBack(raw, normalized)) {
    writeModuleSettingsSync(adapter, NEWS_MODULE_ID, normalized)
  }
  return normalized
}

export function saveNewsModuleSettingsSync(adapter: SyncStorageAdapter, settings: Partial<NewsModuleSettings>): NewsModuleSettings {
  const current = loadNewsModuleSettingsSync(adapter)
  const normalized = normalizeNewsModuleSettings({ ...current, ...settings })
  writeModuleSettingsSync(adapter, NEWS_MODULE_ID, normalized)
  return normalized
}

/** 學習回饋微調：把某來源權重加上 delta（夾在 -1.5 ~ +3）。回話加分 / 設為主題加一點 / 跟我無關扣分共用。 */
export function applyNewsFeedbackDeltaSync(adapter: SyncStorageAdapter, sourceId: string, delta: number): void {
  if (!sourceId) return
  const s = loadNewsModuleSettingsSync(adapter)
  if (!s.enabled) return
  const cur = s.feedback.adjustments[sourceId] ?? 0
  const next = Math.round(Math.max(-1.5, Math.min(3, cur + delta)) * 100) / 100
  saveNewsModuleSettingsSync(adapter, {
    ...s,
    feedback: { adjustments: { ...s.feedback.adjustments, [sourceId]: next } }
  })
}

// ── 非同步版：手機獨立版新路徑用 ────────────────────────────────

export async function hasNewsModuleSettings(adapter: StorageAdapter): Promise<boolean> {
  return hasModuleSettings(adapter, NEWS_MODULE_ID)
}

export async function loadNewsModuleSettings(adapter: StorageAdapter): Promise<NewsModuleSettings> {
  const raw = await readModuleSettings<Partial<NewsModuleSettings>>(adapter, NEWS_MODULE_ID)
  const normalized = normalizeNewsModuleSettings(raw)
  // ⚠️ **遷移必須寫回**，見 `needsMigrationWriteBack` 的說明。
  if (needsMigrationWriteBack(raw, normalized)) {
    await writeModuleSettings(adapter, NEWS_MODULE_ID, normalized)
  }
  return normalized
}

export async function saveNewsModuleSettings(adapter: StorageAdapter, settings: Partial<NewsModuleSettings>): Promise<NewsModuleSettings> {
  const current = await loadNewsModuleSettings(adapter)
  const normalized = normalizeNewsModuleSettings({ ...current, ...settings })
  await writeModuleSettings(adapter, NEWS_MODULE_ID, normalized)
  return normalized
}

export async function applyNewsFeedbackDelta(adapter: StorageAdapter, sourceId: string, delta: number): Promise<void> {
  if (!sourceId) return
  const s = await loadNewsModuleSettings(adapter)
  if (!s.enabled) return
  const cur = s.feedback.adjustments[sourceId] ?? 0
  const next = Math.round(Math.max(-1.5, Math.min(3, cur + delta)) * 100) / 100
  await saveNewsModuleSettings(adapter, {
    ...s,
    feedback: { adjustments: { ...s.feedback.adjustments, [sourceId]: next } }
  })
}
