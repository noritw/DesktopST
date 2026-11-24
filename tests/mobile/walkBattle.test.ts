import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { FOE_FORMS } from '@core/walk/battle'
import type { WalkItem } from '@core/walk/items'
import {
  beginBattle,
  countOpenedBox,
  endBattle,
  forceEncounter,
  loadBattles,
  playBattleRound,
  rerollBattleRound,
  syncBattles,
  updateBattles
} from '../../src/mobile/runtime/walkBattle'
import { loadCollection, revealWalkItem, updateCollection } from '../../src/mobile/runtime/walkItems'

const A = { id: 'a', name: '甲' }
const NOW = 1_800_000_000_000
const REPLY = '名稱：破舊的字典\n故事：它卡在石縫裡。\n地點：舊城牆\n效果：心情會變好。'
const item = (id: string, kindId: string, name?: string): WalkItem => ({
  id,
  kindId,
  day: '2026-11-25',
  finderId: 'a',
  finderName: '甲',
  stepsToday: 1,
  status: name ? 'kept' : 'unopened',
  name
})

type Storage = ReturnType<typeof createMemoryStorage>

async function ready(): Promise<Storage> {
  const storage = createMemoryStorage()
  const items = ['glow-c1', 'ink-c1', 'vessel-c1'].map((k) => item(k, k, k))
  await updateCollection(storage, (c) => ({ ...c, items }))
  await forceEncounter(storage)
  return storage
}
const meet = (s: Storage, people = [A]): ReturnType<typeof syncBattles> => syncBattles(s, { present: people, newId: () => 'x' })
const play = (s: Storage, round: number, itemId: string): ReturnType<typeof playBattleRound> =>
  playBattleRound(s, { battleId: 'x', round, itemId, present: [A], now: NOW + round, roll: (n) => Array(n).fill(2) })

describe('過招落地', () => {
  it('開箱成功才計數，已揭曉再點、失敗都不算', async () => {
    const storage = createMemoryStorage()
    await updateCollection(storage, (c) => ({ ...c, items: [item('n', 'glow-c1')] }))
    const go = (reply: string): ReturnType<typeof revealWalkItem> =>
      revealWalkItem({
        storage,
        itemId: 'n',
        hasApiKey: true,
        findCharacter: () => A,
        generate: async () => reply,
        onRevealed: () => countOpenedBox(storage)
      })
    await go('壞格式')
    expect((await loadBattles(storage)).opened).toBe(0)
    await Promise.all([go(REPLY), go(REPLY)])
    await go(REPLY)
    expect((await loadBattles(storage)).opened).toBe(1)
  })

  it('計數失敗不影響揭曉', async () => {
    const storage = createMemoryStorage()
    await updateCollection(storage, (c) => ({ ...c, items: [item('n', 'glow-c1')] }))
    const r = await revealWalkItem({
      storage,
      itemId: 'n',
      hasApiKey: true,
      findCharacter: () => A,
      generate: async () => REPLY,
      onRevealed: async () => {
        throw new Error('x')
      }
    })
    expect(r.ok).toBe(true)
  })

  it('整場：出場時間寫到物品，重讀續打，收尾清掉對手', async () => {
    const s = await ready()
    expect((await meet(s)).current?.id).toBe('x')
    expect((await beginBattle(s, 'x', NOW)).current?.hand).toHaveLength(3)
    await Promise.all([play(s, 0, 'glow-c1'), play(s, 0, 'ink-c1')])
    expect((await loadBattles(s)).current?.rounds).toHaveLength(1)
    const first = (await loadBattles(s)).current!.rounds[0]
    expect(first.rolls.every((r) => r === 2)).toBe(true)
    await rerollBattleRound(s, 'x', 0)
    expect((await loadBattles(s)).current?.rerollUsed).toBe(true)
    await play(s, 1, 'ink-c1')
    await play(s, 2, 'vessel-c1')
    const done = await endBattle(s, 'x', NOW + 9)
    expect(done.current).toBeUndefined()
    expect(done.log).toHaveLength(1)
    const { items } = await loadCollection(s)
    expect(items.map((i) => i.lastBattleAt)).toEqual([NOW, NOW + 1, NOW + 2])
    expect(items.map((i) => i.name)).toEqual(['glow-c1', 'ink-c1', 'vessel-c1'])
    expect((await endBattle(s, 'x')).log).toHaveLength(1)
  })

  it('出場時間沒寫到就中斷，下次進旅途補寫', async () => {
    const s = await ready()
    await meet(s)
    await beginBattle(s, 'x', NOW)
    await play(s, 0, 'glow-c1')
    await updateCollection(s, (c) => ({ ...c, items: c.items.map((i) => ({ ...i, lastBattleAt: undefined })) }))
    await meet(s)
    expect((await loadCollection(s)).items[0].lastBattleAt).toBe(NOW)
  })

  it('打到一半丟掉手牌仍能打完', async () => {
    const s = await ready()
    await meet(s)
    await beginBattle(s, 'x', NOW)
    await updateCollection(s, (c) => ({ ...c, items: [] }))
    await play(s, 0, 'glow-c1')
    await play(s, 1, 'ink-c1')
    await play(s, 2, 'vessel-c1')
    expect((await endBattle(s, 'x')).log[0].rounds.map((r) => r.itemName)).toEqual(['glow-c1', 'ink-c1', 'vessel-c1'])
  })

  it('沒有同行角色不出現；主角離開會換人', async () => {
    const s = await ready()
    expect((await meet(s, [])).current).toBeUndefined()
    await meet(s)
    expect((await meet(s, [{ id: 'b', name: '乙' }])).current?.leadId).toBe('b')
  })

  it('沒有變動不重寫檔案；壞檔退回預設', async () => {
    const s = createMemoryStorage()
    await updateBattles(s, (x) => x)
    await s.writeJson('modules/desktopst.walk/battles.json', { current: 3, dex: [], log: 'x' })
    expect((await loadBattles(s)).current).toBeUndefined()
    expect(Object.keys(FOE_FORMS)).toHaveLength(6)
  })
})
