import type { StorageAdapter } from '@core/adapters'
import { MIN_ITEMS, tryAppear, type Approach, type BattleStore } from '@core/walk/battle'
import type { JourneyMapId, WalkItem } from '@core/walk/items'
import { BATTLE_REWARDS, POINT_COSTS, makeDrop, rewardBattle, spendPoints, summonItem, type PointUse, type PointsState } from '@core/walk/points'
import { loadWalkState, localDay, updateWalkState } from './walk'
import { loadCollection, updateCollection } from './walkItems'
import { updateBattles } from './walkBattle'

/** 步數點數的手機 runtime（`core/walk/points.ts`）。點數只存在 state.json，跟步數同一份。 */

export async function loadPoints(storage: StorageAdapter): Promise<PointsState> {
  return (await loadWalkState(storage)).points
}

/** 畫面播完入帳動畫後呼叫：只扣掉播過的量，播的期間又入帳的留著下次播。 */
export async function markPointsSeen(storage: StorageAdapter, shown: number): Promise<void> {
  await updateWalkState(storage, (s) =>
    shown <= 0 || s.points.unseen === 0 ? s : { ...s, points: { ...s.points, unseen: Math.max(0, s.points.unseen - shown) } }
  )
}

export async function canAfford(storage: StorageAdapter, use: PointUse): Promise<boolean> {
  return (await loadPoints(storage)).balance >= POINT_COSTS[use]
}

/** 扣點。不夠回 `false`，什麼都不動。 */
export async function spend(storage: StorageAdapter, use: PointUse): Promise<boolean> {
  let ok = false
  await updateWalkState(storage, (s) => {
    const points = spendPoints(s.points, use)
    ok = points !== null
    return points ? { ...s, points } : s
  })
  return ok
}

/** 後面的步驟失敗了，把點數退回去。 */
async function refund(storage: StorageAdapter, use: PointUse): Promise<void> {
  await updateWalkState(storage, (s) => ({ ...s, points: { ...s.points, balance: s.points.balance + POINT_COSTS[use] } }))
}

type Person = { id: string; name: string }
const pickOne = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]

export type PointActionResult = { ok: true } | { ok: false; reason: 'no_points' | 'no_character' | 'not_now' | 'failed' }

/** 花點數在附近找一個箱子。放進掉落，之後由 `collect` 搬進收藏。 */
export async function findBox(
  storage: StorageAdapter,
  deps: { finders: readonly Person[]; newId: () => string; collect: () => Promise<void>; now?: number }
): Promise<PointActionResult> {
  if (deps.finders.length === 0) return { ok: false, reason: 'no_character' }
  const now = deps.now ?? Date.now()
  const day = localDay(now)
  let ok = false
  await updateWalkState(storage, (s) => {
    const points = spendPoints(s.points, 'findBox')
    if (!points) return s
    ok = true
    const drop = makeDrop({ id: deps.newId(), day, stepsToday: s.creditedByDay[day] ?? 0, finder: pickOne(deps.finders) })
    return { ...s, points, pendingDrops: [...s.pendingDrops, drop] }
  })
  if (!ok) return { ok: false, reason: 'no_points' }
  await deps.collect()
  return { ok: true }
}

/** 花點數引來一個對手。條件跟自然出現一樣，不符合就不扣。 */
export async function lureFoe(
  storage: StorageAdapter,
  deps: { present: readonly Person[]; newId: () => string }
): Promise<PointActionResult & { store?: BattleStore }> {
  if (deps.present.length === 0) return { ok: false, reason: 'no_character' }
  const items = (await loadCollection(storage)).items
  if (items.filter((i) => i.name).length < MIN_ITEMS) return { ok: false, reason: 'not_now' }
  if (!(await spend(storage, 'lureFoe'))) return { ok: false, reason: 'no_points' }
  try {
    let appeared = false
    const store = await updateBattles(storage, (s) => {
      if (s.current) return s
      const next = tryAppear({ ...s, opened: Math.max(s.nextAt, 1), nextAt: Math.max(s.nextAt, 1) }, { present: deps.present, items, newId: deps.newId })
      appeared = !!next.current
      return appeared ? next : s
    })
    if (!appeared) {
      await refund(storage, 'lureFoe')
      return { ok: false, reason: 'not_now' }
    }
    return { ok: true, store }
  } catch (e) {
    console.warn('[Walk] 引來對手失敗:', e)
    await refund(storage, 'lureFoe').catch(() => {})
    return { ok: false, reason: 'failed' }
  }
}

/** 過招應急：花點數拿出一件指定做法的道具，直接收進道具欄。 */
export async function summonWalkItem(
  storage: StorageAdapter,
  deps: { approach: Approach; map: JourneyMapId; finder: Person; newId: () => string; now?: number }
): Promise<{ ok: true; item: WalkItem } | { ok: false; reason: 'no_points' | 'failed' }> {
  if (!(await spend(storage, 'summonItem'))) return { ok: false, reason: 'no_points' }
  const now = deps.now ?? Date.now()
  let made: WalkItem | null = null
  try {
    await updateCollection(storage, (c) => {
      const r = summonItem(c, { id: deps.newId(), day: localDay(now), map: deps.map, approach: deps.approach, finder: deps.finder, now })
      made = r?.item ?? null
      return r ? r.collection : c
    })
  } catch (e) {
    console.warn('[Walk] 拿出道具失敗:', e)
  }
  if (!made) {
    await refund(storage, 'summonItem').catch(() => {})
    return { ok: false, reason: 'failed' }
  }
  return { ok: true, item: made }
}

/**
 * 過招結束的獎勵：點數＋（贏了）留下一個箱子。同一場只發一次。
 * `finder` 是這場的主角；箱子之後由 `collect` 搬進收藏。
 */
export async function rewardWalkBattle(
  storage: StorageAdapter,
  deps: {
    battleId: string
    outcome: keyof typeof BATTLE_REWARDS
    finder: Person
    newId: () => string
    collect: () => Promise<void>
    now?: number
  }
): Promise<void> {
  const now = deps.now ?? Date.now()
  const day = localDay(now)
  let boxed = false
  await updateWalkState(storage, (s) => {
    const points = rewardBattle(s.points, deps.battleId, deps.outcome)
    if (points === s.points) return s
    const floor = BATTLE_REWARDS[deps.outcome].box
    if (!floor) return { ...s, points }
    boxed = true
    const drop = makeDrop({ id: deps.newId(), day, stepsToday: s.creditedByDay[day] ?? 0, finder: deps.finder, floor })
    return { ...s, points, pendingDrops: [...s.pendingDrops, drop] }
  })
  if (boxed) await deps.collect()
}
