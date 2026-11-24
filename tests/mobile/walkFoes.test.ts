import { describe, expect, it, vi } from 'vitest'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { FOE_FORM_IDS, defaultBattleStore, normalizeBattleStore } from '@core/walk/battle'
import { MIN_FOES, buildFoePrompt, parseFoeReply } from '@core/walk/foes'
import { loadBattles, updateBattles, writeFoes } from '../../src/mobile/runtime/walkBattle'

const section = (id: string, draw = '它自己走了。坐一下吧。'): string =>
  `形：${id}\n名稱：「難解的Bug」\n出場：又是你。\n大勝：它消失了。「痛快。」\n打跑：它退開了。\n平手：${draw}`
const reply = (ids: readonly string[] = FOE_FORM_IDS): string => ids.map((id) => section(id)).join('\n\n')
const C = { id: 'c', name: '紀天行' }

describe('敵人 prompt', () => {
  it('有六個形與「麻煩不是人」的規則', () => {
    const p = buildFoePrompt('紀天行')
    for (const id of FOE_FORM_IDS) expect(p).toContain(`- ${id}：`)
    expect(p).toContain('對手是麻煩本身，不是人')
    expect(p).not.toContain('縣市')
  })
})

describe('敵人解析', () => {
  it('六段都讀到', () => {
    const list = parseFoeReply(reply())!
    expect(Object.keys(list).sort()).toEqual([...FOE_FORM_IDS].sort())
    expect(list.tangle).toEqual({
      name: '難解的Bug',
      intro: '又是你。',
      perfect: '它消失了。「痛快。」',
      win: '它退開了。',
      draw: '它自己走了。坐一下吧。'
    })
  })

  it('容忍粗體、大小寫、前言、分隔線、CRLF、半形冒號', () => {
    const messy = `好的，以下是：\n\n${reply()}`
      .replace(/形：(\w)/g, (_, c: string) => `**形：**${c.toUpperCase()}`)
      .replace(/名稱：/g, '- **名稱**: ')
      .replace(/\n\n/g, '\n\n---\n\n')
      .replace(/\n/g, '\r\n')
    const list = parseFoeReply(messy)!
    expect(Object.keys(list)).toHaveLength(6)
    expect(list.pile?.name).toBe('難解的Bug')
    expect(list.pile?.draw).toBe('它自己走了。坐一下吧。')
  })

  it('缺欄、責備的段落作廢；少於 4 段視為失敗', () => {
    const broken = [section('tangle').replace(/出場.*\n/, ''), section('spike', '真可惜。'), reply(FOE_FORM_IDS.slice(2))].join('\n')
    expect(Object.keys(parseFoeReply(broken)!)).toEqual(FOE_FORM_IDS.slice(2))
    expect(parseFoeReply(reply(FOE_FORM_IDS.slice(0, MIN_FOES - 1)))).toBeNull()
    expect(parseFoeReply('抱歉，我不能幫忙。')).toBeNull()
  })

  it('尾巴被截斷時，前面完整的還能用；工程師題材的「輸入」不算責備', () => {
    const cut = reply().slice(0, -30)
    expect(Object.keys(parseFoeReply(cut)!)).toHaveLength(5)
    const ok = [section('tangle', '它去別的輸入框玩了。'), reply(FOE_FORM_IDS.slice(1))].join('\n')
    expect(parseFoeReply(ok)!.tangle).toBeDefined()
  })
})

describe('寫敵人', () => {
  const deps = (generate: () => Promise<string>) => ({
    storage: createMemoryStorage(),
    character: C as typeof C | null,
    hasApiKey: true,
    generate
  })

  it('成功才存，同時只呼叫一次', async () => {
    const gen = vi.fn(async () => reply())
    const d = deps(gen)
    const [a, b] = await Promise.all([writeFoes(d), writeFoes(d)])
    expect(gen).toHaveBeenCalledTimes(1)
    expect(a.ok && b.ok).toBe(true)
    const saved = await loadBattles(d.storage)
    expect(saved.foes.c.name).toBe('紀天行')
    expect(Object.keys(saved.foes.c.list)).toHaveLength(6)
  })

  it('換批失敗保留舊的；換批少寫的形留著上一批', async () => {
    const d = deps(async () => reply())
    await writeFoes(d)
    const before = (await loadBattles(d.storage)).foes
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await writeFoes({ ...d, generate: async () => '壞' })).toEqual({ ok: false, reason: 'failed' })
    expect(await writeFoes({ ...d, generate: () => Promise.reject(new Error('x')) })).toEqual({ ok: false, reason: 'failed' })
    expect((await loadBattles(d.storage)).foes).toEqual(before)
    await writeFoes({ ...d, generate: async () => reply(FOE_FORM_IDS.slice(0, 4)).replace(/難解的Bug/g, '新的') })
    const { list } = (await loadBattles(d.storage)).foes.c
    expect(list.tangle?.name).toBe('新的')
    expect(list.bounce?.name).toBe('難解的Bug')
  })

  it('換批不動進行中的對手與圖鑑', async () => {
    const d = deps(async () => reply())
    const text = { name: '舊', intro: '舊', perfect: '舊', win: '舊', draw: '舊' }
    const hand = ['1', '2', '3'].map((itemId) => ({ itemId, name: itemId, category: 'glow' as const, finderId: 'c', finderName: '紀天行' }))
    await updateBattles(d.storage, () => ({
      ...defaultBattleStore(),
      current: { id: 'x', leadId: 'c', leadName: '紀天行', form: 'tangle', weak: ['lure', 'move', 'trap'], hand, text, rounds: [], rerollUsed: false },
      dex: { 'c:tangle': { met: 1, won: true, perfect: false, text, leadName: '紀天行' } }
    }))
    await writeFoes(d)
    const s = await loadBattles(d.storage)
    expect(s.current?.text).toEqual(text)
    expect(s.dex['c:tangle'].text).toEqual(text)
  })

  it('沒金鑰、沒角色不呼叫；逾時會中止', async () => {
    const gen = vi.fn(async () => reply())
    expect(await writeFoes({ ...deps(gen), hasApiKey: false })).toEqual({ ok: false, reason: 'no_key' })
    expect(await writeFoes({ ...deps(gen), character: null })).toEqual({ ok: false, reason: 'no_character' })
    expect(gen).not.toHaveBeenCalled()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    let signal: AbortSignal | undefined
    const r = await writeFoes({
      ...deps(gen),
      generate: (_c, _p, s) => {
        signal = s
        return new Promise(() => {})
      },
      timeoutMs: 10
    })
    expect(r).toEqual({ ok: false, reason: 'failed' })
    expect(signal?.aborted).toBe(true)
  })

  it('同意與拒絕會存下來', () => {
    expect(normalizeBattleStore({ consented: true, declined: true })).toMatchObject({ consented: true, declined: true })
    expect(normalizeBattleStore({})).toMatchObject({ consented: false, declined: false })
  })
})
