import { describe, it, expect, vi } from 'vitest'
import type { AppEvent } from '../../src/core/events'
import { RemoteEventSource, type WebSocketLike, type SocketEventLike } from '../../src/mobile/events/remoteEventSource'
import { LocalEventSource } from '../../src/mobile/events/localEventSource'

/**
 * 事件來源抽象（B3 階段 0-②）。
 *
 * 重點不只是「WS 訊息有沒有轉對」，更是**遙控獨有的行為有沒有被關在遙控實作裡**
 * ——重連對帳、退避、逾時保險若漏進介面，UI 就得寫模式特例，決議③ 就白做了。
 */

/** 可控的假 WebSocket：測試自己決定何時 open / message / close。 */
class FakeSocket implements WebSocketLike {
  closed = false
  private handlers: Record<string, ((event: SocketEventLike) => void)[]> = {}

  addEventListener(type: string, listener: (event: SocketEventLike) => void): void {
    (this.handlers[type] ??= []).push(listener)
  }
  fire(type: string, event: SocketEventLike = { data: '' }): void {
    for (const h of this.handlers[type] ?? []) h(event)
  }
  close(): void {
    this.closed = true
    this.fire('close')
  }
}

function makeRemote(overrides: Partial<ConstructorParameters<typeof RemoteEventSource>[0]> = {}) {
  const sockets: FakeSocket[] = []
  const events: AppEvent[] = []
  const source = new RemoteEventSource({
    wsUrl: () => 'ws://test',
    createSocket: () => {
      const s = new FakeSocket()
      sockets.push(s)
      return s
    },
    ...overrides
  })
  source.subscribe(e => events.push(e))
  return { source, sockets, events, last: () => sockets[sockets.length - 1] }
}

describe('RemoteEventSource — WS 訊息轉成事件', () => {
  it('六種 WS 訊息正規化成五種事件', () => {
    const { source, last, events } = makeRemote()
    source.start()
    const msg = { id: 'm1', role: 'assistant', content: 'hi' }
    last().fire('message', { data: JSON.stringify({ type: 'message', message: msg }) })
    last().fire('message', { data: JSON.stringify({ type: 'thinking', characterId: 'c1' }) })
    last().fire('message', { data: JSON.stringify({ type: 'thinking-done', characterId: 'c1' }) })
    last().fire('message', { data: JSON.stringify({ type: 'reminder', content: '該喝水了' }) })
    last().fire('message', { data: JSON.stringify({ type: 'desktop-updated', desktopCharacterIds: ['c1'] }) })
    last().fire('message', { data: JSON.stringify({ type: 'remote-control-state', remoteControl: {} }) })

    expect(events).toEqual([
      { kind: 'message', message: msg },
      { kind: 'thinking', characterId: 'c1' },
      { kind: 'thinking-done', characterId: 'c1' },
      { kind: 'reminder', content: '該喝水了' },
      { kind: 'state-invalidated', reason: 'desktop' },
      { kind: 'state-invalidated', reason: 'remote-control' }
    ])
  })

  it('壞掉的 JSON 與未知的 type 一律忽略，不中斷', () => {
    const { source, last, events } = makeRemote()
    source.start()
    last().fire('message', { data: '{ not json' })
    last().fire('message', { data: JSON.stringify({ type: 'who-knows' }) })
    expect(events).toEqual([])
  })
})

describe('RemoteEventSource — 遙控獨有的行為', () => {
  it('第一次連上不對帳（UI 本來就會自己載入一次）', () => {
    vi.useFakeTimers()
    try {
      const { source, last, events } = makeRemote()
      source.start()
      last().fire('open')
      expect(events).toEqual([])
      last().fire('close')
      expect(source.getStatus()).toBe('offline')
      source.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('斷線後退避重連，連上時發出 reconnect 對帳事件', () => {
    vi.useFakeTimers()
    try {
      const { source, sockets, last, events } = makeRemote()
      source.start()
      last().fire('open')
      last().fire('close')

      vi.advanceTimersByTime(500)
      expect(sockets.length).toBe(2)

      last().fire('open')
      expect(events).toEqual([{ kind: 'state-invalidated', reason: 'reconnect' }])
      expect(source.getStatus()).toBe('online')
    } finally {
      vi.useRealTimers()
    }
  })

  it('退避是指數成長且有上限', () => {
    vi.useFakeTimers()
    try {
      const { source, sockets, last } = makeRemote({ onNeedsReload: undefined })
      source.start()
      for (let i = 0; i < 3; i++) {
        last().fire('close')
        vi.advanceTimersByTime(8000)
      }
      // 三次重連都在 8 秒上限內完成
      expect(sockets.length).toBe(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('連續失敗 4 次且能重載時，改為請呼叫端重載而不再重連', () => {
    vi.useFakeTimers()
    try {
      const onNeedsReload = vi.fn()
      const { source, sockets, last } = makeRemote({ onNeedsReload })
      source.start()
      for (let i = 0; i < 4; i++) {
        last().fire('close')
        vi.advanceTimersByTime(8000)
      }
      expect(onNeedsReload).toHaveBeenCalledTimes(1)
      const countAfter = sockets.length
      vi.advanceTimersByTime(60_000)
      expect(sockets.length).toBe(countAfter)   // 不再排新的重連
    } finally {
      vi.useRealTimers()
    }
  })

  it('thinking 之後沒收到 thinking-done，逾時會自行補一則（UI 不會永遠轉圈）', () => {
    vi.useFakeTimers()
    try {
      const { source, last, events } = makeRemote({ thinkingTimeoutMs: 90_000 })
      source.start()
      last().fire('open')
      last().fire('message', { data: JSON.stringify({ type: 'thinking', characterId: 'c9' }) })

      vi.advanceTimersByTime(89_999)
      expect(events.some(e => e.kind === 'thinking-done')).toBe(false)

      vi.advanceTimersByTime(1)
      expect(events).toContainEqual({ kind: 'thinking-done', characterId: 'c9' })
      expect(events).toContainEqual({ kind: 'state-invalidated', reason: 'reconnect' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('正常收到 thinking-done 就不會再補逾時那則', () => {
    vi.useFakeTimers()
    try {
      const { source, last, events } = makeRemote({ thinkingTimeoutMs: 1000 })
      source.start()
      last().fire('message', { data: JSON.stringify({ type: 'thinking', characterId: 'c9' }) })
      last().fire('message', { data: JSON.stringify({ type: 'thinking-done', characterId: 'c9' }) })
      vi.advanceTimersByTime(5000)
      expect(events.filter(e => e.kind === 'thinking-done')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('多位角色同時思考時，每個人各有自己的逾時保險', () => {
    // 群組接龍會有多位角色同時在思考。早期只留一個計時器，
    // 第二位開始思考會把第一位的保險清掉——第一位的 done 若沒送到就永遠轉下去。
    vi.useFakeTimers()
    try {
      const { source, last, events } = makeRemote({ thinkingTimeoutMs: 1000 })
      source.start()
      last().fire('message', { data: JSON.stringify({ type: 'thinking', characterId: 'A' }) })
      vi.advanceTimersByTime(400)
      last().fire('message', { data: JSON.stringify({ type: 'thinking', characterId: 'B' }) })

      // B 正常回覆，A 沒有
      last().fire('message', { data: JSON.stringify({ type: 'thinking-done', characterId: 'B' }) })
      vi.advanceTimersByTime(5000)

      const done = events.filter(e => e.kind === 'thinking-done')
      expect(done).toContainEqual({ kind: 'thinking-done', characterId: 'A' })
      expect(done.filter(e => e.characterId === 'B')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('某位角色的 thinking-done 不會清掉其他角色的保險', () => {
    vi.useFakeTimers()
    try {
      const { source, last, events } = makeRemote({ thinkingTimeoutMs: 1000 })
      source.start()
      last().fire('message', { data: JSON.stringify({ type: 'thinking', characterId: 'A' }) })
      last().fire('message', { data: JSON.stringify({ type: 'thinking', characterId: 'B' }) })
      last().fire('message', { data: JSON.stringify({ type: 'thinking-done', characterId: 'A' }) })
      vi.advanceTimersByTime(2000)

      expect(events.filter(e => e.kind === 'thinking-done' && e.characterId === 'B')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('回前景：連線還在只對帳；連線斷了立刻重連、不等退避', () => {
    vi.useFakeTimers()
    try {
      const { source, sockets, last, events } = makeRemote()
      source.start()
      last().fire('open')

      source.notifyForeground()
      expect(events).toEqual([{ kind: 'state-invalidated', reason: 'foreground' }])

      last().fire('close')
      const before = sockets.length
      source.notifyForeground()
      expect(sockets.length).toBe(before + 1)   // 沒有等 500ms 退避
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop() 之後不再重連', () => {
    vi.useFakeTimers()
    try {
      const { source, sockets, last } = makeRemote()
      source.start()
      last().fire('open')
      source.stop()
      vi.advanceTimersByTime(60_000)
      expect(sockets.length).toBe(1)
      expect(source.getStatus()).toBe('idle')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('LocalEventSource — 獨立模式', () => {
  it('start 之後直接是 online（UI 讀同一個欄位，不做模式判斷）', () => {
    const source = new LocalEventSource()
    expect(source.getStatus()).toBe('idle')
    source.start()
    expect(source.getStatus()).toBe('online')
  })

  it('回前景不做任何事，也不會發對帳事件', () => {
    const source = new LocalEventSource()
    const events: AppEvent[] = []
    source.subscribe(e => events.push(e))
    source.start()
    source.notifyForeground()
    expect(events).toEqual([])
  })

  it('push 進來的事件會送到訂閱者', () => {
    const source = new LocalEventSource()
    const events: AppEvent[] = []
    source.subscribe(e => events.push(e))
    source.push({ kind: 'thinking', characterId: 'c1' })
    expect(events).toEqual([{ kind: 'thinking', characterId: 'c1' }])
  })
})

describe('EventHub 的共用行為（兩種實作都靠它）', () => {
  it('取消訂閱之後收不到事件，重複取消無害', () => {
    const source = new LocalEventSource()
    const events: AppEvent[] = []
    const off = source.subscribe(e => events.push(e))
    source.push({ kind: 'reminder', content: 'a' })
    off()
    off()
    source.push({ kind: 'reminder', content: 'b' })
    expect(events).toEqual([{ kind: 'reminder', content: 'a' }])
  })

  it('某個 listener 拋例外不影響其他 listener', () => {
    const source = new LocalEventSource()
    const seen: string[] = []
    vi.spyOn(console, 'error').mockImplementation(() => {})
    source.subscribe(() => { throw new Error('boom') })
    source.subscribe(() => { seen.push('ok') })
    source.push({ kind: 'reminder', content: 'x' })
    expect(seen).toEqual(['ok'])
  })

  it('狀態沒變就不重複通知', () => {
    const source = new LocalEventSource()
    const seen: string[] = []
    source.onStatusChange(s => seen.push(s))
    source.start()
    source.start()
    expect(seen).toEqual(['online'])
  })
})
