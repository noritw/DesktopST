package tw.nori.destnutrition.widget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.Calendar
import kotlin.math.roundToLong

/**
 * 今日合計快照，給 [NutritionWidgetProvider] 組 RemoteViews 用。
 * `hasBodyProfile` 為 false 時代表使用者還沒建立身體資料，畫面要顯示「尚未設定」而不是 0/0。
 */
data class NutritionWidgetSnapshot(
    val totalKcal: Long,
    val totalProteinG: Long,
    val kcalLimit: Long,
    val proteinGoalG: Long,
    val hasBodyProfile: Boolean,
    /** `kcalLimit` 是不是手錶動態上限（而非 `bodyProfile.dailyKcalLimit`）。畫面上會加註記。 */
    val isDynamicKcalLimit: Boolean = false
)

/**
 * 讀 `files/body-profile.json`／`food-items.json`／`meal-logs.json` 三個攤平 JSON 檔，
 * 在原生層重算「今天」的熱量／蛋白質合計。
 *
 * ⚠️ 這段邏輯是 `core/nutrition/aggregation.ts` 的 `aggregateDailyNutrition()` 的
 * Kotlin 版重寫——沒有 JS runtime 可以直接呼叫 core，兩邊要各自維護。
 * 改動 core 那份（例如換時區判定方式、改 override 優先序）務必回來同步這裡。
 * 見 `docs/nutrition-widget-plan.md` §7。
 *
 * 只支援靜態熱量上限（`bodyProfile.dailyKcalLimit`）：Health Connect 動態上限
 * （`useWatchCalorieLimit` 開啟時）目前完全不落地存檔，原生層讀不到，見計畫書 §2.1。
 */
object NutritionWidgetDataReader {
    private const val FOOD_ITEMS_FILE = "food-items.json"
    private const val MEAL_LOGS_FILE = "meal-logs.json"
    private const val BODY_PROFILE_FILE = "body-profile.json"

    /** 由 App 寫入的動態上限原料，檔名要跟 `mobile/src/widgetBridge.ts` 的常數一致。 */
    private const val WIDGET_HEALTH_FILE = "widget-health.json"

    fun read(context: Context): NutritionWidgetSnapshot {
        val bodyProfile = readJsonObject(context, BODY_PROFILE_FILE)
        val foodItems = readJsonArray(context, FOOD_ITEMS_FILE)
        val mealLogs = readJsonArray(context, MEAL_LOGS_FILE)

        val perServingByFoodId = HashMap<String, Pair<Double?, Double?>>()
        for (i in 0 until foodItems.length()) {
            val item = foodItems.optJSONObject(i) ?: continue
            val id = item.optString("id", "")
            if (id.isEmpty()) continue
            val perServing = item.optJSONObject("perServing")
            val kcal = perServing?.let { if (it.has("kcal")) it.optDouble("kcal") else null }
            val proteinG = perServing?.let { if (it.has("proteinG")) it.optDouble("proteinG") else null }
            perServingByFoodId[id] = Pair(kcal, proteinG)
        }

        val todayIso = todayIsoDate()
        var totalKcal = 0.0
        var totalProteinG = 0.0
        for (i in 0 until mealLogs.length()) {
            val log = mealLogs.optJSONObject(i) ?: continue
            val eatenAt = log.optLong("eatenAt", -1L)
            if (eatenAt < 0 || isoDateOf(eatenAt) != todayIso) continue

            val servings = log.optDouble("servings", 1.0)
            val override = log.optJSONObject("override")
            val overrideKcal = override?.let { if (it.has("kcal")) it.optDouble("kcal") else null }
            val overrideProteinG = override?.let { if (it.has("proteinG")) it.optDouble("proteinG") else null }
            val fallback = perServingByFoodId[log.optString("foodItemId", "")]

            val perServingKcal = overrideKcal ?: fallback?.first
            val perServingProteinG = overrideProteinG ?: fallback?.second
            if (perServingKcal == null && perServingProteinG == null) continue

            totalKcal += Math.round((perServingKcal ?: 0.0) * servings)
            totalProteinG += Math.round((perServingProteinG ?: 0.0) * servings)
        }

        val hasBodyProfile = bodyProfile != null
        val staticKcalLimit = bodyProfile?.optLong("dailyKcalLimit", 0L) ?: 0L
        val dynamicKcalLimit = readDynamicKcalLimit(context)
        return NutritionWidgetSnapshot(
            totalKcal = totalKcal.roundToLong(),
            totalProteinG = totalProteinG.roundToLong(),
            kcalLimit = dynamicKcalLimit ?: staticKcalLimit,
            proteinGoalG = bodyProfile?.optLong("dailyProteinGoalG", 0L) ?: 0L,
            hasBodyProfile = hasBodyProfile,
            isDynamicKcalLimit = dynamicKcalLimit != null
        )
    }

    /**
     * 今日「手錶動態熱量上限」＝ 今天已消耗 ＋ 今天剩餘時間 × 靜止代謝每小時消耗。
     * 對應 `core/nutrition/health.ts` 的 `suggestTodayKcalLimit()`。
     *
     * ⚠️ **這裡刻意只做一次乘加，不重算 BMR。** BMR 有兩套公式（Katch-McArdle／
     * Mifflin-St Jeor，見 `core/nutrition/tdee.ts`），在這邊抄一份就是計畫書 §7
     * 警告的跨語言漂移。App 已經把 `restingKcalPerHour` 算好寫進
     * `widget-health.json`（見 `mobile/src/widgetBridge.ts`），這裡只補上
     * 「剩餘時間」——而且是在**繪製當下**補，所以上限會隨時間自己遞減，
     * 不是凍結在 App 上次前景時算的那個數。
     *
     * 回傳 null（呼叫端退回靜態 `dailyKcalLimit`）的情況：
     * - 檔案不存在：使用者沒開「手錶消耗熱量當上限」，或還沒同步過
     * - `measuredAt` 不是今天：資料過夜了，不能拿昨天的消耗當今日上限
     *   （跟 `suggestTodayKcalLimit()` 的判斷一致）
     */
    private fun readDynamicKcalLimit(context: Context): Long? {
        val state = readJsonObject(context, WIDGET_HEALTH_FILE) ?: return null
        if (!state.has("burnedSoFarToday") || !state.has("restingKcalPerHour")) return null
        val measuredAt = state.optLong("measuredAt", -1L)
        if (measuredAt < 0 || isoDateOf(measuredAt) != todayIsoDate()) return null

        val now = System.currentTimeMillis()
        val calendar = Calendar.getInstance()
        calendar.timeInMillis = now
        calendar.set(Calendar.HOUR_OF_DAY, 0)
        calendar.set(Calendar.MINUTE, 0)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        calendar.add(Calendar.DAY_OF_MONTH, 1)
        val hoursRemaining = ((calendar.timeInMillis - now).toDouble() / 3_600_000.0).coerceAtLeast(0.0)

        val burned = state.optDouble("burnedSoFarToday", 0.0)
        val restingPerHour = state.optDouble("restingKcalPerHour", 0.0)
        return Math.round(burned + hoursRemaining * restingPerHour)
    }

    /** 對齊 `aggregation.ts` 的 `toIsoDateString()`：裝置本地時區的年／月／日。 */
    private fun isoDateOf(timestampMs: Long): String {
        val calendar = Calendar.getInstance()
        calendar.timeInMillis = timestampMs
        return isoDateOfCalendar(calendar)
    }

    private fun todayIsoDate(): String = isoDateOfCalendar(Calendar.getInstance())

    private fun isoDateOfCalendar(calendar: Calendar): String {
        val year = calendar.get(Calendar.YEAR)
        val month = calendar.get(Calendar.MONTH) + 1
        val day = calendar.get(Calendar.DAY_OF_MONTH)
        return "%04d-%02d-%02d".format(year, month, day)
    }

    private fun readJsonArray(context: Context, fileName: String): JSONArray {
        val text = readFile(context, fileName) ?: return JSONArray()
        return try {
            JSONArray(text)
        } catch (_: Exception) {
            JSONArray()
        }
    }

    private fun readJsonObject(context: Context, fileName: String): JSONObject? {
        val text = readFile(context, fileName) ?: return null
        return try {
            val obj = JSONObject(text)
            if (obj == JSONObject.NULL) null else obj
        } catch (_: Exception) {
            null
        }
    }

    /** `Directory.Data`（Capacitor Filesystem）在 Android 上對應 `context.filesDir`，見計畫書 §2／§7。 */
    private fun readFile(context: Context, fileName: String): String? {
        val file = File(context.filesDir, fileName)
        if (!file.exists()) return null
        return try {
            file.readText(Charsets.UTF_8)
        } catch (_: Exception) {
            null
        }
    }
}
