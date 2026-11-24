import type { StorageAdapter } from '@core/adapters'
import {
  addDrops,
  advanceItemProgress,
  applyGenerated,
  buildItemPrompt,
  normalizeCollection,
  parseItemReply,
  patchItem,
  type DropContext,
  type ItemWeather,
  type JourneyMapId,
  type WalkCollection,
  type WalkItem
} from '@core/walk/items'
import { loadWalkState, localDay, updateWalkState } from './walk'
import { walkItemsKey } from './walkKeys'

/** 拾物的手機 runtime：落地、收集、揭曉（`docs/walk-items-design.md`）。 */

export async function loadCollection(storage: StorageAdapter): Promise<WalkCollection> {
  return normalizeCollection(await storage.readJson<unknown>(walkItemsKey))
}

let queue: Promise<unknown> = Promise.resolve()

export function updateCollection(
  storage: StorageAdapter,
  fn: (c: WalkCollection) => WalkCollection
): Promise<WalkCollection> {
  const run = queue.then(async () => {
    const before = await loadCollection(storage)
    const after = fn(before)
    if (after !== before) await storage.writeJson(walkItemsKey, after)
    return after
  })
  queue = run.catch(() => {})
  return run
}

const WEATHER_TIMEOUT_MS = 5000

/** 掉落 → 收藏。先寫收藏再清掉落；中途中斷時重做，以 id 去重。 */
export async function collectWalkDrops(
  storage: StorageAdapter,
  getWeather: () => Promise<ItemWeather | null>,
  now: number = Date.now()
): Promise<void> {
  const { pendingDrops } = await loadWalkState(storage)
  if (pendingDrops.length === 0) return
  const today = localDay(now)
  let weather: ItemWeather | null = null
  if (pendingDrops.some((d) => d.day === today)) {
    weather = await Promise.race([
      getWeather().catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), WEATHER_TIMEOUT_MS))
    ])
  }
  await updateCollection(storage, (c) => addDrops(c, pendingDrops, (d) => (d.day === today && weather ? weather : undefined)))
  const moved = new Set(pendingDrops.map((d) => d.id))
  await updateWalkState(storage, (s) => ({ ...s, pendingDrops: s.pendingDrops.filter((d) => !moved.has(d.id)) }))
}

/** 測試版用：只推進撿東西的進度，不動步數與里程。 */
export async function simulateWalkSteps(
  storage: StorageAdapter,
  steps: number,
  ctx: DropContext,
  now: number = Date.now()
): Promise<void> {
  const day = localDay(now)
  await updateWalkState(storage, (s) => {
    const r = advanceItemProgress(s.itemProgress, steps, { day, stepsToday: s.creditedByDay[day] ?? 0 }, ctx)
    return { ...s, itemProgress: r.progress, pendingDrops: [...s.pendingDrops, ...r.drops] }
  })
}

export type RevealResult =
  | { ok: true; item: WalkItem }
  | { ok: false; reason: 'not_found' | 'no_key' | 'no_character' | 'failed' }

export interface RevealDeps<C extends { name: string }> {
  storage: StorageAdapter
  itemId: string
  /** 打開時所在的地圖 */
  map?: JourneyMapId
  hasApiKey: boolean
  findCharacter: (id: string) => C | null
  generate: (character: C, prompt: string, signal: AbortSignal) => Promise<string>
  timeoutMs?: number
  /** 由無名變有名的那一次才呼叫，失敗不影響揭曉 */
  onRevealed?: () => Promise<void>
}

const inFlight = new Map<string, Promise<RevealResult>>()

/** 同一件同時只生成一次：連點不會花兩次錢。 */
export function revealWalkItem<C extends { name: string }>(deps: RevealDeps<C>): Promise<RevealResult> {
  const running = inFlight.get(deps.itemId)
  if (running) return running
  const p = doReveal(deps).finally(() => inFlight.delete(deps.itemId))
  inFlight.set(deps.itemId, p)
  return p
}

async function doReveal<C extends { name: string }>(deps: RevealDeps<C>): Promise<RevealResult> {
  // 地圖先存再生成，重試時換了地圖也不變
  const before = await updateCollection(deps.storage, (c) => {
    const cur = c.items.find((i) => i.id === deps.itemId)
    return deps.map && cur && !cur.name && !cur.map ? patchItem(c, cur.id, { map: deps.map }) : c
  })
  const item = before.items.find((i) => i.id === deps.itemId)
  if (!item) return { ok: false, reason: 'not_found' }
  if (item.name) return { ok: true, item }
  if (!deps.hasApiKey) return { ok: false, reason: 'no_key' }
  const character = deps.findCharacter(item.finderId)
  if (!character) return { ok: false, reason: 'no_character' }

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), deps.timeoutMs ?? 60_000)
  try {
    const text = parseItemReply(await deps.generate(character, buildItemPrompt(item, character.name), abort.signal))
    if (!text) return { ok: false, reason: 'failed' }
    const c = await updateCollection(deps.storage, (cur) => applyGenerated(cur, item.id, text, Date.now()))
    const done = c.items.find((i) => i.id === item.id)
    if (done) await deps.onRevealed?.().catch((e) => console.warn('[Walk] 開箱計數失敗:', e))
    return done ? { ok: true, item: done } : { ok: false, reason: 'not_found' }
  } catch (e) {
    console.warn('[Walk] 揭曉失敗:', e)
    return { ok: false, reason: 'failed' }
  } finally {
    clearTimeout(timer)
  }
}
