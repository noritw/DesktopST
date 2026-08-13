import { describe, expect, it } from 'vitest'
import { countdownLabel, secondsLeftAt } from '../../src/mobile/ui/shell/useCountdown'
import { isReconnected, nextOfflineSince } from '../../src/mobile/ui/shell/offlineWatch'
import { PROBE_TIMEOUT_MS } from '../../src/mobile/ui/connection'
import { MANIFEST_TIMEOUT_MS } from '../../src/mobile/runtime/syncManifest'

describe('secondsLeftAt', () => {
  it('一開始顯示完整秒數', () => {
    expect(secondsLeftAt(6000, 0)).toBe(6)
  })

  it('隨經過時間遞減', () => {
    expect(secondsLeftAt(6000, 1000)).toBe(5)
    expect(secondsLeftAt(6000, 3000)).toBe(3)
    expect(secondsLeftAt(6000, 5000)).toBe(1)
  })

  it('不足一秒時仍顯示 1，不會提早跳 0（跑著卻顯示 0 看起來像壞掉）', () => {
    expect(secondsLeftAt(6000, 5001)).toBe(1)
    expect(secondsLeftAt(6000, 5999)).toBe(1)
  })

  it('到期與超時都是 0，不會出現負數', () => {
    expect(secondsLeftAt(6000, 6000)).toBe(0)
    expect(secondsLeftAt(6000, 99_999)).toBe(0)
  })
})

describe('countdownLabel', () => {
  it('還有時間就顯示剩餘秒數', () => {
    expect(countdownLabel('連線中', 6)).toBe('連線中⋯⋯（6 秒）')
    expect(countdownLabel('連線中', 1)).toBe('連線中⋯⋯（1 秒）')
  })

  it('歸零時不顯示「0 秒」——那看起來像壞掉', () => {
    expect(countdownLabel('連線中', 0)).toBe('連線中⋯⋯（即將放棄）')
  })
})

/**
 * 倒數的秒數必須跟真正的逾時同一個來源。
 *
 * 這兩個常數被 UI（倒數）與網路層（`Promise.race`）共用；哪天有人只改一邊，
 * 使用者就會看到「倒數到 0 卻還在轉」或「還沒數完就跳錯誤」——那比沒有倒數
 * 更糟，因為它會讓人不再相信畫面上的提示。這裡把它們釘住。
 */
describe('倒數用的逾時常數', () => {
  it('探測與 manifest 的逾時是有限、合理的秒數', () => {
    expect(PROBE_TIMEOUT_MS).toBeGreaterThan(0)
    expect(MANIFEST_TIMEOUT_MS).toBeGreaterThan(0)
    // 使用者盯著畫面等的時間，超過 15 秒就該重新考慮，不是預設值調大就好
    expect(PROBE_TIMEOUT_MS).toBeLessThanOrEqual(15_000)
    expect(MANIFEST_TIMEOUT_MS).toBeLessThanOrEqual(15_000)
    // 換算成整秒才數得出來（`Math.ceil` 之後不會出現半秒的跳動）
    expect(PROBE_TIMEOUT_MS % 1000).toBe(0)
    expect(MANIFEST_TIMEOUT_MS % 1000).toBe(0)
  })
})

/**
 * 斷線計時（owner 2026-08-13 回報「遙控版斷線好像還是沒跳訊息」的回歸測試）。
 *
 * 成因：`RemoteEventSource` 每次重連嘗試都會把狀態設成 `'connecting'`，
 * 斷線期間狀態一直在 offline／connecting 之間跳。第一版把「非 offline」
 * 當成恢復連線而歸零計時，8 秒的門檻於是永遠數不完。
 */
describe('nextOfflineSince', () => {
  it('第一次 offline 開始計時', () => {
    expect(nextOfflineSince('offline', null, 1000)).toBe(1000)
  })

  it('持續 offline 不會重新計時（維持第一次的時刻）', () => {
    expect(nextOfflineSince('offline', 1000, 5000)).toBe(1000)
  })

  it('⭐ 重連嘗試中（connecting）不可以歸零——這正是當初數不完的原因', () => {
    expect(nextOfflineSince('connecting', 1000, 5000)).toBe(1000)
  })

  it('真的連上了才歸零', () => {
    expect(nextOfflineSince('online', 1000, 5000)).toBeNull()
  })

  it('idle 維持原樣，不會憑空開始計時（事件來源還沒啟動）', () => {
    expect(nextOfflineSince('idle', null, 5000)).toBeNull()
  })

  it('⭐ 一開始就連不上（只有 connecting、從沒 offline 過）也要開始計時', () => {
    // 電腦關著時開 App：WebSocket 會一直卡在連線中，`offline` 可能好幾分鐘
    // 都不會出現。只認 offline 的話這種情況永遠不會有任何提示。
    expect(nextOfflineSince('connecting', null, 5000)).toBe(5000)
  })

  it('連上之後再斷，計時重新從斷掉那一刻算', () => {
    let v = nextOfflineSince('connecting', null, 1000)
    v = nextOfflineSince('online', v, 2000)
    expect(v).toBeNull()
    v = nextOfflineSince('offline', v, 9000)
    expect(v).toBe(9000)
  })

  it('offline → connecting → offline 這串跳動，計時一路從第一次算起', () => {
    let v = nextOfflineSince('offline', null, 1000)
    v = nextOfflineSince('connecting', v, 1500)
    v = nextOfflineSince('offline', v, 2000)
    v = nextOfflineSince('connecting', v, 4000)
    v = nextOfflineSince('offline', v, 8000)
    expect(v).toBe(1000) // 全程沒有被重連嘗試打斷
  })

  it('⭐ 本機模式一律歸零——切過去之後斷線提示不可以留在畫面上', () => {
    // owner 2026-08-13 回報「切到本機之後斷線提示還留在那邊」：
    // 第一版是在 effect 裡 early return，計時值原封不動留著。
    expect(nextOfflineSince('offline', 1000, 5000, false)).toBeNull()
    expect(nextOfflineSince('connecting', 1000, 5000, false)).toBeNull()
    expect(nextOfflineSince('idle', 1000, 5000, false)).toBeNull()
  })

  it('遙控模式維持原本規則（預設就是遙控）', () => {
    expect(nextOfflineSince('offline', null, 1000, true)).toBe(1000)
    expect(nextOfflineSince('offline', null, 1000)).toBe(1000)
  })

  it('只有 isReconnected 認 online', () => {
    expect(isReconnected('online')).toBe(true)
    expect(isReconnected('connecting')).toBe(false)
    expect(isReconnected('offline')).toBe(false)
  })
})

/**
 * 重連退避的節奏（owner 2026-08-13 問「反覆重連會有不好影響嗎」）。
 *
 * 原本不論斷多久都固定每 8 秒重試一次、而且永遠不停。前 10 次維持快節奏
 * 讓短暫中斷能立刻接回，之後降頻到 30 秒省電。
 */
describe('重連退避間隔', () => {
  /** 與 `RemoteEventSource.handleClose()` 同一條公式。 */
  const delayFor = (retryCount: number): number =>
    Math.min(500 * Math.pow(2, retryCount), retryCount >= 10 ? 30_000 : 8000)

  it('前幾次很快（短暫中斷要能立刻接回來）', () => {
    expect(delayFor(0)).toBe(500)
    expect(delayFor(1)).toBe(1000)
    expect(delayFor(2)).toBe(2000)
    expect(delayFor(3)).toBe(4000)
  })

  it('中段維持 8 秒上限', () => {
    expect(delayFor(4)).toBe(8000)
    expect(delayFor(9)).toBe(8000)
  })

  it('連續失敗夠多次之後降頻到 30 秒（電腦真的關了就不用一直試）', () => {
    expect(delayFor(10)).toBe(30_000)
    expect(delayFor(50)).toBe(30_000)
  })
})
