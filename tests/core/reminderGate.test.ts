import { describe, expect, it } from 'vitest'
import { decideReminderFire, offlineFallbackAllowed } from '@core/reminder/gate'
import {
  needsRefresh,
  isCacheUsable,
  pruneCache,
  reminderFingerprint,
  CACHE_MAX_AGE_MS
} from '@core/reminder/cache'
import { appendHistory, buildHistoryItem, normalizeHistory, REMINDER_HISTORY_LIMIT } from '@core/reminder/history'
import type { Reminder } from '@core/types'

const base: Reminder = {
  id: 'r1',
  label: '喝水',
  prompt: '提醒我喝水',
  schedule: { type: 'daily', hour: 8, minute: 0 },
  enabled: true,
  createdAt: 0
}

describe('提醒該不該響（gate）', () => {
  it('沒設任何限制就照常響', () => {
    expect(decideReminderFire(base, { activeSceneId: null, screenOn: true })).toEqual({ action: 'fire' })
  })

  it('match_scene_only：情境不符就略過（不讓日常提醒打斷跑團）', () => {
    const r: Reminder = { ...base, sceneId: 's-daily', sceneConstraint: 'match_scene_only' }
    expect(decideReminderFire(r, { activeSceneId: 's-trpg', screenOn: true })).toEqual({
      action: 'skip',
      status: 'skipped_scene_mismatch'
    })
    expect(decideReminderFire(r, { activeSceneId: 's-daily', screenOn: true })).toEqual({ action: 'fire' })
  })

  it('any_scene：綁了情境但不限制觸發時機', () => {
    const r: Reminder = { ...base, sceneId: 's-daily', sceneConstraint: 'any_scene' }
    expect(decideReminderFire(r, { activeSceneId: 's-trpg', screenOn: true })).toEqual({ action: 'fire' })
  })

  it('情境不符優先於螢幕判定，且不進補發佇列', () => {
    // 情境不對就是根本不該出現，不是「晚點再說」
    const r: Reminder = {
      ...base,
      sceneId: 's-daily',
      sceneConstraint: 'match_scene_only',
      wakeMode: 'screen_on_only',
      inactiveBehavior: 'notify_on_unlock'
    }
    expect(decideReminderFire(r, { activeSceneId: 's-trpg', screenOn: false })).toEqual({
      action: 'skip',
      status: 'skipped_scene_mismatch'
    })
  })

  it('screen_on_only：螢幕暗著預設略過', () => {
    const r: Reminder = { ...base, wakeMode: 'screen_on_only' }
    expect(decideReminderFire(r, { activeSceneId: null, screenOn: false })).toEqual({
      action: 'skip',
      status: 'skipped_idle'
    })
  })

  it('screen_on_only ＋ notify_on_unlock：押後而不是丟掉', () => {
    const r: Reminder = { ...base, wakeMode: 'screen_on_only', inactiveBehavior: 'notify_on_unlock' }
    expect(decideReminderFire(r, { activeSceneId: null, screenOn: false })).toEqual({ action: 'defer' })
  })

  it('always（預設）不管螢幕亮不亮都響', () => {
    expect(decideReminderFire(base, { activeSceneId: null, screenOn: false })).toEqual({ action: 'fire' })
  })

  it('allowOfflineFallback 未設定＝允許（舊資料沒有這個欄位，該響的要響）', () => {
    expect(offlineFallbackAllowed(base)).toBe(true)
    expect(offlineFallbackAllowed({ ...base, allowOfflineFallback: false })).toBe(false)
  })
})

describe('快取台詞', () => {
  const now = 1_000_000_000

  it('太舊的快取寧可不用', () => {
    expect(isCacheUsable({ reminderId: 'r1', characterId: 'c', characterName: 'A', text: 'hi', generatedAt: now }, now)).toBe(true)
    expect(
      isCacheUsable(
        { reminderId: 'r1', characterId: 'c', characterName: 'A', text: 'hi', generatedAt: now - CACHE_MAX_AGE_MS - 1 },
        now
      )
    ).toBe(false)
  })

  it('對話沒動過就不重生（省 Token 的主要手段）', () => {
    const entry = {
      reminderId: 'r1',
      characterId: 'c',
      characterName: 'A',
      text: 'hi',
      generatedAt: now,
      basedOnConversationUpdatedAt: 500
    }
    expect(needsRefresh(entry, 500, now)).toBe(false)
    // 設完提醒之後又聊了天 → 一定要重生，否則那段互動不會被吃進去
    expect(needsRefresh(entry, 600, now)).toBe(true)
    expect(needsRefresh(undefined, 500, now)).toBe(true)
  })

  it('提醒內容被改過就一定要重生（2026-08-11 實機回報的「改了還是舊句子」）', () => {
    const entry = {
      reminderId: 'r1',
      characterId: 'c',
      characterName: 'A',
      text: '記得洗杯子',
      generatedAt: now,
      basedOnConversationUpdatedAt: 500,
      fingerprint: reminderFingerprint(base)
    }
    // 對話沒動、時間也還新，但提醒指令換了 → 舊台詞講的是別件事
    const edited = { ...base, prompt: '再檢查一下功能' }
    expect(needsRefresh(entry, 500, now, reminderFingerprint(edited))).toBe(true)
    expect(needsRefresh(entry, 500, now, reminderFingerprint(base))).toBe(false)
  })

  it('指紋只看會影響台詞的欄位（改時間不該讓快取白重生）', () => {
    // 型別上 reminderFingerprint 只收得到那幾個欄位，這裡順帶固定住這個界線
    const a = reminderFingerprint({ label: '喝水', prompt: '提醒我喝水' })
    const b = reminderFingerprint({ label: '喝水', prompt: '提醒我喝水', injectWeather: false })
    expect(a).toBe(b)
    expect(a).not.toBe(reminderFingerprint({ label: '喝水', prompt: '提醒我喝水', injectWeather: true }))
  })

  it('換發話角色也算內容改變', () => {
    expect(reminderFingerprint(base)).not.toBe(reminderFingerprint({ ...base, characterId: 'c2' }))
  })

  it('提醒被刪掉時快取跟著走', () => {
    const cache = {
      r1: { reminderId: 'r1', characterId: 'c', characterName: 'A', text: 'a', generatedAt: now },
      r2: { reminderId: 'r2', characterId: 'c', characterName: 'A', text: 'b', generatedAt: now }
    }
    expect(Object.keys(pruneCache(cache, ['r1']))).toEqual(['r1'])
  })
})

describe('提醒歷史', () => {
  it('新的排前面並套用上限', () => {
    let list = [] as ReturnType<typeof buildHistoryItem>[]
    for (let i = 0; i < REMINDER_HISTORY_LIMIT + 10; i++) {
      list = appendHistory(list, buildHistoryItem(base, { status: 'success', text: `t${i}` }, `h${i}`, i))
    }
    expect(list).toHaveLength(REMINDER_HISTORY_LIMIT)
    expect(list[0].text).toBe(`t${REMINDER_HISTORY_LIMIT + 9}`)
  })

  it('label 是觸發當下的快照（之後改名不影響舊紀錄）', () => {
    const item = buildHistoryItem(base, { status: 'success', text: 'hi' }, 'h1', 123)
    expect(item.reminderLabel).toBe('喝水')
    expect(item.timestamp).toBe(123)
  })

  it('檔案壞掉時讀回空陣列而不是炸掉', () => {
    expect(normalizeHistory(null)).toEqual([])
    expect(normalizeHistory({ nope: 1 })).toEqual([])
    expect(normalizeHistory([{ id: 'a' }, null, 'x'])).toHaveLength(1)
  })
})
