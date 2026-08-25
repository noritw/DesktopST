import { describe, expect, it } from 'vitest'
import type { PlatformAdapters } from '@core/adapters'
import type { ChoiceMap, PairTable } from '@core/sync/pair'
import type { Reminder } from '@core/types'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { unavailableSecrets } from '../../src/mobile/adapters/secretCrypto'
import { bootStandaloneSession, type StandaloneSession } from '../../src/mobile/runtime/session'
import { applySync } from '../../src/mobile/runtime/syncApply'

/**
 * S2 提醒同步（`docs/reminder-sync-kickoff.md`）。
 *
 * 跟角色／情境那些 `applySync` 既有測試（`syncApply.test.ts`）不一樣的地方只有
 * 一件事：提醒物件裡有幾個欄位是「裝置本地設定」，push/pull 時不能整包覆蓋
 * 接收端原有的值——這份測試檔的重點全部圍繞這一條。
 */

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

function makeReminder(over: Partial<Reminder> = {}): Reminder {
  return {
    id: 'r-local',
    label: '喝水',
    prompt: '提醒使用者喝水',
    schedule: { type: 'daily', hour: 8, minute: 0 },
    enabled: true,
    notificationDevice: 'mobile',
    createdAt: 1,
    ...over
  }
}

/** 造假電腦端：`reminders` 是電腦上現有的提醒清單，`calls` 記錄所有請求。 */
function makeFakeDesktop(reminders: Reminder[] = []) {
  const list = [...reminders]
  const calls: { method: string; path: string; body?: any }[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const path = url.replace(SRC.baseUrl, '')
    const method = init?.method ?? 'GET'
    let body: any
    if (typeof init?.body === 'string') body = JSON.parse(init.body)
    calls.push({ method, path, body })

    const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } })

    if (method === 'GET' && path === '/api/reminders') return json({ reminders: list })
    if (method === 'POST' && path === '/api/reminders/save') {
      const sent: Reminder = body.reminder
      const idx = list.findIndex((r) => r.id === sent.id)
      if (idx >= 0) list[idx] = sent
      else list.push(sent)
      return json({ reminder: sent })
    }
    if (method === 'POST' && path === '/api/reminders/delete') {
      const i = list.findIndex((r) => r.id === body.id)
      if (i >= 0) list.splice(i, 1)
      return json({ ok: true })
    }
    return json({ ok: true })
  }) as typeof fetch

  return { fetchImpl, calls, list }
}

describe('reminders 推送／帶回', () => {
  it('只有手機有的新提醒：推到電腦，落地成新的一筆', async () => {
    const session = await bootSession()
    session.reminders.push(makeReminder())

    const { fetchImpl, list } = makeFakeDesktop()
    const table = emptyTable({ reminders: [{ key: 'k', name: '喝水', localId: 'r-local' }] })
    const res = await applySync(SRC, session, { table, choices: emptyChoices({ reminders: { k: 'local' } }) }, fetchImpl)

    expect(res.failed).toEqual([])
    expect(res.pushed.reminders).toEqual(['喝水'])
    expect(list).toHaveLength(1)
    expect(list[0].prompt).toBe('提醒使用者喝水')
  })

  it('只有電腦有的提醒：帶回手機，落地成手機本地那份', async () => {
    const session = await bootSession()
    const { fetchImpl } = makeFakeDesktop([makeReminder({ id: 'r-remote', label: '運動' })])
    const table = emptyTable({ reminders: [{ key: 'k', name: '運動', remoteId: 'r-remote' }] })
    const res = await applySync(SRC, session, { table, choices: emptyChoices({ reminders: { k: 'remote' } }) }, fetchImpl)

    expect(res.failed).toEqual([])
    expect(res.pulled.reminders).toEqual(['運動'])
    expect(session.reminders.some((r) => r.label === '運動')).toBe(true)
  })
})

describe('reminders 裝置本地欄位不會被覆蓋', () => {
  it('推送時保留電腦端原有的 notificationDevice／wakeMode／inactiveBehavior', async () => {
    const session = await bootSession()
    session.reminders.push(
      makeReminder({
        id: 'r-local',
        label: '洗碗',
        notificationDevice: 'mobile',
        wakeMode: 'screen_on_only',
        inactiveBehavior: 'notify_on_unlock',
        allowOfflineFallback: false
      })
    )

    const { fetchImpl, list } = makeFakeDesktop([
      makeReminder({
        id: 'r-remote',
        label: '洗碗',
        notificationDevice: 'desktop',
        wakeMode: 'always',
        inactiveBehavior: 'skip',
        allowOfflineFallback: true,
        lastTriggeredAt: 12345
      })
    ])
    const table = emptyTable({ reminders: [{ key: 'k', name: '洗碗', localId: 'r-local', remoteId: 'r-remote' }] })
    await applySync(SRC, session, { table, choices: emptyChoices({ reminders: { k: 'local' } }) }, fetchImpl)

    const saved = list.find((r) => r.id === 'r-remote')!
    // 裝置本地欄位：維持電腦上原本的值，不被手機那份蓋掉
    expect(saved.notificationDevice).toBe('desktop')
    expect(saved.wakeMode).toBe('always')
    expect(saved.inactiveBehavior).toBe('skip')
    expect(saved.allowOfflineFallback).toBe(true)
    expect(saved.lastTriggeredAt).toBe(12345)
    // 其餘欄位才套用手機的值
    expect(saved.label).toBe('洗碗')
  })

  it('帶回手機時保留手機端原有的裝置本地欄位', async () => {
    const session = await bootSession()
    session.reminders.push(
      makeReminder({
        id: 'r-local',
        label: '倒垃圾',
        notificationDevice: 'mobile',
        wakeMode: 'screen_on_only',
        allowOfflineFallback: false
      })
    )

    const { fetchImpl } = makeFakeDesktop([
      makeReminder({
        id: 'r-remote',
        label: '倒垃圾',
        prompt: '電腦端改過的提詞',
        notificationDevice: 'desktop',
        wakeMode: 'always',
        allowOfflineFallback: true
      })
    ])
    const table = emptyTable({ reminders: [{ key: 'k', name: '倒垃圾', localId: 'r-local', remoteId: 'r-remote', compare: 'differs' }] })
    await applySync(SRC, session, { table, choices: emptyChoices({ reminders: { k: 'remote' } }) }, fetchImpl)

    const landed = session.reminders.find((r) => r.id === 'r-local')!
    // 內容欄位換成電腦的
    expect(landed.prompt).toBe('電腦端改過的提詞')
    // 裝置本地欄位維持手機原本的值
    expect(landed.notificationDevice).toBe('mobile')
    expect(landed.wakeMode).toBe('screen_on_only')
    expect(landed.allowOfflineFallback).toBe(false)
  })

  it('新增（接收端本來沒有這筆）時，裝置本地欄位才用來源端的值當初始值', async () => {
    const session = await bootSession()
    session.reminders.push(makeReminder({ id: 'r-local', label: '新提醒', notificationDevice: 'mobile', wakeMode: 'screen_on_only' }))

    const { fetchImpl, list } = makeFakeDesktop()
    const table = emptyTable({ reminders: [{ key: 'k', name: '新提醒', localId: 'r-local' }] })
    await applySync(SRC, session, { table, choices: emptyChoices({ reminders: { k: 'local' } }) }, fetchImpl)

    expect(list[0].notificationDevice).toBe('mobile')
    expect(list[0].wakeMode).toBe('screen_on_only')
  })
})

describe('reminders id 參照翻譯', () => {
  it('characterId／sceneId 翻不過去時整欄位不推，不留死參照', async () => {
    const session = await bootSession()
    session.reminders.push(makeReminder({ id: 'r-local', label: '提醒', characterId: '電腦上沒有這隻', sceneId: '電腦上沒有這個情境' }))

    const { fetchImpl, list } = makeFakeDesktop()
    const table = emptyTable({ reminders: [{ key: 'k', name: '提醒', localId: 'r-local' }] })
    await applySync(SRC, session, { table, choices: emptyChoices({ reminders: { k: 'local' } }) }, fetchImpl)

    expect(list[0].characterId).toBeUndefined()
    expect(list[0].sceneId).toBeUndefined()
  })

  it('conversationId 一律不推——同步當下沒有對照表可翻', async () => {
    const session = await bootSession()
    session.reminders.push(makeReminder({ id: 'r-local', label: '提醒', conversationId: 'conv-local' }))

    const { fetchImpl, list } = makeFakeDesktop()
    const table = emptyTable({ reminders: [{ key: 'k', name: '提醒', localId: 'r-local' }] })
    await applySync(SRC, session, { table, choices: emptyChoices({ reminders: { k: 'local' } }) }, fetchImpl)

    expect(list[0].conversationId).toBeUndefined()
  })

  it('characterId 翻得過去時換成電腦端的 id', async () => {
    const session = await bootSession()
    session.characters.push({ id: 'c-local', name: '小明' } as any)
    session.reminders.push(makeReminder({ id: 'r-local', label: '提醒', characterId: 'c-local' }))

    const { fetchImpl, list } = makeFakeDesktop()
    const table = emptyTable({
      characters: [{ key: 'c', name: '小明', localId: 'c-local', remoteId: 'c-remote' }],
      reminders: [{ key: 'k', name: '提醒', localId: 'r-local' }]
    })
    await applySync(SRC, session, { table, choices: emptyChoices({ characters: { c: 'keep' }, reminders: { k: 'local' } }) }, fetchImpl)

    expect(list[0].characterId).toBe('c-remote')
  })
})

describe('reminders 刪除', () => {
  it('只有手機有、卻選了電腦 → 從手機刪掉', async () => {
    const session = await bootSession()
    session.reminders.push(makeReminder({ id: 'r-local', label: '刪掉我' }))

    const { fetchImpl } = makeFakeDesktop()
    const table = emptyTable({ reminders: [{ key: 'k', name: '刪掉我', localId: 'r-local' }] })
    const res = await applySync(SRC, session, { table, choices: emptyChoices({ reminders: { k: 'remote' } }) }, fetchImpl)

    expect(res.deletedLocal.reminders).toEqual(['刪掉我'])
    expect(session.reminders.some((r) => r.id === 'r-local')).toBe(false)
  })

  it('只有電腦有、卻選了手機 → 呼叫電腦的刪除端點', async () => {
    const session = await bootSession()
    const { fetchImpl, calls } = makeFakeDesktop([makeReminder({ id: 'r-remote', label: '電腦上刪掉' })])
    const table = emptyTable({ reminders: [{ key: 'k', name: '電腦上刪掉', remoteId: 'r-remote' }] })
    const res = await applySync(SRC, session, { table, choices: emptyChoices({ reminders: { k: 'local' } }) }, fetchImpl)

    expect(res.deletedRemote.reminders).toEqual(['電腦上刪掉'])
    const del = calls.find((c) => c.path === '/api/reminders/delete')
    expect(del?.body).toEqual({ id: 'r-remote' })
  })
})
