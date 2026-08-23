import { normalizeWidgetAppearance, resolveWidgetColors } from '@shared/widgetAppearance'
import { nutritionMobileStorage } from './storage'

/**
 * 橋接 Android 桌面小工具（`android/.../widget/NutritionWidgetProvider.kt`）。
 * JS 沒有辦法直接發 Android broadcast，存檔／App 離開前景這兩個更新時機
 * （`docs/nutrition-widget-plan.md` §3）都要靠這支薄外掛跳回原生層重算。
 * 只有原生殼裝了這個外掛，瀏覽器煙測直接跳過（CLAUDE.md：外掛一律動態 import()）。
 */
export async function refreshNutritionWidget(): Promise<void> {
  const core = await import('@capacitor/core').catch(() => null)
  if (!core || !core.Capacitor.isNativePlatform()) return
  const bridge = core.registerPlugin<{ refresh(): Promise<void> }>('NutritionWidgetBridge')
  await bridge.refresh().catch(() => {})
}

/** 小工具讀得到的「手錶動態上限」原料。檔名同步寫在 `NutritionWidgetDataReader.kt`。 */
export const WIDGET_HEALTH_STATE_KEY = 'widget-health.json'

/**
 * 小工具算今日動態熱量上限所需、而**原生層自己拿不到**的那幾個數。
 *
 * 為什麼不直接存算好的上限：上限公式是「已消耗 ＋ 剩餘時間 × 靜止代謝」，
 * 其中「剩餘時間」隨時間遞減。存成一個定值的話，小工具整天都顯示早上算的那個數，
 * 按重新整理也不會變。改成存原料、由小工具在**繪製當下**乘上剩餘時間，
 * 上限就會自己隨時間收斂——真正會過期的只有 `burnedSoFarToday`
 * （那個只有 App 在前景查 Health Connect 時才拿得到）。
 *
 * 為什麼連 `restingKcalPerHour` 都先算好：BMR 有兩套公式
 * （有體脂率用 Katch-McArdle、否則 Mifflin-St Jeor，見 `core/nutrition/tdee.ts`），
 * 在 Kotlin 再抄一份就是 `docs/nutrition-widget-plan.md` §7 警告的那種跨語言漂移。
 * 先算好之後原生層只剩一次乘加，沒有可以抄錯的東西。
 */
export interface WidgetHealthState {
  /** Health Connect 今日累計消耗熱量（查詢當下為止）。 */
  burnedSoFarToday: number
  /** 上面那個數字的量測時間。不是「今天」就不能用（比照 `suggestTodayKcalLimit`）。 */
  measuredAt: number
  /** 靜止代謝率的每小時消耗量，＝ `calculateBmr(bodyProfile) / 24`。 */
  restingKcalPerHour: number
}

/**
 * 寫入（或清除）動態上限原料。
 *
 * 傳 `null` 代表「不要用動態上限」——會把檔案刪掉，小工具因此自動退回顯示
 * `bodyProfile.dailyKcalLimit`。**用「檔案在不在」表達開關狀態**，小工具就不必
 * 再去讀 `settings.json` 判斷 `useWatchCalorieLimit`，少一個要同步的真相來源。
 */
export async function writeWidgetHealthState(state: WidgetHealthState | null): Promise<void> {
  try {
    if (state === null) await nutritionMobileStorage.remove(WIDGET_HEALTH_STATE_KEY)
    else await nutritionMobileStorage.writeJson(WIDGET_HEALTH_STATE_KEY, state)
  } catch {
    // 小工具的裝飾性資料，寫不進去就算了，不要影響 App 本身
  }
}

/** 小工具配色。檔名要跟 `NutritionWidgetDataReader.kt` 的常數一致。 */
export const WIDGET_THEME_KEY = 'widget-theme.json'

/**
 * 把配色與底色透明度換算成 `#AARRGGBB` 落地給原生層（`docs/mobile-android-widget-plan.md` §14.2）。
 *
 * ⚠️ **色表與換算跟 DeST 共用 `@shared/widgetAppearance`**——抄一份過來就是
 * 計畫書再三警告的雙邊定義漂移。這個 App 沒有「跟隨 App 配色」的概念
 * （UI 有自己一套 CSS），所以 `resolveWidgetColors` 的第二個參數固定
 * 傳預設值，實際用的一定是 `appearance.theme`。
 */
export async function writeWidgetTheme(appearance: unknown): Promise<void> {
  try {
    const normalized = normalizeWidgetAppearance(appearance)
    // theme 為 null（還沒選過）時就用全站預設的薄荷，跟改版前的寫死色值一致。
    await nutritionMobileStorage.writeJson(
      WIDGET_THEME_KEY,
      resolveWidgetColors({ ...normalized, theme: normalized.theme ?? 'mint' })
    )
  } catch {
    // 同上：裝飾性資料，失敗不影響 App
  }
}
