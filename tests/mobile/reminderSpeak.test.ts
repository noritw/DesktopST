import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@core/types'
import type { AppSettings, Character, Conversation, Reminder } from '@core/types'
import { speakStandaloneReminder } from '../../src/mobile/runtime/reminderSpeak'
import { LocalEventSource } from '../../src/mobile/events/localEventSource'

/**
 * 提醒觸發 → 角色發話（獨立模式）。
 *
 * owner 2026-08-09：「提醒就只是內容照用，我要的是走 LLM 用角色語氣提醒我，
 * 不然這功能跟一般行事曆沒有差異。」所以這裡的重點不是「有沒有發通知」，
 * 而是**通知內容到底是誰寫的**——`reminder.prompt` 是給角色的指令，
 * 不是要給使用者看的文案。
 */

const CHAR: Character = {
  id: 'c1',
  name: '小綠',
  avatar: '',
  description: '',
  personality: '',
  firstMessage: '',
  exampleDialogue: '',
  emotions: {},
  createdAt: 0,
  updatedAt: 0
}

const REMINDER: Reminder = {
  id: 'r1',
  label: '喝水',
  prompt: '提醒我喝水',
  schedule: { type: 'daily', hour: 8, minute: 0 },
  enabled: true,
  notificationDevice: 'mobile',
  createdAt: 0
}

function makeSettings(apiKey: string): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    llm: {
      ...DEFAULT_SETTINGS.llm,
      provider: 'openai',
      models: { openai: 'gpt-4o' },
      model: 'gpt-4o',
      apiKeys: { ...DEFAULT_SETTINGS.llm.apiKeys, openai: apiKey }
    },
    ui: {
      ...DEFAULT_SETTINGS.ui,
      desktopCharacters: [
        { characterId: 'c1', position: { x: 0, y: 0 }, size: 1, flipped: false, muted: false, zIndex: 1 }
      ]
    }
  }
}

/** 攔下送出去的 request body，並回一個 Responses API 形狀的假回應。 */
function stubLlm(reply: string): { fetch: typeof globalThis.fetch; bodies: string[] } {
  const bodies: string[] = []
  const fetch = (async (_input: unknown, init?: { body?: unknown }) => {
    if (typeof init?.body === 'string') bodies.push(init.body)
    return new Response(JSON.stringify({ output_text: reply, usage: { input_tokens: 10, output_tokens: 5 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as unknown as typeof globalThis.fetch
  return { fetch, bodies }
}

function makeOpts(settings: AppSettings, fetchImpl: typeof globalThis.fetch, conv: Conversation) {
  return {
    adapters: { http: { fetch: fetchImpl, supportsStreaming: false } } as never,
    events: new LocalEventSource(),
    settings,
    characters: [CHAR],
    getActiveConversation: () => conv,
    saveConversation: async () => undefined,
    getPersona: () => null,
    getWorld: () => null,
    getActiveScene: () => null,
    loadLorebook: async () => null,
    reminder: REMINDER
  }
}

function emptyConv(): Conversation {
  return { id: 'conv1', title: '聊天', participantIds: ['c1'], messages: [], summary: '', createdAt: 0, updatedAt: 0 }
}

describe('提醒觸發時由角色發話（獨立模式）', () => {
  it('走 LLM：通知內容是角色講的話，不是 reminder.prompt', async () => {
    const conv = emptyConv()
    const { fetch, bodies } = stubLlm('欸，記得喝水啦，你都盯著螢幕多久了。')
    const result = await speakStandaloneReminder(makeOpts(makeSettings('sk-test'), fetch, conv))

    expect(result).not.toBeNull()
    expect(result?.characterName).toBe('小綠')
    expect(result?.text).toBe('欸，記得喝水啦，你都盯著螢幕多久了。')
    // 最關鍵的一條：不可以直接照搬指令
    expect(result?.text).not.toBe(REMINDER.prompt)
    expect(bodies.length).toBe(1)
  })

  it('提醒內容是當成「給角色的指令」餵進 system prompt', async () => {
    const conv = emptyConv()
    const { fetch, bodies } = stubLlm('好啦好啦，喝水。')
    await speakStandaloneReminder(makeOpts(makeSettings('sk-test'), fetch, conv))

    const sent = bodies[0]
    expect(sent).toContain('[提醒指令]')
    expect(sent).toContain('提醒我喝水')
    // 沒有這段，模型會把提醒當成普通對話接下去聊
    expect(sent).toContain('[發話重點]')
  })

  it('發話會寫進目前的對話（之後回頭看得到角色說了什麼）', async () => {
    const conv = emptyConv()
    const { fetch } = stubLlm('該喝水囉。')
    await speakStandaloneReminder(makeOpts(makeSettings('sk-test'), fetch, conv))

    expect(conv.messages).toHaveLength(1)
    expect(conv.messages[0].role).toBe('character')
    expect(conv.messages[0].characterId).toBe('c1')
    expect(conv.messages[0].content).toBe('該喝水囉。')
  })

  /*
   * 2026-08-11 起，生不出來時**不再退回 `reminder.prompt` 原文**。
   * 原文是「給角色的指令」（「提醒我喝水」），照搬出去等於把這功能降級成
   * 普通行事曆通知——正是這整支檔案在防的事。改成退回「最近一次生成的
   * 快取台詞」（見 docs/mobile-standalone-reminder-plan.md §2.1）。
   */
  it('沒有 API Key：改用快取台詞，不照搬提醒原文', async () => {
    const conv = emptyConv()
    const { fetch, bodies } = stubLlm('不該被呼叫')
    const result = await speakStandaloneReminder({
      ...makeOpts(makeSettings(''), fetch, conv),
      cached: { text: '欸，記得喝水喔。', characterId: 'c1', characterName: '小助手' }
    })

    expect(bodies).toHaveLength(0)
    expect(result?.text).toBe('欸，記得喝水喔。')
    expect(result?.text).not.toBe(REMINDER.prompt)
    expect(result?.status).toBe('offline_fallback')
  })

  it('LLM 掛掉且有快取：用快取台詞，該響的還是要響', async () => {
    const conv = emptyConv()
    const failing = (async () => {
      throw new Error('network down')
    }) as unknown as typeof globalThis.fetch
    const result = await speakStandaloneReminder({
      ...makeOpts(makeSettings('sk-test'), failing, conv),
      cached: { text: '欸，記得喝水喔。', characterId: 'c1', characterName: '小助手' }
    })

    expect(result).not.toBeNull()
    expect(result?.text).toBe('欸，記得喝水喔。')
    expect(result?.status).toBe('offline_fallback')
    expect(conv.messages).toHaveLength(1)
  })

  it('LLM 掛掉又沒有快取：仍要發樸素提醒（開關預設是開的）', async () => {
    /*
     * owner 2026-08-11 實機：離線時提醒整個被吞掉。
     * 「連不上網時仍要提醒」預設開著，勾了卻完全沉默是騙人的——
     * 連「有件事該做」都丟了，比一則樸素通知更糟。
     */
    const conv = emptyConv()
    const failing = (async () => {
      throw new Error('network down')
    }) as unknown as typeof globalThis.fetch
    const result = await speakStandaloneReminder(makeOpts(makeSettings('sk-test'), failing, conv))

    expect(result?.status).toBe('offline_plain')
    expect(result?.text).toContain('提醒我喝水')
    expect(result?.text).toContain('離線')
    // 通知標題用提醒名稱，不掛角色名字——那不是角色在講話
    expect(result?.plainTitle).toBe('喝水')
    // 也不寫進對話：提醒事項不是誰說的話
    expect(conv.messages).toHaveLength(0)
  })

  it('allowOfflineFallback=false 且沒快取：這時才真的安靜略過', async () => {
    const conv = emptyConv()
    const failing = (async () => {
      throw new Error('network down')
    }) as unknown as typeof globalThis.fetch
    const base = makeOpts(makeSettings('sk-test'), failing, conv)
    const result = await speakStandaloneReminder({
      ...base,
      reminder: { ...base.reminder, allowOfflineFallback: false }
    })

    expect(result).toBeNull()
    expect(conv.messages).toHaveLength(0)
  })

  it('allowOfflineFallback=false：有快取也不用，維持沉浸感', async () => {
    const conv = emptyConv()
    const failing = (async () => {
      throw new Error('network down')
    }) as unknown as typeof globalThis.fetch
    const base = makeOpts(makeSettings('sk-test'), failing, conv)
    const result = await speakStandaloneReminder({
      ...base,
      reminder: { ...base.reminder, allowOfflineFallback: false },
      cached: { text: '欸，記得喝水喔。', characterId: 'c1', characterName: '小助手' }
    })

    expect(result).toBeNull()
    expect(conv.messages).toHaveLength(0)
  })

  it('降級時掛回「當初講這句話的角色」，不是這次隨機挑到的', async () => {
    /*
     * owner 2026-08-11 實機回報：通知顯示 A 角色，點進 App 卻是 B 角色說的。
     * 原因是快取只存了文字，降級時用當下重新挑到的角色掛名。
     */
    const other: Character = { ...CHAR, id: 'c2', name: '小藍' }
    const conv = emptyConv()
    const failing = (async () => {
      throw new Error('network down')
    }) as unknown as typeof globalThis.fetch

    const settings = makeSettings('sk-test')
    // 在場只有 c2，所以「這次挑到的」一定是小藍
    settings.ui.desktopCharacters = [
      { characterId: 'c2', position: { x: 0, y: 0 }, size: 1, flipped: false, muted: false, zIndex: 1 }
    ]
    const base = makeOpts(settings, failing, conv)

    const result = await speakStandaloneReminder({
      ...base,
      characters: [CHAR, other],
      cached: { text: '記得洗杯子喔。', characterId: 'c1', characterName: '小綠' }
    })

    expect(result?.characterName).toBe('小綠')
    expect(result?.characterId).toBe('c1')
    // 寫進對話的那則也要掛在小綠身上，不然通知與對話會是兩個人
    expect(conv.messages[0].characterId).toBe('c1')
  })

  it('降級會附上原因，讓提醒紀錄查得出為什麼是舊句子', async () => {
    const conv = emptyConv()
    const { fetch } = stubLlm('不該被呼叫')
    const result = await speakStandaloneReminder({
      ...makeOpts(makeSettings(''), fetch, conv),
      cached: { text: '欸，記得喝水喔。', characterId: 'c1', characterName: '小綠' }
    })
    expect(result?.fallbackReason).toContain('API Key')
  })

  it('cache-refresh 模式生成失敗時回 null，不把降級結果存成快取', async () => {
    /*
     * owner 2026-08-11 實機：離線時按 HOME，刷快取失敗後把樸素通知
     * 「（離線中，角色暫時說不了話）」存進快取，之後觸發就用了它——
     * 快取被自己毒化，狀態也被誤記成 offline_fallback。
     */
    const conv = emptyConv()
    const failing = (async () => {
      throw new Error('network down')
    }) as unknown as typeof globalThis.fetch
    const result = await speakStandaloneReminder({
      ...makeOpts(makeSettings('sk-test'), failing, conv),
      mode: 'cache-refresh'
    })

    expect(result).toBeNull()
  })

  it('cache-refresh 模式：只回台詞，不寫進對話也不推事件', async () => {
    const conv = emptyConv()
    const { fetch } = stubLlm('該喝水囉。')
    const result = await speakStandaloneReminder({
      ...makeOpts(makeSettings('sk-test'), fetch, conv),
      mode: 'cache-refresh'
    })

    expect(result?.text).toBe('該喝水囉。')
    // 每次切走 App 都憑空多一則訊息的話，對話會被刷爆
    expect(conv.messages).toHaveLength(0)
  })

  it('全部角色都禁言時回 null（不發通知）', async () => {
    const conv = emptyConv()
    const settings = makeSettings('sk-test')
    settings.ui.desktopCharacters[0].muted = true
    const { fetch } = stubLlm('不該被呼叫')
    const result = await speakStandaloneReminder(makeOpts(settings, fetch, conv))

    expect(result).toBeNull()
    expect(conv.messages).toHaveLength(0)
  })
})
