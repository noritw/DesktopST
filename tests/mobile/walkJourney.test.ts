import { describe, expect, it } from 'vitest'
import { advanceJourney, normalizeJourney, partyOf, roadAt, slotOrder, stayAt, tripBetween, visitJourney, type Journey } from '@core/walk/journey'
import { JOURNEY_MAP_IDS } from '@core/walk/items'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { clearWalkData } from '../../src/mobile/runtime/walk'
import { openJourney, simulateJourney, stayInJourney } from '../../src/mobile/runtime/walkJourney'
import { MAP_ROUTES, between, buildRoad, pointAt, slotsOn } from '../../src/mobile/ui/walk/road'

const D = '2026-11-25'
const now = (steps?: number): { day: string; map: 'dream'; steps?: number } => ({ day: D, map: 'dream', steps })
const start = (steps: number): Journey => visitJourney(null, now(steps))

describe('旅途位置', () => {
  it('沒撿東西時等於今日步數，一萬步走完，超過折返', () => {
    expect(roadAt(start(3000).phase)).toBeCloseTo(0.3)
    expect(roadAt(start(10_000).phase)).toBe(1)
    expect(roadAt(start(13_000).phase)).toBeCloseTo(0.7)
    expect(roadAt(start(20_000).phase)).toBe(0)
    expect(roadAt(start(23_000).phase)).toBeCloseTo(0.3)
  })
  it('分次看到跟一次看到一樣', () => {
    expect(visitJourney(start(3000), now(13_000)).phase).toBeCloseTo(start(13_000).phase)
  })
  it('撿完留在箱子旁，再依新增步數走；折返時方向不變', () => {
    const j = visitJourney(stayAt(start(3000), 0.6, 'a'), now(4000))
    expect(roadAt(j.phase)).toBeCloseTo(0.7)
    expect(j.leadId).toBe('a')
    expect(roadAt(visitJourney(stayAt(start(13_000), 0.6, 'a'), now(14_000)).phase)).toBeCloseTo(0.5)
  })
  it('步數讀不到或變少都不動，恢復後不重複算', () => {
    const j = start(5000)
    expect(visitJourney(j, now())).toBe(j)
    expect(visitJourney(j, now(4000))).toBe(j)
    expect(visitJourney(j, now(NaN))).toBe(j)
    expect(roadAt(visitJourney(visitJourney(j, now(4000)), now(6000)).phase)).toBeCloseTo(0.6)
  })
  it('換地圖回盡頭且只算之後的步數；換日重新開始；同地圖不重置', () => {
    const c = visitJourney(start(5000), { day: D, map: 'city', steps: 5000 })
    expect(c.phase).toBe(0)
    expect(roadAt(visitJourney(c, { day: D, map: 'city', steps: 6000 }).phase)).toBeCloseTo(0.1)
    expect(visitJourney(start(5000), { day: '2026-11-26', map: 'dream' }).phase).toBe(0)
    const j = start(5000)
    expect(visitJourney(j, now(5000))).toBe(j)
  })
  it('測試步數不動真正看過的步數', () => {
    const j = advanceJourney(start(1000), 2000)
    expect(j.seen).toBe(1000)
    expect(roadAt(visitJourney(j, now(2000)).phase)).toBeCloseTo(0.4)
  })
  it('折返路線先到盡處再往回', () => {
    const t = tripBetween(0.9, 1.2)
    expect(t.stops[0]).toBe(1)
    expect(t.stops[1]).toBeCloseTo(0.8)
    expect(tripBetween(1.9, 0.1).stops[0]).toBe(0)
    expect(tripBetween(0.5, 0.5).stops).toEqual([])
  })
  it('壞資料當作沒有', () => {
    expect(normalizeJourney({ day: 'x', map: 'dream' })).toBeNull()
    expect(normalizeJourney({ day: D, map: 'toString' })).toBeNull()
    expect(normalizeJourney({ day: D, map: 'city', phase: null, seen: -4 })).toEqual({ day: D, map: 'city', phase: 0, seen: 0 })
  })
  it('箱子先放前方，折返時反過來', () => {
    const at = [1, 0.8, 0.6, 0.4, 0.2]
    expect(slotOrder(at, 0)).toEqual([4, 3, 2, 1, 0])
    expect(slotOrder(at, 0.5).slice(0, 3)).toEqual([2, 1, 0])
    expect(slotOrder(at, 1.5).slice(0, 2)).toEqual([3, 4])
  })
})

describe('畫面上的隊伍', () => {
  const people = Array.from('abcdefgh', (id) => ({ id }))
  const ids = (p: { id: string }[]): string => p.map((c) => c.id).join('')
  it('第四位也站出來，發現者走最前面', () => {
    expect(ids(partyOf(people.slice(0, 4), undefined))).toBe('abcd')
    expect(ids(partyOf(people.slice(0, 4), 'd'))).toBe('dabc')
    expect(ids(partyOf(people.slice(0, 4), '離席的'))).toBe('abcd')
  })
  it('人太多時，發現者與遇到對手的人一定在畫面上', () => {
    expect(ids(partyOf(people, 'h', 'g'))).toBe('habcdg')
  })
})

describe('落地', () => {
  it('重開接著走、測試推進、清除資料', async () => {
    const s = createMemoryStorage()
    expect((await openJourney(s, now(2000))).from).toBe(0)
    await stayInJourney(s, 0.6, 'a')
    const again = await openJourney(s, now(3000))
    expect(again.from).toBeCloseTo(0.6)
    expect(again.journey.phase).toBeCloseTo(0.7)
    expect((await simulateJourney(s, 2000))!.journey).toMatchObject({ seen: 3000 })
    await clearWalkData(s)
    expect((await openJourney(s, now())).journey.phase).toBe(0)
  })
})

describe('各地圖的路', () => {
  it.each(JOURNEY_MAP_IDS)('%s：點都在畫面內，箱子位置遞增', (id) => {
    const road = buildRoad(MAP_ROUTES[id])
    const at = slotsOn(road)
    expect(at[0]).toBe(1)
    expect([...at].sort((a, b) => b - a)).toEqual(at)
    for (const rank of [0, 1, 2, 3, 4, 5])
      for (let d = 0; d <= road.length; d += 10) {
        const p = pointAt(road, d, rank)
        expect(p.x).toBeGreaterThan(30)
        expect(p.x).toBeLessThan(360)
        expect(p.y).toBeLessThan(520)
        expect(p.y).toBeGreaterThan(70)
      }
    expect(between(road, road.length, 0).at(-1)).toBe(0)
  })
})
