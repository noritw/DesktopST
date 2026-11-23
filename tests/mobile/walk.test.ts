import { describe, expect, it, vi } from 'vitest'
import { createMemoryStorage } from '../../src/mobile/adapters/memoryStorage'
import { defaultWalkSettings, pendingSteps } from '@core/walk'
import { loadWalkState, localDay, saveWalkSettings, speakWalk, syncWalk, updateWalkState } from '../../src/mobile/runtime/walk'

const NOW = new Date(2026, 10, 23, 18, 0).getTime()
const T = localDay(NOW)
const companions = [
  { id: 'a', name: '甲', muted: false },
  { id: 'b', name: '乙', muted: true }
]

async function setup(steps = 3000): Promise<ReturnType<typeof createMemoryStorage>> {
  const storage = createMemoryStorage()
  await saveWalkSettings(storage, { ...defaultWalkSettings(), enabled: true })
  const sync = (n: number): Promise<unknown> =>
    syncWalk({ storage, companionIds: ['a', 'b'], readDays: async () => ({ [T]: n }), now: NOW })
  await sync(0)
  await sync(steps)
  return storage
}

const base = { companions, busy: false, getWeather: async () => null, now: NOW }

describe('陪伴同行 runtime', () => {
  it('關閉時完全不讀步數', async () => {
    const readDays = vi.fn()
    expect(await syncWalk({ storage: createMemoryStorage(), companionIds: ['a'], readDays })).toBeNull()
    expect(readDays).not.toHaveBeenCalled()
  })

  it('讀取失敗會擲例外且不動資料，之後仍能正常記帳', async () => {
    const storage = await setup()
    const before = await loadWalkState(storage)
    await expect(
      syncWalk({ storage, companionIds: ['a'], readDays: async () => { throw new Error('x') }, now: NOW })
    ).rejects.toThrow()
    expect(await loadWalkState(storage)).toEqual(before)
    await syncWalk({ storage, companionIds: ['a'], readDays: async () => ({ [T]: 3100 }), now: NOW })
    expect((await loadWalkState(storage)).byCharacter.a.totalSteps).toBe(3100)
  })

  it('兩次同步重疊不會重複記帳', async () => {
    const storage = await setup(0)
    const one = (): Promise<unknown> =>
      syncWalk({ storage, companionIds: ['a'], readDays: async () => ({ [T]: 500 }), now: NOW })
    await Promise.all([one(), one()])
    expect((await loadWalkState(storage)).byCharacter.a.totalSteps).toBe(500)
  })

  it('講成功才用掉步數，且不挑被禁言的角色', async () => {
    const storage = await setup()
    const speak = vi.fn(async (_id: string, _prompt: string) => true)
    expect(await speakWalk({ ...base, storage, speak })).toEqual({ spoke: true })
    expect(speak.mock.calls[0][0]).toBe('a')
    expect(speak.mock.calls[0][1]).toContain('「甲」、「乙」')
    expect(pendingSteps(await loadWalkState(storage), T)).toBe(0)
  })

  it('失敗或擲例外都不扣步數', async () => {
    const storage = await setup()
    expect((await speakWalk({ ...base, storage, speak: async () => false })).reason).toBe('failed')
    expect((await speakWalk({ ...base, storage, speak: async () => { throw new Error('x') } })).reason).toBe('failed')
    expect(pendingSteps(await loadWalkState(storage), T)).toBe(3000)
  })

  it('生成期間新走的步數留下；同時觸發只講一次', async () => {
    const storage = await setup()
    const speak = async (): Promise<boolean> => {
      expect((await speakWalk({ ...base, storage, speak: async () => true })).reason).toBe('busy')
      await updateWalkState(storage, (s) => ({ ...s, pendingByDay: { [T]: 3400 } }))
      return true
    }
    await speakWalk({ ...base, storage, speak })
    expect(pendingSteps(await loadWalkState(storage), T)).toBe(400)
  })

  it('手動：沒有新步數時改講今天累計，今天 0 步則不講', async () => {
    const storage = await setup()
    await speakWalk({ ...base, storage, speak: async () => true })
    const speak = vi.fn(async (_id: string, _prompt: string) => true)
    expect((await speakWalk({ ...base, storage, manual: true, busy: true, speak })).spoke).toBe(true)
    expect(speak.mock.calls[0][1]).toContain('今天一起走了')
    expect((await speakWalk({ ...base, storage: await setup(0), manual: true, speak })).reason).toBe('steps')
  })
})
