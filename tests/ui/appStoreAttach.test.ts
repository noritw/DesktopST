import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppStateSnapshot, DataSource, SendMessageInput } from '@core/data'
import { DataError } from '@core/data'
import type { EventSource } from '@core/events'
import { LocalEventSource } from '../../src/mobile/events/localEventSource'
import { isAttached, useAppStore } from '../../src/mobile/ui/stores/appStore'

function fakeSource(build: () => Partial<DataSource>): DataSource {
  return build() as unknown as DataSource
}

describe('isAttached()', () => {
  it('attach() 之前回傳 false', () => {
    expect(isAttached()).toBe(false)
  })

  it('attach() 之後回傳 true', async () => {
    const events = new LocalEventSource()
    const data = fakeSource(() => ({
      async getState(): Promise<AppStateSnapshot> {
        return { conversation: { id: 'c1', title: 't', messages: [] } }
      }
    }))
    useAppStore.getState().attach({ data, events })
    expect(isAttached()).toBe(true)
  })

  it('呼叫 attach() 回傳的 detach 函式之後回到 false', async () => {
    const events = new LocalEventSource()
    const data = fakeSource(() => ({
      async getState(): Promise<AppStateSnapshot> {
        return { conversation: { id: 'c1', title: 't', messages: [] } }
      }
    }))
    const detach = useAppStore.getState().attach({ data, events })
    expect(isAttached()).toBe(true)
    detach()
    expect(isAttached()).toBe(false)
  })
})

describe('send() 的 unreachable 對帳分支', () => {
  let detachFn: (() => void) | null = null

  afterEach(() => {
    if (detachFn) detachFn()
    detachFn = null
  })

  it('attach() 之後 send() 可以添加樂觀訊息', async () => {
    const events = new LocalEventSource()
    const data = fakeSource(() => ({
      async sendMessage(_input: SendMessageInput) {
        // 成功
      },
      async getState(): Promise<AppStateSnapshot> {
        return {
          conversation: {
            id: 'c1',
            title: 't',
            messages: []
          }
        }
      }
    }))

    detachFn = useAppStore.getState().attach({ data, events })
    expect(isAttached()).toBe(true)

    // 等待 attach() 的非同步 refresh() 完成
    await new Promise((resolve) => setTimeout(resolve, 10))

    const input: SendMessageInput = { content: '測試' }
    await useAppStore.getState().send(input)

    const messages = useAppStore.getState().messages
    expect(messages.length).toBeGreaterThan(0)
    expect(messages[0]?.content).toBe('測試')
  })

  it('sendMessage() 丟 unreachable，對帳後樂觀訊息已被伺服器版本取代 → 不顯示錯誤', async () => {
    const events = new LocalEventSource()
    let getStateCalls = 0

    const data = fakeSource(() => ({
      async sendMessage(_input: SendMessageInput) {
        throw new DataError('unreachable')
      },
      async getState(): Promise<AppStateSnapshot> {
        getStateCalls++
        // 模擬對帳時發現訊息已送達（不在樂觀訊息清單裡）
        return {
          conversation: {
            id: 'c1',
            title: 't',
            messages: [
              {
                id: 'server-1',
                role: 'user' as const,
                content: '嗨',
                timestamp: 1000
              }
            ]
          }
        }
      }
    }))

    detachFn = useAppStore.getState().attach({ data, events })
    getStateCalls = 0 // 重設計數器（attach() 會呼叫一次 refresh）

    const input: SendMessageInput = { content: '嗨' }
    await useAppStore.getState().send(input).catch(() => {})

    const messages = useAppStore.getState().messages
    expect(getStateCalls).toBe(1) // 應該呼叫過對帳
    expect(messages).not.toContainEqual(
      expect.objectContaining({ role: 'system' })
    )
    expect(useAppStore.getState().sending).toBe(false)
  })

  it('sendMessage() 丟 unreachable，對帳失敗或找不到伺服器回應 → 樂觀訊息變成錯誤訊息', async () => {
    const events = new LocalEventSource()
    let getStateCalls = 0

    const data = fakeSource(() => ({
      async sendMessage(_input: SendMessageInput) {
        throw new DataError('unreachable')
      },
      async getState(): Promise<AppStateSnapshot> {
        getStateCalls++
        // 對帳時連線仍有問題，refresh 也會失敗，訊息不被更新
        // 所以樂觀訊息會留在清單裡
        throw new DataError('unreachable')
      }
    }))

    detachFn = useAppStore.getState().attach({ data, events })
    getStateCalls = 0 // 重設計數器（attach() 會呼叫一次 refresh）

    const input: SendMessageInput = { content: '嗨' }
    await useAppStore.getState().send(input).catch(() => {})

    const messages = useAppStore.getState().messages
    expect(getStateCalls).toBe(1) // 應該呼叫過對帳（即使失敗）
    const errorMessage = messages.find((m) => m.role === 'system')
    expect(errorMessage).toBeDefined()
    expect(useAppStore.getState().sending).toBe(false)
  })

  it('sendMessage() 丟 unauthorized（不是 unreachable） → 直接顯示錯誤，不做對帳', async () => {
    const events = new LocalEventSource()
    let getStateCalls = 0

    const data = fakeSource(() => ({
      async sendMessage(_input: SendMessageInput) {
        throw new DataError('unauthorized')
      },
      async getState(): Promise<AppStateSnapshot> {
        getStateCalls++
        return {
          conversation: {
            id: 'c1',
            title: 't',
            messages: []
          }
        }
      }
    }))

    detachFn = useAppStore.getState().attach({ data, events })
    // 等待 attach() 的非同步 refresh() 完成
    await new Promise((resolve) => setTimeout(resolve, 10))
    getStateCalls = 0 // 重設計數器（attach() 會呼叫一次 refresh）

    const input: SendMessageInput = { content: '嗨' }
    try {
      await useAppStore.getState().send(input)
    } catch (e) {
      // Expected to throw
    }

    const messages = useAppStore.getState().messages
    expect(getStateCalls).toBe(0) // 不應該呼叫 getState 對帳
    // 應該有至少一則訊息（樂觀訊息被換成錯誤訊息）
    expect(messages.length).toBeGreaterThan(0)
    const errorMessage = messages.find((m) => m.role === 'system')
    expect(errorMessage).toBeDefined()
    expect(useAppStore.getState().sending).toBe(false)
  })
})
