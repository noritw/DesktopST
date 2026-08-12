import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveLiveRemote } from '../../src/mobile/ui/connection'

/**
 * 2026-08-12 owner 實機回報：App 內切換到遙控後，訊息送得出去（HTTP）
 * 但畫面一直跳「連線中斷」（WebSocket）。根因是掃到的是**中繼**網址，
 * `wsUrlFor()` 拿它去代換 `http→ws` 組出的路由對中繼來說是錯的——
 * 中繼的即時通道只有中繼自己託管網頁時才會注入正確位址。
 *
 * `resolveLiveRemote()` 是修法：連線前先問一次 `/api/sync-init`，
 * 中繼就試著比照 S1 的 `upgradeToLan` 換成區網直連，換不了就老實回報
 * `relayOnly`，不要讓呼叫端切過去卻卡在一個永遠連不上的假連線。
 */
describe('resolveLiveRemote', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('已經是區網直連時原樣採用，不必再問第二次', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lanDirect: true })
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await resolveLiveRemote('http://192.168.1.20:3721', 'tok')
    expect(r).toEqual({ ok: true, baseUrl: 'http://192.168.1.20:3721', token: 'tok' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('掃到中繼網址、電腦回報有區網位址 → 自動升級成直連', async () => {
    const fetchMock = vi
      .fn()
      // 第一次：問中繼，回報不是直連，但附了 lanUrl
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ lanDirect: false, lanUrl: 'http://192.168.1.20:3721' })
      })
      // 第二次：改問區網位址，確認真的是直連
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ lanDirect: true })
      })
    vi.stubGlobal('fetch', fetchMock)

    const r = await resolveLiveRemote('https://relay.nori.tw/abc123', 'tok')
    expect(r).toEqual({ ok: true, baseUrl: 'http://192.168.1.20:3721', token: 'tok' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('中繼、沒有 lanUrl 可以升級 → relayOnly，不切換', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ lanDirect: false })
    })
    vi.stubGlobal('fetch', fetchMock)

    const r = await resolveLiveRemote('https://relay.nori.tw/abc123', 'tok')
    expect(r).toEqual({ ok: true, relayOnly: true })
  })

  it('中繼附了 lanUrl，但那個位址其實連不上（假 lanUrl 或已失效）→ 仍是 relayOnly', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ lanDirect: false, lanUrl: 'http://192.168.1.20:3721' })
      })
      .mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const r = await resolveLiveRemote('https://relay.nori.tw/abc123', 'tok')
    expect(r).toEqual({ ok: true, relayOnly: true })
  })

  it('連不上（電腦沒開／權杖過期）→ ok:false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const r = await resolveLiveRemote('http://192.168.1.20:3721', 'tok')
    expect(r).toEqual({ ok: false })
  })

  it('網路直接丟例外（連線逾時）→ ok:false，不會往上炸', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down'))
    )
    const r = await resolveLiveRemote('http://192.168.1.20:3721', 'tok')
    expect(r).toEqual({ ok: false })
  })
})
