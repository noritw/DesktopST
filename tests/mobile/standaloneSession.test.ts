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
   * 從電腦匯入的情境會記著手機上沒有的角色 id。照抄的話聊天列會出現
   * 一排點不開的空角色，所以只留這台真的有的；一個都沒有時維持原狀。
   */
  it('情境帶著手機沒有的角色時不會把在場清單洗成空的', async () => {
    const session = await bootWithScene()
    const before = session.settings.ui.desktopCharacters.map((d) => d.characterId)
    const scene = session.scenes.find((s) => s.id === 'sc1')!
    await session.saveScene({
      ...scene,
      desktopCharacters: [{ ...scene.desktopCharacters[0]!, characterId: '電腦上才有的角色' }]
    })
    await session.applyScene('sc1')
    expect(session.settings.ui.desktopCharacters.map((d) => d.characterId)).toEqual(before)
  })

  it('覆寫為目前狀態會保留新聞關鍵字組與用語解說綁定', async () => {
    const session = await bootWithScene()
    const scene = session.scenes.find((s) => s.id === 'sc1')!
    await session.saveScene({ ...scene, newsKeywordGroupId: 'kg1', lorebookIds: ['lb1'] })

    session.settings.ui.colorTheme = 'cyber'
    await session.captureScene('sc1')

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
