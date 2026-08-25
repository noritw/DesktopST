import { describe, expect, it } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import * as keys from '@core/store/keys'
import type { ChoiceMap, PairTable } from '@core/sync/pair'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'
import { applySync } from '../../src/mobile/runtime/syncApply'

const SRC = { baseUrl: 'http://192.168.1.20:3721', token: 'tok' }

function adapters(): PlatformAdapters {
  return {
    storage: createMemoryStorage(),
    secrets: unavailableSecrets,
    http: { fetch: (() => Promise.reject(new Error('unused'))) as typeof fetch, supportsStreaming: false },
    scheduler: { schedule: () => {}, cancel: () => {}, cancelAll: () => {} },
    notifier: { notify: () => Promise.resolve() }
  }
}

const bootSession = (): Promise<StandaloneSession> => bootStandaloneSession(adapters(), { skipPackFetch: true })

function emptyTable(over: Partial<PairTable> = {}): PairTable {
  return { characters: [], personas: [], worlds: [], scenes: [], lorebooks: [], reminders: [], characterDisplay: [], ...over }
}

function emptyChoices(over: Partial<ChoiceMap> = {}): ChoiceMap {
  return { characters: {}, personas: {}, worlds: {}, scenes: {}, lorebooks: {}, reminders: {}, characterDisplay: {}, ...over }
}

/**
 * 造假電腦端。`presets` 是電腦上現有的資料（供 GET 用），
 * `calls` 記錄所有請求，`newIdFor` 模擬「電腦收到後自己發一顆新 id」——
 * 那正是 M3 對應表寫錯的來源，測試必須涵蓋。
 */
function makeFakeDesktop(opts: { presets?: Record<string, unknown>; newIdFor?: Record<string, string> } = {}) {
  const calls: { method: string; path: string; body?: any }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.replace(SRC.baseUrl, '')
    const method = init?.method ?? 'GET'
    let body: any
    if (typeof init?.body === 'string') body = JSON.parse(init.body)
    calls.push({ method, path, body })

    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

    const presetSave = /^\/api\/presets\/(persona|world|scene)\/save$/.exec(path)
    if (presetSave) {
      const sent = body.preset
      // 電腦端的真實行為：送來的 id 不存在就發一顆新的（savePersonaPresetDirect）
      const id = sent.id || opts.newIdFor?.[sent.name] || `desktop-new-${sent.name}`
      return json({ preset: { ...sent, id } })
    }
    const presetGet = /^\/api\/presets\/(persona|world|scene)\/(.+)$/.exec(path)
    if (method === 'GET' && presetGet) {
      const p = opts.presets?.[decodeURIComponent(presetGet[2])]
      if (!p) return new Response('not found', { status: 404 })
      return json({ preset: p })
    }
    if (path === '/api/lorebooks/save') return json({ book: body.book })
    const loreGet = /^\/api\/lorebooks\/(.+)$/.exec(path)
    if (method === 'GET' && loreGet) {
      const b = opts.presets?.[decodeURIComponent(loreGet[1])]
      if (!b) return new Response('not found', { status: 404 })
      return json({ book: b })
    }
    return json({ ok: true })
  }) as typeof fetch

  return { fetchImpl, calls }
}

describe('applySync 方向', () => {
  it("choice 'local' ＝ 推到電腦（POST），不會反過來改手機", async () => {
    const session = await bootSession()
    const persona = { id: 'p-local', name: '測試使用者', displayName: 'A', nickname: 'B', description: 'D', createdAt: 1, updatedAt: 2 }
    session.personas.push(persona as any)

    const { fetchImpl, calls } = makeFakeDesktop()
    const table = emptyTable({ personas: [{ key: 'k', name: '測試使用者', localId: 'p-local' }] })
    const res = await applySync(SRC, session, { table, choices: emptyChoices({ personas: { k: 'local' } }) }, fetchImpl)

    expect(res.failed).toEqual([])
    expect(res.pushed.personas).toEqual(['測試使用者'])
    expect(res.pulled.personas).toEqual([])
    const save = calls.find((c) => c.path === '/api/presets/persona/save')
    expect(save?.body.preset.description).toBe('D')
  })

  it("choice 'remote' ＝ 從電腦帶回手機，落地成手機那份的 id（不會多一筆）", async () => {
    const session = await bootSession()
    session.personas.push({ id: 'p-local', name: '測試使用者', displayName: '舊', nickname: '', description: '舊的', createdAt: 1, updatedAt: 2 } as any)

    const { fetchImpl } = makeFakeDesktop({
      presets: { 'p-desktop': { id: 'p-desktop', name: '測試使用者', displayName: '新', nickname: '', description: '電腦改過', createdAt: 1, updatedAt: 9 } }
    })
    const table = emptyTable({ personas: [{ key: 'k', name: '測試使用者', localId: 'p-local', remoteId: 'p-desktop', compare: 'differs' }] })
    const res = await applySync(SRC, session, { table, choices: emptyChoices({ personas: { k: 'remote' } }) }, fetchImpl)

    expect(res.failed).toEqual([])
    expect(res.pulled.personas).toEqual(['測試使用者'])
    const landed = await session.adapters.storage.readJson<any>(keys.personaKey('p-local'))
    expect(landed.description).toBe('電腦改過')
    // 關鍵：仍然只有一筆，沒有因為 id 不同而多長一份
    const all = await session.adapters.storage.list(keys.PERSONAS_DIR)
    expect(all.filter((k) => k.includes('p-desktop'))).toHaveLength(0)
  })

  it("choice 'keep' 與內容相同的列都不發任何請求", async () => {
    const session = await bootSession()
    session.personas.push({ id: 'p', name: 'X', displayName: '', nickname: '', description: '', createdAt: 1, updatedAt: 2 } as any)
    const { fetchImpl, calls } = makeFakeDesktop()
    const table = emptyTable({
      personas: [
        { key: 'a', name: 'X', localId: 'p', remoteId: 'r', compare: 'differs' },
        { key: 'b', name: 'Y', localId: 'p', remoteId: 'r2', compare: 'same' }
      ]
    })
    await applySync(SRC, session, { table, choices: emptyChoices({ personas: { a: 'keep', b: 'local' } }) }, fetchImpl)
    expect(calls.filter((c) => c.method === 'POST')).toEqual([])
  })
})

describe('applySync 對應表', () => {
  it('採用電腦回應裡的真 id，而不是自己送出去的那個（M3 重複資料的根因）', async () => {
    const session = await bootSession()
    session.personas.push({ id: 'phone-1', name: 'Nori', displayName: '', nickname: '', description: '', createdAt: 1, updatedAt: 2 } as any)
    session.scenes.push({
      id: 's1', name: '日常', activePersonaId: 'phone-1', activeWorldId: '', desktopCharacters: [], createdAt: 1, updatedAt: 2
    } as any)

    const { fetchImpl, calls } = makeFakeDesktop({ newIdFor: { Nori: 'desktop-real-id' } })
    const table = emptyTable({
      personas: [{ key: 'p', name: 'Nori', localId: 'phone-1' }],
      scenes: [{ key: 's', name: '日常', localId: 's1' }]
    })
    await applySync(SRC, session, { table, choices: emptyChoices({ personas: { p: 'local' }, scenes: { s: 'local' } }) }, fetchImpl)

    // 情境推過去時，activePersonaId 必須是電腦剛剛回報的那個 id
    const sceneSave = calls.find((c) => c.path === '/api/presets/scene/save')
    expect(sceneSave?.body.preset.activePersonaId).toBe('desktop-real-id')
  })

  it('情境的角色參照翻譯不過去時整項拿掉，不推死參照', async () => {
    const session = await bootSession()
    session.scenes.push({
      id: 's1', name: '日常', activePersonaId: '', activeWorldId: '',
      desktopCharacters: [{ characterId: '電腦上沒有這隻', position: { x: 0, y: 0 }, size: 1, flipped: false, muted: false, zIndex: 1 }],
      createdAt: 1, updatedAt: 2
    } as any)
    const { fetchImpl, calls } = makeFakeDesktop()
    const table = emptyTable({ scenes: [{ key: 's', name: '日常', localId: 's1' }] })
    await applySync(SRC, session, { table, choices: emptyChoices({ scenes: { s: 'local' } }) }, fetchImpl)

    const sceneSave = calls.find((c) => c.path === '/api/presets/scene/save')
    expect(sceneSave?.body.preset.desktopCharacters).toEqual([])
  })

  it('推情境時沿用電腦上原本的座標，不用手機的值覆蓋桌寵配置', async () => {
    const session = await bootSession()
    const char = { id: 'c-local', name: '小明' }
    session.characters.push(char as any)
    session.scenes.push({
      id: 's1', name: '日常', activePersonaId: '', activeWorldId: '',
      desktopCharacters: [{ characterId: 'c-local', position: { x: 0, y: 0 }, size: 1, flipped: false, muted: true, zIndex: 1 }],
      createdAt: 1, updatedAt: 2
    } as any)

    const { fetchImpl, calls } = makeFakeDesktop({
      presets: {
        'scene-remote': {
          id: 'scene-remote', name: '日常', activePersonaId: '', activeWorldId: '',
          desktopCharacters: [{ characterId: 'c-remote', position: { x: 999, y: 888 }, size: 0.8, flipped: true, muted: false, zIndex: 5 }],
          createdAt: 1, updatedAt: 3
        }
      }
    })
    const table = emptyTable({
      characters: [{ key: 'c', name: '小明', localId: 'c-local', remoteId: 'c-remote', compare: 'same' }],
      scenes: [{ key: 's', name: '日常', localId: 's1', remoteId: 'scene-remote', compare: 'differs' }]
    })
    await applySync(SRC, session, { table, choices: emptyChoices({ characters: { c: 'keep' }, scenes: { s: 'local' } }) }, fetchImpl)

    const dc = calls.find((c) => c.path === '/api/presets/scene/save')?.body.preset.desktopCharacters[0]
    expect(dc.characterId).toBe('c-remote')
    expect(dc.position).toEqual({ x: 999, y: 888 })  // 電腦的座標保住
    expect(dc.size).toBe(0.8)
    expect(dc.muted).toBe(true)                       // 靜音是有意義的同步欄位，用手機的
  })
})

describe('applySync 刪除（選了空的那一邊）', () => {
  it('只有手機有、卻選了電腦 → 真的把手機那份刪掉', async () => {
    const session = await bootSession()
    session.personas.push(
      { id: 'keep-me', name: '留著', displayName: '', nickname: '', description: '', createdAt: 1, updatedAt: 2 } as any,
      { id: 'p-gone', name: '電腦上刪掉了', displayName: '', nickname: '', description: '', createdAt: 1, updatedAt: 2 } as any
    )
    await session.adapters.storage.writeJson(keys.personaKey('p-gone'), session.personas[session.personas.length - 1])

    const { fetchImpl } = makeFakeDesktop()
    const table = emptyTable({ personas: [{ key: 'k', name: '電腦上刪掉了', localId: 'p-gone' }] })
    const res = await applySync(SRC, session, { table, choices: emptyChoices({ personas: { k: 'remote' } }) }, fetchImpl)

    expect(res.failed).toEqual([])
    expect(res.deletedLocal.personas).toEqual(['電腦上刪掉了'])
    expect(session.personas.some((p) => p.id === 'p-gone')).toBe(false)
  })

  it('只有電腦有、卻選了手機 → 呼叫電腦的刪除端點', async () => {
    const session = await bootSession()
    const { fetchImpl, calls } = makeFakeDesktop()
    const table = emptyTable({ scenes: [{ key: 'k', name: '手機上刪掉了', remoteId: 's-remote' }] })
    const res = await applySync(SRC, session, { table, choices: emptyChoices({ scenes: { k: 'local' } }) }, fetchImpl)

    expect(res.deletedRemote.scenes).toEqual(['手機上刪掉了'])
    const del = calls.find((c) => c.path === '/api/presets/scene/delete')
    expect(del?.body).toEqual({ id: 's-remote' })
  })

  it('刪除一律排在所有複製之後——不然情境推送會翻不到剛被刪掉的角色', async () => {
    const session = await bootSession()
    session.personas.push({ id: 'p', name: '要推的', displayName: '', nickname: '', description: '', createdAt: 1, updatedAt: 2 } as any)

    const { fetchImpl, calls } = makeFakeDesktop()
    const table = emptyTable({
      personas: [{ key: 'push', name: '要推的', localId: 'p' }],
      scenes: [{ key: 'del', name: '要刪的', remoteId: 's-remote' }]
    })
    await applySync(
      SRC,
      session,
      { table, choices: emptyChoices({ personas: { push: 'local' }, scenes: { del: 'local' } }) },
      fetchImpl
    )

    const saveAt = calls.findIndex((c) => c.path === '/api/presets/persona/save')
    const deleteAt = calls.findIndex((c) => c.path === '/api/presets/scene/delete')
    expect(saveAt).toBeGreaterThanOrEqual(0)
    expect(deleteAt).toBeGreaterThan(saveAt)
  })

  it('最後一組使用者設定刪不掉時記進 failed，不是整趟炸掉', async () => {
    const session = await bootSession()
    // bootStandaloneSession 會種一組預設；只剩一組時 removePersona 會擋下來
    const only = session.personas[0]
    expect(session.personas).toHaveLength(1)

    const { fetchImpl } = makeFakeDesktop()
    const table = emptyTable({ personas: [{ key: 'k', name: only.name, localId: only.id }] })
    const res = await applySync(SRC, session, { table, choices: emptyChoices({ personas: { k: 'remote' } }) }, fetchImpl)

    expect(res.deletedLocal.personas).toEqual([])
    expect(res.failed).toHaveLength(1)
    expect(session.personas).toHaveLength(1)
  })
})

describe('applySync 容錯', () => {
  it('單筆失敗不中斷整趟，其餘照做並回報失敗清單', async () => {
    const session = await bootSession()
    session.personas.push({ id: 'ok', name: '好的', displayName: '', nickname: '', description: '', createdAt: 1, updatedAt: 2 } as any)

    const { fetchImpl } = makeFakeDesktop()
    const table = emptyTable({
      personas: [
        { key: 'bad', name: '本機沒有這筆', localId: '不存在' },
        { key: 'good', name: '好的', localId: 'ok' }
      ]
    })
    const res = await applySync(SRC, session, { table, choices: emptyChoices({ personas: { bad: 'local', good: 'local' } }) }, fetchImpl)

    expect(res.pushed.personas).toEqual(['好的'])
    expect(res.failed).toHaveLength(1)
    expect(res.failed[0].name).toBe('本機沒有這筆')
  })

  it('用語解說先於角色處理，角色卡上的參照才翻得成電腦端的 id', async () => {
    const session = await bootSession()
    await session.saveLorebook({ id: 'lore-local', name: 'DeST', entries: [], scan_depth: 0, token_budget: 100, createdAt: 1, updatedAt: 2 })
    const { fetchImpl, calls } = makeFakeDesktop()
    const table = emptyTable({ lorebooks: [{ key: 'l', name: 'DeST', localId: 'lore-local', remoteId: 'lore-remote', compare: 'differs' }] })
    await applySync(SRC, session, { table, choices: emptyChoices({ lorebooks: { l: 'local' } }) }, fetchImpl)

    const save = calls.find((c) => c.path === '/api/lorebooks/save')
    // 推到電腦上那本既有的 id 上，不是自己的 id——否則電腦會多一本同名的
    expect(save?.body.book.id).toBe('lore-remote')
  })
})
