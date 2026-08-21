import { afterEach, describe, expect, it } from 'vitest'
import {
  getStandaloneSession,
  setPendingStandaloneSession,
  setStandaloneSession,
  takePendingStandaloneSession
} from '../../src/mobile/runtime/sessionHolder'
import type { StandaloneSession } from '../../src/mobile/runtime/session'

/**
 * B-6：`pending` 是繞開 `App.tsx` attach effect 那段「切換模式一定會
 * `setStandaloneSession(null)`」cleanup 的另一條通道，用來把
 * `ModeSwitcher.localSessionForSync()` 剛 boot 好、已經同步過的 session
 * 交給 `App.tsx` 接手，而不是讓它重新 boot 一份只認磁碟的新的。
 * 這裡只測邏輯本身（拿放對不對、用過即棄），不牽扯真的 boot session。
 */
const fakeSession = (tag: string): StandaloneSession => ({ tag } as unknown as StandaloneSession)

describe('sessionHolder：pending session 交接（B-6）', () => {
  afterEach(() => {
    setStandaloneSession(null)
    takePendingStandaloneSession() // 清掉，不讓一個測試殘留的 pending 汙染下一個
  })

  it('沒有人 set 過 pending 時，take 回傳 null', () => {
    expect(takePendingStandaloneSession()).toBeNull()
  })

  it('set 過的 session，take 拿得到同一個物件', () => {
    const s = fakeSession('a')
    setPendingStandaloneSession(s)
    expect(takePendingStandaloneSession()).toBe(s)
  })

  it('take 之後自動清空，第二次 take 回傳 null（用過即棄，不是常駐單例）', () => {
    setPendingStandaloneSession(fakeSession('a'))
    takePendingStandaloneSession()
    expect(takePendingStandaloneSession()).toBeNull()
  })

  it('後面 set 的會蓋掉前一個還沒被 take 的（不會排隊）', () => {
    setPendingStandaloneSession(fakeSession('a'))
    const b = fakeSession('b')
    setPendingStandaloneSession(b)
    expect(takePendingStandaloneSession()).toBe(b)
  })

  it('pending 跟 current（getStandaloneSession／setStandaloneSession）是完全獨立的兩個變數', () => {
    const current = fakeSession('current')
    setStandaloneSession(current)
    setPendingStandaloneSession(fakeSession('pending'))

    // 模擬 App.tsx attach effect 的 cleanup：無條件把 current 清空
    setStandaloneSession(null)

    // pending 不受影響，仍然拿得到
    expect(getStandaloneSession()).toBeNull()
    expect(takePendingStandaloneSession()).not.toBeNull()
  })
})
