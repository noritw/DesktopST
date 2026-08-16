import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppStateSnapshot, DataSource, SendMessageInput } from '@core/data'
import { DataError } from '@core/data'
import type { EventSource } from '@core/events'
import { LocalEventSource } from '../../src/mobile/events/localEventSource'
import { isAttached, useAppStore } from '../../src/mobile/ui/stores/appStore'

function fakeSource(build: () => Partial<DataSource>): DataSource {
  return build() as unknown as DataSource
}

/**
 * 補齊 `AppStateSnapshot` 的必填欄位。
 *
 * 這幾個測試只在意 `conversation`，但 `getState()` 的回傳型別是完整的
 * `AppStateSnapshot`——只寫 `{ conversation }` 會讓 `npm run typecheck` 紅
 * （tsconfig.node.json 有含 `tests/`）。集中在這裡補，之後型別再加欄位
 * 也只要改這一處。
 */
function makeState(conversation: AppStateSnapshot['conversation']): AppStateSnapshot {
  return {
    presentCharacters: [],
    conversation,
    colorTheme: 'mint',
    randomToolsEnabled: false,
    showLlmBadge: true,
    showPersonaName: true,
    maxImagesPerMessage: 1
  }
}

describe('isAttached()', () => {
  it('attach() 之前回傳 false', () => {
    expect(isAttached()).toBe(false)
  })

  it('attach() 之後回傳 true', async () => {
    const events = new LocalEventSource()
    const data = fakeSource(() => ({
      async getState(): Promise<AppStateSnapshot> {
        return makeState({ id: 'c1', title: 't', messages: [] })
      }
    }))
    useAppStore.getState().attach({ data, events })
    expect(isAttached()).toBe(true)
  })

  it('呼叫 attach() 回傳的 detach 函式之後回到 false', async () => {
    const events = new LocalEventSource()
    const data = fakeSource(() => ({
      async getState(): Promise<AppStateSnapshot> {
        return makeState({ id: 'c1', title: 't', messages: [] })
      }
    }))
    const detach = useAppStore.getState().attach({ data, events })
    expect(isAttached()).toBe(true)
    detach()
    expect(isAttached()).toBe(false)
  })
})

describe('attached／ready 在 detach 時歸零（B-4）', () => {
  it('attach() 之後 attached 為 true，detach 之後歸零', async () => {
    const events = new LocalEventSource()
    const data = fakeSource(() => ({
      async getState(): Promise<AppStateSnapshot> {
        return makeState({ id: 'c1', title: 't', messages: [] })
      }
    }))
    const detach = useAppStore.getState().attach({ data, events })
    expect(useAppStore.getState().attached).toBe(true)
    detach()
    expect(useAppStore.getState().attached).toBe(false)
  })

  /*
   * 這是 B-4 的核心：切換模式時 `ready` 若停在舊的 `true`，App.tsx 頂層的
   * 選單按鈕、設定／角色編輯畫面都會誤判「已經接上」，在真正的空窗期間
   * 呼叫 `getData()` 撞見 throw，被當成「載入失敗」而不是「還沒接上」。
   */
  it('detach 之後 ready 也要歸零，不能停在上一輪的 true', async () => {
    const events = new LocalEventSource()
    const data = fakeSource(() => ({
      async getState(): Promise<AppStateSnapshot> {
        return makeState({ id: 'c1', title: 't', messages: [] })
      }
    }))
    const detach = useAppStore.getState().attach({ data, events })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(useAppStore.getState().ready).toBe(true)

    detach()
    expect(useAppStore.getState().ready).toBe(false)
  })
})

describe('message 事件會正確帶著 imageCount 併入（B-5）', () => {
  let detachFn: (() => void) | null = null

  afterEach(() => {
    if (detachFn) detachFn()
    detachFn = null
  })

  /*
   * 這是真機回報的實際路徑：獨立模式送出帶圖訊息後，`chat.ts` 把完整的
   * `Message`（有 `images`，沒有 `imageCount`）推上 `'message'` 事件。
   * 原本直接 `as MessageSnapshot` 硬轉型會讓 `imageCount` 是 `undefined`，
   * `MessageList` 的縮圖判斷 `if (message.imageCount)` 就不渲染。
   */
  it('獨立模式的完整 Message（帶 images）併入後 imageCount 正確', async () => {
    const events = new LocalEventSource()
    const data = fakeSource(() => ({
      async getState(): Promise<AppStateSnapshot> {
        return makeState({ id: 'c1', title: 't', messages: [] })
      }
    }))
    detachFn = useAppStore.getState().attach({ data, events })
    await new Promise((resolve) => setTimeout(resolve, 10))

    events.push({
      kind: 'message',
      message: {
        id: 'real-1',
        role: 'user',
        content: '一張圖',
        timestamp: Date.now(),
        images: ['data:image/png;base64,aaa', 'data:image/png;base64,bbb']
      } as never
    })

    const msg = useAppStore.getState().messages.find((m) => m.id === 'real-1')
    expect(msg?.imageCount).toBe(2)
  })

  it('遙控模式已經只有 imageCount（沒有 images）時直接信任那個數字', async () => {
    const events = new LocalEventSource()
    const data = fakeSource(() => ({
      async getState(): Promise<AppStateSnapshot> {
        return makeState({ id: 'c1', title: 't', messages: [] })
      }
    }))
    detachFn = useAppStore.getState().attach({ data, events })
    await new Promise((resolve) => setTimeout(resolve, 10))

    events.push({
      kind: 'message',
      message: {
        id: 'real-2',
        role: 'character',
        content: '收到圖了',
        timestamp: Date.now(),
        imageCount: 3
      } as never
    })

    const msg = useAppStore.getState().messages.find((m) => m.id === 'real-2')
    expect(msg?.imageCount).toBe(3)
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
        return makeState({
          id: 'c1',
          title: 't',
          messages: []
        })
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
        return makeState({
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
        })
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
        return makeState({
          id: 'c1',
          title: 't',
          messages: []
        })
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
