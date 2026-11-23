import { describe, expect, it } from 'vitest'
import {
  buildWalkPrompt, creditSteps, daysToRead, defaultWalkSettings, defaultWalkState, markWalkSpoken,
  normalizeWalkSettings, normalizeWalkState, pendingSteps, pickWalkTheme, removeWalkCharacter,
  resolveStrideMeters, shiftDay, stepsToKm, walkSpeakBlock, type WalkState
} from '../../../src/core/walk'

const T = '2026-11-23'
const Y = '2026-11-22'
const NOW = 1_800_000_000_000
const start = (total = 0): WalkState => creditSteps(defaultWalkState(), { [T]: total }, ['a'], T, NOW)
const on = { ...defaultWalkSettings(), enabled: true }

describe('記帳', () => {
  it('首次啟用只建立起點', () => {
    const s = start(3000)
    expect(s.byCharacter).toEqual({})
    expect(pendingSteps(s, T)).toBe(0)
    expect(creditSteps(s, { [T]: 3500 }, ['a'], T, NOW).byCharacter.a.totalSteps).toBe(500)
  })

  it('三隻各得全額，重複 id 不重記', () => {
    const s = creditSteps(start(), { [T]: 6000 }, ['a', 'b', 'c', 'a'], T, NOW)
    expect(['a', 'b', 'c'].map((i) => s.byCharacter[i].totalSteps)).toEqual([6000, 6000, 6000])
    expect(pendingSteps(s, T)).toBe(6000)
  })

  it('重複讀取不重複記帳；變少不倒扣，回升也不重記', () => {
    let s = creditSteps(start(), { [T]: 1000 }, ['a'], T, NOW)
    for (const n of [1000, 800, 1000]) s = creditSteps(s, { [T]: n }, ['a'], T, NOW)
    expect(s.byCharacter.a.totalSteps).toBe(1000)
  })

  it('昨天晚到的資料會補；換角色後只記給新成員', () => {
    const before = creditSteps(start(), { [T]: 1000 }, ['a'], T, NOW)
    const after = creditSteps(before, { [T]: 1500, [Y]: 200 }, ['b'], T, NOW)
    expect(after.byCharacter.a.totalSteps).toBe(1000)
    expect(after.byCharacter.b.totalSteps).toBe(700)
  })

  it('跨多日', () => {
    const d1 = shiftDay(T, 1)
    const d2 = shiftDay(T, 2)
    const s = creditSteps(start(100), { [T]: 500, [d1]: 2000, [d2]: 300 }, ['a'], d2, NOW)
    expect(s.byCharacter.a.totalSteps).toBe(2700)
  })

  it('今天讀不到就完全不動', () => {
    const s = start(100)
    expect(creditSteps(s, {}, ['a'], T, NOW)).toBe(s)
    expect(creditSteps(s, { [T]: NaN }, ['a'], T, NOW)).toBe(s)
  })

  it('超過 7 天的待講步數丟掉，里程保留', () => {
    const s = creditSteps(start(), { [T]: 5000 }, ['a'], T, NOW)
    const later = shiftDay(T, 7)
    expect(pendingSteps(s, later)).toBe(0)
    expect(creditSteps(s, { [later]: 0 }, ['a'], later, NOW).byCharacter.a.totalSteps).toBe(5000)
  })

  it('沒有同行角色時不追溯', () => {
    const s = creditSteps(start(), { [T]: 900 }, [], T, NOW)
    expect(creditSteps(s, { [T]: 1000 }, ['a'], T, NOW).byCharacter.a.totalSteps).toBe(100)
  })

  it('刪角色清里程；讀取日期可跨月', () => {
    const s = creditSteps(start(), { [T]: 9 }, ['a'], T, NOW)
    expect(removeWalkCharacter(s, 'a').byCharacter).toEqual({})
    expect(daysToRead('2026-03-01')[0]).toBe('2026-02-23')
  })
})

it('步幅：自訂 → 身高 → 預設，超出範圍不採用', () => {
  expect(resolveStrideMeters(on)).toBe(0.7)
  expect(resolveStrideMeters({ ...on, heightCm: 170 })).toBeCloseTo(0.7055)
  expect(resolveStrideMeters({ ...on, heightCm: 170, strideMeters: 0.8 })).toBe(0.8)
  expect(resolveStrideMeters({ ...on, heightCm: 17 })).toBe(0.7)
  expect(stepsToKm(6000, on)).toBe(4.2)
})

describe('發話條件', () => {
  const ctx = { now: NOW, today: T, busy: false }
  const walked = creditSteps(start(), { [T]: 2000 }, ['a'], T, NOW)

  it('每一種擋下的理由', () => {
    expect(walkSpeakBlock(on, walked, ctx)).toBeNull()
    expect(walkSpeakBlock(defaultWalkSettings(), walked, ctx)).toBe('disabled')
    expect(walkSpeakBlock(on, walked, { ...ctx, busy: true })).toBe('busy')
    expect(walkSpeakBlock(on, start(), ctx)).toBe('steps')
    expect(walkSpeakBlock(on, { ...walked, lastSpokenAt: NOW - 60_000 }, ctx)).toBe('interval')
    expect(walkSpeakBlock(on, { ...walked, spokenDay: T, spokenCount: 3 }, ctx)).toBe('quota')
    expect(walkSpeakBlock(on, { ...walked, spokenDay: Y, spokenCount: 3 }, ctx)).toBeNull()
  })

  it('門檻 0 也不會在沒走路時說話；時鐘回調不卡死', () => {
    expect(walkSpeakBlock({ ...on, minStepsToSpeak: 0 }, start(), ctx)).toBe('steps')
    expect(walkSpeakBlock(on, { ...walked, lastSpokenAt: NOW + 9e8 }, ctx)).toBeNull()
  })

  it('生成中新增的步數不遺失；手動不佔次數', () => {
    const during = creditSteps(walked, { [T]: 2600 }, ['a'], T, NOW)
    const done = markWalkSpoken(during, walked.pendingByDay, { ...ctx, theme: '撿到東西' })
    expect(pendingSteps(done, T)).toBe(600)
    expect(done.spokenCount).toBe(1)
    expect(markWalkSpoken(during, {}, { ...ctx, theme: 'x', manual: true }).spokenCount).toBe(0)
  })
})

describe('prompt', () => {
  const base = {
    steps: 6000,
    settings: { ...on, heightCm: 183 },
    speakerName: '甲',
    characterNames: ['甲', '乙'],
    theme: '走錯路'
  }

  it('含距離，不含步數與身高', () => {
    const p = buildWalkPrompt(base)
    expect(p).toContain('約 4.6 公里')
    expect(p).not.toMatch(/6000|183/)
  })

  it('天氣可關；預報不標成目前', () => {
    const weather = { description: '小雨', temperatureC: 21.6, kind: 'forecast' as const }
    expect(buildWalkPrompt({ ...base, weather })).toContain('天氣預報：小雨，22°C')
    expect(buildWalkPrompt({ ...base, weather, settings: { ...on, includeWeather: false } })).not.toContain('小雨')
  })

  it('題材不重複前兩次；單人不抽同伴題材', () => {
    const recent = ['遇到某個人', '撿到東西']
    for (let i = 0; i < 20; i++) {
      const t = pickWalkTheme(recent, 1, () => i / 20)
      expect(recent).not.toContain(t)
      expect(t).not.toBe('跟同伴拌嘴')
    }
    expect(pickWalkTheme([], 2, () => 0.999)).toBe('跟同伴拌嘴')
  })
})

it('壞資料退回預設', () => {
  const raw = { creditedByDay: { bad: 1, [T]: -5 }, pendingByDay: 3, recentThemes: [1] }
  expect(normalizeWalkState(raw)).toEqual({ ...defaultWalkState(), creditedByDay: { [T]: 0 } })
  const s = normalizeWalkSettings({ enabled: 'yes', heightCm: 999, maxPerDay: 'x' })
  expect(s).toMatchObject({ enabled: false, maxPerDay: 3 })
  expect(s.heightCm).toBeUndefined()
})
