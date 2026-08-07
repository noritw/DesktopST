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
