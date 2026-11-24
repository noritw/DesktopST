import { describe, expect, it, vi } from 'vitest'
import { ITEM_CATEGORIES, ITEM_KINDS, type ItemCategory } from '@core/walk/items'
import {
  APPROACH_IDS,
  FOE_FORMS,
  FOE_FORM_IDS,
  HAND_SIZE,
  LOG_LIMIT,
  REST_MS,
  approachOf,
  buildBattleTalkMessage,
  bypassBattle,
  canReroll,
  countOpened,
  dealHand,
  defaultBattleStore,
  dexKey,
  finishBattle,
  keepLead,
  markBattled,
  normalizeBattleStore,
  outcomeOf,
  playRound,
  rerollRound,
  restLeft,
  restText,
  startBattle,
  tryAppear,
  type Approach,
  type BattleItem,
  type BattleRoller,
  type BattleStore
} from '@core/walk/battle'

const NOW = 1_800_000_000_000
const HOUR = 3_600_000
const A = { id: 'a', name: '甲' }
const B = { id: 'b', name: '乙' }

/** 固定種子，機率測試才不會偶爾失敗。 */
function seeded(seed = 1): () => number {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const kindsOf = (c: ItemCategory): string[] => ITEM_KINDS.filter((k) => k.category === c).map((k) => k.id)
const item = (id: string, kindId: string, extra: Partial<BattleItem> = {}): BattleItem => ({
  id,
  kindId,
  name: `物${id}`,
  finderId: 'a',
  finderName: '甲',
  ...extra
})
/** 每類一件，id 就是分類。 */
const ONE_EACH = (Object.keys(ITEM_CATEGORIES) as ItemCategory[]).map((c) => item(c, kindsOf(c)[0]))
const FIVE = ['glow', 'ink', 'vessel', 'nature', 'sound'].map((id) => ONE_EACH.find((i) => i.id === id)!)
const WEAK: Approach[] = ['lure', 'move', 'trap']

function waiting(): BattleStore {
  return {
    ...defaultBattleStore(),
    opened: 4,
    nextAt: 4,
    current: { id: 'x', leadId: 'a', leadName: '甲', form: 'tangle', weak: WEAK, rounds: [], rerollUsed: false }
  }
}
const withFoes = (): BattleStore => ({
  ...waiting(),
  foes: { a: { name: '甲', madeAt: 1, list: { tangle: FOE_FORMS.fog.fallback } } }
})
const started = (items: BattleItem[] = FIVE): BattleStore => startBattle(waiting(), 'x', items, NOW, seeded())
const fixed =
  (...faces: number[]): BattleRoller =>
  (n) =>
    Array.from({ length: n }, (_, i) => faces[i] ?? faces[0])
const play = (s: BattleStore, round: number, itemId: string, face: number, present = [A]): BattleStore =>
  playRound(s, { battleId: 'x', round, itemId, present, now: NOW + round, roll: fixed(face) })
/** 依序出三件都對的；骰面給幾個就打幾回合。 */
const fought = (faces: number[]): BattleStore =>
  faces.reduce((s, f, i) => play(s, i, ['glow', 'ink', 'vessel'][i], f), started())

describe('遇到對手', () => {
  it('門檻只在 3～5，都會出現', () => {
    const r = seeded()
    const seen = new Set(Array.from({ length: 200 }, () => countOpened(defaultBattleStore(), r).nextAt))
    expect([...seen].sort()).toEqual([3, 4, 5])
  })

  it('滿了才出現；物品不足 3 件就停在門檻，湊滿就出現（休息中的也算）', () => {
    let s = defaultBattleStore()
    const ctx = { present: [A], items: ONE_EACH, newId: () => 'n', random: seeded() }
    for (let i = 0; i < 2; i++) s = countOpened(s, () => 0)
    expect(tryAppear(s, ctx)).toBe(s)
    for (let i = 0; i < 5; i++) s = countOpened(s, () => 0)
    expect(s.opened).toBe(3)
    const few = [...ONE_EACH.slice(0, 2), item('z', 'glow-c1', { name: undefined })]
    expect(tryAppear(s, { ...ctx, items: few })).toBe(s)
    expect(tryAppear(s, { ...ctx, present: [] })).toBe(s)
    const resting = ONE_EACH.slice(0, 3).map((i) => ({ ...i, lastBattleAt: NOW }))
    const got = tryAppear(s, { ...ctx, items: resting })
    expect(got.current).toMatchObject({ id: 'n', leadId: 'a', rounds: [] })
    expect(got.current?.hand).toBeUndefined()
  })

  it('有對手等著時不累計，也不會再來一個', () => {
    const s = waiting()
    expect(countOpened(s)).toBe(s)
    expect(tryAppear(s, { present: [A], items: ONE_EACH, newId: () => 'n' })).toBe(s)
  })

  it('三回合弱點不會全部相同，六個形和四種做法都抽得到', () => {
    const random = seeded()
    const base = { ...defaultBattleStore(), opened: 3, nextAt: 3 }
    const forms = new Set<string>()
    const weaks = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const b = tryAppear(base, { present: [A, B], items: ONE_EACH, newId: () => 'n', random }).current!
      expect(new Set(b.weak).size).toBeGreaterThan(1)
      forms.add(b.form)
      b.weak.forEach((w) => weaks.add(w))
    }
    expect(forms.size).toBe(FOE_FORM_IDS.length)
    expect(weaks.size).toBe(APPROACH_IDS.length)
    const same = tryAppear(base, { present: [A], items: ONE_EACH, newId: () => 'n', random: () => 0 }).current!
    expect(new Set(same.weak).size).toBe(2)
  })

  it('主角離開：沒有專屬內容才換人，沒人就留著', () => {
    const s = waiting()
    expect(keepLead(s, [A])).toBe(s)
    expect(keepLead(s, [])).toBe(s)
    expect(keepLead(s, [B]).current).toMatchObject({ leadId: 'b', leadName: '乙' })
    const own = withFoes()
    expect(keepLead(own, [B])).toBe(own)
    const going = started()
    expect(keepLead(going, [B])).toBe(going)
  })

  it('繞過它不留紀錄並重抽門檻；開打後不能繞', () => {
    expect(bypassBattle(waiting(), 'x')).toEqual(defaultBattleStore())
    const going = started()
    expect(bypassBattle(going, 'x')).toBe(going)
    const other = waiting()
    expect(bypassBattle(other, 'y')).toBe(other)
  })
})

describe('做法與文字', () => {
  it('八類都對到做法，每種做法兩類', () => {
    const count: Record<string, number> = {}
    for (const c of Object.keys(ITEM_CATEGORIES) as ItemCategory[]) count[approachOf(c)] = (count[approachOf(c)] ?? 0) + 1
    expect(count).toEqual({ lure: 2, move: 2, trap: 2, startle: 2 })
  })

  it('備用文字齊全，不責備', () => {
    for (const id of FOE_FORM_IDS) {
      for (const t of Object.values(FOE_FORMS[id].fallback)) {
        expect(t).not.toBe('')
        expect(t).not.toMatch(/輸|敗|可惜|努力|下次/)
      }
    }
  })
})

describe('休息 24 小時', () => {
  it('差 1 毫秒仍休息，剛滿就能出；未來時間視為能出', () => {
    expect(restLeft(undefined, NOW)).toBe(0)
    expect(restLeft(NOW, NOW)).toBe(REST_MS)
    expect(restLeft(NOW - REST_MS + 1, NOW)).toBe(1)
    expect(restLeft(NOW - REST_MS, NOW)).toBe(0)
    expect(restLeft(NOW + 1, NOW)).toBe(0)
  })

  it('剩餘時間文字', () => {
    const t = (left: number): string => restText(NOW - REST_MS + left, NOW)
    expect(t(6 * HOUR + 21 * 60_000 + 5)).toBe('休息中，還有 6 小時 21 分鐘可再出場')
    expect(t(HOUR)).toBe('休息中，還有 1 小時可再出場')
    expect(t(HOUR - 1)).toBe('休息中，還有 59 分鐘可再出場')
    expect(t(60_000)).toBe('休息中，還有 1 分鐘可再出場')
    expect(t(59_999)).toBe('馬上就好')
    expect(t(0)).toBe('')
  })

  it('只改出過場物品的時間，重做不變，已丟掉的略過；重擲不重新計時', () => {
    const items: (BattleItem & { fortune: string })[] = FIVE.map((i) => ({ ...i, fortune: 'f' }))
    const rounds = fought([4, 4, 4]).current!.rounds
    const once = markBattled(items, rounds)
    expect(once).toEqual(
      items.map((i) => {
        const at = { glow: NOW, ink: NOW + 1, vessel: NOW + 2 }[i.id]
        return at ? { ...i, lastBattleAt: at } : i
      })
    )
    expect(markBattled(once, rounds)).toBe(once)
    const discarded = items.slice(3)
    expect(markBattled(discarded, rounds)).toBe(discarded)
    const rerolled = rerollRound(play(started(), 0, 'glow', 1), 'x', 0, fixed(6)).current!.rounds
    expect(markBattled(items, rerolled)[0].lastBattleAt).toBe(NOW)
  })
})

describe('發牌', () => {
  it('最多五件、不重複；不足五件全發；抽過籤語的也能出', () => {
    const random = seeded()
    for (let i = 0; i < 200; i++) {
      const hand = dealHand(ONE_EACH, WEAK, NOW, random)
      expect(hand).toHaveLength(HAND_SIZE)
      expect(new Set(hand.map((h) => h.itemId)).size).toBe(HAND_SIZE)
    }
    const used = FIVE.slice(0, 3).map((i) => ({ ...i, fortune: { text: 't' } }))
    expect(dealHand(used, WEAK, NOW, random)).toHaveLength(3)
  })

  it('沒名字的不算，不到 3 件不開打', () => {
    const items = [...FIVE.slice(0, 2), item('z', 'glow-c2', { name: undefined })]
    expect(dealHand(items, WEAK, NOW)).toEqual([])
    const s = waiting()
    expect(startBattle(s, 'x', items, NOW)).toBe(s)
  })

  it('盡量不重複品項', () => {
    const items = [...Array.from({ length: 10 }, (_, i) => item(`g${i}`, 'glow-c1')), ...ONE_EACH.slice(1, 6)]
    const random = seeded()
    for (let i = 0; i < 100; i++) {
      const hand = dealHand(items, WEAK, NOW, random)
      expect(new Set(hand.map((h) => h.category)).size).toBe(HAND_SIZE)
    }
  })

  it('收藏裡有對的做法，至少發到一件', () => {
    const items = [...kindsOf('nature').map((k) => item(k, k)), item('only', 'ink-c1')]
    const random = seeded()
    for (let i = 0; i < 100; i++) {
      expect(dealHand(items, ['move', 'trap', 'move'], NOW, random).some((h) => h.itemId === 'only')).toBe(true)
    }
  })

  it('休息中的不發；不到 3 件才讓休息最久的回來，不清時間', () => {
    const at = (id: string, hoursAgo: number): BattleItem => item(id, `${id}-c1`, { lastBattleAt: NOW - hoursAgo * HOUR })
    const ids = (items: BattleItem[]): string[] => dealHand(items, WEAK, NOW).map((h) => h.itemId).sort()
    expect(ids([...FIVE.slice(0, 3), at('gear', 1)])).not.toContain('gear')
    const tight = [item('glow', 'glow-c1'), at('ink', 2), at('gear', 20), at('lost', 10)]
    const before = structuredClone(tight)
    expect(ids(tight)).toEqual(['gear', 'glow', 'lost'])
    expect(tight).toEqual(before)
    // 同時間用 id 排，結果穩定
    expect(ids([item('glow', 'glow-c1'), at('lost', 2), at('ink', 2), at('gear', 2)])).toEqual(['gear', 'glow', 'ink'])
  })

  it('開打才發牌，重按不重發；文字當下定案', () => {
    const s = started()
    expect(s.current?.hand).toHaveLength(5)
    expect(s.current?.text).toEqual(FOE_FORMS.tangle.fallback)
    expect(startBattle(s, 'x', ONE_EACH, NOW + REST_MS)).toBe(s)
    expect(startBattle(withFoes(), 'x', FIVE, NOW).current?.text?.name).toBe('瞇眼的霧')
  })
})

describe('回合', () => {
  it('做法對擲兩顆取高，不對一顆；3 以下不贏、4 以上贏', () => {
    const two = playRound(started(), { battleId: 'x', round: 0, itemId: 'glow', present: [A], now: NOW, roll: fixed(1, 4) })
    expect(two.current!.rounds[0].rolls).toEqual([1, 4])
    expect(canReroll(two.current!)).toBe(false)
    const one = play(started(), 0, 'nature', 3)
    expect(one.current!.rounds[0].rolls).toEqual([3])
    expect(canReroll(one.current!)).toBe(true)
    expect(canReroll(play(started(), 0, 'nature', 4).current!)).toBe(false)
  })

  it('預設用共用骰子', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const go = (itemId: string): BattleStore =>
      playRound(started(), { battleId: 'x', round: 0, itemId, present: [A], now: NOW })
    expect(go('glow').current!.rounds[0].rolls).toEqual([6, 6])
    expect(go('nature').current!.rounds[0].rolls).toEqual([6])
  })

  it('連點、過期回合、出過的、不在手牌的都不動', () => {
    const s = play(started(), 0, 'glow', 5)
    expect(play(s, 0, 'ink', 5)).toBe(s)
    expect(play(s, 1, 'glow', 5)).toBe(s)
    expect(play(s, 1, 'unknown', 5)).toBe(s)
    expect(playRound(s, { battleId: 'y', round: 1, itemId: 'ink', present: [A], now: NOW })).toBe(s)
    const w = waiting()
    expect(play(w, 0, 'glow', 5)).toBe(w)
    const done = fought([4, 4, 4])
    expect(play(done, 3, 'nature', 5)).toBe(done)
  })

  it('同行的發現者上場幫打；不在就由主角代打，不能重擲', () => {
    const items = [item('glow', 'glow-c1', { finderId: 'b', finderName: '乙' }), ...FIVE.slice(1)]
    const helped = play(started(items), 0, 'glow', 1, [A, B]).current!
    expect(helped.rounds[0]).toMatchObject({ actorId: 'b', actorName: '乙', byFinder: true })
    expect(canReroll(helped)).toBe(true)
    const alone = play(started(items), 0, 'glow', 1, [A])
    expect(alone.current!.rounds[0]).toMatchObject({ actorId: 'a', byFinder: false })
    expect(rerollRound(alone, 'x', 0, fixed(6))).toBe(alone)
  })

  it('重擲整場一次，以新結果為準、骰數與出場時間不變', () => {
    const s = play(started(), 0, 'glow', 1)
    const again = rerollRound(s, 'x', 0, fixed(6))
    expect(again.current!.rounds[0]).toEqual({ ...s.current!.rounds[0], rolls: [6, 6] })
    const worse = rerollRound(play(started(), 0, 'glow', 3), 'x', 0, fixed(1))
    expect(worse.current!.rounds[0].rolls).toEqual([1, 1])
    const next = play(worse, 1, 'ink', 1)
    expect(rerollRound(next, 'x', 1, fixed(6))).toBe(next)
    // 已經打到下一回合，不能回頭重擲
    const late = play(s, 1, 'ink', 5)
    expect(rerollRound(late, 'x', 0, fixed(6))).toBe(late)
  })

  it('稀有度不影響骰數', () => {
    for (const kindId of kindsOf('glow')) {
      const s = started([item('g', kindId), ...FIVE.slice(1)])
      expect(play(s, 0, 'g', 2).current!.rounds[0].rolls).toHaveLength(2)
    }
  })
})

describe('結果', () => {
  it.each([
    [[1, 1, 1], 'draw'],
    [[4, 1, 1], 'draw'],
    [[4, 1, 4], 'win'],
    [[6, 5, 4], 'perfect']
  ])('%j → %s', (faces, outcome) => {
    const s = finishBattle(fought(faces), 'x', NOW)
    expect(s.log[0].outcome).toBe(outcome)
    expect(s.dex[dexKey('a', 'tangle')]).toMatchObject({ met: 1, won: outcome !== 'draw', perfect: outcome === 'perfect' })
    expect(s).toMatchObject({ opened: 0, nextAt: 0 })
    expect(s.current).toBeUndefined()
  })

  it('聊聊這場戰鬥：有敵人、誰拿什麼、結果，不含骰面', () => {
    const r = finishBattle(fought([6, 1, 5]), 'x', NOW).log[0]
    const t = buildBattleTalkMessage(r)
    for (const s of ['聊聊這場戰鬥吧', '打結的線團', '甲在路上遇到的', '甲拿出「物glow」，成功了', '「物ink」，它閃過了', '打跑了', r.text.win]) expect(t).toContain(s)
    expect(t).not.toMatch(/[4-6]|undefined/)
  })

  it('沒打完不能收尾，收尾重做不變', () => {
    const half = play(started(), 0, 'glow', 4)
    expect(finishBattle(half, 'x', NOW)).toBe(half)
    const s = finishBattle(fought([4, 4, 4]), 'x', NOW)
    expect(finishBattle(s, 'x', NOW)).toBe(s)
  })

  it('平手不會抹掉打跑過；最多留 20 場', () => {
    let s = defaultBattleStore()
    for (let i = 0; i < LOG_LIMIT + 5; i++) {
      s = finishBattle({ ...s, current: fought(i === 0 ? [4, 4, 4] : [1, 1, 1]).current }, 'x', NOW + i)
    }
    expect(s.log).toHaveLength(LOG_LIMIT)
    expect(s.dex['a:tangle']).toMatchObject({ met: 25, won: true, perfect: true })
  })

  it.each([
    [3, 0.844, 0.422],
    [2, 0.75, 0.281],
    [1, 0.625, 0.188],
    [0, 0.5, 0.125]
  ])('對 %i 回合的機率與文件一致', (matched, win, perfect) => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(7))
    const N = 10_000
    const base = started()
    const weak: Approach[] = WEAK.map((w, i) => (i < matched ? w : 'startle'))
    const from = { ...base, current: { ...base.current!, weak } }
    let wins = 0
    let perfects = 0
    for (let n = 0; n < N; n++) {
      let s: BattleStore = from
      ;['glow', 'ink', 'vessel'].forEach((itemId, round) => {
        s = playRound(s, { battleId: 'x', round, itemId, present: [A], now: NOW })
      })
      const o = outcomeOf(s.current!.rounds)
      if (o !== 'draw') wins++
      if (o === 'perfect') perfects++
    }
    expect(Math.abs(wins / N - win)).toBeLessThan(0.02)
    expect(Math.abs(perfects / N - perfect)).toBeLessThan(0.02)
  })
})

describe('讀取', () => {
  const roundTrip = (s: BattleStore): BattleStore => normalizeBattleStore(JSON.parse(JSON.stringify(s)))

  it('各階段存檔重讀都一樣', () => {
    for (const s of [defaultBattleStore(), waiting(), withFoes(), started(), fought([1, 4]), finishBattle(fought([4, 1, 4]), 'x', NOW)]) {
      expect(roundTrip(s)).toEqual(s)
    }
  })

  it('打到一半重讀可續玩，骰面不變，也不能多重擲', () => {
    const s = roundTrip(rerollRound(play(started(), 0, 'glow', 1), 'x', 0, fixed(2)))
    expect(s.current!.rounds[0].rolls).toEqual([2, 2])
    expect(canReroll(s.current!)).toBe(false)
    expect(play(s, 1, 'ink', 4).current!.rounds).toHaveLength(2)
  })

  it('壞資料退回預設，未知的形略過', () => {
    expect(normalizeBattleStore(null)).toEqual(defaultBattleStore())
    expect(normalizeBattleStore([])).toEqual(defaultBattleStore())
    const t = FOE_FORMS.fog.fallback
    const s = normalizeBattleStore({
      opened: 99,
      nextAt: 4,
      current: { ...waiting().current, form: 'dragon' },
      foes: { a: { name: '甲', list: { dragon: t, fog: t, pile: { name: '缺欄' } } }, b: 3 },
      dex: { 'a:dragon': { text: t }, 'a:fog': { met: 1, text: t } },
      log: [{ id: 'q', form: 'dragon', text: t, outcome: 'win' }, 5]
    })
    expect(s.current).toBeUndefined()
    expect(s.opened).toBe(4)
    expect(Object.keys(s.foes.a.list)).toEqual(['fog'])
    expect(s.foes.b).toBeUndefined()
    expect(Object.keys(s.dex)).toEqual(['a:fog'])
    expect(s.log).toEqual([])
  })

  it('壞掉的回合從那裡截斷', () => {
    const raw = JSON.parse(JSON.stringify(fought([4, 4, 4])))
    raw.current.rounds[1].rolls = [9]
    expect(normalizeBattleStore(raw).current!.rounds).toHaveLength(1)
  })
})
