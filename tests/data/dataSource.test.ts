import { describe, it, expect } from 'vitest'
import { DataError } from '../../src/core/data'
import type { DataSource } from '../../src/core/data'
import { RemoteDataSource } from '../../src/mobile/data/remoteDataSource'
import { LocalDataSource } from '../../src/mobile/data/localDataSource'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { createSecretAdapterFromKey, generateMasterKey } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession } from '../../src/mobile/runtime/session'
import type { PlatformAdapters } from '../../src/core/adapters'

async function makeLocal(): Promise<LocalDataSource> {
  const adapters: PlatformAdapters = {
    storage: createMemoryStorage(),
    secrets: createSecretAdapterFromKey(generateMasterKey()),
    http: { fetch: globalThis.fetch.bind(globalThis), supportsStreaming: false },
    scheduler: { schedule() {}, cancel() {}, cancelAll() {} },
    notifier: { async notify() {} }
  }
  const session = await bootStandaloneSession(adapters, { skipPackFetch: true })
  return new LocalDataSource(session)
}

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
    const { ds, calls } = makeRemote({
      '/api/characters/desktop/add': { ok: true },
      '/api/characters/desktop/remove': { ok: true }
    })
    await ds.characters.setPresent('c1', true)
    await ds.characters.setPresent('c1', false)
    expect(calls.map((c) => c.url.replace('http://pc:1234', ''))).toEqual([
      '/api/characters/desktop/add',
      '/api/characters/desktop/remove'
    ])
    expect(calls[0].body).toEqual({ characterId: 'c1' })
  })

  /**
   * 這兩支端點用 **HTTP 200 + `ok: false`** 表示拒絕，不是錯誤狀態碼
   * （最常見的原因是「至少要留一個角色」，清單 D5）。
   * 不翻成錯誤的話 UI 會顯示成功、清單卻沒變 —— 看起來就是按鈕壞了。
   */
  it('setPresent 被拒絕（ok:false）要變成 conflict，不能當成功', async () => {
    const { ds } = makeRemote({ '/api/characters/desktop/remove': { ok: false } })
    await expect(ds.characters.setPresent('c1', false)).rejects.toMatchObject({ code: 'conflict' })
  })

  /**
   * 三支訊息端點讀的都是 `payload.id`（`mobileServer.ts` 688–730）。
   * 階段 0-③ 送成 `messageId`，會被當成缺參數擋下回 400 ——
   * 而 UI 只會看到「操作失敗」，完全看不出是欄位名錯了。
   */
  it('訊息操作送的欄位名是 id，不是 messageId', async () => {
    const { ds, calls } = makeRemote()
    await ds.messages.remove('m1')
    await ds.messages.edit('m2', '改過的內容')
    await ds.messages.resend('m3')
    expect(calls.map((c) => c.body)).toEqual([
      { id: 'm1' },
      { id: 'm2', content: '改過的內容' },
      { id: 'm3' }
    ])
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

describe('裝置識別 header（清單 G8）', () => {
  it('每個請求都帶 X-Device-Id 與 X-Device-Nickname', async () => {
    // 少了這兩個，電腦端會退回預設值 'Desktop'，角色會以為使用者在電腦前打字
    // （ipcHandlers 的 sourceDeviceName）。owner 2026-08-04 實機踩到。
    const { impl, calls } = makeFetch({ '/api/conversations': { conversations: [] } })
    const ds = new RemoteDataSource({
      baseUrl: () => 'http://pc:1234',
      token: () => 'tok',
      fetchImpl: impl,
      device: () => ({ id: 'dev-1', nickname: '手機' })
    })
    await ds.conversations.list()
    expect(calls[0].headers['X-Device-Id']).toBe('dev-1')
  })

  it('中文暱稱要編碼 —— header 只能是 ASCII，直接塞會讓請求送不出去', async () => {
    const { impl, calls } = makeFetch({ '/api/conversations': { conversations: [] } })
    const ds = new RemoteDataSource({
      baseUrl: () => 'http://pc:1234',
      token: () => 'tok',
      fetchImpl: impl,
      device: () => ({ id: 'd', nickname: '手機' })
    })
    await ds.conversations.list()
    const sent = calls[0].headers['X-Device-Nickname']
    expect(sent).toBe(encodeURIComponent('手機'))
    expect([...sent].every((c) => c.charCodeAt(0) < 128)).toBe(true)
    expect(decodeURIComponent(sent)).toBe('手機')
  })

  it('沒給 device 時就不送這兩個 header（獨立模式沒有這個概念）', async () => {
    const { ds, calls } = makeRemote({ '/api/conversations': { conversations: [] } })
    await ds.conversations.list()
    expect(calls[0].headers['X-Device-Id']).toBeUndefined()
  })
})

describe('組標頭時的程式錯誤不可被誤標成連線問題', () => {
  it('device() 拋錯時不會變成 unreachable', async () => {
    // owner 2026-08-04 踩到：crypto.randomUUID() 在非安全內容（http + 區網 IP）
    // 下拋錯，被包成 unreachable → UI 顯示「連不上電腦」，於是跑去查網路與防火牆。
    // 網路完全正常。catch 的範圍必須剛好只包住 fetch。
    const { impl } = makeFetch({ '/api/state': {} })
    const ds = new RemoteDataSource({
      baseUrl: () => 'http://pc:1234',
      token: () => 'tok',
      fetchImpl: impl,
      device: () => { throw new TypeError('randomUUID is not a function') }
    })
    await expect(ds.getState()).rejects.toThrow(TypeError)
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

  it('獨立模式恆有 API Key、恆無遙控與截圖', async () => {
    const local = await makeLocal()
    expect(local.capabilities).toEqual({
      apiKeyAccess: true,
      remoteControl: false,
      screenshot: false
    })
  })
})

describe('兩個實作對 UI 是同一個形狀', () => {
  const shape = (ds: DataSource) => ({
    top: ['getState', 'sendMessage', 'stopGenerating', 'getMessageImageUrl'].every((k) => typeof (ds as unknown as Record<string, unknown>)[k] === 'function'),
    conversations: Object.keys(ds.conversations).sort(),
    messages: Object.keys(ds.messages).sort(),
    characters: Object.keys(ds.characters).sort(),
    presets: Object.keys(ds.presets).sort(),
    lorebooks: Object.keys(ds.lorebooks).sort(),
    news: Object.keys(ds.news).sort(),
    remoteControl: Object.keys(ds.remoteControl).sort()
  })

  it('方法集合完全相同', async () => {
    const { ds: remote } = makeRemote()
    const local = await makeLocal()
    expect(shape(local)).toEqual(shape(remote))
  })

  it('獨立模式可讀寫對話與角色；個人新聞報全部接完（B1 抽 core）', async () => {
    const local = await makeLocal()
    await expect(local.conversations.list()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ active: true })])
    )
    await expect(local.characters.list()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ present: true })])
    )
    const imported = await local.characters.importCard({
      bytes: new TextEncoder().encode(
        JSON.stringify({
          name: '測試卡',
          description: 'desc',
          personality: 'nice',
          firstMessage: '嗨',
          exampleDialogue: ''
        })
      ),
      kind: 'json'
    })
    expect(imported.name).toBe('測試卡')
    // 個人新聞報 15 支已全部接完（B1 抽 core，缺口 #6）；
    // 新聞模組預設關閉，回應是正常拒絕不是連線錯誤
    await expect(local.news.fetchBatch()).resolves.toEqual({ ok: false, error: '新聞模組尚未啟用' })
    await local.news.setKeywordGroups(['g1'])
    await expect(local.news.getSettings()).resolves.toMatchObject({ enabled: false })
    // enrichForChat 沒開 enrichForChat 開關時走 rssFallback，直接回退回 title/summary，不連線也不 reject
    await expect(
      local.news.enrichForChat({
        id: 'n1',
        title: '標題',
        summary: '',
        source: '',
        tags: [],
        url: '',
        publishedAt: '',
        sourceId: 's1',
        sourceType: 'rss',
        sourceWeight: 'normal'
      })
    ).resolves.toMatchObject({ ok: true })
  })

  /**
   * 遙控（B6）在獨立模式**永久**不支援 —— 不是「之後補」的 pending stage，
   * 因為獨立模式沒有電腦可控這件事不會隨任何未來階段改變。
   */
  it('遙控在獨立模式永久不支援（不是 pending stage）', async () => {
    const local = await makeLocal()
    await expect(local.remoteControl.getState()).rejects.toMatchObject({ code: 'not-supported' })
    await expect(local.remoteControl.click(1, 2, { button: 'left', double: false })).rejects.toMatchObject({ code: 'not-supported' })
    await expect(local.remoteControl.systemAction('shutdown')).rejects.toMatchObject({ code: 'not-supported' })
  })

  it('遙控已有端點的方法不該被誤標成未實作', async () => {
    const { ds } = makeRemote({ '/api/conversations': { conversations: [] } })
    await expect(ds.conversations.list()).resolves.toEqual([])
  })

  /**
   * 階段 3 的角色卡寫入。這裡驗的是**打對端點與欄位名**——
   * 端點少一個字或欄位名不合，UI 只會看到一句「操作失敗」，
   * 從畫面完全推不回原因（階段 2d 的 `messageId` vs `id` 就是這樣晚被發現的）。
   */
  it('角色卡寫入打對端點', async () => {
    const { ds, calls } = makeRemote({
      '/api/characters/card/c1': { character: { id: 'c1', name: '小綠' } },
      '/api/characters/create': { character: { id: 'c9', name: '新角色' } },
      '/api/characters/save': { ok: true },
      '/api/characters/avatar': { avatar: 'D:/x/avatar-1.png' },
      '/api/lorebooks': { lorebooks: [{ id: 'b1', name: '用語' }] },
      '/api/presets/persona/p1': { preset: { id: 'p1', name: '我' } },
      '/api/presets/world/save': { preset: { id: 'w2', name: '新世界' } },
      '/api/presets/scene/delete': { ok: true }
    })

    await expect(ds.characters.get('c1')).resolves.toMatchObject({ id: 'c1' })
    await expect(ds.characters.create('新角色')).resolves.toMatchObject({ id: 'c9' })
    await ds.characters.save({ id: 'c1', name: '小綠' } as never)
    await expect(
      ds.characters.saveAvatar('c1', { bytes: new Uint8Array([1, 2, 3]), ext: '.png' })
    ).resolves.toBe('D:/x/avatar-1.png')
    await expect(ds.lorebooks.list()).resolves.toEqual([{ id: 'b1', name: '用語' }])
    await expect(ds.presets.getPersona('p1')).resolves.toMatchObject({ id: 'p1' })
    await ds.presets.saveWorld({ id: 'w2', name: '新世界' } as never)
    await ds.presets.removeScene('s1')

    expect(calls.map((c) => c.url.split('?')[0])).toEqual([
      'http://pc:1234/api/characters/card/c1',
      'http://pc:1234/api/characters/create',
      'http://pc:1234/api/characters/save',
      'http://pc:1234/api/characters/avatar',
      'http://pc:1234/api/lorebooks',
      'http://pc:1234/api/presets/persona/p1',
      'http://pc:1234/api/presets/world/save',
      'http://pc:1234/api/presets/scene/delete'
    ])
    // 存檔送的是 `character`，主圖送的是 base64 字串（不是 Uint8Array —— JSON 沒有那個型別）
    expect(calls[2].body).toEqual({ character: { id: 'c1', name: '小綠' } })
    expect((calls[3].body as { data: string }).data).toBe('AQID')
    expect(calls[6].body).toEqual({ preset: { id: 'w2', name: '新世界' } })
    expect(calls[7].body).toEqual({ id: 's1' })
  })

  /**
   * 階段 6 的新聞報。端點打錯只會在 UI 上顯示「抓取失敗」，
   * 從畫面完全推不回是哪一支錯了 —— 所以在這裡鎖住路徑與欄位名。
   */
  it('新聞報打對端點與欄位名', async () => {
    const batch = { ok: true, items: [], fetchedAt: 1, sources: [], keywordGroups: [], readerKeywordGroupIds: [], readerMaxItems: 30, readerPerKeyword: 3, readerBreakoutQuota: 3 }
    const { ds, calls } = makeRemote({
      '/api/news/reader/state': { enabled: true, sources: [], keywordGroups: [], readerKeywordGroupIds: [], readerMaxItems: 30, readerPerKeyword: 3, readerBreakoutQuota: 3, pinnedItems: [], dismissedIds: [] },
      '/api/news/reader/batch': batch,
      '/api/news/reader/section': { ...batch, sectionGroupId: 'kw:a' },
      '/api/news/reader/pinned': { pinnedItems: [], dismissedIds: [] },
      '/api/news/reader/dismissed': { pinnedItems: [], dismissedIds: [] },
      '/api/news/reader/quota': { ...batch, sectionGroupId: 'kw:a' },
      '/api/news/reader/groups': { ok: true, readerKeywordGroupIds: ['g1'] },
      '/api/news/reader/order': { ok: true, sources: [{ id: 'kw-a' }] },
      '/api/news/mark-opened': { ok: true },
      '/api/news/settings': { enabled: true, sources: [], keywordGroups: [], blacklist: ['詐騙'] },
      '/api/news/scheduler': { enabled: true, schedule: { type: 'daily', hour: 9, minute: 0 } }
    })

    await expect(ds.news.getReaderState()).resolves.toMatchObject({ enabled: true })
    await ds.news.fetchBatch({ excludeIds: ['n1'], strictExclude: true })
    await ds.news.fetchSection({ sectionGroupId: 'kw:a' })
    await ds.news.setPinned([])
    await ds.news.setDismissed(['n1'])
    await ds.news.setQuota('kw:a', 5)
    await ds.news.setKeywordGroups(['g1'])
    await expect(ds.news.setSourceOrder(['kw-a'])).resolves.toEqual([{ id: 'kw-a' }])
    await ds.news.markOpened('kw-a')
    await expect(ds.news.getSettings()).resolves.toMatchObject({ blacklist: ['詐騙'] })
    await ds.news.saveSettings({ blacklist: ['詐騙'] })
    await expect(ds.news.getSchedule()).resolves.toMatchObject({ enabled: true })
    await ds.news.setSchedule({ enabled: false })

    expect(calls.map((c) => c.url.split('?')[0].replace('http://pc:1234', ''))).toEqual([
      '/api/news/reader/state',
      '/api/news/reader/batch',
      '/api/news/reader/section',
      '/api/news/reader/pinned',
      '/api/news/reader/dismissed',
      '/api/news/reader/quota',
      '/api/news/reader/groups',
      '/api/news/reader/order',
      '/api/news/mark-opened',
      '/api/news/settings',
      '/api/news/settings',
      '/api/news/scheduler',
      '/api/news/scheduler'
    ])
    expect(calls[1].body).toEqual({ excludeIds: ['n1'], strictExclude: true })
    // 單欄重抓預設 strictExclude=true：不加的話重抓會抓回同一批，看起來像沒反應
    expect(calls[2].body).toEqual({ sectionGroupId: 'kw:a', excludeIds: [], strictExclude: true })
    expect(calls[5].body).toEqual({ sectionGroupId: 'kw:a', quota: 5 })
    expect(calls[7].body).toEqual({ orderedSourceIds: ['kw-a'] })
  })

  /**
   * 「新聞模組尚未啟用」是**正常的拒絕**（HTTP 200 ＋ ok:false），不是連線錯誤。
   * 翻成例外的話 UI 會顯示「請再試一次」，但再試一百次也一樣。
   */
  it('模組沒開時回 ok:false 而不是丟例外', async () => {
    const { ds } = makeRemote({ '/api/news/reader/batch': { ok: false, error: '新聞模組尚未啟用' } })
    await expect(ds.news.fetchBatch()).resolves.toEqual({ ok: false, error: '新聞模組尚未啟用' })
  })

  it('匯出角色卡把 base64 解回位元組', async () => {
    const { ds } = makeRemote({
      '/api/characters/export-card': { data: 'AQID', filename: '小綠.png' }
    })
    const file = await ds.characters.exportCard('c1', 'png')
    expect(Array.from(file.bytes)).toEqual([1, 2, 3])
    expect(file.filename).toBe('小綠.png')
  })

  /**
   * 遙控面板（清單 H1–H11，B6）打對端點與欄位名。截圖走二進位（`getBinary`），
   * 這裡的假 fetch 沒有 `.blob()`，只驗 JSON 類的指令與讀取方法。
   */
  it('遙控面板打對端點與欄位名', async () => {
    const { ds, calls } = makeRemote({
      '/api/state': { remoteControl: { enabled: true, allowedCapabilities: [], requireConfirmation: [], restrictToAllowedDevices: false } },
      '/api/displays': [{ index: 0, label: '螢幕 1', isPrimary: true, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }],
      '/api/windows': [{ hwnd: 1, pid: 2, title: '記事本', proc: 'notepad', minimized: false, displayIndex: 0, x: 0, y: 0, w: 100, h: 100 }],
      '/api/system/lock-status': { locked: false },
      '/api/remote/click': { ok: true },
      '/api/remote/scroll': { ok: true },
      '/api/remote/type': { ok: true },
      '/api/remote/key': { ok: true },
      '/api/remote/programs': [{ id: 'p1', name: '小算盤', running: false }],
      '/api/remote/programs/launch': { ok: true },
      '/api/remote/programs/close': { ok: true },
      '/api/remote/monitor-off': { ok: true },
      '/api/remote/wake': { ok: true },
      '/api/remote/system': { ok: true },
      '/api/remote/hide-windows': { ok: true },
      '/api/remote/restore-windows': { ok: true }
    })

    await expect(ds.remoteControl.getState()).resolves.toMatchObject({ enabled: true })
    await expect(ds.remoteControl.listDisplays()).resolves.toHaveLength(1)
    await expect(ds.remoteControl.listWindows()).resolves.toHaveLength(1)
    await expect(ds.remoteControl.isLocked()).resolves.toBe(false)
    await ds.remoteControl.click(10, 20, { button: 'left', double: false })
    await ds.remoteControl.scroll(10, 20, 1, -2)
    await ds.remoteControl.typeText('嗨', { pressEnter: true })
    await ds.remoteControl.sendKey('ctrl+c')
    await expect(ds.remoteControl.listPrograms()).resolves.toHaveLength(1)
    await ds.remoteControl.launchProgram('p1')
    await ds.remoteControl.closeProgram('p1')
    await ds.remoteControl.systemAction('monitor-off')
    await ds.remoteControl.systemAction('wake')
    await ds.remoteControl.systemAction('shutdown')
    await ds.remoteControl.hideWindows()
    await ds.remoteControl.restoreWindows()

    expect(calls.map((c) => c.url.split('?')[0].replace('http://pc:1234', ''))).toEqual([
      '/api/state',
      '/api/displays',
      '/api/windows',
      '/api/system/lock-status',
      '/api/remote/click',
      '/api/remote/scroll',
      '/api/remote/type',
      '/api/remote/key',
      '/api/remote/programs',
      '/api/remote/programs/launch',
      '/api/remote/programs/close',
      '/api/remote/monitor-off',
      '/api/remote/wake',
      '/api/remote/system',
      '/api/remote/hide-windows',
      '/api/remote/restore-windows'
    ])
    expect(calls[4].body).toEqual({ x: 10, y: 20, button: 'left', double: false })
    expect(calls[6].body).toEqual({ text: '嗨', pressEnter: true })
    expect(calls[13].body).toEqual({ action: 'shutdown' })
  })

  /** `confirmed: true` 要帶 `X-Remote-Confirmed` header，否則伺服器有要求確認的能力一律 428。 */
  it('confirmed 選項會帶 X-Remote-Confirmed header', async () => {
    const { ds, calls } = makeRemote({ '/api/remote/click': { ok: true } })
    await ds.remoteControl.click(1, 2, { button: 'left', double: false, confirmed: true })
    expect(calls[0].headers['X-Remote-Confirmed']).toBe('1')
  })
})
