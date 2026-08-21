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
    val hasBodyProfile: Boolean
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
        return NutritionWidgetSnapshot(
            totalKcal = totalKcal.roundToLong(),
            totalProteinG = totalProteinG.roundToLong(),
            kcalLimit = bodyProfile?.optLong("dailyKcalLimit", 0L) ?: 0L,
            proteinGoalG = bodyProfile?.optLong("dailyProteinGoalG", 0L) ?: 0L,
            hasBodyProfile = hasBodyProfile
        )
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
