import type { HealthAdapter, HealthSnapshot } from '@core/adapters'
import { toIsoDateString, parseIsoDateToStartOfDayMs } from '@core/nutrition'

/**
 * Health Connect 讀取（Android 限定）。走 `@capgo/capacitor-health`（統一包裝
 * HealthKit／Health Connect，這裡只用得到 Health Connect 那半邊）。
 *
 * 外掛一律動態 `import()`（CLAUDE.md §5 既有規則）：瀏覽器煙測、vitest、
 * 桌面都不該在載入時就因為原生外掛不存在而炸掉——`isAvailable()` 在這些
 * 環境下應該回傳 `false`，其餘方法不會被呼叫。
 */

const READ_TYPES = ['weight', 'bodyFat', 'totalCalories'] as const
const MS_PER_DAY = 24 * 60 * 60 * 1000

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

/** Capacitor plugin 的 timeout 選項不保證兌現（CLAUDE.md §5），外面要自己包。 */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(onTimeout), ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      () => { clearTimeout(timer); resolve(onTimeout) }
    )
  })
}

/**
 * 絕對不要讓這支 function 直接 `return` 外掛物件本身（CLAUDE.md §5：plugin
 * proxy 把任何屬性存取當成原生方法呼叫，`await` 直接卡死）。包一層物件。
 */
async function loadPlugin(): Promise<{ Health: import('@capgo/capacitor-health').HealthPlugin } | null> {
  try {
    const mod = await import('@capgo/capacitor-health')
    return { Health: mod.Health }
  } catch {
    return null
  }
}

async function safeReadSamples(
  Health: import('@capgo/capacitor-health').HealthPlugin,
  options: import('@capgo/capacitor-health').QueryOptions
): Promise<import('@capgo/capacitor-health').HealthSample[]> {
  try {
    const result = await withTimeout(Health.readSamples(options), 8_000, { samples: [] })
    return result.samples
  } catch {
    return []
  }
}

export const nutritionHealthAdapter: HealthAdapter = {
  async isAvailable(): Promise<boolean> {
    const loaded = await loadPlugin()
    if (!loaded) return false
    try {
      const result = await withTimeout(loaded.Health.isAvailable(), 5_000, { available: false })
      return result.available
    } catch {
      return false
    }
  },

  async hasPermission(): Promise<boolean> {
    const loaded = await loadPlugin()
    if (!loaded) return false
    try {
      const status = await withTimeout(
        loaded.Health.checkAuthorization({ read: [...READ_TYPES] }),
        5_000,
        { readAuthorized: [], readDenied: [...READ_TYPES], writeAuthorized: [], writeDenied: [] }
      )
      return READ_TYPES.every((type) => status.readAuthorized.includes(type))
    } catch {
      return false
    }
  },

  async requestPermission(): Promise<boolean> {
    const loaded = await loadPlugin()
    if (!loaded) return false
    try {
      // 這支會跳系統對話框，使用者可能一直不理它——逾時拉長一點，但仍然不能無限等。
      const status = await withTimeout(
        loaded.Health.requestAuthorization({ read: [...READ_TYPES] }),
        60_000,
        { readAuthorized: [], readDenied: [...READ_TYPES], writeAuthorized: [], writeDenied: [] }
      )
      return READ_TYPES.every((type) => status.readAuthorized.includes(type))
    } catch {
      return false
    }
  },

  async readSnapshot(): Promise<HealthSnapshot> {
    const loaded = await loadPlugin()
    if (!loaded) return { measuredAt: Date.now() }
    const { Health } = loaded

    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const todayStartIso = new Date(parseIsoDateToStartOfDayMs(toIsoDateString(now))).toISOString()
    // Health Connect 讀取一般只保留約 30 天內資料（未申請 READ_HEALTH_DATA_HISTORY），
    // 體重/體脂不強求「今天量的」，抓近 30 天內最新一筆即可。
    const recentStartIso = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

    // limit 不能給小數字：@capgo/capacitor-health 的原生分頁邏輯（HealthManager.kt
    // readRecords()）一湊到 >= limit 筆就停止翻頁，不保證 Health Connect 回傳的分頁
    // 本身是新到舊排序——limit:5 在 30 天視窗裡真機實測會抓到「30 天內最舊的 5 筆」
    // 而不是最新 5 筆，導致同步到的體重是好幾週前的舊數字（2026-08-19 真機發現）。
    // 500 是這個外掛單頁上限（MAX_PAGE_SIZE），一次就能蓋滿 30 天內所有體重/體脂
    // 紀錄（正常一天最多量個幾次，遠到不了 500 筆）。
    const [weightSamples, bodyFatSamples, calorieSamples] = await Promise.all([
      safeReadSamples(Health, { dataType: 'weight', startDate: recentStartIso, endDate: nowIso, limit: 500, ascending: false }),
      safeReadSamples(Health, { dataType: 'bodyFat', startDate: recentStartIso, endDate: nowIso, limit: 500, ascending: false }),
      // 累計消耗熱量一定要抓「今天 00:00 到現在」這段區間自己加總——
      // 不是讀一筆現成的「今日總量」欄位（見 docs/nutrition-health-lite-kickoff.md §6）。
      safeReadSamples(Health, { dataType: 'totalCalories', startDate: todayStartIso, endDate: nowIso, limit: 500, ascending: true })
    ])

    const latestWeight = weightSamples[0]
    const latestBodyFat = bodyFatSamples[0]
    const caloriesBurnedSoFarToday = calorieSamples.length > 0
      ? calorieSamples.reduce((sum, sample) => sum + sample.value, 0)
      : undefined
    const lastCalorieSample = calorieSamples[calorieSamples.length - 1]

    return {
      // Health Connect 的公斤數是從來源 App 的單位（常見是磅）換算來的，換算會拖出
      // 一長串小數——體重/體脂只在意到小數點後一位，這裡先四捨五入乾淨再往下傳。
      weightKg: latestWeight ? roundToOneDecimal(latestWeight.value) : undefined,
      bodyFatPercent: latestBodyFat ? roundToOneDecimal(latestBodyFat.value) : undefined,
      caloriesBurnedSoFarToday,
      // measuredAt 只在 caloriesBurnedSoFarToday 有值時才會被 suggestTodayKcalLimit() 拿來判斷
      // 新鮮度；沒有熱量樣本時這裡的值不影響任何判斷邏輯，預設用 now 即可。
      measuredAt: lastCalorieSample ? new Date(lastCalorieSample.endDate).getTime() : now
    }
  },

  async readDailyCaloriesBurned(dateIso: string): Promise<number | undefined> {
    const loaded = await loadPlugin()
    if (!loaded) return undefined
    const { Health } = loaded

    const dayStartMs = parseIsoDateToStartOfDayMs(dateIso)
    const dayEndMs = Math.min(dayStartMs + MS_PER_DAY, Date.now())
    if (dayEndMs <= dayStartMs) return undefined

    const samples = await safeReadSamples(Health, {
      dataType: 'totalCalories',
      startDate: new Date(dayStartMs).toISOString(),
      endDate: new Date(dayEndMs).toISOString(),
      limit: 500,
      ascending: true
    })
    if (samples.length === 0) return undefined
    return samples.reduce((sum, sample) => sum + sample.value, 0)
  }
}
