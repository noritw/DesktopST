import { describe, it, expect } from 'vitest'
import { DataError } from '../../src/core/data'
import type { DataSource } from '../../src/core/data'
import { RemoteDataSource } from '../../src/mobile/data/remoteDataSource'
import { LocalDataSource } from '../../src/mobile/data/localDataSource'

/**
 * 資料來源抽象（B3 階段 0-③）。
 *
 * 重點與階段 0-② 相同：不只驗「呼叫有沒有打對端點」，更要驗
 * **兩個實作對 UI 而言是同一個形狀** —— 形狀若不一致，UI 就得寫模式特例，
 * 「一份程式碼兩種資料來源」（roadmap §4.5）就白做了。
 */

interface FakeCall {
  url: string
  method: string
  body: unknown
  headers: Record<string, string>
}

/** 可控的假 fetch：測試自己決定每個路徑回什麼。 */
function makeFetch(routes: Record<string, unknown>, status = 200) {
  const calls: FakeCall[] = []
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>
    })
    const path = url.replace('http://pc:1234', '').split('?')[0]
    const payload = routes[path]
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => payload ?? {},
      text: async () => 'err'
    } as Response
  }) as unknown as typeof globalThis.fetch
  return { impl, calls }
}

function makeRemote(routes: Record<string, unknown> = {}, status = 200, lanDirect = false) {
  const { impl, calls } = makeFetch(routes, status)
  const ds = new RemoteDataSource({
    baseUrl: () => 'http://pc:1234',
    token: () => 'tok',
    fetchImpl: impl,
    lanDirect
  })
  return { ds, calls }
}

const STATE_ROUTE = {
  '/api/state': {
    desktopCharacters: [{ id: 'c1', name: '小綠', muted: false }],
    conversation: { id: 'v1', title: '聊天', messages: [] },
    colorTheme: 'mint',
    randomToolsEnabled: true,
    maxImages: 3
  }
}

describe('RemoteDataSource：狀態與名稱轉換', () => {
  it('把電腦端的「桌面角色」轉成手機的「在場角色」', async () => {
    const { ds } = makeRemote(STATE_ROUTE)
    const state = await ds.getState()
    expect(state.presentCharacters).toEqual([{ id: 'c1', name: '小綠', muted: false }])
    expect(state.maxImagesPerMessage).toBe(3)
    expect(state.colorTheme).toBe('mint')
  })

  it('沒有進行中的對話時回 null，不是丟出錯誤', async () => {
    const { ds } = makeRemote({ '/api/state': { ...STATE_ROUTE['/api/state'], conversation: null } })
    expect((await ds.getState()).conversation).toBeNull()
  })

  it('每次請求都帶 token header', async () => {
    const { ds, calls } = makeRemote(STATE_ROUTE)
    await ds.getState()
    expect(calls[0].headers['X-DesktopST-Token']).toBe('tok')
  })
})

describe('RemoteDataSource：指令對映', () => {
  it('setPresent 依 true/false 打到不同端點', async () => {
    const { ds, calls } = makeRemote()
    await ds.characters.setPresent('c1', true)
    await ds.characters.setPresent('c1', false)
    expect(calls.map((c) => c.url.replace('http://pc:1234', ''))).toEqual([
      '/api/characters/desktop/add',
      '/api/characters/desktop/remove'
    ])
    expect(calls[0].body).toEqual({ characterId: 'c1' })
  })

  it('sendMessage 只送伺服器認得的欄位', async () => {
    const { ds, calls } = makeRemote()
    await ds.sendMessage({ content: '嗨', images: ['data:image/jpeg;base64,x'], skipLlm: true })
    expect(calls[0].body).toEqual({
      content: '嗨',
      images: ['data:image/jpeg;base64,x'],
      randomResults: undefined,
      skipLlm: true
    })
  })

  it('圖片與頭像位址走 query token —— <img> 沒辦法加 header', async () => {
    const { ds } = makeRemote()
    expect(await ds.characters.avatarUrl('c1')).toBe('http://pc:1234/api/avatar/c1?token=tok')
    expect(await ds.getMessageImageUrl('m1', 2)).toBe('http://pc:1234/api/message-image/m1/2?token=tok')
  })

  it('角色 id 會做 URL 編碼，含斜線也不會跑掉路徑', async () => {
    const { ds } = makeRemote()
    expect(await ds.characters.avatarUrl('a/b')).toContain('/api/avatar/a%2Fb')
  })
})

describe('RemoteDataSource：錯誤翻譯', () => {
  it('連不上電腦 → unreachable（不是 unknown）', async () => {
    const ds = new RemoteDataSource({
      baseUrl: () => 'http://pc:1234',
      token: () => 'tok',
      fetchImpl: (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof globalThis.fetch
    })
    await expect(ds.getState()).rejects.toMatchObject({ code: 'unreachable' })
  })

  it('401 → unauthorized；404 → not-found；413 → invalid-input；503 → unreachable', async () => {
    for (const [status, code] of [[401, 'unauthorized'], [404, 'not-found'], [413, 'invalid-input'], [503, 'unreachable']] as const) {
      const { ds } = makeRemote(STATE_ROUTE, status)
      await expect(ds.getState()).rejects.toMatchObject({ code })
    }
  })

  it('錯誤不含 UI 文案，只有代碼與 detail（roadmap §3.3）', async () => {
    const { ds } = makeRemote(STATE_ROUTE, 401)
    const err = await ds.getState().catch((e: DataError) => e)
    expect(err).toBeInstanceOf(DataError)
    expect((err as DataError).code).toBe('unauthorized')
  })
})

describe('Capabilities：模式的真實差異', () => {
  it('遙控預設沒有 API Key 存取；區網直連才有', async () => {
    expect(makeRemote({}, 200, false).ds.capabilities.apiKeyAccess).toBe(false)
    expect(makeRemote({}, 200, true).ds.capabilities.apiKeyAccess).toBe(true)
  })

  it('獨立模式恆有 API Key、恆無遙控與截圖', () => {
    expect(new LocalDataSource().capabilities).toEqual({
      apiKeyAccess: true,
      remoteControl: false,
      screenshot: false
    })
  })
})

describe('兩個實作對 UI 是同一個形狀', () => {
  const shape = (ds: DataSource) => ({
    top: ['getState', 'sendMessage', 'getMessageImageUrl'].every((k) => typeof (ds as unknown as Record<string, unknown>)[k] === 'function'),
    conversations: Object.keys(ds.conversations).sort(),
    messages: Object.keys(ds.messages).sort(),
    characters: Object.keys(ds.characters).sort(),
    presets: Object.keys(ds.presets).sort()
  })

  it('方法集合完全相同', () => {
    const { ds: remote } = makeRemote()
    expect(shape(new LocalDataSource())).toEqual(shape(remote))
  })

  it('尚未實作的方法一律 reject 而非假裝成功', async () => {
    const local = new LocalDataSource()
    const { ds: remote } = makeRemote()
    // 「假裝成功」會讓使用者以為存檔了 —— 這是刻意要避免的行為。
    await expect(local.conversations.list()).rejects.toMatchObject({ code: 'not-supported' })
    await expect(remote.characters.save({} as never)).rejects.toMatchObject({ code: 'not-supported' })
    await expect(remote.presets.saveScene({} as never)).rejects.toMatchObject({ code: 'not-supported' })
  })

  it('遙控已有端點的方法不該被誤標成未實作', async () => {
    const { ds } = makeRemote({ '/api/conversations': { conversations: [] } })
    await expect(ds.conversations.list()).resolves.toEqual([])
  })
})
