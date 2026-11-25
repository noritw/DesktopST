import { describe, expect, it, vi } from 'vitest'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { creditSteps, defaultWalkSettings, defaultWalkState, normalizeWalkState, shiftDay } from '@core/walk'
import {
  ITEM_KINDS,
  RARE_PITY,
  advanceItemProgress,
  buildItemPrompt,
  defaultItemProgress,
  discardItem,
  buildItemTalkMessage,
  findItemKind,
  useItem,
  journeyMapFor,
  normalizeCollection,
  parseItemReply,
  sortItems,
  type ItemSort
} from '@core/walk/items'
import { FORTUNES, USE_REACTIONS, cleanFortune, drawFortune, fortuneKindAt } from '@core/walk/itemFortunes'
import { clearWalkData, loadWalkState, localDay, saveWalkSettings, syncWalk, updateWalkState } from '../../src/mobile/runtime/walk'
import {
  collectWalkDrops,
  loadCollection,
  revealWalkItem,
  simulateWalkSteps,
  updateCollection
} from '../../src/mobile/runtime/walkItems'

const NOW = new Date(2026, 10, 25, 18, 0).getTime()
const T = localDay(NOW)
let seq = 0
const ctx = (): { finders: { id: string; name: string }[]; newId: () => string } => ({
  finders: [{ id: 'a', name: '甲' }],
  newId: () => `d${++seq}`
})
const REPLY = '名稱：「破舊的字典」\n故事：它卡在石縫裡。\n我翻了三頁。\n地點：舊城牆\n效果：心情會變好，無法驗證。'

async function withItems(steps = 10_000): Promise<ReturnType<typeof createMemoryStorage>> {
  const storage = createMemoryStorage()
  await simulateWalkSteps(storage, steps, ctx(), NOW)
  await (await collectWalkDrops(storage, async () => ({ description: '小雨', temperatureC: 21.6 }), NOW)).weatherDone
  return storage
}
const reveal = (storage: ReturnType<typeof createMemoryStorage>, itemId: string, over = {}) =>
  revealWalkItem({
    storage,
    itemId,
    hasApiKey: true,
    findCharacter: () => ({ name: '甲' }),
    generate: async (_c: { name: string }, _p: string, _s: AbortSignal) => REPLY,
    ...over
  })

describe('拾物：品項', () => {
  it('96 種、id 不重複、每類 6／4／2', () => {
    expect(ITEM_KINDS).toHaveLength(96)
    expect(new Set(ITEM_KINDS.map((k) => k.id)).size).toBe(96)
    for (const r of [['common', 48], ['uncommon', 32], ['rare', 16]] as const)
      expect(ITEM_KINDS.filter((k) => k.rarity === r[0])).toHaveLength(r[1])
  })

  it('保底：最慢第 26 件必為奇珍', () => {
    const r = advanceItemProgress(defaultItemProgress(), 2500 * (RARE_PITY + 1), { day: T, stepsToday: 0 }, { ...ctx(), random: () => 0.1 })
    const rare = r.drops.findIndex((d) => findItemKind(d.kindId)!.rarity === 'rare')
    expect(rare).toBe(RARE_PITY)
  })

  it('沒有同行角色不累積', () => {
    const p = defaultItemProgress()
    expect(advanceItemProgress(p, 9999, { day: T, stepsToday: 0 }, { ...ctx(), finders: [] })).toEqual({ progress: p, drops: [] })
  })
})

describe('拾物：記帳不漏不重', () => {
  const run = (s: ReturnType<typeof defaultWalkState>, totals: Record<string, number>, today = T) =>
    creditSteps(s, totals, ['a'], today, NOW, ctx())

  it('首次啟用不補發；重讀與變少不重發；晚到會補', () => {
    let s = run(defaultWalkState(), { [T]: 20_000 })
    expect(s.pendingDrops).toEqual([])
    s = run(s, { [T]: 30_000 })
    const n = s.pendingDrops.length
    expect(n).toBeGreaterThanOrEqual(4)
    expect(run(s, { [T]: 30_000 }).pendingDrops).toHaveLength(n)
    expect(run(s, { [T]: 25_000 }).pendingDrops).toHaveLength(n)
    const tomorrow = shiftDay(T, 1)
    const late = run(s, { [T]: 35_000, [tomorrow]: 0 }, tomorrow)
    expect(late.pendingDrops.length).toBeGreaterThan(n)
    expect(late.pendingDrops.at(-1)!.day).toBe(T)
  })

  it('進度與掉落寫檔後讀回不會消失', () => {
    const s = run(run(defaultWalkState(), { [T]: 0 }), { [T]: 10_000 })
    const back = normalizeWalkState(JSON.parse(JSON.stringify(s)))
    expect(back.pendingDrops).toEqual(s.pendingDrops)
    expect(back.itemProgress).toEqual(s.itemProgress)
  })

  it('重疊同步只發一次', async () => {
    const storage = createMemoryStorage()
    await saveWalkSettings(storage, { ...defaultWalkSettings(), enabled: true })
    const sync = (n: number): Promise<unknown> =>
      syncWalk({ storage, companionIds: ['a'], readDays: async () => ({ [T]: n }), dropCtx: ctx(), now: NOW })
    await sync(0)
    await Promise.all([sync(8000), sync(8000)])
    const total = (await loadWalkState(storage)).pendingDrops.length
    expect(total).toBeGreaterThanOrEqual(3)
    expect(total).toBeLessThanOrEqual(6)
  })

  it('搬移中斷重做、丟掉之後都不會長回來', async () => {
    const storage = createMemoryStorage()
    await simulateWalkSteps(storage, 10_000, ctx(), NOW)
    const drops = (await loadWalkState(storage)).pendingDrops
    await collectWalkDrops(storage, async () => null, NOW)
    expect((await loadWalkState(storage)).pendingDrops).toEqual([])
    const before = (await loadCollection(storage)).items.length
    await updateCollection(storage, (c) => discardItem(c, drops[0].id))
    await updateWalkState(storage, (s) => ({ ...s, pendingDrops: drops }))
    await collectWalkDrops(storage, async () => null, NOW)
    expect((await loadCollection(storage)).items).toHaveLength(before - 1)
  })

  it('天氣還沒查到，物品就先出現；已經打開的不補', async () => {
    const storage = createMemoryStorage()
    await simulateWalkSteps(storage, 10_000, ctx(), NOW)
    let give: (w: { description: string; temperatureC: number }) => void = () => {}
    const r = await collectWalkDrops(storage, () => new Promise((resolve) => { give = resolve }), NOW)
    expect((await loadCollection(storage)).items.length).toBeGreaterThan(1)
    await updateCollection(storage, (c) => ({ ...c, items: c.items.map((i, n) => (n === 0 ? { ...i, map: 'city' as const } : i)) }))
    give({ description: '小雨', temperatureC: 21 })
    await r.weatherDone
    const items = (await loadCollection(storage)).items
    expect(items[0].weather).toBeUndefined()
    expect(items[1].weather?.description).toBe('小雨')
  })

  it('天氣只附當天的', async () => {
    const storage = await withItems()
    expect((await loadCollection(storage)).items[0].weather?.description).toBe('小雨')
    const old = createMemoryStorage()
    await simulateWalkSteps(old, 10_000, ctx(), NOW - 86_400_000)
    await (await collectWalkDrops(old, async () => ({ description: '晴', temperatureC: 20 }), NOW)).weatherDone
    expect((await loadCollection(old)).items[0].weather).toBeUndefined()
  })

  it('模擬步數不動里程；清除步數不清道具', async () => {
    const storage = await withItems()
    expect((await loadWalkState(storage)).byCharacter).toEqual({})
    await simulateWalkSteps(storage, 10_000, ctx(), NOW)
    const pending = (await loadWalkState(storage)).pendingDrops
    await clearWalkData(storage)
    expect((await loadWalkState(storage)).pendingDrops).toEqual(pending)
    expect((await loadCollection(storage)).items.length).toBeGreaterThan(0)
  })
})

describe('拾物：使用', () => {
  it('每件一次，存檔讀回不變；還沒揭曉不能用', async () => {
    const storage = await withItems()
    const id = (await loadCollection(storage)).items[0].id
    expect((await updateCollection(storage, (c) => useItem(c, id, 1))).items[0].fortune).toBeUndefined()
    await reveal(storage, id)
    await updateCollection(storage, (c) => useItem(c, id, 1))
    const first = (await loadCollection(storage)).items[0].fortune!
    await updateCollection(storage, (c) => useItem(c, id, 2))
    const item = (await loadCollection(storage)).items[0]
    expect(item.fortune).toEqual(first)
    expect(buildItemTalkMessage(item)).toContain(first.text)
  })

  it('用的是揭曉時寫好的籤語，用之前不外流；漏寫或不合格才抽備用', async () => {
    const storage = await withItems()
    const [a, b] = (await loadCollection(storage)).items
    await reveal(storage, a.id, { generate: async () => `${REPLY}\n籤語：「停在這裡也沒關係，明天再翻下一頁。」` })
    const item = (await loadCollection(storage)).items[0]
    expect(item.effect).toBe('心情會變好，無法驗證。')
    expect(buildItemTalkMessage(item)).not.toContain('停在這裡')
    const c = await updateCollection(storage, (cur) => useItem(cur, a.id, 1))
    expect(c.items[0].fortune?.text).toBe('停在這裡也沒關係，明天再翻下一頁')
    await reveal(storage, b.id, { generate: async () => `${REPLY}\n籤語：小心會生病` })
    const d = await updateCollection(storage, (cur) => useItem(cur, b.id, 2))
    expect(Object.values(FORTUNES).flat()).toContain(d.items[1].fortune?.text)
    expect(cleanFortune('')).toBeUndefined()
  })

  it('備用句都過得了自己的檢查；同一個 roll 同一類', () => {
    for (const t of Object.values(FORTUNES).flat()) expect(cleanFortune(t)).toBe(t)
    expect([0, 0.39, 0.41, 0.67, 0.69, 0.87, 0.89, 0.99].map(fortuneKindAt)).toEqual(['luck', 'luck', 'answer', 'answer', 'mood', 'mood', 'care', 'care'])
  })

  it('試玩期用過多次的，留最後一句且不能再用', () => {
    const base = { id: 'x', day: T, kindId: 'glow-c1', finderId: 'a', finderName: '甲', status: 'kept', name: '燈' }
    const c = normalizeCollection({ items: [{ ...base, uses: [{ text: '一', at: 1 }, { reaction: '亮', text: '二', at: 2 }] }] })
    expect(c.items[0].fortune).toEqual({ reaction: '亮', text: '二', at: 2 })
    expect(useItem(c, 'x', 3)).toBe(c)
  })

  it('籤語不重複、夠短，提醒類是少數，不碰負面與療效', () => {
    const all = Object.values(FORTUNES).flat()
    expect(new Set(all).size).toBe(all.length)
    expect(all.every((t) => t.length <= 24)).toBe(true)
    expect(all.join()).not.toMatch(/死|病|治|癌|失敗|投資|股票|彩券|賭/)
    expect(Object.values(USE_REACTIONS).every((l) => l.length >= 2)).toBe(true)
    let care = 0
    for (let i = 0; i < 4000; i++) if (FORTUNES.care.includes(drawFortune([]))) care++
    expect(care / 4000).toBeLessThan(0.16)
  })

  it('避開最近抽過的', () => {
    const avoid = FORTUNES.luck.slice(1)
    expect(drawFortune(avoid, () => 0)).toBe(FORTUNES.luck[0])
  })
})

describe('拾物：揭曉', () => {
  it('成功後有名稱故事並點亮圖鑑，再揭曉不會重新生成', async () => {
    const storage = await withItems()
    const id = (await loadCollection(storage)).items[0].id
    const generate = vi.fn(async () => REPLY)
    const r = await reveal(storage, id, { generate })
    expect(r.ok && r.item).toMatchObject({ name: '破舊的字典', story: '它卡在石縫裡。 我翻了三頁。', place: '舊城牆', status: 'kept' })
    await reveal(storage, id, { generate })
    expect(generate).toHaveBeenCalledTimes(1)
    const c = await loadCollection(storage)
    expect(Object.keys(c.discovered)).toEqual([c.items[0].kindId])
  })

  it('失敗不掉道具，重試時條件不變', async () => {
    const storage = await withItems()
    const id = (await loadCollection(storage)).items[0].id
    expect(await reveal(storage, id, { generate: async () => { throw new Error('x') } })).toEqual({ ok: false, reason: 'failed' })
    let prompt = ''
    expect(await reveal(storage, id, { generate: async (_c: { name: string }, p: string) => ((prompt = p), '我不知道') })).toEqual({ ok: false, reason: 'failed' })
    expect(await reveal(storage, id, { hasApiKey: false })).toEqual({ ok: false, reason: 'no_key' })
    expect((await loadCollection(storage)).items[0].status).toBe('unopened')
    const generate = vi.fn(async (_c: { name: string }, _p: string) => REPLY)
    expect((await reveal(storage, id, { generate })).ok).toBe(true)
    expect(generate.mock.calls[0][1]).toBe(prompt)
  })

  it('打開時所在的地圖決定道具；失敗後換地圖也不變', async () => {
    const storage = await withItems()
    const [a, b] = (await loadCollection(storage)).items
    await reveal(storage, a.id, { map: 'ruins', generate: async () => { throw new Error('x') } })
    const first = (await loadCollection(storage)).items[0]
    const generate = vi.fn(async (_c: { name: string }, _p: string) => '故事：這個有刮痕。我試了一下。\n籤語：先做最小的那一步')
    const r = await reveal(storage, a.id, { map: 'dream', generate })
    expect(r.ok && r.item).toMatchObject({ name: first.treasureName, look: first.look, move: first.move, map: 'ruins', story: '這個有刮痕。我試了一下。' })
    expect(generate.mock.calls[0][1]).toContain('不解釋、不猜原因')
    await reveal(storage, b.id, { map: 'dream', generate })
    expect(generate.mock.calls[1][1]).not.toContain('不猜原因')
    expect((await loadCollection(storage)).items.slice(0, 2).map((i) => i.map)).toEqual(['ruins', 'dream'])
  })

  it('選的地圖會存下來；沒選或認不得就每天輪替', () => {
    expect(normalizeCollection({ map: 'ruins' }).map).toBe('ruins')
    expect(normalizeCollection({ map: 'nope' }).map).toBeUndefined()
    expect(journeyMapFor('ruins', T)).toBe('ruins')
    expect(journeyMapFor(undefined, T)).toBe(journeyMapFor(undefined, T))
    const seen = new Set(Array.from({ length: 60 }, (_, i) => journeyMapFor(undefined, shiftDay(T, i))))
    expect(seen.size).toBe(7)
  })

  it('連點只生成一次', async () => {
    const storage = await withItems()
    const id = (await loadCollection(storage)).items[0].id
    const generate = vi.fn(async () => REPLY)
    await Promise.all([reveal(storage, id, { generate }), reveal(storage, id, { generate })])
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('prompt 不含步數與吉凶', async () => {
    const storage = await withItems()
    const item = { ...(await loadCollection(storage)).items[0], stepsToday: 98765 }
    const p = buildItemPrompt(item, '甲')
    expect(p).not.toContain('98765')
    expect(p).toContain('22°C')
    expect(p).toContain('怎麼發現的：')
    expect(p).not.toMatch(/吉|凶|抽籤/)
    expect(p).toContain('籤語：')
    expect(p).toContain('沒有主人')
    expect(p).not.toMatch(/撿|有人掉了/)
  })

  it('發現經過不跟角落綁在一起', () => {
    const pairs = new Set<string>()
    const item = { day: T, kindId: 'glow-c1', finderId: 'a', finderName: '甲', stepsToday: 0, status: 'unopened' as const }
    for (let i = 0; i < 2000; i++) {
      const p = buildItemPrompt({ ...item, id: `drop-${i}-${(i * 7919).toString(36)}` }, '甲')
      pairs.add(`${p.match(/怎麼發現的：(.*)/)![1]}|${p.match(/某處的「(.*?)」/)![1]}`)
    }
    expect(pairs.size).toBe(72)
  })

  it('舊資料的「還沒收好」視為已收，吉凶不再帶出', () => {
    const base = { id: 'x', day: T, kindId: 'glow-c1', finderId: 'a', finderName: '甲', stepsToday: 1, omikuji: '凶' }
    const c = normalizeCollection({ items: [{ ...base, status: 'opened', name: '燈' }, { ...base, id: 'y', status: 'opened' }] })
    expect(c.items.map((i) => i.status)).toEqual(['kept', 'unopened'])
    expect(c.items[0]).not.toHaveProperty('omikuji')
  })

  it('解析容忍 markdown 與全半形冒號', () => {
    expect(parseItemReply('**名稱**: 鈴\n- 故事：響了。\n')).toMatchObject({ name: '鈴', story: '響了。' })
    expect(parseItemReply('名稱：鈴')).toBeNull()
  })
})

describe('物品排序', () => {
  const mk = (id: string, kindId: string, name: string, finderName: string) => ({ id, kindId, name, finderName, day: T, finderId: finderName, stepsToday: 0 })
  const list = [mk('1', 'gear-c1', '乙', '王'), mk('2', 'glow-r1', '甲', '李'), mk('3', 'glow-u1', '丙', '王'), mk('4', 'gear-c2', '丁', '李')]
  const by = (s?: ItemSort): string => sortItems(list, s).map((i) => i.id).join('')

  it('各種排序，同組新的在前，不改原陣列', () => {
    expect(by()).toBe('4321')
    expect(by('newest')).toBe('4321')
    expect(by('oldest')).toBe('1234')
    expect(by('approach')).toBe('3241')
    expect(by('rarity')).toBe('2341')
    expect(['4231', '3142']).toContain(by('finder'))
    expect([...by('name')].sort().join('')).toBe('1234')
    expect(list.map((i) => i.id).join('')).toBe('1234')
  })

  it('排序存得下來，亂值退回預設', () => {
    expect(normalizeCollection({ sort: 'rarity' }).sort).toBe('rarity')
    expect(normalizeCollection({ sort: 'x' }).sort).toBeUndefined()
  })
})
