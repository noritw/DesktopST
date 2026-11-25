import { describe, expect, it } from 'vitest'
import { BUILTIN_TREASURES, TREASURE_SAMPLES } from '@core/walk/builtinTreasures'
import { TREASURE_SLOTS, buildTreasurePrompt, parseTreasureReply } from '@core/walk/treasures'

const reply = (n: number): string =>
  TREASURE_SLOTS.slice(0, n).map((s, i) => `${s.id}｜東西${i}號｜留著就好。｜用它把對方引開${i}。｜${i % 2 ? '雨' : '任意'}`).join('\n')

describe('角色寶物清單', () => {
  it('兩份內建清單各 24 種，名稱不重複，不用「妳」也不編共同回憶', () => {
    const all = Object.values(BUILTIN_TREASURES)
    expect(all).toHaveLength(2)
    for (const list of all) {
      const items = Object.values(list)
      expect(Object.keys(list).sort()).toEqual(TREASURE_SLOTS.map((s) => s.id).sort())
      expect(new Set(items.map((t) => t.move)).size).toBe(24)
      const text = items.map((t) => t.name + t.why + t.move).join()
      expect(items.map((t) => t.move).join()).not.toMatch(/星離宸|琉緋璃/)
      expect(text).not.toMatch(/妳|你送|你那天|你第一次|你上次|預設|屍/)
      expect(items.filter((t) => t.weather).length).toBeGreaterThanOrEqual(6)
      expect(items.every((t) => t.name.length <= 10 && t.why.length <= 30 && t.move.length <= 30)).toBe(true)
    }
    const names = all.flatMap((l) => Object.values(l).map((t) => t.name))
    expect(new Set(names).size).toBe(48)
  })

  it('解析：容忍雜訊，壞行與重複略過，太少視為失敗', () => {
    const list = parseTreasureReply(`好的：\n${reply(24)}\nglow-c1｜重複｜留著。｜不該蓋掉前面的`)
    expect(Object.keys(list!)).toHaveLength(24)
    expect(list!['glow-c1']).toMatchObject({ category: 'glow', rarity: 'common', name: '東西0號', move: '用它把對方引開0' })
    expect(list!['glow-c1'].weather).toBeUndefined()
    expect(list!['glow-u1'].weather).toBe('雨')
    expect(parseTreasureReply(reply(17))).toBeNull()
    expect(parseTreasureReply(`${reply(18)}\nglow-x9｜壞代號｜留著。｜不算數的`)).not.toBeNull()
  })

  it('prompt 列出全部代號', () => {
    const p = buildTreasurePrompt('甲', TREASURE_SAMPLES)
    expect(p).toContain('要喝茶自己泡')
    expect(p).not.toMatch(/星離宸|琉緋璃/)
    for (const s of TREASURE_SLOTS) expect(p).toContain(s.id)
  })
})
