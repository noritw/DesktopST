import { describe, expect, it } from 'vitest'
import { approachOf, normalizeBattleStore } from '@core/walk/battle'
import { BUILTIN_TREASURES } from '@core/walk/builtinTreasures'
import {
  applyGenerated,
  buildItemPrompt,
  buildItemTalkMessage,
  defaultCollection,
  findItemKind,
  JOURNEY_MAP_IDS,
  normalizeCollection,
  parseItemReply,
  type WalkCollection,
  type WalkItem
} from '@core/walk/items'
import { MAP_ITEMS, MAP_STORIES, findMapItem, kindIdOf } from '@core/walk/mapItems'
import { liveMoveGuide, prepareReveal, weatherTags } from '@core/walk/treasureDraw'

const drop = (id: string, over: Partial<WalkItem> = {}): WalkItem => ({
  id,
  day: '2026-11-25',
  kindId: 'lost-c3',
  finderId: 'f',
  finderName: '星離宸',
  stepsToday: 0,
  status: 'unopened',
  ...over
})
const withItems = (...items: WalkItem[]): WalkCollection => ({ ...defaultCollection(), items })
const one = (c: WalkCollection, i = 0): WalkItem => c.items[i]

describe('地圖道具表', () => {
  it('七張各 24 件：四種做法各 3 尋常、2 罕見、1 奇珍，名稱全不重複', () => {
    expect(MAP_ITEMS).toHaveLength(JOURNEY_MAP_IDS.length * 24)
    expect(new Set(MAP_ITEMS.map((i) => i.id)).size).toBe(MAP_ITEMS.length)
    expect(new Set(MAP_ITEMS.map((i) => i.name)).size).toBe(MAP_ITEMS.length)
    for (const map of JOURNEY_MAP_IDS) {
      expect(MAP_STORIES[map].place).toBeTruthy()
      for (const a of ['lure', 'move', 'trap', 'startle'])
        expect(['common', 'uncommon', 'rare'].map((r) => MAP_ITEMS.filter((i) => i.map === map && i.approach === a && i.rarity === r).length)).toEqual([3, 2, 1])
    }
    expect(MAP_ITEMS.every((i) => i.name && i.look && i.move)).toBe(true)
    for (const t of MAP_ITEMS) expect(findItemKind(kindIdOf(t))).toMatchObject({ rarity: t.rarity })
    for (const t of MAP_ITEMS) expect(approachOf(findItemKind(kindIdOf(t))!.category)).toBe(t.approach)
  })
})

describe('打開箱子時抽', () => {
  it('抽該地圖同稀有度的；定了不再變', () => {
    const c = prepareReveal(withItems(drop('a')), 'a', 'space')
    const i = one(c)
    const t = findMapItem(i.treasureId)!
    expect(t).toMatchObject({ map: 'space', rarity: 'common' })
    expect(i).toMatchObject({ kindId: kindIdOf(t), treasureName: t.name, look: t.look, move: t.move, map: 'space' })
    expect(prepareReveal(c, 'a', 'ruins')).toBe(c)
    expect(one(normalizeCollection(JSON.parse(JSON.stringify(c))))).toMatchObject({ look: t.look, treasureId: t.id })
  })

  it('改版前打開失敗、已有地圖的箱子，照那張地圖抽', () => {
    expect(findMapItem(one(prepareReveal(withItems(drop('a', { map: 'town' })), 'a', 'space')).treasureId)!.map).toBe('town')
  })

  it('十二件尋常找齊前不重複，找齊後輪流再出；丟掉的算找過', () => {
    let c = withItems(...Array.from({ length: 24 }, (_, n) => drop(`d${n}`)))
    for (const i of c.items) c = prepareReveal(c, i.id, 'town')
    const got = c.items.map((i) => i.treasureId!)
    expect(new Set(got.slice(0, 12)).size).toBe(12)
    expect(new Set(got.slice(12)).size).toBe(12)
    const known = MAP_ITEMS.filter((i) => i.map === 'town' && i.rarity === 'common').slice(1)
    const left = prepareReveal({ ...withItems(drop('z')), discovered: Object.fromEntries(known.map((i) => [i.id, 1])) }, 'z', 'town')
    expect(known.map((i) => i.id)).not.toContain(one(left).treasureId)
  })

  it('奇珍偶爾是角色專屬寶物；遺跡與沒有清單的角色不會', () => {
    const run = (map: 'city' | 'ruins', finderName: string): WalkItem[] =>
      Array.from({ length: 60 }, (_, n) => one(prepareReveal(withItems(drop(`r${n * 37}`, { kindId: 'lost-r1', finderName })), `r${n * 37}`, map)))
    const own = run('city', '星離宸').filter((i) => !findMapItem(i.treasureId))
    expect(own.length).toBeGreaterThan(5)
    expect(own.length).toBeLessThan(40)
    for (const i of own) expect(BUILTIN_TREASURES['星離宸'][i.treasureId!]).toMatchObject({ name: i.treasureName, rarity: 'rare' })
    expect(run('ruins', '星離宸').every((i) => findMapItem(i.treasureId))).toBe(true)
    expect(run('city', '別人').every((i) => findMapItem(i.treasureId))).toBe(true)
    expect(weatherTags({ description: '晴時多雲', temperatureC: 31 })).toEqual(['晴', '陰', '熱'])
    expect(weatherTags({ description: '雷陣雨', temperatureC: 12 })).toEqual(['雨', '冷'])
  })

  it('名稱、說明、絕招不被 AI 改掉；找到的記在圖鑑', () => {
    const c = prepareReveal(withItems(drop('a')), 'a', 'space')
    const i = one(c)
    const p = buildItemPrompt(i, '星離宸')
    expect(p).toContain(i.treasureName)
    expect(p).toContain(MAP_STORIES.space.place)
    expect(p).not.toContain('絕招：')
    const text = parseItemReply('故事：在那裡。\n絕招：亂寫一個\n地點：公園', i.treasureName)!
    const done = applyGenerated(c, 'a', text, 5)
    expect(one(done)).toMatchObject({ name: i.treasureName, look: i.look, move: i.move, status: 'kept' })
    expect(one(done).place).toBeUndefined()
    expect(done.discovered).toEqual({ [i.treasureId!]: 5 })
    expect(buildItemTalkMessage(one(done))).toContain(i.look)
  })

  it('即時生成也有理由與絕招，做法跟分類一致', () => {
    const i = drop('a', { kindId: 'vessel-c1', finderName: '別人' })
    const p = buildItemPrompt(i, '別人', liveMoveGuide(i.kindId, '別人'))
    expect(p).toContain('做法是「封鎖」')
    expect(p).toContain('只輸出下面六行')
    expect(parseItemReply('名稱：罐\n故事：在。\n地點：街\n留著：「放著就好。」\n絕招：打開罐子放霧。\n籤語：先做最小的那一步')).toEqual({
      name: '罐', story: '在。', place: '街', effect: undefined, why: '放著就好。', move: '打開罐子放霧', omen: '先做最小的那一步'
    })
    expect(findItemKind('vessel-c1')).toBeDefined()
  })

  it('打到一半重開，絕招還在', () => {
    const hand = ['a', 'b', 'c'].map((id) => ({ itemId: id, name: id, move: `招${id}`, category: 'glow', finderId: 'f', finderName: 'F' }))
    const s = normalizeBattleStore({
      current: { id: 'b', leadId: 'f', leadName: 'F', form: 'bounce', weak: ['lure', 'trap', 'move'], hand, rounds: [], rerollUsed: false }
    })
    expect(s.current?.hand?.[0].move).toBe('招a')
  })
})
