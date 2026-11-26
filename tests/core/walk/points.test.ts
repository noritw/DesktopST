import { describe, expect, it } from 'vitest'
import { creditSteps, defaultWalkState, normalizeWalkState } from '../../../src/core/walk'
import { APPROACH_IDS, JOURNEY_MAP_IDS, defaultCollection, findItemKind, approachOf } from '../../../src/core/walk/items'
import {
  BATTLE_REWARDS,
  POINT_COSTS,
  defaultPoints,
  earnPoints,
  makeDrop,
  rewardBattle,
  rollRarityAtLeast,
  spendPoints,
  summonItem,
  weekStats
} from '../../../src/core/walk/points'

const T = '2026-11-26' // 週四
const Y = '2026-11-25'
const NOW = 1_800_000_000_000

describe('步數換點數', () => {
  it('首次啟用的起點不給點，之後 1 步 1 點', () => {
    const s0 = creditSteps(defaultWalkState(), { [T]: 4000 }, ['a'], T, NOW)
    expect(s0.points.balance).toBe(0)
    const s1 = creditSteps(s0, { [T]: 4600 }, ['a'], T, NOW)
    expect(s1.points).toMatchObject({ balance: 600, unseen: 600 })
  })

  it('同一筆重讀不重複入帳，來源變少不倒扣', () => {
    const s0 = creditSteps(defaultWalkState(), { [T]: 1000 }, ['a'], T, NOW)
    const s1 = creditSteps(s0, { [T]: 1500 }, ['a'], T, NOW)
    expect(creditSteps(s1, { [T]: 1500 }, ['a'], T, NOW).points.balance).toBe(500)
    expect(creditSteps(s1, { [T]: 1200 }, ['a'], T, NOW).points.balance).toBe(500)
  })

  it('跨日累積，昨天晚到的步數也補進來', () => {
    const s0 = creditSteps(defaultWalkState(), { [Y]: 3000, [T]: 0 }, ['a'], T, NOW)
    const s1 = creditSteps(s0, { [Y]: 3500, [T]: 800 }, ['a'], T, NOW)
    expect(s1.points.balance).toBe(1300)
  })

  it('沒有同行角色也照樣拿點數', () => {
    const s0 = creditSteps(defaultWalkState(), { [T]: 0 }, [], T, NOW)
    expect(creditSteps(s0, { [T]: 700 }, [], T, NOW).points.balance).toBe(700)
  })

  it('舊資料沒有點數欄位時從 0 開始', () => {
    expect(normalizeWalkState({ initialized: true }).points).toEqual(defaultPoints())
  })
})

describe('花點數', () => {
  it('不夠就不扣', () => {
    expect(spendPoints({ ...defaultPoints(), balance: POINT_COSTS.openBox - 1 }, 'openBox')).toBeNull()
    expect(spendPoints({ ...defaultPoints(), balance: 2000 }, 'openBox')?.balance).toBe(2000 - POINT_COSTS.openBox)
  })

  it('扣點不影響還沒播的入帳量', () => {
    const p = earnPoints(defaultPoints(), 800)
    expect(spendPoints(p, 'openBox')).toMatchObject({ balance: 300, unseen: 800 })
  })

  it('過招獎勵同一場只發一次', () => {
    const once = rewardBattle(defaultPoints(), 'b1', 'perfect')
    expect(once.balance).toBe(BATTLE_REWARDS.perfect.points)
    expect(rewardBattle(once, 'b1', 'perfect')).toBe(once)
    expect(rewardBattle(once, 'b2', 'draw').balance).toBe(BATTLE_REWARDS.perfect.points + BATTLE_REWARDS.draw.points)
  })
})

describe('箱子與道具', () => {
  it('大獲全勝的箱子至少罕見', () => {
    for (const x of [0, 0.3, 0.6, 0.99]) expect(rollRarityAtLeast('uncommon', () => x)).not.toBe('common')
    const drop = makeDrop({ id: 'd', day: T, stepsToday: 0, finder: { id: 'a', name: 'A' }, floor: 'uncommon', random: () => 0 })
    expect(findItemKind(drop.kindId)?.rarity).toBe('uncommon')
  })

  it('應急拿出的道具做法正確、直接收進道具欄、不寫故事', () => {
    for (const map of JOURNEY_MAP_IDS) for (const approach of APPROACH_IDS) {
      const r = summonItem(defaultCollection(), {
        id: `s-${approach}`, day: T, map, approach, finder: { id: 'a', name: 'A' }, now: NOW, random: () => 0.5
      })
      expect(r).not.toBeNull()
      if (!r) continue
      expect(approachOf(findItemKind(r.item.kindId)!.category)).toBe(approach)
      expect(r.item).toMatchObject({ status: 'kept', map })
      expect(r.item.name).toBeTruthy()
      expect(r.item.story).toBeUndefined()
      expect(r.collection.seen).toContain(r.item.id)
    }
  })
})

describe('每週步數', () => {
  it('週一起算，未來的日子留空，平均除以已過天數', () => {
    const w = weekStats({ '2026-11-23': 1000, '2026-11-24': 2000, [Y]: 3000, [T]: 500 }, T, 2000)
    expect(w.days.map((d) => d.day)[0]).toBe('2026-11-23')
    expect(w.days.slice(4).every((d) => d.steps === null)).toBe(true)
    expect(w.total).toBe(8000)
    expect(w.average).toBe(2000)
  })

  it('週日看的是同一週', () => {
    expect(weekStats({}, '2026-11-29').days[0].day).toBe('2026-11-23')
  })
})
