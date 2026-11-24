import type { StorageAdapter } from '@core/adapters'
import type { DropContext } from '@core/walk/items'
import { moduleSettingsKey, moduleFileKey } from './walkKeys'
import { clearJourney } from './walkJourney'
import {
  buildWalkPrompt,
  creditSteps,
  daysToRead,
  markWalkSpoken,
  normalizeWalkSettings,
  normalizeWalkState,
  pendingSteps,
  pickRandom,
  pickWalkTheme,
  walkSpeakBlock,
  type WalkSettings,
  type WalkSpeakBlock,
  type WalkState,
  type WalkWeather
} from '@core/walk'

/** 陪伴同行的手機 runtime：落地、記帳、決定要不要說話（`docs/walk-together-design.md`）。 */

export function localDay(now: number): string {
  const d = new Date(now)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export async function loadWalkSettings(storage: StorageAdapter): Promise<WalkSettings> {
  return normalizeWalkSettings(await storage.readJson<unknown>(moduleSettingsKey))
}

export async function saveWalkSettings(storage: StorageAdapter, s: WalkSettings): Promise<void> {
  await storage.writeJson(moduleSettingsKey, normalizeWalkSettings(s))
}

export async function loadWalkState(storage: StorageAdapter): Promise<WalkState> {
  return normalizeWalkState(await storage.readJson<unknown>(moduleFileKey))
}

/** 讀－改－寫排隊執行，冷啟動與 visibilitychange 重疊時才不會互蓋。 */
let queue: Promise<unknown> = Promise.resolve()

export function updateWalkState(
  storage: StorageAdapter,
  fn: (s: WalkState) => WalkState | Promise<WalkState>
): Promise<WalkState> {
  const run = queue.then(async () => {
    const before = await loadWalkState(storage)
    const after = await fn(before)
    if (after !== before) await storage.writeJson(moduleFileKey, after)
    return after
  })
  queue = run.catch(() => {})
  return run
}

export async function clearWalkData(storage: StorageAdapter): Promise<void> {
  // 還沒搬進收藏的道具不算步數資料，清除步數時要留著
  await updateWalkState(storage, (s) => ({ ...normalizeWalkState(null), pendingDrops: s.pendingDrops }))
  await clearJourney(storage)
}

/** 讀步數並記帳。模組關閉回 `null`；讀取失敗會擲例外且不動任何資料。 */
export async function syncWalk(deps: {
  storage: StorageAdapter
  companionIds: readonly string[]
  readDays: (days: string[]) => Promise<Record<string, number>>
  dropCtx?: DropContext
  now?: number
}): Promise<WalkState | null> {
  if (!(await loadWalkSettings(deps.storage)).enabled) return null
  return updateWalkState(deps.storage, async (s) => {
    const now = deps.now ?? Date.now()
    const today = localDay(now)
    const totals = await deps.readDays(daysToRead(today))
    return creditSteps(s, totals, deps.companionIds, today, now, deps.dropCtx)
  })
}

export type WalkSpeakResult = { spoke: boolean; reason?: WalkSpeakBlock | 'no_character' | 'failed' }

export interface WalkSpeakDeps {
  storage: StorageAdapter
  companions: readonly { id: string; name: string; muted: boolean }[]
  busy: boolean
  manual?: boolean
  getWeather: () => Promise<WalkWeather | null>
  /** 回傳是否真的講出來了。 */
  speak: (characterId: string, prompt: string) => Promise<boolean>
  now?: number
}

let speaking = false

export async function speakWalk(deps: WalkSpeakDeps): Promise<WalkSpeakResult> {
  if (speaking) return { spoke: false, reason: 'busy' }
  speaking = true
  try {
    const settings = await loadWalkSettings(deps.storage)
    const state = await loadWalkState(deps.storage)
    const now = deps.now ?? Date.now()
    const today = localDay(now)

    if (!settings.enabled) return { spoke: false, reason: 'disabled' }
    if (!deps.manual) {
      const block = walkSpeakBlock(settings, state, { now, today, busy: deps.busy })
      if (block) return { spoke: false, reason: block }
    }

    const speakers = deps.companions.filter((c) => !c.muted)
    if (speakers.length === 0) return { spoke: false, reason: 'no_character' }

    const pending = pendingSteps(state, today)
    const steps = pending > 0 ? pending : (state.creditedByDay[today] ?? 0)
    if (steps <= 0) return { spoke: false, reason: 'steps' }

    const speaker = pickRandom(speakers)
    const theme = pickWalkTheme(state.recentThemes, deps.companions.length)
    const weather = settings.includeWeather ? await deps.getWeather().catch(() => null) : null
    const prompt = buildWalkPrompt({
      steps,
      settings,
      speakerName: speaker.name,
      characterNames: deps.companions.map((c) => c.name),
      theme,
      weather,
      scope: pending > 0 ? 'since-last' : 'today'
    })

    const spoke = await deps.speak(speaker.id, prompt).catch(() => false)
    if (!spoke) return { spoke: false, reason: 'failed' }

    // 扣掉「開始生成時」的量，生成期間新走的步數要留下
    await updateWalkState(deps.storage, (s) =>
      markWalkSpoken(s, state.pendingByDay, { now: deps.now ?? Date.now(), today, theme, manual: deps.manual })
    )
    return { spoke: true }
  } finally {
    speaking = false
  }
}
