import { describe, expect, it } from 'vitest'
import type { AppEvent } from '@core/events'
import type { PlatformAdapters } from '@core/adapters'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'

function testAdapters(): PlatformAdapters {
  return {
    storage: createMemoryStorage(),
    secrets: unavailableSecrets,
    // 這幾支測試不會走到（一律 skipLlm）
    http: { fetch: (() => Promise.reject(new Error('no network in tests'))) as typeof fetch, supportsStreaming: false },
    scheduler: { schedule: () => {}, cancel: () => {}, cancelAll: () => {} },
    notifier: { notify: () => Promise.resolve() }
  }
}

async function bootWithMessages(count: number): Promise<{
  session: StandaloneSession
  events: AppEvent[]
}> {
  const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
  const events: AppEvent[] = []
  session.events.subscribe((e) => events.push(e))
  for (let i = 0; i < count; i++) {
    // skipLlm：只落地使用者訊息，不呼叫模型
    await session.sendMessage({ content: `訊息 ${i}`, skipLlm: true })
  }
  return { session, events }
}

describe('StandaloneSession', () => {
  it('boots with a character and an active conversation even without a default pack', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    expect(session.characters.length).toBeGreaterThan(0)
    expect(session.activeConversation).not.toBeNull()
    expect(session.settings.ui.desktopCharacters.length).toBe(1)
  })

  it('resend truncates from the target message and tells the UI to refresh', async () => {
    const { session, events } = await bootWithMessages(3)
    const conv = session.activeConversation!
    expect(conv.messages).toHaveLength(3)

    const target = conv.messages[1]!
    events.length = 0
    await session.resendMessage(target.id)

    /*
     * 沒有 `state-invalidated` 的話，UI 不知道舊訊息被砍了，畫面會停在舊清單
     * 直到重開 app（owner 2026-08-08 回報的正是這個）。
     */
    expect(events.some((e) => e.kind === 'state-invalidated')).toBe(true)

    // 目標之後的訊息不留，重送的那則回到最後
    // （沒填 API Key，所以尾巴會多一則「請去設定填 Key」的角色提示，那是預期行為）
    const contents = session.activeConversation!.messages.map((m) => m.content)
    expect(contents.slice(0, 2)).toEqual(['訊息 0', '訊息 1'])
    expect(contents).not.toContain('訊息 2')
  })

  it('llm snapshot never borrows another provider model', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    session.settings.llm.provider = 'claude'
    session.settings.llm.model = 'gpt-5.4-nano'
    session.settings.llm.models = {}
    expect(session.llmSnapshot().model).toBe('')
  })

  it('stopGenerating aborts in-flight reply and restores the draft', async () => {
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (!signal) return
        if (signal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'))
          return
        }
        signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })

    const session = await bootStandaloneSession(
      {
        ...testAdapters(),
        http: { fetch: hangingFetch, supportsStreaming: false }
      },
      { skipPackFetch: true }
    )
    session.settings.llm.provider = 'openai'
    session.settings.llm.apiKeys.openai = 'test-key'
    session.settings.llm.models = { openai: 'gpt-4o-mini' }
    // 關掉天氣，否則會先卡在氣象 fetch
    session.settings.weather = { ...session.settings.weather!, enabled: false }

    const before = session.activeConversation!.messages.length
    const sendPromise = session.sendMessage({ content: '打錯字了' })
    // 讓 send 先寫入使用者訊息、進入 LLM
    await new Promise((r) => setTimeout(r, 20))

    const draft = await session.stopGenerating()
    await sendPromise

    expect(draft).toEqual({ content: '打錯字了' })
    expect(session.activeConversation!.messages).toHaveLength(before)
    expect(session.activeConversation!.messages.every((m) => m.content !== '打錯字了')).toBe(true)
    expect(await session.stopGenerating()).toBeNull()
  })
})

describe('StandaloneSession：情境與設定組（缺口 #1）', () => {
  async function bootWithScene(): Promise<StandaloneSession> {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    await session.saveScene({
      id: 'sc1',
      name: '深夜',
      activePersonaId: session.personas[0]!.id,
      activeWorldId: session.worlds[0]!.id,
      desktopCharacters: session.settings.ui.desktopCharacters.map((d) => ({ ...d })),
      colorTheme: 'forest',
      createdAt: 0,
      updatedAt: 0
    })
    return session
  }

  it('套用情境會換掉配色與使用中的身分／世界觀', async () => {
    const session = await bootWithScene()
    session.settings.ui.colorTheme = 'mint'
    await session.applyScene('sc1')
    expect(session.settings.activeSceneId).toBe('sc1')
    expect(session.settings.ui.colorTheme).toBe('forest')
  })

  /**
   * 情境記著的角色 id 只留這台真的有的。全部對不到時也要套用成空清單，
   * 不要靜靜「保持原狀」——否則壞掉的匯入看起來像套用沒反應。
   */
  it('情境角色全對不到時套用後在場清單會變空（不偷偷保留舊的）', async () => {
    const session = await bootWithScene()
    const scene = session.scenes.find((s) => s.id === 'sc1')!
    await session.saveScene({
      ...scene,
      desktopCharacters: [{ ...scene.desktopCharacters[0]!, characterId: '電腦上才有的角色' }]
    })
    await session.applyScene('sc1')
    expect(session.settings.ui.desktopCharacters).toEqual([])
  })

  it('覆寫為目前狀態會保留新聞關鍵字組與用語解說綁定', async () => {
    const session = await bootWithScene()
    const scene = session.scenes.find((s) => s.id === 'sc1')!
    await session.saveScene({ ...scene, newsKeywordGroupId: 'kg1', lorebookIds: ['lb1'] })

    session.settings.ui.colorTheme = 'cyber'
    await session.captureScene('sc1', scene.name)

    const next = session.scenes.find((s) => s.id === 'sc1')!
    expect(next.colorTheme).toBe('cyber')
    expect(next.newsKeywordGroupId).toBe('kg1')
    expect(next.lorebookIds).toEqual(['lb1'])
  })

  it('刪掉使用中的情境只是不再跟著它，身分與世界觀不動', async () => {
    const session = await bootWithScene()
    await session.applyScene('sc1')
    const persona = session.settings.activePersonaId
    await session.removeScene('sc1')
    expect(session.settings.activeSceneId).toBeUndefined()
    expect(session.settings.activePersonaId).toBe(persona)
  })

  /** 與桌面同一條規則：刪光了就沒有東西能組出「使用者是誰」，畫面也沒地方加回來。 */
  it('最後一組身分／世界觀不給刪', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    expect(session.personas).toHaveLength(1)
    await expect(session.removePersona(session.personas[0]!.id)).rejects.toMatchObject({
      code: 'conflict'
    })
    await expect(session.removeWorld(session.worlds[0]!.id)).rejects.toMatchObject({
      code: 'conflict'
    })
  })

  it('刪掉正在用的身分會改指向剩下的那一組', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    const first = session.personas[0]!
    const second = { ...first, id: 'p2', name: '另一個我' }
    session.personas.push(second)
    session.settings.activePersonaId = first.id

    await session.removePersona(first.id)
    expect(session.settings.activePersonaId).toBe('p2')
  })
})

describe('StandaloneSession：用語解說（缺口 #2）', () => {
  it('create／get／save／remove 走完整輪，list 只回摘要', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })

    const created = await session.createLorebook('我的世界觀')
    expect(created.entries).toEqual([])
    expect(created.name).toBe('我的世界觀')

    expect(await session.listLorebooks()).toEqual([{ id: created.id, name: '我的世界觀' }])

    const fetched = await session.getLorebook(created.id)
    expect(fetched).toEqual(created)

    const saved = await session.saveLorebook({
      ...created,
      name: '改名了',
      entries: [{ id: 'e1', keys: ['DeST'], content: 'DeST 是桌面程式', enabled: true, constant: true, insertion_order: 0 }]
    })
    expect(saved.name).toBe('改名了')
    expect(saved.updatedAt).toBeGreaterThanOrEqual(created.updatedAt)
    expect((await session.getLorebook(created.id))!.entries).toHaveLength(1)

    await session.removeLorebook(created.id)
    expect(await session.getLorebook(created.id)).toBeNull()
    expect(await session.listLorebooks()).toEqual([])
  })

  it('沒有這本回 null，不是丟例外', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    expect(await session.getLorebook('沒這本')).toBeNull()
  })

  it('刪除時一併清掉角色卡／世界觀／情境上的參照', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    const book = await session.createLorebook('待刪')

    const char = session.characters[0]!
    await session.saveCharacter({ ...char, lorebookIds: [book.id] })

    const world = session.worlds[0]!
    await session.saveScene({
      id: 'sc1',
      name: '深夜',
      activePersonaId: session.personas[0]!.id,
      activeWorldId: world.id,
      desktopCharacters: session.settings.ui.desktopCharacters.map((d) => ({ ...d })),
      lorebookIds: [book.id],
      colorTheme: 'mint',
      createdAt: 0,
      updatedAt: 0
    })
    session.worlds[0] = { ...world, lorebookIds: [book.id] }

    await session.removeLorebook(book.id)

    expect(session.characters.find((c) => c.id === char.id)!.lorebookIds).toEqual([])
    expect(session.worlds[0]!.lorebookIds).toEqual([])
    expect(session.scenes.find((s) => s.id === 'sc1')!.lorebookIds).toEqual([])
  })

  /*
   * 生成本身（呼叫輔助模型）不進自動測試——同 tests/lore/generate.test.ts 的既有原則。
   * 這裡只測接線：id 找不到要丟 DataError（呼叫端傳錯，是程式錯誤）；
   * 生成失敗（這裡的測試環境本來就沒有網路）要收斂成 `{ ok: false, error }`，
   * 不能讓例外整個往上炸穿到 UI。
   */
  it('generateLoreEntry：角色或書找不到丟 DataError；生成失敗收斂成 ok:false', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    const book = await session.createLorebook('待生成')
    const char = session.characters[0]!

    await expect(session.generateLoreEntry('沒這個角色', book.id)).rejects.toMatchObject({ code: 'not-found' })
    await expect(session.generateLoreEntry(char.id, '沒這本書')).rejects.toMatchObject({ code: 'not-found' })

    const result = await session.generateLoreEntry(char.id, book.id)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(typeof result.error).toBe('string')
    // 失敗不該留下半條資料
    expect((await session.getLorebook(book.id))!.entries).toEqual([])
  })
})

describe('StandaloneSession：角色卡／設定包匯出（缺口 #3）', () => {
  it('exportCard(json) 輸出可以再被 importCard 讀回同樣的人設', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    const char = session.characters[0]!
    await session.saveCharacter({ ...char, name: '小綠', personality: '活潑', firstMessage: '嗨！' })

    const file = await session.exportCard(char.id, 'json')
    expect(file.filename).toBe('小綠.json')

    const reimported = await session.importCard({ bytes: file.bytes, kind: 'json' })
    expect(reimported.name).toBe('小綠')
    expect(reimported.firstMessage).toBe('嗨！')
    // 重新匯入一律發新 id，不能撞名原本那隻
    expect(reimported.id).not.toBe(char.id)
  })

  it('exportCard(png) 沒有頭像時退回內建透明底圖，PNG 仍嵌得出 chara chunk', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    const char = session.characters[0]!
    await session.saveCharacter({ ...char, avatar: '', name: '無頭像角色' })

    const file = await session.exportCard(char.id, 'png')
    expect(file.filename).toBe('無頭像角色.png')

    const reimported = await session.importCard({ bytes: file.bytes, kind: 'png' })
    expect(reimported.name).toBe('無頭像角色')
  })

  it('找不到角色時丟 DataError', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    await expect(session.exportCard('沒這隻', 'json')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('exportPack 打出的 .dstpack 能被同一套匯入邏輯讀回（跨 session 也一樣）', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    const char = session.characters[0]!
    await session.saveCharacter({ ...char, name: '小藍' })
    await session.saveAvatar(char.id, { bytes: new Uint8Array([1, 2, 3, 4]), ext: '.png' })

    const file = await session.exportPack([char.id], {
      includeGlobalSettings: false,
      includeLorebooks: false
    })
    expect(file.filename).toBe('小藍.dstpack')

    // 另開一個全新的獨立 session（模擬換一台手機／電腦匯入），驗證格式真的互通
    const other = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    const before = other.characters.length
    const result = await other.importPack(file.bytes, { onConflict: 'skip', applyGlobalSettings: false })
    expect(result.imported).toBe(1)
    await other.reloadCharacters()
    expect(other.characters.length).toBe(before + 1)
    const landed = other.characters.find((c) => c.name === '小藍')
    expect(landed).toBeTruthy()
    // 帶著頭像一起打包進去，匯入端也要能還原成一個可讀的 storage key
    expect(landed!.avatar).toBeTruthy()
  })

  it('exportPack 沒帶 id 時匯出全部角色；空清單丟 DataError', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    const file = await session.exportPack([], { includeGlobalSettings: false, includeLorebooks: false })
    expect(file.bytes.length).toBeGreaterThan(0)

    const empty = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })
    empty.characters = []
    await expect(
      empty.exportPack([], { includeGlobalSettings: false, includeLorebooks: false })
    ).rejects.toMatchObject({ code: 'invalid-input' })
  })
})

describe('StandaloneSession：模組開關', () => {
  /*
   * owner 2026-08-12 實機回報：新聞模組打勾後切走再回來又變回沒開。
   * 原因是 `listModules` 把新聞寫死成 false、`setModuleEnabled` 對新聞是空的
   * no-op（接 core 之前的遺留）。新聞的開關不在 `settings.json`，
   * 在 `modules/desktopst.news/settings.json`，所以要另外讀寫。
   */
  it('模組開關：新聞打開之後讀得回來（開關不在 settings.json）', async () => {
    const adapters = testAdapters()
    const session = await bootStandaloneSession(adapters, { skipPackFetch: true })

    const before = await session.listModules()
    expect(before.find((m) => m.id === 'desktopst.news')!.enabled).toBe(false)

    await session.setModuleEnabled('desktopst.news', true)
    const after = await session.listModules()
    expect(after.find((m) => m.id === 'desktopst.news')!.enabled).toBe(true)

    // 真正的重點：重開 App（同一份 storage 重新 boot）之後還在
    const reopened = await bootStandaloneSession(adapters, { skipPackFetch: true })
    const persisted = await reopened.listModules()
    expect(persisted.find((m) => m.id === 'desktopst.news')!.enabled).toBe(true)

    // 關掉也要能落地
    await reopened.setModuleEnabled('desktopst.news', false)
    expect((await reopened.listModules()).find((m) => m.id === 'desktopst.news')!.enabled).toBe(false)
  })

  it('模組開關：其餘三個模組仍走 settings.json，沒被新聞那條路徑影響', async () => {
    const session = await bootStandaloneSession(testAdapters(), { skipPackFetch: true })

    await session.setModuleEnabled('desktopst.weather', true)
    const list = await session.listModules()
    expect(list.find((m) => m.id === 'desktopst.weather')!.enabled).toBe(true)
    expect(session.settings.weather?.enabled).toBe(true)

    await expect(session.setModuleEnabled('desktopst.nope', true)).rejects.toMatchObject({ code: 'not-found' })
  })
})
