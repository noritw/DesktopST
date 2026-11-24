/**
 * 今日旅途的隊伍位置（`docs/walk-items-design.md` §15.7）。
 *
 * `phase` 是 0～2 的來回：0＝路的盡頭，1＝最近處，1～2 是折返。
 * 只認「從上次看到現在新增的步數」，所以撿東西留在哪裡，就從哪裡繼續。
 */
import { JOURNEY_MAP_IDS, type JourneyMapId } from './items'

export const STEPS_PER_ROAD = 10_000

export interface Journey {
  day: string
  map: JourneyMapId
  phase: number
  /** 已經換成位移的今日步數 */
  seen: number
  /** 走最前面的角色 */
  leadId?: string
}

export interface Trip {
  /** 出發的位置，0～1 */
  start: number
  /** 依序經過的位置，最後一個是終點；空陣列＝原地 */
  stops: number[]
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const wrap = (phase: number): number => ((phase % 2) + 2) % 2

/** 折返後在路上的位置，0～1。 */
export function roadAt(phase: number): number {
  const p = wrap(phase)
  return p <= 1 ? p : 2 - p
}

export function normalizeJourney(raw: unknown): Journey | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.day)) return null
  const map = JOURNEY_MAP_IDS.find((id) => id === r.map)
  if (!map) return null
  return {
    day: r.day,
    map,
    phase: finite(r.phase) ? wrap(r.phase) : 0,
    seen: finite(r.seen) ? Math.max(0, r.seen) : 0,
    ...(typeof r.leadId === 'string' ? { leadId: r.leadId } : {})
  }
}

export function advanceJourney(j: Journey, steps: number): Journey {
  return steps > 0 ? { ...j, phase: wrap(j.phase + steps / STEPS_PER_ROAD) } : j
}

/**
 * 換日、換地圖回到路的盡頭；否則依新增步數前進。
 * 步數讀不到或變少都留在原地。沒有變化時回傳原物件。
 */
export function visitJourney(
  prev: Journey | null,
  now: { day: string; map: JourneyMapId; steps?: number }
): Journey {
  const steps = finite(now.steps) ? Math.max(0, now.steps) : undefined
  let j = prev
  if (!j || j.day !== now.day) j = { day: now.day, map: now.map, phase: 0, seen: 0, leadId: prev?.leadId }
  else if (j.map !== now.map) return { ...j, map: now.map, phase: 0, seen: Math.max(j.seen, steps ?? 0) }
  if (steps === undefined || steps <= j.seen) return j
  return { ...advanceJourney(j, steps - j.seen), seen: steps }
}

/** 走到箱子旁就留下，方向不變。 */
export function stayAt(j: Journey, at: number, leadId: string): Journey {
  const p = Math.max(0, Math.min(1, at))
  return { ...j, leadId, phase: wrap(j.phase) <= 1 ? p : wrap(2 - p) }
}

/** 從一個相位往前走到另一個相位，途中最多折返兩次。 */
export function tripBetween(from: number, to: number): Trip {
  const a = wrap(from)
  let b = wrap(to)
  if (a === b) return { start: roadAt(a), stops: [] }
  if (b < a) b += 2
  const stops: number[] = []
  for (let turn = Math.floor(a) + 1; turn < b; turn++) stops.push(roadAt(turn))
  return { start: roadAt(a), stops: [...stops, roadAt(b)] }
}

export const PARTY_MAX = 6

/** 畫面上站誰、怎麼排：發現者走最前面；人太多時，說話的人一定要站得出來。 */
export function partyOf<T extends { id: string }>(
  present: readonly T[],
  leadId: string | undefined,
  mustShowId?: string
): T[] {
  const lead = present.find((c) => c.id === leadId)
  const rest = present.filter((c) => c !== lead)
  const party = (lead ? [lead, ...rest] : rest).slice(0, PARTY_MAX)
  const must = present.find((c) => c.id === mustShowId)
  if (must && !party.includes(must)) party[party.length - 1] = must
  return party
}

/** 箱子先放在隊伍前方，由近到遠；前方放完才放後面。 */
export function slotOrder(slotsAt: readonly number[], phase: number): number[] {
  const at = roadAt(phase)
  const dir = wrap(phase) < 1 ? 1 : -1
  const ahead = (i: number): boolean => (slotsAt[i] - at) * dir > 0.04
  return slotsAt
    .map((_, i) => i)
    .sort((a, b) => Number(ahead(b)) - Number(ahead(a)) || Math.abs(slotsAt[a] - at) - Math.abs(slotsAt[b] - at))
}
