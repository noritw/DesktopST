import { describe, expect, it } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import type { Conversation, Message } from '@core/types'
import { pairConversations, defaultConvChoices, type ConvEntity } from '@core/sync/convPair'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'
import { applyConversationSync } from '../../src/mobile/runtime/syncConversations'

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

const msg = (id: string, timestamp: number, over: Partial<Message> = {}): Message => ({
  id,
  role: 'character',
  content: `內容 ${id}`,
  timestamp,
  ...over
})

const conv = (over: Partial<Conversation> & { id: string }): Conversation => ({
  title: '對話',
  participantIds: [],
  messages: [],
  summary: '',
  createdAt: 1000,
  updatedAt: 1000,
  ...over
})

const noMaps = (): { l2r: Map<string, string>; r2l: Map<string, string> } => ({ l2r: new Map(), r2l: new Map() })

/**
 * 造假電腦端。
 *
 * `newIdFor` 模擬「電腦收到新對話後自己發一顆 uuid」——那正是 S2 M3
 * 對應表整份寫錯的來源（`mobile-sync-m4-compare.md` §1.1），測試必須涵蓋。
 */
function makeFakeDesktop(opts: { conversations?: Conversation[]; newId?: string } = {}) {
  const remote = new Map((opts.conversations ?? []).map((c) => [c.id, structuredClone(c)]))
  const calls: { method: string; path: string; body?: any }[] = []

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.replace(SRC.baseUrl, '')
    const method = init?.method ?? 'GET'
    let body: any
    if (typeof init?.body === 'string') body = JSON.parse(init.body)
    calls.push({ method, path, body })

    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

    if (path.startsWith('/api/sync-conversation?')) {
      const q = new URLSearchParams(path.split('?')[1])
      const c = remote.get(q.get('id') ?? '')
      if (!c) return new Response('not found', { status: 404 })
      if (q.get('idsOnly') === '1') {
        return json({
          conversation: {
            id: c.id,
            title: c.title,
            updatedAt: c.updatedAt,
            summary: c.summary,
            summaryCoversTs: c.summaryCoversTs,
            participantIds: c.participantIds,
            messageIds: c.messages.map((m) => m.id)
          }
        })
      }
      return json({ conversation: c })
    }

    if (path === '/api/sync-conversation-merge') {
      let target = body.targetId ? remote.get(body.targetId) : undefined
      if (!target) {
        // 電腦端**丟掉手機送來的 id、自己發一顆新的**（createNewConversation 的行為）
        target = conv({ id: opts.newId ?? 'pc-new', title: body.title ?? '對話' })
        remote.set(target.id, target)
      }
      const have = new Set(target.messages.map((m) => m.id))
      let written = 0
      let skipped = 0
      for (const m of body.messages ?? []) {
        if (have.has(m.id)) { skipped++; continue }
        have.add(m.id)
        target.messages.push(m)
        written++
      }
      target.participantIds = [...new Set([...target.participantIds, ...(body.participantIds ?? [])])]
      return json({ id: target.id, written, skipped, messageCount: target.messages.length })
    }

    if (path === '/api/conversations/rename') {
      const c = remote.get(body.id)
      if (c) c.title = body.title
      return json({ ok: true })
    }

    if (path === '/api/conversations/delete') {
      remote.delete(body.id)
      return json({ activeConversationId: 'whatever' })
    }

    return new Response('unexpected ' + path, { status: 500 })
  }) as unknown as typeof fetch

  return { fetchImpl, calls, remote }
}

/** 把 session 裡的對話與造假電腦端的對話配對成 rows。 */
function rowsFor(session: StandaloneSession, remote: Map<string, Conversation>) {
  const remoteEntities: ConvEntity[] = [...remote.values()].map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    messageCount: c.messages.length,
    messageIdsHash: c.messages.map((m) => m.id).sort().join('|'),
    summaryHash: c.summary || '',
    summaryCoversTs: c.summaryCoversTs
  }))
  const localEntities: ConvEntity[] = session.listConversationsManifest().map((m) => ({
    ...m,
    // 造假端的指紋用同一套土法算，兩邊才對得起來
    messageIdsHash: (session.getConversation(m.id)?.messages ?? []).map((x) => x.id).sort().join('|'),
    summaryHash: session.getConversation(m.id)?.summary || ''
  }))
  return pairConversations(localEntities, remoteEntities)
}

/** 清掉開機時自動建立的那則空對話，讓測試只看自己放進去的。 */
async function onlyConversations(session: StandaloneSession, list: Conversation[]): Promise<void> {
  for (const c of session.listConversations()) {
    await session.adapters.storage.remove(`conversations/${c.id}`)
  }
  ;(session as unknown as { conversationIndex: Map<string, Conversation> }).conversationIndex.clear()
  for (const c of list) await session.addImportedConversation(c)
}

describe('applyConversationSync', () => {
  it('手機獨有的對話整則推過去', async () => {
    const session = await bootSession()
    await onlyConversations(session, [conv({ id: 'phone-1', title: '週末的冒險', messages: [msg('m1', 1), msg('m2', 2)] })])
    const pc = makeFakeDesktop({ newId: 'pc-fresh' })
    const rows = rowsFor(session, pc.remote)

    const r = await applyConversationSync(
      SRC,
      session,
      { rows, choices: defaultConvChoices(rows), characterIds: noMaps() },
      pc.fetchImpl
    )

    expect(r.pushed).toEqual(['週末的冒險'])
    expect(pc.remote.get('pc-fresh')!.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  /*
   * S2 M3 的死因：推完不讀回應，把手機自己的 id 記成對應。
   * 電腦端會丟掉送來的 id 自己發一顆，不讀回應的話對應表整份指向不存在的東西，
   * 下一趟又推一份，而且**沒有自我修復路徑**。
   */
  it('推送後把電腦回傳的真實 id 記回本機，不是自己那顆', async () => {
    const session = await bootSession()
    await onlyConversations(session, [conv({ id: 'phone-1', messages: [msg('m1', 1)] })])
    const pc = makeFakeDesktop({ newId: 'pc-uuid-9999' })
    const rows = rowsFor(session, pc.remote)

    await applyConversationSync(SRC, session, { rows, choices: defaultConvChoices(rows), characterIds: noMaps() }, pc.fetchImpl)

    expect(session.getConversation('phone-1')!.importedFrom?.sourceId).toBe('pc-uuid-9999')
  })

  it('第二次同步不會再推一份（第一次已經記下對應）', async () => {
    const session = await bootSession()
    await onlyConversations(session, [conv({ id: 'phone-1', messages: [msg('m1', 1)] })])
    const pc = makeFakeDesktop({ newId: 'pc-uuid' })

    const first = rowsFor(session, pc.remote)
    await applyConversationSync(SRC, session, { rows: first, choices: defaultConvChoices(first), characterIds: noMaps() }, pc.fetchImpl)

    const second = rowsFor(session, pc.remote)
    expect(second).toHaveLength(1)
    expect(second[0]!.localId).toBe('phone-1')
    expect(second[0]!.remoteId).toBe('pc-uuid')
    expect(second[0]!.compare).toBe('same')

    await applyConversationSync(SRC, session, { rows: second, choices: defaultConvChoices(second), characterIds: noMaps() }, pc.fetchImpl)
    expect(pc.remote.size).toBe(1)
    expect(pc.remote.get('pc-uuid')!.messages).toHaveLength(1)
  })

  it('電腦獨有的對話整則帶回手機，並記住來源 id', async () => {
    const session = await bootSession()
    await onlyConversations(session, [])
    const pc = makeFakeDesktop({
      conversations: [conv({ id: 'pc-1', title: '電腦上的對話', messages: [msg('a', 1), msg('b', 2)] })]
    })
    const rows = rowsFor(session, pc.remote)

    const r = await applyConversationSync(SRC, session, { rows, choices: defaultConvChoices(rows), characterIds: noMaps() }, pc.fetchImpl)

    expect(r.pulled).toEqual(['電腦上的對話'])
    const landed = session.listConversations().find((c) => c.title === '電腦上的對話')!
    expect(session.getConversation(landed.id)!.messages.map((m) => m.id)).toEqual(['a', 'b'])
    expect(session.getConversation(landed.id)!.importedFrom?.sourceId).toBe('pc-1')
  })

  /*
   * 對話同步的核心：同一則裡兩邊都有對方沒有的訊息，這是**常態不是衝突**，
   * 正確處置是兩邊都補齊，不是叫使用者選一邊。
   */
  it('兩邊都有對方沒有的訊息時雙向補齊，且順序按時間戳', async () => {
    const session = await bootSession()
    await onlyConversations(session, [
      conv({ id: 'phone-1', title: '共同的對話', messages: [msg('m1', 10), msg('m2', 20)] })
    ])
    const pc = makeFakeDesktop({
      conversations: [conv({ id: 'pc-1', title: '共同的對話', messages: [msg('m1', 10), msg('m3', 30)] })]
    })
    const rows = rowsFor(session, pc.remote)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.compare).toBe('differs')

    const r = await applyConversationSync(SRC, session, { rows, choices: defaultConvChoices(rows), characterIds: noMaps() }, pc.fetchImpl)

    expect(r.merged).toEqual(['共同的對話'])
    expect(session.getConversation('phone-1')!.messages.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(pc.remote.get('pc-1')!.messages.map((m) => m.id).sort()).toEqual(['m1', 'm2', 'm3'])
  })

  it('只送電腦缺的那幾則，不整則重送', async () => {
    const session = await bootSession()
    await onlyConversations(session, [
      conv({ id: 'phone-1', title: '共同的對話', messages: [msg('m1', 10), msg('m2', 20), msg('m3', 30)] })
    ])
    const pc = makeFakeDesktop({
      conversations: [conv({ id: 'pc-1', title: '共同的對話', messages: [msg('m1', 10), msg('m2', 20)] })]
    })
    const rows = rowsFor(session, pc.remote)

    await applyConversationSync(SRC, session, { rows, choices: defaultConvChoices(rows), characterIds: noMaps() }, pc.fetchImpl)

    const merge = pc.calls.find((c) => c.path === '/api/sync-conversation-merge')!
    expect(merge.body.messages.map((m: Message) => m.id)).toEqual(['m3'])
  })

  it('兩邊完全相同時什麼請求都不發', async () => {
    const session = await bootSession()
    await onlyConversations(session, [conv({ id: 'phone-1', title: '一樣的', messages: [msg('m1', 1)] })])
    const pc = makeFakeDesktop({ conversations: [conv({ id: 'pc-1', title: '一樣的', messages: [msg('m1', 1)] })] })
    const rows = rowsFor(session, pc.remote)
    expect(rows[0]!.compare).toBe('same')

    await applyConversationSync(SRC, session, { rows, choices: defaultConvChoices(rows), characterIds: noMaps() }, pc.fetchImpl)
    expect(pc.calls).toHaveLength(0)
  })

  /*
   * ⚠️ 這條跟情境推送**方向剛好相反**，兩者長得很像、抄錯不會有任何錯誤訊息。
   *
   * 情境的 desktopCharacters 對不到角色時整項丟掉（推死參照過去更糟）；
   * 訊息**絕對不能丟**——那是內容本身，丟掉就是聊天記錄真的少一段。
   * 角色查不到人時還有 characterName 當備援（core/types.ts 記了 2026-08-13
   * 七隻角色 id 被同步重建、五月到八月對話全部查不到人的事故）。
   */
  it('訊息的角色 id 翻不出來時原樣保留，不丟掉那則訊息', async () => {
    const session = await bootSession()
    await onlyConversations(session, [
      conv({
        id: 'phone-1',
        messages: [
          msg('m1', 1, { characterId: 'phone-char-known' }),
          msg('m2', 2, { characterId: 'phone-char-unknown', characterName: '小綠' })
        ]
      })
    ])
    const pc = makeFakeDesktop({ newId: 'pc-1' })
    const rows = rowsFor(session, pc.remote)
    const maps = noMaps()
    maps.l2r.set('phone-char-known', 'pc-char-known')

    await applyConversationSync(SRC, session, { rows, choices: defaultConvChoices(rows), characterIds: maps }, pc.fetchImpl)

    const sent = pc.remote.get('pc-1')!.messages
    expect(sent).toHaveLength(2)
    expect(sent[0]!.characterId).toBe('pc-char-known')
    expect(sent[1]!.characterId).toBe('phone-char-unknown')
    expect(sent[1]!.characterName).toBe('小綠')
  })

  /** 參與清單相反：留死 id 沒有備援可以接回去，只會在對面變成死參照。 */
  it('參與角色清單裡翻不出來的 id 會被拿掉', async () => {
    const session = await bootSession()
    await onlyConversations(session, [
      conv({ id: 'phone-1', participantIds: ['known', 'unknown'], messages: [msg('m1', 1)] })
    ])
    const pc = makeFakeDesktop({ newId: 'pc-1' })
    const rows = rowsFor(session, pc.remote)
    const maps = noMaps()
    maps.l2r.set('known', 'pc-known')

    await applyConversationSync(SRC, session, { rows, choices: defaultConvChoices(rows), characterIds: maps }, pc.fetchImpl)

    expect(pc.remote.get('pc-1')!.participantIds).toEqual(['pc-known'])
  })

  it('單則失敗不中斷整趟，其餘照做', async () => {
    const session = await bootSession()
    await onlyConversations(session, [
      conv({ id: 'phone-bad', title: '會失敗的', messages: [msg('x', 1)] }),
      conv({ id: 'phone-ok', title: '正常的', messages: [msg('y', 1)] })
    ])
    const pc = makeFakeDesktop({ newId: 'pc-ok' })
    const rows = rowsFor(session, pc.remote)
    let first = true
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (first && String(input).includes('sync-conversation-merge')) {
        first = false
        throw new Error('斷線')
      }
      return pc.fetchImpl(input, init)
    }) as unknown as typeof fetch

    const r = await applyConversationSync(SRC, session, { rows, choices: defaultConvChoices(rows), characterIds: noMaps() }, flaky)

    expect(r.failed).toHaveLength(1)
    expect(r.pushed).toEqual(['正常的'])
  })

  /*
   * B-1 階段一：owner 實機回報「故意刪掉的對話同步後又被送回來」——
   * 單邊獨有的列選 delete 要真的刪掉有值的那一邊，不能只是不動。
   */
  it('手機獨有的列選 delete 會刪掉本機那份', async () => {
    const session = await bootSession()
    await onlyConversations(session, [conv({ id: 'phone-1', title: '想刪掉的', messages: [msg('m1', 1)] })])
    const pc = makeFakeDesktop()
    const rows = rowsFor(session, pc.remote)

    const r = await applyConversationSync(
      SRC,
      session,
      { rows, choices: { [rows[0]!.key]: 'delete' }, characterIds: noMaps() },
      pc.fetchImpl
    )

    expect(r.deletedLocal).toEqual(['想刪掉的'])
    expect(session.listConversations().some((c) => c.id === 'phone-1')).toBe(false)
    expect(pc.calls).toHaveLength(0)
  })

  it('電腦獨有的列選 delete 會叫電腦刪掉，不會拉回手機', async () => {
    const session = await bootSession()
    await onlyConversations(session, [])
    const pc = makeFakeDesktop({
      conversations: [conv({ id: 'pc-1', title: '電腦上想刪的', messages: [msg('a', 1)] })]
    })
    const rows = rowsFor(session, pc.remote)

    const r = await applyConversationSync(
      SRC,
      session,
      { rows, choices: { [rows[0]!.key]: 'delete' }, characterIds: noMaps() },
      pc.fetchImpl
    )

    expect(r.deletedRemote).toEqual(['電腦上想刪的'])
    expect(pc.remote.has('pc-1')).toBe(false)
    expect(session.listConversations().some((c) => c.title === '電腦上想刪的')).toBe(false)
  })

  it('選 keep 的列完全不動', async () => {
    const session = await bootSession()
    await onlyConversations(session, [conv({ id: 'phone-1', title: '不要動', messages: [msg('m1', 1)] })])
    const pc = makeFakeDesktop()
    const rows = rowsFor(session, pc.remote)

    await applyConversationSync(SRC, session, { rows, choices: { [rows[0]!.key]: 'keep' }, characterIds: noMaps() }, pc.fetchImpl)
    expect(pc.calls).toHaveLength(0)
    expect(pc.remote.size).toBe(0)
  })

  it('標題選「電腦」時本機改名；選「手機」時去電腦上改名', async () => {
    const session = await bootSession()
    await onlyConversations(session, [
      conv({ id: 'phone-1', title: '手機的名字', messages: [msg('m1', 1)], importedFrom: { sourceId: 'pc-1', sourceUpdatedAt: 1, importedAt: 1 } })
    ])
    const pc = makeFakeDesktop({ conversations: [conv({ id: 'pc-1', title: '電腦的名字', messages: [msg('m1', 1)] })] })
    const rows = rowsFor(session, pc.remote)
    expect(rows[0]!.conflicts.map((c) => c.field)).toEqual(['title'])

    await applyConversationSync(
      SRC,
      session,
      { rows, choices: defaultConvChoices(rows), fieldChoices: { [rows[0]!.key]: { title: 'remote' } }, characterIds: noMaps() },
      pc.fetchImpl
    )
    expect(session.getConversation('phone-1')!.title).toBe('電腦的名字')
  })

  /*
   * §6.2 ② 規則 2：同 id 內容不同 ＝ 兩邊各自保留自己那份。
   *
   * ⚠️ 這件事是**靜默**發生的，而且刻意如此：推送前先算出電腦缺哪幾則，
   * 同 id 的根本不會被傳輸 —— 所以也就無從得知對面把它編輯過。要偵測就得
   * 比對內容，那正是 `?idsOnly=1` 與分批想避免的整份傳輸。這條測試釘的是
   * 「結果正確（兩邊各留各的）」與「不為此付出傳輸成本」。
   */
  it('同一個 id 兩邊內容不同時各自保留自己那份，且不為此傳輸內容', async () => {
    const session = await bootSession()
    await onlyConversations(session, [
      conv({ id: 'phone-1', title: '共同的', messages: [msg('m1', 1, { content: '手機版本' }), msg('m2', 2)] })
    ])
    const pc = makeFakeDesktop({
      conversations: [conv({ id: 'pc-1', title: '共同的', messages: [msg('m1', 1, { content: '電腦上編輯過' }), msg('m3', 3)] })]
    })
    const rows = rowsFor(session, pc.remote)

    const r = await applyConversationSync(SRC, session, { rows, choices: defaultConvChoices(rows), characterIds: noMaps() }, pc.fetchImpl)

    // 兩邊各自保留原本的 m1
    expect(session.getConversation('phone-1')!.messages.find((m) => m.id === 'm1')!.content).toBe('手機版本')
    expect(pc.remote.get('pc-1')!.messages.find((m) => m.id === 'm1')!.content).toBe('電腦上編輯過')
    // m1 從頭到尾沒有被送出去過——只有兩邊真的缺的那幾則才上路
    const merge = pc.calls.find((c) => c.path === '/api/sync-conversation-merge')!
    expect(merge.body.messages.map((m: Message) => m.id)).toEqual(['m2'])
    expect(r.keptOwnVersion).toBe(0)
  })
})
