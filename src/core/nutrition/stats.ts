import type { FoodItem, MealLog } from './types'
import { addDaysIso, dayDistance, groupMealLogsByDay, parseIsoDateToStartOfDayMs, toIsoDateString } from './aggregation'

/** 統計頁的區間預設值；`custom` 由呼叫端自己給起訖日。 */
export type NutritionStatsRangeKind = 'this-week' | 'this-month' | 'last-7' | 'last-30' | 'custom'

export interface NutritionStatsRange {
  startIsoDate: string
  endIsoDate: string
}

export interface NutritionDayStat {
  isoDate: string
  kcal: number
  proteinG: number
  /** Health Connect 當日總消耗；查不到（沒授權／沒資料／未來的日子）為 undefined。 */
  burnedKcal?: number
  /** 有沒有任何餐次紀錄。沒紀錄的日子不列入「有紀錄天數」與其平均。 */
  hasLog: boolean
}

export interface NutritionStats {
  range: NutritionStatsRange
  /** 區間總天數（含頭尾）。 */
  dayCount: number
  /** 已經過完／正在過的天數（未來的日子不算），平均值的分母。 */
  elapsedDayCount: number
  /** 有餐次紀錄的天數。 */
  loggedDayCount: number
  days: NutritionDayStat[]
  totalKcal: number
  totalProteinG: number
  /** 以「已過天數」為分母的日均攝取——漏記的日子會把平均拉低，看趨勢用。 */
  averageKcalPerDay: number
  averageProteinPerDay: number
  /** 以「有紀錄天數」為分母的日均攝取——只想看有記錄的日子吃多少時看這個。 */
  averageKcalPerLoggedDay: number
  averageProteinPerLoggedDay: number
  /** 有查到消耗資料的天數；0 代表整段區間都沒有手錶資料。 */
  burnedDayCount: number
  totalBurnedKcal: number
  averageBurnedPerDay: number
  /**
   * 平均每日淨值（攝取 − 消耗），只用「攝取與消耗都有資料」的日子計算，
   * 沒有可比對的日子時為 null。正值＝盈餘，負值＝赤字。
   */
  averageNetKcalPerDay: number | null
  /** 攝取與消耗都有資料的天數（`averageNetKcalPerDay` 的分母）。 */
  netDayCount: number
}

/** 週起始固定為星期一（zh-TW 慣例）。 */
export function startOfWeekIso(isoDate: string): string {
  const date = new Date(parseIsoDateToStartOfDayMs(isoDate))
  const weekday = date.getDay() // 0 = 星期日
  return addDaysIso(isoDate, weekday === 0 ? -6 : 1 - weekday)
}

export function startOfMonthIso(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`
}

export function endOfMonthIso(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number)
  return toIsoDateString(new Date(year, month, 0).getTime())
}

/**
 * 把區間種類換算成起訖日。`todayIso` 由呼叫端傳（可測，跟現有慣例一致）；
 * `this-week`／`this-month` 會涵蓋整週／整月（包含還沒到的日子），
 * 平均值那邊再用 `elapsedDayCount` 排除未來的日子。
 */
export function resolveStatsRange(kind: NutritionStatsRangeKind, todayIso: string): NutritionStatsRange {
  switch (kind) {
    case 'this-week':
      return { startIsoDate: startOfWeekIso(todayIso), endIsoDate: addDaysIso(startOfWeekIso(todayIso), 6) }
    case 'this-month':
      return { startIsoDate: startOfMonthIso(todayIso), endIsoDate: endOfMonthIso(todayIso) }
    case 'last-7':
      return { startIsoDate: addDaysIso(todayIso, -6), endIsoDate: todayIso }
    case 'last-30':
      return { startIsoDate: addDaysIso(todayIso, -29), endIsoDate: todayIso }
    case 'custom':
      return { startIsoDate: todayIso, endIsoDate: todayIso }
  }
}

/** 列出區間內每一天的日期字串（起訖顛倒時回空陣列，不要爆掉）。 */
export function listRangeDates(range: NutritionStatsRange): string[] {
  const span = dayDistance(range.startIsoDate, range.endIsoDate)
  if (span < 0) return []
  return Array.from({ length: span + 1 }, (_, index) => addDaysIso(range.startIsoDate, index))
}

function round(value: number): number {
  return Math.round(value)
}

/**
 * 區間統計：攝取來自本機餐次，消耗（可選）由呼叫端把每日總消耗查好傳進來
 * （`burnedByDate`，鍵是 ISO 日期）——`core/` 不碰 Health Connect。
 */
export function buildNutritionStats(
  mealLogs: MealLog[],
  foodItems: FoodItem[],
  range: NutritionStatsRange,
  todayIso: string,
  burnedByDate: Record<string, number | null | undefined> = {}
): NutritionStats {
  const foodById = new Map(foodItems.map((foodItem) => [foodItem.id, foodItem]))
  const grouped = groupMealLogsByDay(mealLogs)
  const dates = listRangeDates(range)

  const days: NutritionDayStat[] = dates.map((isoDate) => {
    const logs = grouped.get(isoDate) ?? []
    let kcal = 0
    let proteinG = 0
    for (const mealLog of logs) {
      const foodItem = foodById.get(mealLog.foodItemId)
      const perServingKcal = mealLog.override?.kcal ?? foodItem?.perServing.kcal
      const perServingProteinG = mealLog.override?.proteinG ?? foodItem?.perServing.proteinG
      kcal += round((perServingKcal ?? 0) * mealLog.servings)
      proteinG += round((perServingProteinG ?? 0) * mealLog.servings)
    }
    const burned = burnedByDate[isoDate]
    const stat: NutritionDayStat = { isoDate, kcal, proteinG, hasLog: logs.length > 0 }
    if (typeof burned === 'number') stat.burnedKcal = round(burned)
    return stat
  })

  const elapsedDays = days.filter((day) => day.isoDate <= todayIso)
  const loggedDays = days.filter((day) => day.hasLog)
  const burnedDays = days.filter((day) => day.burnedKcal !== undefined)
  const netDays = days.filter((day) => day.burnedKcal !== undefined && day.hasLog)

  const totalKcal = days.reduce((sum, day) => sum + day.kcal, 0)
  const totalProteinG = days.reduce((sum, day) => sum + day.proteinG, 0)
  const totalBurnedKcal = burnedDays.reduce((sum, day) => sum + (day.burnedKcal ?? 0), 0)
  const totalNet = netDays.reduce((sum, day) => sum + day.kcal - (day.burnedKcal ?? 0), 0)

  const perElapsed = (total: number): number => (elapsedDays.length > 0 ? round(total / elapsedDays.length) : 0)
  const perLogged = (total: number): number => (loggedDays.length > 0 ? round(total / loggedDays.length) : 0)

  return {
    range,
    dayCount: days.length,
    elapsedDayCount: elapsedDays.length,
    loggedDayCount: loggedDays.length,
    days,
    totalKcal,
    totalProteinG,
    averageKcalPerDay: perElapsed(totalKcal),
    averageProteinPerDay: perElapsed(totalProteinG),
    averageKcalPerLoggedDay: perLogged(totalKcal),
    averageProteinPerLoggedDay: perLogged(totalProteinG),
    burnedDayCount: burnedDays.length,
    totalBurnedKcal,
    averageBurnedPerDay: burnedDays.length > 0 ? round(totalBurnedKcal / burnedDays.length) : 0,
    averageNetKcalPerDay: netDays.length > 0 ? round(totalNet / netDays.length) : null,
    netDayCount: netDays.length
  }
}
