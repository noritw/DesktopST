import { describe, it, expect } from 'vitest'
import { elapsedSince } from '../../src/core/util/relativeTime'

/**
 * 相對時間（清單 F12）。core 只算不寫字，中文在 `src/shared/relativeTimeLabel.ts`。
 */
describe('elapsedSince', () => {
  const now = Date.parse('2026-08-06T12:00:00Z')
  const ago = (ms: number): string => new Date(now - ms).toISOString()

  it('一分鐘內是「剛剛」，之後依分／時／天遞進', () => {
    expect(elapsedSince(ago(30_000), now)).toEqual({ kind: 'just-now' })
    expect(elapsedSince(ago(5 * 60_000), now)).toEqual({ kind: 'minutes', value: 5 })
    expect(elapsedSince(ago(3 * 3_600_000), now)).toEqual({ kind: 'hours', value: 3 })
    expect(elapsedSince(ago(3 * 86_400_000), now)).toEqual({ kind: 'days', value: 3 })
  })

  it('邊界值不會跳號（59 分還是分、60 分變小時）', () => {
    expect(elapsedSince(ago(59 * 60_000), now)).toEqual({ kind: 'minutes', value: 59 })
    expect(elapsedSince(ago(60 * 60_000), now)).toEqual({ kind: 'hours', value: 1 })
    expect(elapsedSince(ago(23 * 3_600_000), now)).toEqual({ kind: 'hours', value: 23 })
    expect(elapsedSince(ago(24 * 3_600_000), now)).toEqual({ kind: 'days', value: 1 })
  })

  it('超過一週改用絕對時間', () => {
    const iso = ago(8 * 86_400_000)
    expect(elapsedSince(iso, now)).toEqual({ kind: 'absolute', iso })
  })

  it('未來時間當「剛剛」——「-3 分鐘前」比沒有時間更難看懂', () => {
    expect(elapsedSince(ago(-60_000), now)).toEqual({ kind: 'just-now' })
  })

  it('空字串與無法解析的字串回 unknown（新聞來源常抓不到時間）', () => {
    expect(elapsedSince('', now)).toEqual({ kind: 'unknown' })
    expect(elapsedSince(undefined, now)).toEqual({ kind: 'unknown' })
    expect(elapsedSince('不是時間', now)).toEqual({ kind: 'unknown' })
  })
})
