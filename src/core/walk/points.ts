import { ITEM_KINDS, ITEM_RARITIES, findItemKind, type ItemDrop, type ItemRarity, type JourneyMapId, type WalkCollection, type WalkItem } from './items'
import { MAP_ITEMS, kindIdOf } from './mapItems'
import type { Approach, BattleOutcome } from './battle'
import { approachOf } from './items'

/**
 * 步數點數：1 步＝1 點，跨日累積，只能靠走路與過招拿，**不能用錢買**。
 * 入帳接在 `creditSteps()` 的記帳差額上，所以去重與跨日都沿用步數那一套。
 */

export const POINT_COSTS = {
  /** 打開一個箱子（揭曉成功才扣） */
  openBox: 500,
  /** 過招時直接拿出一件指定做法的道具 */
  summonItem: 1000,
  /** 主動在附近找一個箱子 */
  findBox: 1500,
  /** 主動引來一個對手 */
  lureFoe: 2000
} as const
export type PointUse = keyof typeof POINT_COSTS

export const BATTLE_REWARDS: Record<BattleOutcome, { points: number; box: ItemRarity | null }> = {
  perfect: { points: 1500, box: 'uncommon' },
  win: { points: 800, box: 'common' },
  draw: { points: 200, box: null }
}

export interface PointsState {
  /** 目前餘額 */
  balance: number
  /** 還沒在畫面上播過入帳動畫的量 */
  unseen: number
  /** 已發過獎勵的過招 id（最近幾場），重做不重發 */
  rewarded: string[]
}

export function defaultPoints(): PointsState {
  return { balance: 0, unseen: 0, rewarded: [] }
}

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0)

export function normalizePoints(raw: unknown): PointsState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return defaultPoints()
  const r = raw as Record<string, unknown>
  return {
    balance: n(r.balance),
    unseen: n(r.unseen),
    rewarded: Array.isArray(r.rewarded) ? r.rewarded.filter((x): x is string => typeof x === 'string').slice(-20) : []
  }
}

export function earnPoints(p: PointsState, amount: number): PointsState {
  const a = n(amount)
  return a === 0 ? p : { ...p, balance: p.balance + a, unseen: p.unseen + a }
}

/** 不夠就回 `null`，不扣成負的。 */
export function spendPoints(p: PointsState, use: PointUse): PointsState | null {
  const cost = POINT_COSTS[use]
  return p.balance < cost ? null : { ...p, balance: p.balance - cost }
}

/** 過招獎勵；同一場只發一次。點數不算進入帳動畫，結果頁自己會顯示。 */
export function rewardBattle(p: PointsState, battleId: string, outcome: BattleOutcome): PointsState {
  if (p.rewarded.includes(battleId)) return p
  return { ...p, balance: p.balance + BATTLE_REWARDS[outcome].points, rewarded: [...p.rewarded, battleId].slice(-20) }
}

// ── 掉落與道具 ───────────────────────────────────────

const RARITY_RANK: ItemRarity[] = ['common', 'uncommon', 'rare']

/** 照一般機率抽，但不低於 `floor`。 */
export function rollRarityAtLeast(floor: ItemRarity, random: () => number = Math.random): ItemRarity {
  const allowed = RARITY_RANK.slice(RARITY_RANK.indexOf(floor))
  const total = allowed.reduce((s, r) => s + ITEM_RARITIES[r].weight, 0)
  let x = random() * total
  for (const r of allowed) {
    x -= ITEM_RARITIES[r].weight
    if (x < 0) return r
  }
  return allowed[allowed.length - 1]
}

const pick = <T>(list: readonly T[], random: () => number): T => list[Math.min(list.length - 1, Math.floor(random() * list.length))]

/** 做一個箱子（買的、過招留下的）：跟走路掉的一樣，打開才知道是什麼。 */
export function makeDrop(ctx: {
  id: string
  day: string
  stepsToday: number
  finder: { id: string; name: string }
  floor?: ItemRarity
  random?: () => number
}): ItemDrop {
  const random = ctx.random ?? Math.random
  const rarity = rollRarityAtLeast(ctx.floor ?? 'common', random)
  const kind = pick(ITEM_KINDS.filter((k) => k.rarity === rarity), random)
  return { id: ctx.id, day: ctx.day, kindId: kind.id, finderId: ctx.finder.id, finderName: ctx.finder.name, stepsToday: ctx.stepsToday }
}

/**
 * 過招應急：直接拿出一件指定做法的地圖道具。不找 AI 寫故事，
 * 名稱與說明照地圖道具表；之後拿去「聊聊這個」再由角色講。
 */
export function summonItem(
  c: WalkCollection,
  ctx: { id: string; day: string; map: JourneyMapId; approach: Approach; finder: { id: string; name: string }; now: number; random?: () => number }
): { collection: WalkCollection; item: WalkItem } | null {
  const random = ctx.random ?? Math.random
  const ofApproach = MAP_ITEMS.filter((i) => i.map === ctx.map && i.approach === ctx.approach)
  if (ofApproach.length === 0) return null
  const rarity = rollRarityAtLeast('common', random)
  const same = ofApproach.filter((i) => i.rarity === rarity)
  const t = pick(same.length > 0 ? same : ofApproach, random)
  const kindId = kindIdOf(t)
  // kindIdOf 一定落在 ITEM_KINDS；保險起見確認做法沒跑掉
  const kind = findItemKind(kindId)
  if (!kind || approachOf(kind.category) !== ctx.approach) return null
  const item: WalkItem = {
    id: ctx.id,
    day: ctx.day,
    kindId,
    finderId: ctx.finder.id,
    finderName: ctx.finder.name,
    stepsToday: 0,
    status: 'kept',
    map: ctx.map,
    treasureId: t.id,
    treasureName: t.name,
    name: t.name,
    look: t.look,
    move: t.move
  }
  return {
    item,
    collection: {
      ...c,
      items: [...c.items, item],
      seen: [...c.seen, item.id],
      discovered: { ...c.discovered, [t.id]: c.discovered[t.id] ?? ctx.now }
    }
  }
}

// ── 每週步數 ─────────────────────────────────────────

export interface WeekStats {
  /** 週一到週日；未來的日子是 `null` */
  days: { day: string; steps: number | null }[]
  total: number
  /** 已過天數（含今天）的平均 */
  average: number
}

const DAY_MS = 86_400_000
const shift = (day: string, d: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + d * DAY_MS).toISOString().slice(0, 10)

/** 週一起算。`todaySteps` 給了就蓋過今天（小工具可能比記帳新）。 */
export function weekStats(creditedByDay: Record<string, number>, today: string, todaySteps?: number): WeekStats {
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7
  const monday = shift(today, -weekday)
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = shift(monday, i)
    if (day > today) return { day, steps: null }
    const v = day === today && todaySteps !== undefined ? Math.max(todaySteps, creditedByDay[day] ?? 0) : (creditedByDay[day] ?? 0)
    return { day, steps: v }
  })
  const total = days.reduce((s, d) => s + (d.steps ?? 0), 0)
  return { days, total, average: Math.round(total / (weekday + 1)) }
}
