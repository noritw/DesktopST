package tw.nori.destnutrition.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.TotalCaloriesBurnedRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.io.File
import java.time.Instant
import java.util.Calendar
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import tw.nori.destnutrition.MainActivity
import tw.nori.destnutrition.R
import kotlin.math.roundToInt

/**
 * 飲食記錄桌面小工具。三個更新時機（見 `docs/nutrition-widget-plan.md` §3）：
 * 1. App 存入 MealLog 成功後（由 [NutritionWidgetBridgePlugin] 從 JS 觸發）
 * 2. App 離開前景時（同上，透過 `appStateChange` 監聽觸發）
 * 3. 小工具上的「重新整理」按鈕（[ACTION_REFRESH] 自迴圈 broadcast，直接落在這支 Provider）
 *
 * 小工具本身完全不做背景輪詢；`onUpdate()` 的系統排程週期只是保底。
 */
class NutritionWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val snapshot = NutritionWidgetDataReader.read(context)
        for (appWidgetId in appWidgetIds) updateWidget(context, appWidgetManager, appWidgetId, snapshot)
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle
    ) {
        updateWidget(context, appWidgetManager, appWidgetId, NutritionWidgetDataReader.read(context))
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_REFRESH) {
            // 查 Health Connect 是 suspend／IO 動作，onReceive 本身跑在主執行緒、
            // 一結束系統就可能回收這個 BroadcastReceiver——用 goAsync() 換一段
            // 延長的存活時間，做完（或失敗）才 finish()。
            val pendingResult = goAsync()
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    refreshHealthCaloriesIfNeeded(context)
                } catch (e: Exception) {
                    Log.w(TAG, "health refresh on widget tap failed", e)
                } finally {
                    updateAll(context)
                    pendingResult.finish()
                }
            }
        }
    }

    companion object {
        const val ACTION_REFRESH = "tw.nori.destnutrition.widget.ACTION_NUTRITION_WIDGET_REFRESH"

        /** 小工具讀得到的「手錶動態上限」原料，檔名對齊 `mobile/src/widgetBridge.ts`。 */
        private const val WIDGET_HEALTH_FILE = "widget-health.json"

        /**
         * 小工具「重新整理」按鈕點下去時，直接在原生層問一次 Health Connect
         * 今天累計消耗了多少熱量，不開 App（owner 2026-08-25 回報按重新整理
         * 小工具數字跟手錶對不起來——這支按鈕之前只是重讀舊快取重繪，
         * Health Connect 完全沒被碰過）。
         *
         * ⚠️ **刻意只重算 `burnedSoFarToday`，不重算 `restingKcalPerHour`**：
         * 後者要算 BMR，公式在 `core/nutrition/tdee.ts`（Katch-McArdle／
         * Mifflin-St Jeor 兩套），在 Kotlin 這邊重寫一份會製造跨語言漂移
         * （`NutritionWidgetDataReader.kt` 檔頭已經在警告同一件事）。
         * `restingKcalPerHour` 沿用 App 上次前景時算好、寫進這個檔案的值，
         * 這裡只補上「這一刻查到的已消耗量」。
         *
         * 沒有這個檔案（使用者沒開「手錶消耗熱量當上限」）就整段跳過——
         * 那種情況下小工具本來就不顯示動態上限，沒有什麼好重新整理的。
         */
        private suspend fun refreshHealthCaloriesIfNeeded(context: Context) {
            val file = File(context.filesDir, WIDGET_HEALTH_FILE)
            if (!file.exists()) return
            val state = try { JSONObject(file.readText(Charsets.UTF_8)) } catch (_: Exception) { return }
            if (!state.has("restingKcalPerHour")) return

            if (HealthConnectClient.getSdkStatus(context) != HealthConnectClient.SDK_AVAILABLE) return
            val client = HealthConnectClient.getOrCreate(context)
            val permission = HealthPermission.getReadPermission(TotalCaloriesBurnedRecord::class)
            val granted = client.permissionController.getGrantedPermissions()
            if (permission !in granted) return

            val now = Instant.now()
            val calendar = Calendar.getInstance()
            calendar.set(Calendar.HOUR_OF_DAY, 0)
            calendar.set(Calendar.MINUTE, 0)
            calendar.set(Calendar.SECOND, 0)
            calendar.set(Calendar.MILLISECOND, 0)
            val todayStart = Instant.ofEpochMilli(calendar.timeInMillis)

            var burned = 0.0
            var pageToken: String? = null
            do {
                val response = client.readRecords(
                    ReadRecordsRequest(
                        recordType = TotalCaloriesBurnedRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(todayStart, now),
                        pageSize = 500,
                        pageToken = pageToken
                    )
                )
                response.records.forEach { burned += it.energy.inKilocalories }
                pageToken = response.pageToken
            } while (pageToken != null)

            state.put("burnedSoFarToday", burned)
            state.put("measuredAt", now.toEpochMilli())
            file.writeText(state.toString(), Charsets.UTF_8)
        }

        /** 真機除錯：`adb logcat -s NutritionWidget` 可以看到每次挑了哪個版面、容器多大。 */
        private const val TAG = "NutritionWidget"

        /** 深連結 scheme 沿用 Capacitor 產生的 `custom_url_scheme`（見 R.string.custom_url_scheme）。 */
        private const val DEEP_LINK_SCHEME = "tw.nori.destnutrition"
        private const val PATH_DAILY = "daily"
        private const val PATH_PHOTO = "photo"
        private const val PATH_QUICK_ENTRY = "quick-entry"

        /**
         * 版面斷點：**寬度與高度都要算**，四種形狀各有各的版面（見 [pickLayout]）。
         *
         * ⚠️ **門檻必須 ≥ 對應版面的實際內容高度。** owner 2026-08-22 兩度回報
         * 「數字被裁掉」都是這裡沒跟上版面：第一次是中版宣告成「高 40dp 就適用」
         * 但實際要 80dp；第二次是進度條加回完整版之後門檻還停在 76dp。
         * **往完整版加東西時，一定要回來把 [BREAKPOINT_TALL_HEIGHT_DP] 調高。**
         *
         * 目前完整版一整欄要 `82 + 2×數字高度`（見 [valueTextSizeSp]），
         * 門檻 140dp 時數字約 22sp、還有餘裕；再低就只剩十幾 sp，「大數字」就沒意義了，
         * 不如讓它退到方形版（按鈕移到底下、數字吃整個寬度）。
         */
        private const val BREAKPOINT_MEDIUM_WIDTH_DP = 200
        private const val BREAKPOINT_TALL_HEIGHT_DP = 140

        /** [NutritionWidgetBridgePlugin] 存檔／App 離開前景時呼叫這個，重繪畫面上所有小工具實例。 */
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, NutritionWidgetProvider::class.java))
            if (ids.isEmpty()) return
            val snapshot = NutritionWidgetDataReader.read(context)
            for (id in ids) updateWidget(context, manager, id, snapshot)
        }

        private fun updateWidget(context: Context, manager: AppWidgetManager, appWidgetId: Int, snapshot: NutritionWidgetSnapshot) {
            // ⚠️ **刻意不用 `RemoteViews(Map<SizeF, RemoteViews>)`。**
            // 那個 API 由系統決定挑哪一份，實測（owner 2026-08-22，352×190dp 的
            // 小工具）它挑了「中版」而不是我們想要的完整版——系統的挑選規則不是
            // 「放得下的當中最大的」那麼單純，跟宣告的尺寸接近程度也有關。
            // 版面選擇是這個小工具反覆出包的地方，所以改成**自己算、自己挑**：
            // 行為完全確定，而且 API 26–30 與 31+ 走同一條路徑，只需要驗一次。
            val options = manager.getAppWidgetOptions(appWidgetId)
            // portrait 的寬是 MIN_WIDTH、高是 MAX_HEIGHT（landscape 剛好相反）。
            // 手機主畫面幾乎都是直的，用 portrait 這組才對得上使用者看到的畫面。
            val widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 110)
            val heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 40)
                .takeIf { it > 0 } ?: options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 40)
            val layoutRes = pickLayout(widthDp, heightDp)
            // 又高又窄（方形版）時標籤佔一整列，橫向反而是最緊的；改用不帶單位的短尾巴。
            val shortSuffix = layoutRes == R.layout.widget_nutrition_square && widthDp < 150
            val buttonDp = buttonSizeDp(layoutRes, widthDp, heightDp)
            val refreshDp = refreshSizeDp(buttonDp, widthDp)

            // 數字大小依實際高度給，不用 autoSizeTextType（見 widget_nutrition_wide.xml 檔頭）。
            val sizeSp = valueTextSizeSp(layoutRes, widthDp, heightDp, snapshot, shortSuffix, buttonDp, refreshDp)
            Log.d(TAG, "widget $appWidgetId ${widthDp}x${heightDp}dp -> ${layoutName(layoutRes)} value=${sizeSp}sp btn=${buttonDp}dp")

            // ── 配色與底色透明度（docs/mobile-android-widget-plan.md §14.2）──
            // 色票由 App 寫進 widget-theme.json（跟 DeST 共用同一張色表，
            // 但兩邊各存各的）。這裡只負責塗，不做任何顏色決策。
            val colors = NutritionWidgetDataReader.readColors(context)
            val views = buildRemoteViews(context, layoutRes, appWidgetId, snapshot, shortSuffix, colors)
            applyBackground(context, views, widthDp, heightDp, colors.bg)
            applyThemeColors(views, colors)
            views.setTextViewTextSize(R.id.widget_kcal_value, TypedValue.COMPLEX_UNIT_SP, sizeSp)
            views.setTextViewTextSize(R.id.widget_protein_value, TypedValue.COMPLEX_UNIT_SP, sizeSp)
            // 上下限那行也要跟著放大，否則大數字旁邊會顯得像註腳（owner 2026-08-22 ①③）。
            val suffixSp = (sizeSp * SUFFIX_RATIO).coerceIn(10f, 20f)
            views.setTextViewTextSize(R.id.widget_kcal_suffix, TypedValue.COMPLEX_UNIT_SP, suffixSp)
            views.setTextViewTextSize(R.id.widget_protein_suffix, TypedValue.COMPLEX_UNIT_SP, suffixSp)

            applyButtons(context, views, buttonDp, refreshDp, colors)
            manager.updateAppWidget(appWidgetId, views)
        }

        /** 上下限尾巴相對大數字的比例。字寬估算與實際設定共用同一個常數，不可以各寫各的。 */
        private const val SUFFIX_RATIO = 0.45f

        /** 底板圓角，與 `bg_widget_container.xml` 的值一致。 */
        private const val CORNER_RADIUS_DP = 20f

        /**
         * 圓角底板（§14.2）。
         *
         * ⚠️ **不能用 `setInt(root, "setBackgroundColor", …)`**：那會是直角，
         * 而 CLAUDE.md §3 的視覺硬規則明訂不要尖角；`setBackgroundTintList`
         * 又要 API 31（本專案 minSdk 26）。所以自己畫一張圓角矩形 bitmap 塞進
         * `widget_bg` 那個 ImageView（`scaleType="fitXY"`，bitmap 就是實際尺寸）。
         */
        private fun applyBackground(context: Context, views: RemoteViews, widthDp: Int, heightDp: Int, color: Int) {
            val density = context.resources.displayMetrics.density
            val w = (widthDp * density).toInt().coerceIn(1, 2000)
            val h = (heightDp * density).toInt().coerceIn(1, 2000)
            val radius = CORNER_RADIUS_DP * density
            val bitmap = try {
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bmp)
                val paint = Paint(Paint.ANTI_ALIAS_FLAG)
                paint.color = color
                canvas.drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), radius, radius, paint)
                bmp
            } catch (_: Exception) {
                null
            }
            if (bitmap != null) views.setImageViewBitmap(R.id.widget_bg, bitmap)
        }

        /**
         * 文字顏色。
         *
         * ⚠️ **大數字的顏色不在這裡設**：那兩個是語意色（熱量超標紅字／蛋白質
         * 達標綠字，見 [buildRemoteViews]），跟著配色跑會把「超標」的警示意義
         * 洗掉。標籤與尾巴這種純敘述文字才跟著配色走。
         * RemoteViews 對找不到的 id 會安靜略過，所以不必判斷現在是哪個版面。
         */
        private fun applyThemeColors(views: RemoteViews, colors: NutritionWidgetDataReader.NutritionWidgetColors) {
            for (id in intArrayOf(R.id.widget_kcal_label, R.id.widget_protein_label)) {
                views.setTextColor(id, colors.textSub)
            }
            for (id in intArrayOf(R.id.widget_kcal_suffix, R.id.widget_protein_suffix)) {
                views.setTextColor(id, colors.textSub)
            }
        }

        /**
         * 相機／鉛筆的邊長。
         *
         * ⚠️ **大小要同時看寬度，不能只看高度。** 2x2 那種又高又窄的尺寸，只看高度
         * 會算出很大的按鈕，把文字擠到只剩「蛋⋯」（owner 2026-08-22 回報 ④）。
         */
        private fun buttonSizeDp(layoutRes: Int, widthDp: Int, heightDp: Int): Float = when (layoutRes) {
            // 中版：底下沒有別的東西，兩顆左右並排，受限於高度與「不吃掉太多寬度」。
            R.layout.widget_nutrition_medium -> {
                minOf((heightDp - 14).toFloat(), (widthDp * 0.32f - 6f) / 2f, 56f).coerceAtLeast(28f)
            }
            // 方形版：按鈕在最底下一列，高度只能佔一小部分，寬度反而寬鬆。
            R.layout.widget_nutrition_square -> {
                minOf(heightDp * 0.26f, (widthDp * 0.5f - 8f) / 2f, 52f).coerceAtLeast(28f)
            }
            // 其餘（narrow／wide）：右側直排，受限於高度的一半與單欄寬度上限。
            else -> {
                val padTotal = if (layoutRes == R.layout.widget_nutrition_wide) 20 else 14
                val gap = if (layoutRes == R.layout.widget_nutrition_wide) 10 else 6
                minOf((heightDp - padTotal - gap) / 2f, widthDp * 0.28f, 64f).coerceAtLeast(24f)
            }
        }

        /** 重新整理是次要動作，維持明顯小一號；窄的小工具再縮一點免得跟數字搶寬度。 */
        private fun refreshSizeDp(buttonDp: Float, widthDp: Int): Float =
            minOf(buttonDp * 0.5f, widthDp * 0.11f).coerceIn(14f, 30f)

        /**
         * ⚠️ **邊框變大時內距一定要跟著變大。** owner 2026-08-22 回報「最大尺寸的
         * icon 太大而且有點畫出去」，就是因為之前只用 `setViewLayoutWidth/Height()`
         * 放大圓形底、`padding` 卻還是 XML 寫死的 12dp——按鈕撐到 80dp 時圖示就變成
         * 56dp，幾乎填滿整個圓、邊緣看起來像溢出。內距固定佔邊長的 26%。
         *
         * `setViewPadding()` 吃的是 **px**（不是 dp），要自己乘密度換算。
         */
        private fun applyButtons(
            context: Context,
            views: RemoteViews,
            buttonDp: Float,
            refreshDp: Float,
            colors: NutritionWidgetDataReader.NutritionWidgetColors
        ) {
            for (id in intArrayOf(R.id.widget_btn_edit, R.id.widget_btn_camera)) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    views.setViewLayoutWidth(id, buttonDp, TypedValue.COMPLEX_UNIT_DIP)
                    views.setViewLayoutHeight(id, buttonDp, TypedValue.COMPLEX_UNIT_DIP)
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                views.setViewLayoutWidth(R.id.widget_btn_refresh, refreshDp, TypedValue.COMPLEX_UNIT_DIP)
                views.setViewLayoutHeight(R.id.widget_btn_refresh, refreshDp, TypedValue.COMPLEX_UNIT_DIP)
            }

            applyButtonSkin(context, views, R.id.widget_btn_camera, R.drawable.ic_widget_camera, buttonDp, colors.accent, colors.text)
            applyButtonSkin(context, views, R.id.widget_btn_edit, R.drawable.ic_widget_edit, buttonDp, colors.accent, colors.text)
            // 重新整理是次要動作：用比主要按鈕淡的底（border）＋次要文字色，維持視覺層級。
            applyButtonSkin(context, views, R.id.widget_btn_refresh, R.drawable.ic_widget_refresh, refreshDp, colors.border, colors.textSub)
        }

        /**
         * 把「圓底＋圖示」畫成一張 bitmap 當 `src`（計畫書 §14.2）。
         *
         * ⚠️ **這是唯一能讓按鈕跟著配色走的做法。** 圓底原本是
         * `android:background="@drawable/bg_widget_button_circle"`（寫死 widget_mint），
         * 而 RemoteViews 在 minSdk 26 上既不能 tint 背景 drawable
         * （`setBackgroundTintList` 要 API 31），`setBackgroundColor` 又會變成方形——
         * owner 2026-08-23 回報「改了小工具配色，按鈕還是原本的淺綠色」就是這個。
         * 改成自己畫好整顆按鈕，再用 `setBackgroundResource(0)` 把舊的綠圓底拿掉。
         *
         * 內距要一起歸零（原本 XML 有 padding，是給「背景是圓、src 是圖示」那套用的）；
         * 現在圖示的留白已經畫在 bitmap 裡了，不歸零會連圓底一起被縮小。
         */
        private fun applyButtonSkin(
            context: Context,
            views: RemoteViews,
            viewId: Int,
            iconRes: Int,
            sizeDp: Float,
            circleColor: Int,
            iconColor: Int
        ) {
            views.setInt(viewId, "setBackgroundResource", 0)
            views.setViewPadding(viewId, 0, 0, 0, 0)

            val density = context.resources.displayMetrics.density
            val size = (sizeDp * density).roundToInt().coerceIn(1, 400)
            val bitmap = try {
                val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bmp)
                canvas.drawCircle(size / 2f, size / 2f, size / 2f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = circleColor })
                // 圖示留白固定佔邊長 26%——跟改版前 applyButtonSizes 的比例一致，
                // 大按鈕時圖示才不會幾乎填滿整個圓（owner 2026-08-22 回報過）。
                val icon = ContextCompat.getDrawable(context, iconRes)
                if (icon != null) {
                    val pad = (size * 0.26f).roundToInt()
                    icon.setBounds(pad, pad, size - pad, size - pad)
                    // 向量圖的線條色寫死在 XML（strokeColor="@color/widget_text"），
                    // setTint 是整層 color filter，連筆畫一起蓋掉，正是我們要的。
                    icon.setTint(iconColor)
                    icon.draw(canvas)
                }
                bmp
            } catch (_: Exception) {
                null
            }
            if (bitmap != null) views.setImageViewBitmap(viewId, bitmap)
        }

        /**
         * 進度條：自繪的圓角長條 bitmap（計畫書 §14.2）。
         *
         * 版面裡那幾個 id 已經從 `ProgressBar` 換成 `ImageView`——`progressTint`
         * 只能在 XML 寫死，RemoteViews 改不動（`setProgressTintList` 要 API 31），
         * 配色會永遠停在原本那組淺綠。
         *
         * ⚠️ **換成 ImageView 之後就不能再呼叫 `views.setProgressBar()`**：
         * 那支會對 ImageView 呼叫不存在的 `setMax`／`setProgress`，
         * 套用時直接丟例外變成「無法載入小工具」。
         */
        private fun applyProgress(context: Context, views: RemoteViews, viewId: Int, percent: Int, colors: NutritionWidgetDataReader.NutritionWidgetColors) {
            val density = context.resources.displayMetrics.density
            // 寬度只是繪製解析度，實際由 scaleType="fitXY" 拉滿容器。
            val w = (240 * density).roundToInt()
            val h = (6 * density).roundToInt().coerceAtLeast(2)
            val bitmap = try {
                val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(bmp)
                val paint = Paint(Paint.ANTI_ALIAS_FLAG)
                val r = h / 2f
                paint.color = colors.border
                canvas.drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), r, r, paint)
                val filled = w * percent.coerceIn(0, 100) / 100f
                if (filled > 0f) {
                    paint.color = colors.accentStrong
                    canvas.drawRoundRect(RectF(0f, 0f, filled.coerceAtLeast(h.toFloat()), h.toFloat()), r, r, paint)
                }
                bmp
            } catch (_: Exception) {
                null
            }
            if (bitmap != null) views.setImageViewBitmap(viewId, bitmap)
        }

        /**
         * 大數字字級：**高度與寬度兩個上限取小的**。
         *
         * `1.16` 是 `includeFontPadding="false"` 下 sp→dp 的大約行高倍率。
         */
        private fun valueTextSizeSp(
            layoutRes: Int,
            widthDp: Int,
            heightDp: Int,
            snapshot: NutritionWidgetSnapshot,
            shortSuffix: Boolean,
            buttonDp: Float,
            refreshDp: Float
        ): Float {
            val byHeight = when (layoutRes) {
                // 完整版一整欄 = padding 20 ＋ 2×(標籤 13 ＋ 數字 V ＋ 進度條 11) ＋ 組間距 10
                //              = 82 ＋ 2V。用 88 而不是 82，留 6dp 餘裕。
                R.layout.widget_nutrition_wide -> (heightDp - 88) / 2f / 1.16f
                // 方形版沒有進度條，但底下多一列按鈕。
                R.layout.widget_nutrition_square -> (heightDp - 62 - buttonDp) / 2f / 1.16f
                // 矮版沒有標籤列也沒有進度條：padding 14 ＋ 2×數字 ＋ 列距 4 = 18 ＋ 2V。
                else -> (heightDp - 22) / 2f / 1.16f
            }

            // ── 寬度上限（owner 2026-08-22：「2x2 的上限數字被卡掉，可能需要自適應大小」）──
            // 只看高度時，又高又窄的尺寸會算出「高度放得下、寬度卻塞不進」的字級，
            // 尾巴就被 ellipsize 吃掉。這裡估一次這行文字要多寬，再反推字級上限。
            //
            // 字寬倍率：粗體等寬數字每字約 0.62em；尾巴是大數字的 SUFFIX_RATIO 倍，
            // 其中數字／英文平均約 0.55em 一字。估得寬鬆一點，寧可字小也不要被裁。
            val digits = maxOf(
                snapshot.totalKcal.toString().length,
                snapshot.totalProteinG.toString().length
            )
            val suffixChars = maxOf(
                suffixCharCount(shortSuffix, snapshot.kcalLimit, isKcal = true),
                suffixCharCount(shortSuffix, snapshot.proteinGoalG, isKcal = false)
            )
            val widthPerSp = digits * 0.62f + suffixChars * SUFFIX_RATIO * 0.55f
            val byWidth = statsWidthDp(layoutRes, widthDp, buttonDp, refreshDp) / widthPerSp

            val max = if (layoutRes == R.layout.widget_nutrition_wide) 40f else 32f
            return minOf(byHeight, byWidth).coerceIn(12f, max)
        }

        /** 尾巴的字數（不必真的取字串資源，長度算得出來就夠——這是估算用的）。 */
        private fun suffixCharCount(shortSuffix: Boolean, limit: Long, isKcal: Boolean): Int {
            val digits = limit.toString().length
            return when {
                isKcal && shortSuffix -> 1 + digits          // "/1256"
                isKcal -> 2 + digits + 4                     // "/ 1256kcal"
                shortSuffix -> 1 + digits + 1                // "/70g"
                else -> 2 + digits + 1                       // "/ 70g"
            }
        }

        /** 「數字那一欄」實際拿得到多少寬度——扣掉 padding、重新整理、按鈕與各種間距。 */
        private fun statsWidthDp(layoutRes: Int, widthDp: Int, buttonDp: Float, refreshDp: Float): Float = when (layoutRes) {
            // 按鈕在底下一列，數字欄吃得到整個寬度（只扣 padding）——這正是方形版存在的理由。
            R.layout.widget_nutrition_square -> (widthDp - 20).toFloat()
            // 標籤在數字左邊，還要扣掉標籤欄（minWidth 42dp ＋ 間距 4dp）。
            R.layout.widget_nutrition_medium -> widthDp - 14f - refreshDp - 16f - (buttonDp * 2 + 6f) - 46f
            R.layout.widget_nutrition_wide -> widthDp - 20f - refreshDp - 16f - buttonDp
            else -> widthDp - 12f - refreshDp - 10f - buttonDp
        }.coerceAtLeast(30f)

        private fun progressPercent(value: Long, goal: Long): Int {
            if (goal <= 0) return 0
            return (value * 100 / goal).coerceIn(0, 100).toInt()
        }

        private fun layoutName(layoutRes: Int): String = when (layoutRes) {
            R.layout.widget_nutrition_wide -> "wide"
            R.layout.widget_nutrition_square -> "square"
            R.layout.widget_nutrition_medium -> "medium"
            else -> "narrow"
        }

        /** API 26–30 沒有系統挑圖，手動依寬高判斷斷點；數字抓寬鬆一點，不同 launcher 格寬不完全一致。 */
        private fun pickLayout(widthDp: Int, heightDp: Int): Int = when {
            // 夠高又夠寬：完整版（標籤在上、進度條、按鈕右側直排）
            heightDp >= BREAKPOINT_TALL_HEIGHT_DP && widthDp >= BREAKPOINT_MEDIUM_WIDTH_DP -> R.layout.widget_nutrition_wide
            // 夠高但窄（2x2）：方形版——按鈕移到底下一列，數字欄才吃得到整個寬度
            heightDp >= BREAKPOINT_TALL_HEIGHT_DP -> R.layout.widget_nutrition_square
            // 矮而寬（3x1／4x1）：標籤在數字左邊
            widthDp >= BREAKPOINT_MEDIUM_WIDTH_DP -> R.layout.widget_nutrition_medium
            // 矮又窄（2x1）：不顯示標籤
            else -> R.layout.widget_nutrition_narrow
        }

        private fun buildRemoteViews(
            context: Context,
            layoutRes: Int,
            appWidgetId: Int,
            snapshot: NutritionWidgetSnapshot,
            shortSuffix: Boolean,
            colors: NutritionWidgetDataReader.NutritionWidgetColors
        ): RemoteViews {
            val views = RemoteViews(context.packageName, layoutRes)

            if (!snapshot.hasBodyProfile) {
                views.setTextViewText(R.id.widget_kcal_value, "--")
                views.setTextColor(R.id.widget_kcal_value, colors.text)
                // 窄版的尾巴只有幾個字寬，長句會被截成「尚未設定身…」——那裡用短字串。
                views.setTextViewText(
                    R.id.widget_kcal_suffix,
                    context.getString(
                        if (layoutRes == R.layout.widget_nutrition_narrow) R.string.widget_no_profile_short
                        else R.string.widget_no_profile
                    )
                )
                // 窄版（widget_nutrition_narrow.xml）根本沒有 widget_protein_label 這個
                // view，RemoteViews 對不存在的 id 呼叫 setViewVisibility 會安靜略過，
                // 不會噴錯——不用另外判斷「現在是哪個尺寸」。
                views.setViewVisibility(R.id.widget_protein_label, View.GONE)
                views.setViewVisibility(R.id.widget_protein_value, View.GONE)
                views.setViewVisibility(R.id.widget_protein_suffix, View.GONE)
                views.setViewVisibility(R.id.widget_kcal_progress, View.GONE)
                views.setViewVisibility(R.id.widget_protein_progress, View.GONE)
            } else {
                views.setViewVisibility(R.id.widget_protein_label, View.VISIBLE)
                views.setViewVisibility(R.id.widget_protein_value, View.VISIBLE)
                views.setViewVisibility(R.id.widget_protein_suffix, View.VISIBLE)
                views.setViewVisibility(R.id.widget_kcal_progress, View.VISIBLE)
                views.setViewVisibility(R.id.widget_protein_progress, View.VISIBLE)

                val kcalExceeded = snapshot.totalKcal > snapshot.kcalLimit
                // 蛋白質跟熱量的「好方向」相反：熱量超標是壞事（紅字），蛋白質沒吃到目標
                // 才是壞事（紅字）——吃到或超過目標是好事，見 owner 2026-08-21 回報。
                val proteinBelowGoal = snapshot.totalProteinG < snapshot.proteinGoalG

                // 目前攝取量用大數字，上限／目標值放進小字尾巴，owner 2026-08-22 要求
                // ——像時鐘小工具那樣一眼看到「現在」，不是一整句話。
                views.setTextViewText(R.id.widget_kcal_value, snapshot.totalKcal.toString())
                views.setTextViewText(
                    R.id.widget_kcal_suffix,
                    context.getString(
                        if (shortSuffix) R.string.widget_value_suffix_kcal_short else R.string.widget_value_suffix_kcal,
                        snapshot.kcalLimit
                    )
                )
                views.setTextViewText(R.id.widget_protein_value, snapshot.totalProteinG.toString())
                views.setTextViewText(
                    R.id.widget_protein_suffix,
                    context.getString(
                        if (shortSuffix) R.string.widget_value_suffix_protein_short else R.string.widget_value_suffix_protein,
                        snapshot.proteinGoalG
                    )
                )

                // ⚠️ 「正常」那一側要用**配色的文字色**，不是寫死的 widget_text——
                // 否則挑深色配色時數字會是深綠字配深底，整個看不到（§14.2）。
                // 超標紅／達標綠是語意色，跟著配色跑會把警示意義洗掉，維持固定值。
                val kcalColor = if (kcalExceeded) ContextCompat.getColor(context, R.color.widget_exceeded) else colors.text
                val proteinColor = if (proteinBelowGoal) ContextCompat.getColor(context, R.color.widget_exceeded) else ContextCompat.getColor(context, R.color.widget_good)
                views.setTextColor(R.id.widget_kcal_value, kcalColor)
                views.setTextColor(R.id.widget_protein_value, proteinColor)

                // 上限是手錶動態算出來的時候標一下，不然使用者會覺得「怎麼跟我設定的
                // 上限不一樣」。比照 App 內那個「依手錶動態」小標籤。
                // 2x1（narrow）沒有這個 view，setTextViewText 會安靜略過。
                if (snapshot.isDynamicKcalLimit) {
                    views.setTextViewText(R.id.widget_kcal_label, context.getString(R.string.widget_label_kcal_dynamic))
                }

                // 只有夠高的兩種版面有進度條；矮版（narrow／medium）一格高塞不下，
                // 那兩個版面根本沒有這兩個 id，RemoteViews 對不存在的 id 會安靜略過——
                // 但還是明確判斷，免得之後有人以為矮版也該有。
                if (layoutRes == R.layout.widget_nutrition_wide || layoutRes == R.layout.widget_nutrition_square) {
                    applyProgress(context, views, R.id.widget_kcal_progress, progressPercent(snapshot.totalKcal, snapshot.kcalLimit), colors)
                    applyProgress(context, views, R.id.widget_protein_progress, progressPercent(snapshot.totalProteinG, snapshot.proteinGoalG), colors)
                }
            }

            views.setOnClickPendingIntent(R.id.widget_root, activityPendingIntent(context, appWidgetId, PATH_DAILY, REQUEST_DAILY))
            views.setOnClickPendingIntent(R.id.widget_btn_camera, activityPendingIntent(context, appWidgetId, PATH_PHOTO, REQUEST_PHOTO))
            views.setOnClickPendingIntent(R.id.widget_btn_edit, activityPendingIntent(context, appWidgetId, PATH_QUICK_ENTRY, REQUEST_QUICK_ENTRY))
            views.setOnClickPendingIntent(R.id.widget_btn_refresh, refreshPendingIntent(context, appWidgetId))
            return views
        }

        private const val REQUEST_DAILY = 1
        private const val REQUEST_PHOTO = 2
        private const val REQUEST_QUICK_ENTRY = 3
        private const val REQUEST_REFRESH = 4

        /**
         * 相機／鉛筆／其餘區域三種點擊都拉起 MainActivity，帶不同路徑的深連結 URI，
         * 由 App 端（`main.tsx` 的 `handleWidgetAction`）透過 `@capacitor/app` 的
         * `appUrlOpen`／`getLaunchUrl()` 收下並導覽（見計畫書 §5）。
         */
        private fun activityPendingIntent(context: Context, appWidgetId: Int, path: String, requestCode: Int): PendingIntent {
            val uri = Uri.parse("$DEEP_LINK_SCHEME://widget/$path")
            val intent = Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            // requestCode 混入 appWidgetId：同一台裝置可能放多個小工具實例，PendingIntent 的
            // request code 若共用會被系統當成同一個、只有最後一份 extra 生效。
            return PendingIntent.getActivity(
                context,
                requestCode * 100_000 + appWidgetId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        /** 重新整理**不啟動 App**，直接 broadcast 回這支 Provider 自己重讀重算（計畫書 §5）。 */
        private fun refreshPendingIntent(context: Context, appWidgetId: Int): PendingIntent {
            val intent = Intent(context, NutritionWidgetProvider::class.java).apply {
                action = ACTION_REFRESH
            }
            return PendingIntent.getBroadcast(
                context,
                REQUEST_REFRESH * 100_000 + appWidgetId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }
    }
}
