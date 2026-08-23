package tw.nori.dest.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.net.Uri
import android.os.Bundle
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import tw.nori.dest.MainActivity
import tw.nori.dest.R
import java.io.File

/**
 * 角色陪伴桌面小工具（`docs/mobile-android-widget-plan.md`）。
 *
 * ⚠️ **小工具不綁角色，跟著「目前這個對話」走**（owner 2026-08-23 實機回報後改的，
 * 見計畫書 §11.3）。所以這裡沒有 per-widget 設定、沒有 Configure 畫面，
 * 所有實例讀同一份快照 `files/widget-cache/state.json`（含 `showAvatar`）。
 *
 * 完全不做背景輪詢：`widgetBridge.ts` 在訊息進來／App 離開前景／釘選變動時把
 * `state.json`＋`image.png` 寫好，再呼叫 [DeSTWidgetBridgePlugin] 觸發這裡重繪。
 * `onUpdate()` 的系統排程週期只是保底。
 */
class DeSTWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        val state = readState(context)
        for (id in appWidgetIds) updateWidget(context, appWidgetManager, id, state)
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle
    ) {
        updateWidget(context, appWidgetManager, appWidgetId, readState(context))
    }

    companion object {
        private const val WIDGET_STATE_FILE = "widget-cache/state.json"

        /** 兩則是不同角色時各自一張頭像（§13）；同一個角色時只用得到 index 0 那張。 */
        private val WIDGET_IMAGE_FILES = arrayOf("widget-cache/image1.png", "widget-cache/image2.png")
        private const val DEEP_LINK_SCHEME = "tw.nori.dest"

        /** 高度門檻：矮長條（3x1／4x1）vs 兩則對白版（3x2／4x2），見計畫書 §5.3。 */
        private const val BREAKPOINT_TALL_HEIGHT_DP = 100

        /** 底板圓角，與 `bg_dest_widget_container.xml` 的值一致（扁平圓潤，CLAUDE.md §3）。 */
        private const val CORNER_RADIUS_DP = 20f

        /** [DeSTWidgetBridgePlugin] 呼叫這個，重繪畫面上所有小工具實例。 */
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, DeSTWidgetProvider::class.java))
            if (ids.isEmpty()) return
            val state = readState(context)
            for (id in ids) updateWidget(context, manager, id, state)
        }

        /** 主畫面上目前放了幾個實例（給 App 內的小工具設定頁顯示「現在有沒有在用」）。 */
        fun placedCount(context: Context): Int {
            val manager = AppWidgetManager.getInstance(context)
            return manager.getAppWidgetIds(ComponentName(context, DeSTWidgetProvider::class.java)).size
        }

        private fun updateWidget(context: Context, manager: AppWidgetManager, appWidgetId: Int, state: WidgetState?) {
            val options = manager.getAppWidgetOptions(appWidgetId)
            val heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 60)
                .takeIf { it > 0 } ?: options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 60)
            val widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 180)
            val lines = state?.lines ?: emptyList()
            val twoLine = heightDp >= BREAKPOINT_TALL_HEIGHT_DP
            // 兩則是不同角色時改用「每則各自頭像＋名字」的版面（§13）。判斷已經在
            // JS 端做完寫進 `perLineSpeaker`，這裡不重算。
            val perLineSpeaker = twoLine && state?.perLineSpeaker == true && lines.size >= 2
            val layoutRes = when {
                perLineSpeaker -> R.layout.widget_dest_character_2line_multi
                twoLine -> R.layout.widget_dest_character_2line
                else -> R.layout.widget_dest_character_1line
            }

            val views = RemoteViews(context.packageName, layoutRes)
            val showAvatar = state?.showAvatar != false
            val fallbackName = context.getString(R.string.widget_default_name)
            val colors = state?.colors ?: WidgetColors()

            // ── 底板：圓角矩形 bitmap，顏色與透明度都來自 App 的設定（§14.2）──
            applyBackground(context, views, widthDp, heightDp, colors.bg)

            /*
             * 矮版（3x1／4x1）顯示的是 `singleLine`，**不是 `lines[0]`**。
             * 自動補的那幾則是「舊的在上、新的在下」（§14.1），所以兩則版的第 0 則
             * 是比較舊的那則，而矮版該顯示最新的——JS 端已經另外算好一份寫進
             * `singleLine`，這裡直接用，不要自己從 `lines` 推。
             */
            val singleLine = state?.singleLine

            if (perLineSpeaker) {
                views.setTextViewText(R.id.widget_name1, lines[0].name.ifBlank { fallbackName })
                views.setTextViewText(R.id.widget_name2, lines[1].name.ifBlank { fallbackName })
                views.setTextColor(R.id.widget_name1, colors.textSub)
                views.setTextColor(R.id.widget_name2, colors.textSub)
            } else {
                // 同一個角色連講兩句（或只有一則）：一個名字、一張臉。
                val name = (if (twoLine) lines.firstOrNull()?.name else singleLine?.name)?.ifBlank { null }
                views.setTextViewText(R.id.widget_name, name ?: fallbackName)
                views.setTextColor(R.id.widget_name, colors.textSub)
            }

            if (twoLine) {
                applyLine(context, views, R.id.widget_line1, lines.getOrNull(0), appWidgetId, 1)
                applyLine(context, views, R.id.widget_line2, lines.getOrNull(1), appWidgetId, 2)
                views.setTextColor(R.id.widget_line1, colors.text)
                views.setTextColor(R.id.widget_line2, colors.text)
                views.setInt(R.id.widget_divider, "setBackgroundColor", colors.border)
            } else {
                applyLine(context, views, R.id.widget_line1, singleLine, appWidgetId, 1)
                views.setTextColor(R.id.widget_line1, colors.text)
            }

            // 對白目標 20–50 字、不要一行就截斷——依實際寬度粗估字級（§5.0）。
            // 兩則各自帶頭像時文字欄更窄，再降一階免得每則都只剩幾個字。
            val base = if (widthDp >= 260) 14f else if (widthDp >= 200) 13f else 12f
            val lineSizeSp = if (perLineSpeaker) base - 1f else base
            views.setTextViewTextSize(R.id.widget_line1, TypedValue.COMPLEX_UNIT_SP, lineSizeSp)
            if (twoLine) views.setTextViewTextSize(R.id.widget_line2, TypedValue.COMPLEX_UNIT_SP, lineSizeSp)

            if (perLineSpeaker) {
                applyAvatar(context, views, R.id.widget_avatar1, lines[0].avatarIndex, showAvatar, colors.accentStrong)
                applyAvatar(context, views, R.id.widget_avatar2, lines[1].avatarIndex, showAvatar, colors.accentStrong)
            } else {
                // 矮版跟著 `singleLine` 的那張臉走——它可能是 image2（見上面的說明）。
                val index = if (twoLine) lines.firstOrNull()?.avatarIndex ?: -1 else singleLine?.avatarIndex ?: -1
                applyAvatar(context, views, R.id.widget_avatar, index, showAvatar, colors.accentStrong)
            }

            views.setOnClickPendingIntent(R.id.widget_root, openAppPendingIntent(context, appWidgetId, null, null, 0))
            manager.updateAppWidget(appWidgetId, views)
        }

        /**
         * 圓角底板（§14.2）。
         *
         * ⚠️ **不能用 `setInt(root, "setBackgroundColor", …)`**：那會是直角，
         * 而 CLAUDE.md §3 的視覺硬規則明訂不要尖角。也不能用
         * `setBackgroundTintList`（API 31 才有，本專案 minSdk 26）。
         * 所以自己畫一張圓角矩形 bitmap 塞進 `widget_bg` 那個 ImageView
         * （`scaleType="fitXY"`，bitmap 就是實際尺寸，不會變形）。
         * 透明度直接在顏色的 alpha 通道上，完全透明時就是一張全透明的圖。
         */
        private fun applyBackground(context: Context, views: RemoteViews, widthDp: Int, heightDp: Int, color: Int) {
            val density = context.resources.displayMetrics.density
            // 上限只是保險：極端尺寸下不要配一張大得離譜的 bitmap。
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
         * 一張頭像。關掉頭像、或根本沒有圖可用時整個藏起來，文字區塊的
         * `layout_weight` 會自動吃掉那塊空間（計畫書 §5.3）。
         *
         * ⚠️ **底色圓要畫進 bitmap 裡，不能靠 XML 的 `android:background`**
         * （計畫書 §17）：那層寫死 `@color/widget_mint2`，換配色時不會跟著變，
         * 而角色圖多半是**去背 PNG**，透明的地方會直接露出那顆綠圓。
         * 跟按鈕（§15.1）同一個限制與同一個修法。
         */
        private fun applyAvatar(
            context: Context,
            views: RemoteViews,
            viewId: Int,
            index: Int,
            showAvatar: Boolean,
            circleColor: Int
        ) {
            // XML 那顆寫死顏色的圓底一定要拿掉，否則會從 bitmap 的抗鋸齒邊緣透出來。
            views.setInt(viewId, "setBackgroundResource", 0)
            val bitmap = if (showAvatar) readCircularAvatar(context, index, circleColor) else null
            if (bitmap != null) {
                views.setViewVisibility(viewId, View.VISIBLE)
                views.setImageViewBitmap(viewId, bitmap)
            } else {
                views.setViewVisibility(viewId, View.GONE)
            }
        }

        /**
         * 一則對白。
         *
         * 釘選的那幾則前面加一個圖釘，使用者才知道**為什麼**這一句固定在這裡
         * （owner 2026-08-23：「不知道為什麼會顯示那一則」）。用文字前綴而不是
         * 另外擺一個 ImageView：RemoteViews 能改的屬性有限，而多一個 view 就多一份
         * 要跟兩種版面同步的狀態，前綴在兩種版面上行為完全一致。
         */
        private fun applyLine(
            context: Context,
            views: RemoteViews,
            viewId: Int,
            line: WidgetLine?,
            appWidgetId: Int,
            requestSlot: Int
        ) {
            if (line == null || line.text.isBlank()) {
                views.setTextViewText(viewId, context.getString(R.string.widget_no_conversation))
                // RemoteViews 沒有「移除 click listener」的 API，改綁一份跟 widget_root
                // 相同（不帶 extra）的 PendingIntent，行為就等於落回預設。
                views.setOnClickPendingIntent(viewId, openAppPendingIntent(context, appWidgetId, null, null, 0))
                return
            }
            val prefix = if (line.pinned) context.getString(R.string.widget_pinned_prefix) else ""
            views.setTextViewText(viewId, prefix + line.text)
            views.setOnClickPendingIntent(
                viewId,
                openAppPendingIntent(context, appWidgetId, line.conversationId, line.messageId, requestSlot)
            )
        }

        /**
         * 兩種點擊都拉起 MainActivity：帶 `conversationId`／`messageId` 的跳到那則訊息，
         * 不帶的（其餘區域）單純開 App 到目前預設畫面（§6.1）。
         */
        private fun openAppPendingIntent(
            context: Context,
            appWidgetId: Int,
            conversationId: String?,
            messageId: String?,
            requestSlot: Int
        ): PendingIntent {
            val builder = Uri.Builder().scheme(DEEP_LINK_SCHEME).authority("widget").path("/message")
            if (conversationId != null) builder.appendQueryParameter("conversationId", conversationId)
            if (messageId != null) builder.appendQueryParameter("messageId", messageId)
            val intent = Intent(Intent.ACTION_VIEW, builder.build(), context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            // requestCode 混入 appWidgetId 與 slot：同一個小工具的兩則對白＋背景要各自
            // 有獨立的 PendingIntent，request code 相同的話系統只認得最後一份 extra。
            return PendingIntent.getActivity(
                context,
                requestSlot * 1_000_000 + appWidgetId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
        }

        private data class WidgetLine(
            val text: String,
            /** 這一則的說話者名字（JS 端已經解析過現存角色／名字快照）。 */
            val name: String,
            val conversationId: String?,
            val messageId: String?,
            val pinned: Boolean,
            /** 用 `imageN.png` 的哪一張當頭像；`-1` ＝ 沒有頭像可用。 */
            val avatarIndex: Int
        )

        /**
         * 配色（§14.2）。預設值是薄荷主題，只有在 `state.json` 還沒被寫出來、
         * 或欄位壞掉時才會用到。
         */
        private data class WidgetColors(
            val bg: Int = Color.parseColor("#FFF7FFFC"),
            val text: Int = Color.parseColor("#FF3D5A52"),
            val textSub: Int = Color.parseColor("#FF7AA898"),
            val border: Int = Color.parseColor("#14000000"),
            /** 目前沒用到（DeST 小工具沒有按鈕），留著讓兩個 App 的色票欄位一致。 */
            val accent: Int = Color.parseColor("#FFCBFBC4"),
            /** 頭像的底色圓（§17）。 */
            val accentStrong: Int = Color.parseColor("#FFAAEEDD")
        )

        private data class WidgetState(
            val showAvatar: Boolean,
            /** 兩則是不同角色，要用每則各自頭像＋名字的版面（§13）。 */
            val perLineSpeaker: Boolean,
            val colors: WidgetColors,
            val lines: List<WidgetLine>,
            /** 矮版（3x1／4x1）要顯示的那一則，**不是 `lines[0]`**（§14.1）。 */
            val singleLine: WidgetLine?
        )

        /** 解析 `widgetBridge.ts` 寫的 `WidgetStateFile`；那邊改欄位這裡要跟著改。 */
        private fun readState(context: Context): WidgetState? {
            val file = File(context.filesDir, WIDGET_STATE_FILE)
            if (!file.exists()) return null
            return try {
                val obj = JSONObject(file.readText(Charsets.UTF_8))
                val linesArr: JSONArray = obj.optJSONArray("lines") ?: JSONArray()
                val lines = (0 until linesArr.length()).mapNotNull { i ->
                    parseLine(linesArr.optJSONObject(i))
                }
                WidgetState(
                    showAvatar = obj.optBoolean("showAvatar", true),
                    perLineSpeaker = obj.optBoolean("perLineSpeaker", false),
                    colors = parseColors(obj.optJSONObject("colors")),
                    lines = lines,
                    singleLine = parseLine(obj.optJSONObject("singleLine"))
                )
            } catch (_: Exception) {
                null
            }
        }

        private fun parseLine(obj: JSONObject?): WidgetLine? {
            if (obj == null) return null
            return WidgetLine(
                text = obj.optString("text", ""),
                name = obj.optString("name", ""),
                conversationId = obj.optString("conversationId", "").ifBlank { null },
                messageId = obj.optString("messageId", "").ifBlank { null },
                pinned = obj.optBoolean("pinned", false),
                avatarIndex = obj.optInt("avatarIndex", -1)
            )
        }

        /** 顏色字串是 JS 端換算好的 `#AARRGGBB`；parse 不動就用預設值那一格，不要整個放棄。 */
        private fun parseColors(obj: JSONObject?): WidgetColors {
            if (obj == null) return WidgetColors()
            val fallback = WidgetColors()
            fun pick(key: String, default: Int): Int = try {
                obj.optString(key, "").ifBlank { null }?.let { Color.parseColor(it) } ?: default
            } catch (_: Exception) {
                default
            }
            return WidgetColors(
                bg = pick("bg", fallback.bg),
                text = pick("text", fallback.text),
                textSub = pick("textSub", fallback.textSub),
                border = pick("border", fallback.border),
                accent = pick("accent", fallback.accent),
                accentStrong = pick("accentStrong", fallback.accentStrong)
            )
        }

        /**
         * `imageN.png` 已經是 `widgetBridge.ts` 裁好的圖，這裡只需要疊上底色圓、
         * 再裁成圓形——**不重做臉部裁切的數學**。
         *
         * 底色圓跟著配色走（§17）。角色圖多半是去背 PNG，透明的地方會露出這層底色，
         * 所以它不是裝飾——沒有它，去背的角色會直接貼在桌布上，深色桌布配深色線稿
         * 就看不到臉了。
         *
         * ⚠️ **底色圓不吃底板的透明度**：跟按鈕同一個道理（§15.1），
         * 臉要看得清楚就得有個穩定的背景。使用者把底板調到全透明時，
         * 頭像仍然是一顆看得見的圓形徽章。
         */
        private fun readCircularAvatar(context: Context, index: Int, circleColor: Int): Bitmap? {
            val name = WIDGET_IMAGE_FILES.getOrNull(index) ?: return null
            val file = File(context.filesDir, name)
            if (!file.exists()) return null
            val source = try {
                BitmapFactory.decodeFile(file.absolutePath)
            } catch (_: Exception) {
                null
            } ?: return null

            val size = minOf(source.width, source.height)
            if (size <= 0) return null
            return try {
                val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(output)
                val rect = RectF(0f, 0f, size.toFloat(), size.toFloat())
                val paint = Paint(Paint.ANTI_ALIAS_FLAG)

                // ① 底色圓
                paint.color = circleColor
                canvas.drawOval(rect, paint)

                // ② 頭像疊上去，用 BitmapShader 讓它自動裁成圓形。
                //    比「先畫遮罩再 SRC_IN」少一張暫存 bitmap，而且透明的地方
                //    會正常疊在底色圓上（SRC_IN 那種寫法會把底色一起挖掉）。
                val shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
                shader.setLocalMatrix(Matrix().apply {
                    setTranslate(-(source.width - size) / 2f, -(source.height - size) / 2f)
                })
                paint.shader = shader
                canvas.drawOval(rect, paint)
                output
            } catch (_: Exception) {
                // 記憶體不足之類的：寧可不顯示頭像，也不要讓整個小工具掛掉
                null
            }
        }
    }
}
