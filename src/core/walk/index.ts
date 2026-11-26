/**
 * 陪伴同行（計步陪伴）純邏輯。設計依據：`docs/walk-together-design.md`。
 *
 * 平台無關：步數由呼叫端讀好（每個當地日期一個彙總值）再傳進來。
 * 這裡只管記帳、距離、要不要說話、prompt 內容。
 */

import {
  advanceItemProgress,
  defaultItemProgress,
  normalizeDrops,
  normalizeItemProgress,
  type DropContext,
  type ItemDrop,
  type ItemProgress
} from './items'
import { defaultPoints, earnPoints, normalizePoints, type PointsState } from './points'

export interface WalkSettings {
  enabled: boolean
  /** 選填，只用來算步幅，絕不進 prompt */
  heightCm?: number
  /** 選填，自訂時優先於身高 */
  strideMeters?: number
  heightPromptDone: boolean
  speakOnOpen: boolean
  includeWeather: boolean
  minStepsToSpeak: number
  minIntervalMinutes: number
  maxPerDay: number
}

export interface WalkState {
  /** 首次記帳前是 false；第一次成功讀取只建立起點，不記給角色 */
  initialized: boolean
  /** 當地日期 YYYY-MM-DD → 該日已記帳步數 */
  creditedByDay: Record<string, number>
  byCharacter: Record<string, { totalSteps: number; since: number }>
  /** 尚未拿來講的步數，依發生日期分開，才能丟掉過期的 */
  pendingByDay: Record<string, number>
  lastSpokenAt: number
  spokenDay: string
  spokenCount: number
  recentThemes: string[]
  /** 拾物進度與尚未搬進收藏的掉落：必須跟步數同一次寫入，才不會漏發或重發 */
  itemProgress: ItemProgress
  pendingDrops: ItemDrop[]
  /** 步數點數（`points.ts`）：跟步數同一次寫入，才不會重複入帳 */
  points: PointsState
}

export const DEFAULT_STRIDE_METERS = 0.7
export const BACKFILL_DAYS = 7
const HEIGHT_TO_STRIDE = 0.415
const WALKING_KM_PER_HOUR = 4.5
const DAY_MS = 24 * 60 * 60 * 1000
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function defaultWalkSettings(): WalkSettings {
  return {
    enabled: false,
    heightPromptDone: false,
    speakOnOpen: true,
    includeWeather: true,
    minStepsToSpeak: 1500,
    minIntervalMinutes: 120,
    maxPerDay: 3
  }
}

export function defaultWalkState(): WalkState {
  return {
    initialized: false,
    creditedByDay: {},
    byCharacter: {},
    pendingByDay: {},
    lastSpokenAt: 0,
    spokenDay: '',
    spokenCount: 0,
    recentThemes: [],
    itemProgress: defaultItemProgress(),
    pendingDrops: [],
    points: defaultPoints()
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function inRange(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : undefined
}

function count(v: unknown): number {
  return Math.floor(inRange(v, 0, Number.MAX_SAFE_INTEGER) ?? 0)
}

function dayMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!isObject(v)) return out
  for (const [day, n] of Object.entries(v)) if (DATE_RE.test(day)) out[day] = count(n)
  return out
}

export function normalizeWalkSettings(raw: unknown): WalkSettings {
  const d = defaultWalkSettings()
  if (!isObject(raw)) return d
  const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
  return {
    enabled: bool(raw.enabled, d.enabled),
    heightCm: inRange(raw.heightCm, 100, 230),
    strideMeters: inRange(raw.strideMeters, 0.3, 1.2),
    heightPromptDone: bool(raw.heightPromptDone, d.heightPromptDone),
    speakOnOpen: bool(raw.speakOnOpen, d.speakOnOpen),
    includeWeather: bool(raw.includeWeather, d.includeWeather),
    minStepsToSpeak: inRange(raw.minStepsToSpeak, 0, 100_000) ?? d.minStepsToSpeak,
    minIntervalMinutes: inRange(raw.minIntervalMinutes, 0, 1440) ?? d.minIntervalMinutes,
    maxPerDay: inRange(raw.maxPerDay, 0, 100) ?? d.maxPerDay
  }
}

export function normalizeWalkState(raw: unknown): WalkState {
  const d = defaultWalkState()
  if (!isObject(raw)) return d
  const byCharacter: WalkState['byCharacter'] = {}
  if (isObject(raw.byCharacter)) {
    for (const [id, v] of Object.entries(raw.byCharacter)) {
      if (isObject(v)) byCharacter[id] = { totalSteps: count(v.totalSteps), since: count(v.since) }
    }
  }
  return {
    initialized: raw.initialized === true,
    creditedByDay: dayMap(raw.creditedByDay),
    byCharacter,
    pendingByDay: dayMap(raw.pendingByDay),
    lastSpokenAt: count(raw.lastSpokenAt),
    spokenDay: typeof raw.spokenDay === 'string' ? raw.spokenDay : '',
    spokenCount: count(raw.spokenCount),
    recentThemes: Array.isArray(raw.recentThemes)
      ? raw.recentThemes.filter((t): t is string => typeof t === 'string').slice(-2)
      : [],
    itemProgress: normalizeItemProgress(raw.itemProgress),
    pendingDrops: normalizeDrops(raw.pendingDrops),
    points: normalizePoints(raw.points)
  }
}

/** 日期字串加減天數。用 UTC 純做曆法運算，不受夏令時間影響。 */
export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10)
}

/** 這次該向平台讀哪幾天（由舊到新，含今天）。 */
export function daysToRead(today: string): string[] {
  return Array.from({ length: BACKFILL_DAYS }, (_, i) => shiftDay(today, i - BACKFILL_DAYS + 1))
}

export function resolveStrideMeters(s: WalkSettings): number {
  const custom = inRange(s.strideMeters, 0.3, 1.2)
  if (custom !== undefined) return custom
  const height = inRange(s.heightCm, 100, 230)
  return height !== undefined ? (height * HEIGHT_TO_STRIDE) / 100 : DEFAULT_STRIDE_METERS
}

export function stepsToKm(steps: number, s: WalkSettings): number {
  return Math.round((steps * resolveStrideMeters(s)) / 100) / 10
}

function recentDaysOnly(m: Record<string, number>, today: string): Record<string, number> {
  const oldest = shiftDay(today, 1 - BACKFILL_DAYS)
  return Object.fromEntries(Object.entries(m).filter(([d]) => d >= oldest && d <= today))
}

export function pendingSteps(state: WalkState, today: string): number {
  return Object.values(recentDaysOnly(state.pendingByDay, today)).reduce((sum, n) => sum + n, 0)
}

/**
 * 把讀到的每日彙總記帳，回傳新狀態（不改原物件）。
 *
 * - `totals` **只放讀取成功的日期**；讀不到的不要塞 0。
 * - **首次啟用請一次讀齊 `daysToRead()` 的所有日期**，當作起點；
 *   首次沒讀到的日子，之後補到時會被當成新走的步數。
 * - 同行角色各得全額，不平分。沒有同行角色時仍視為已記帳（不追溯給之後加入的人）。
 * - 資料晚到會補，來源修正變少不倒扣。
 * - 給了 `dropCtx` 才會撿東西；掉落與步數在同一份狀態裡。
 */
export function creditSteps(
  state: WalkState,
  totals: Record<string, number>,
  characterIds: readonly string[],
  today: string,
  now: number,
  dropCtx?: DropContext
): WalkState {
  // 今天讀不到就不動：否則首次啟用的起點會缺今天，稍後整天都被誤記
  if (inRange(totals[today], 0, Number.MAX_SAFE_INTEGER) === undefined) return state

  const creditedByDay = recentDaysOnly(state.creditedByDay, today)
  const pendingByDay = recentDaysOnly(state.pendingByDay, today)
  let added = 0
  /** 點數不看有沒有同行角色：走了就算 */
  let earned = 0
  let itemProgress = state.itemProgress
  const pendingDrops = [...state.pendingDrops]

  for (const day of daysToRead(today)) {
    const raw = inRange(totals[day], 0, Number.MAX_SAFE_INTEGER)
    if (raw === undefined) continue
    const total = Math.floor(raw)
    const credited = creditedByDay[day] ?? 0
    const delta = Math.max(0, total - credited)
    creditedByDay[day] = Math.max(credited, total)
    if (state.initialized) earned += delta
    if (!state.initialized || delta === 0 || characterIds.length === 0) continue
    added += delta
    pendingByDay[day] = (pendingByDay[day] ?? 0) + delta
    if (dropCtx) {
      const r = advanceItemProgress(itemProgress, delta, { day, stepsToday: creditedByDay[day] }, dropCtx)
      itemProgress = r.progress
      pendingDrops.push(...r.drops)
    }
  }

  const byCharacter = { ...state.byCharacter }
  if (added > 0) {
    for (const id of new Set(characterIds)) {
      const prev = byCharacter[id]
      byCharacter[id] = { totalSteps: (prev?.totalSteps ?? 0) + added, since: prev?.since ?? now }
    }
  }
  const points = earnPoints(state.points, earned)
  return { ...state, initialized: true, creditedByDay, pendingByDay, byCharacter, itemProgress, pendingDrops, points }
}

export function removeWalkCharacter(state: WalkState, characterId: string): WalkState {
  const byCharacter = { ...state.byCharacter }
  delete byCharacter[characterId]
  return { ...state, byCharacter }
}

export type WalkSpeakBlock = 'disabled' | 'steps' | 'interval' | 'quota' | 'busy'

/** 開 App 時要不要說話；回 `null` 代表可以說。 */
export function walkSpeakBlock(
  s: WalkSettings,
  state: WalkState,
  ctx: { now: number; today: string; busy: boolean }
): WalkSpeakBlock | null {
  if (!s.enabled || !s.speakOnOpen) return 'disabled'
  if (ctx.busy) return 'busy'
  const steps = pendingSteps(state, ctx.today)
  if (steps <= 0 || steps < s.minStepsToSpeak) return 'steps'
  const elapsed = ctx.now - state.lastSpokenAt
  // elapsed < 0：使用者把時鐘往回調，不要因此永遠不說話
  if (state.lastSpokenAt > 0 && elapsed >= 0 && elapsed < s.minIntervalMinutes * 60_000) return 'interval'
  if (state.spokenDay === ctx.today && state.spokenCount >= s.maxPerDay) return 'quota'
  return null
}

/**
 * 生成**成功後**才呼叫。`used` 是開始生成時的 `pendingByDay` 快照：
 * 扣掉快照量而非歸零，生成期間新走的步數才不會遺失。
 * `manual`（按鈕觸發）不佔每日次數。
 */
export function markWalkSpoken(
  state: WalkState,
  used: Record<string, number>,
  ctx: { now: number; today: string; theme: string; manual?: boolean }
): WalkState {
  const pendingByDay: Record<string, number> = {}
  for (const [day, n] of Object.entries(state.pendingByDay)) {
    const left = n - (used[day] ?? 0)
    if (left > 0) pendingByDay[day] = left
  }
  const before = state.spokenDay === ctx.today ? state.spokenCount : 0
  return {
    ...state,
    pendingByDay,
    lastSpokenAt: ctx.now,
    spokenDay: ctx.today,
    spokenCount: before + (ctx.manual ? 0 : 1),
    recentThemes: [...state.recentThemes, ctx.theme].slice(-2)
  }
}

/** 抽象題材：不綁世界觀，任何角色都能套。 */
const SOLO_THEMES = ['遇到某個人', '找到有趣的小東西', '走錯路', '想起往事', '看到沒見過的東西', '休息一下', '遇上一點小麻煩']
const GROUP_THEME = '跟同伴拌嘴'

export function pickWalkTheme(
  recent: readonly string[],
  groupSize: number,
  random: () => number = Math.random
): string {
  const all = groupSize > 1 ? [...SOLO_THEMES, GROUP_THEME] : SOLO_THEMES
  return pickRandom(all.filter((t) => !recent.slice(-2).includes(t)), random)
}

/** 多角色時隨機挑一隻代表開口。`items` 不可為空。 */
export function pickRandom<T>(items: readonly T[], random: () => number = Math.random): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))]
}

/** 天氣只給狀況與氣溫，**型別上就沒有地名欄位**。 */
export interface WalkWeather {
  description: string
  temperatureC: number
  kind: 'current' | 'forecast'
}

export function buildWalkPrompt(input: {
  steps: number
  settings: WalkSettings
  speakerName: string
  characterNames: readonly string[]
  theme: string
  weather?: WalkWeather | null
  /** 手動觸發且沒有新增步數時，改講今天累計 */
  scope?: 'since-last' | 'today'
}): string {
  const km = stepsToKm(input.steps, input.settings)
  const minutes = Math.max(5, Math.round(((km / WALKING_KM_PER_HOUR) * 60) / 5) * 5)
  const names = input.characterNames.map((n) => `「${n}」`).join('、')
  const scope = input.scope === 'today' ? '今天' : '從上次聊到現在，'
  const distance =
    km < 0.1 ? '一小段路' : `約 ${km.toFixed(1)} 公里（約 ${minutes} 分鐘的步行路程，可能是分段走的）`
  const lines = ['[陪伴同行]', `使用者與${names}${scope}一起走了${distance}。`]
  if (input.weather && input.settings.includeWeather) {
    const label = input.weather.kind === 'forecast' ? '天氣預報' : '目前天氣'
    const temp = Math.round(input.weather.temperatureC)
    lines.push(`${label}：${input.weather.description}，${temp}°C。僅供氣氛參考，不代表走路當時的天氣。`)
  }
  lines.push(
    '',
    `請由「${input.speakerName}」用自己的語氣，說一件在自己的世界裡陪使用者走這段路時發生的小事。`,
    `- 題材：${input.theme}`,
    '- 依角色的世界觀與能力表現，不一定是用腳走',
    '- 路程規模要與距離相稱',
    '- 天氣不符合世界觀時，轉化或忽略',
    '- 不要虛構使用者的行為、感受或去過的地方',
    '- 不要評論走得多或少，不要催促',
    '- 不要條列數據；2～4 句'
  )
  return lines.join('\n')
}
