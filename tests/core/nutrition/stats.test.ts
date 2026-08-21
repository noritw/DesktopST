import { describe, expect, it } from 'vitest'
import {
  buildNutritionStats,
  endOfMonthIso,
  listRangeDates,
  resolveStatsRange,
  startOfMonthIso,
  startOfWeekIso
} from '@core/nutrition'
import { foodItem, mealLog } from './fixtures'

const foods = [foodItem({ id: 'food-1', perServing: { kcal: 400, proteinG: 25 } })]

function at(day: number, hour = 12): number {
  return new Date(2026, 7, day, hour, 0).getTime()
}

describe('區間換算', () => {
  it('週起始固定星期一，星期日算前一週的最後一天', () => {
    expect(startOfWeekIso('2026-08-19')).toBe('2026-08-17') // 星期三 → 星期一
    expect(startOfWeekIso('2026-08-17')).toBe('2026-08-17')
    expect(startOfWeekIso('2026-08-16')).toBe('2026-08-10') // 星期日
  })

  it('本月是整月，不是「到今天為止」', () => {
    expect(startOfMonthIso('2026-08-19')).toBe('2026-08-01')
    expect(endOfMonthIso('2026-08-19')).toBe('2026-08-31')
    expect(endOfMonthIso('2026-02-10')).toBe('2026-02-28')
  })

  it('近 7／30 天以今天為結尾', () => {
    expect(resolveStatsRange('last-7', '2026-08-19')).toEqual({ startIsoDate: '2026-08-13', endIsoDate: '2026-08-19' })
    expect(resolveStatsRange('last-30', '2026-08-19').startIsoDate).toBe('2026-07-21')
  })

  it('起訖顛倒時回空清單', () => {
    expect(listRangeDates({ startIsoDate: '2026-08-19', endIsoDate: '2026-08-17' })).toEqual([])
  })
})

describe('buildNutritionStats', () => {
  const logs = [
    mealLog({ id: 'm1', eatenAt: at(17), servings: 1 }), // 400 kcal
    mealLog({ id: 'm2', eatenAt: at(17, 19), servings: 2 }), // 800 kcal
    mealLog({ id: 'm3', eatenAt: at(19), servings: 1 }) // 400 kcal
  ]

  it('平均分「已過天數」與「有紀錄天數」兩種分母', () => {
    const stats = buildNutritionStats(logs, foods, { startIsoDate: '2026-08-17', endIsoDate: '2026-08-23' }, '2026-08-19')

    expect(stats.dayCount).toBe(7)
    expect(stats.elapsedDayCount).toBe(3) // 17、18、19
    expect(stats.loggedDayCount).toBe(2) // 18 沒吃東西
    expect(stats.totalKcal).toBe(1_600)
    expect(stats.averageKcalPerDay).toBe(533) // 1600 / 3
    expect(stats.averageKcalPerLoggedDay).toBe(800) // 1600 / 2
    expect(stats.totalProteinG).toBe(100)
  })

  it('消耗只算查得到手錶資料的日子，淨值只算兩邊都有資料的日子', () => {
    const stats = buildNutritionStats(
      logs,
      foods,
      { startIsoDate: '2026-08-17', endIsoDate: '2026-08-19' },
      '2026-08-19',
      { '2026-08-17': 2_000, '2026-08-18': null, '2026-08-19': 1_800 }
    )

    expect(stats.burnedDayCount).toBe(2)
    expect(stats.totalBurnedKcal).toBe(3_800)
    expect(stats.averageBurnedPerDay).toBe(1_900)
    expect(stats.netDayCount).toBe(2)
    expect(stats.averageNetKcalPerDay).toBe(-1_100) // (1200-2000 + 400-1800) / 2
  })

  it('完全沒有手錶資料時淨值為 null，不要顯示成 0', () => {
    const stats = buildNutritionStats(logs, foods, { startIsoDate: '2026-08-17', endIsoDate: '2026-08-19' }, '2026-08-19')
    expect(stats.averageNetKcalPerDay).toBeNull()
    expect(stats.burnedDayCount).toBe(0)
  })

  it('單筆覆寫值優先於食物主檔', () => {
    const stats = buildNutritionStats(
      [mealLog({ id: 'm1', eatenAt: at(17), override: { kcal: 100, proteinG: 5 } })],
      foods,
      { startIsoDate: '2026-08-17', endIsoDate: '2026-08-17' },
      '2026-08-19'
    )
    expect(stats.totalKcal).toBe(100)
    expect(stats.totalProteinG).toBe(5)
  })
})
