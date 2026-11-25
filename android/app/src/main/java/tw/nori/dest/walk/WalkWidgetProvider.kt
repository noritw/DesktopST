package tw.nori.dest.walk

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
import android.os.Bundle
import android.text.format.DateFormat
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import tw.nori.dest.MainActivity
import tw.nori.dest.R
import java.io.File
import java.text.NumberFormat
import java.time.LocalDate
import java.util.Date
import java.util.Locale

/**
 * 陪伴同行計步小工具（`docs/walk-together-design.md` §6）。
 *
 * ⚠️ **只讀步數、畫畫面**：不記帳、不呼叫 LLM、不啟動 WebView。記帳只由 App 做，
 * 避免前景與背景兩個程序同時寫同一份檔案。
 * 名單、頭像、步幅、配色由 `walkBridge.ts` 寫進 `files/walk-widget/`。
 */
class WalkWidgetProvider : AppWidgetProvider() {

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            AppWidgetManager.ACTION_APPWIDGET_UPDATE,
            Intent.ACTION_BOOT_COMPLETED,
            Intent.ACTION_MY_PACKAGE_REPLACED,
            ACTION_REFRESH -> {
                renderAll(context)
                // aggregate 是 suspend，onReceive 一結束行程就可能被回收，所以用 goAsync
                val pending = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        refresh(context)
                    } catch (e: Exception) {
                        Log.w(TAG, "refresh failed", e)
                    } finally {
                        pending.finish()
                    }
                }
            }
        }
    }

    override fun onAppWidgetOptionsChanged(
        context: Context,
        manager: AppWidgetManager,
        appWidgetId: Int,
        newOptions: Bundle
    ) {
        render(context, manager, appWidgetId)
    }

    companion object {
        private const val TAG = "WalkWidget"
        private const val ACTION_REFRESH = "tw.nori.dest.walk.REFRESH"
        private const val STATE_FILE = "walk-widget/state.json"
        private const val PREFS = "walk-widget"
        private const val CORNER_RADIUS_DP = 20f
        private const val READ_FAILED = "failed"
        private val AVATAR_VIEWS = intArrayOf(R.id.walk_avatar1, R.id.walk_avatar2, R.id.walk_avatar3)

        /** 讀一次步數、記下結果、重繪。讀取失敗保留上次數字。 */
        suspend fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            if (widgetIds(context, manager).isEmpty()) return
            if (readState(context).enabled) {
                val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                try {
                    withTimeout(8_000) {
                        val status = WalkSteps.status(context)
                        val edit = prefs.edit()
                            .putString("status", status.state)
                            .putBoolean("background", status.backgroundGranted)
                        if (status.state == WalkSteps.OK) {
                            val today = LocalDate.now()
                            val steps = WalkSteps.readDay(context, today) ?: 0L
                            edit.putString("day", today.toString())
                                .putLong("steps", steps)
                                .putLong("at", System.currentTimeMillis())
                        }
                        edit.commit()
                    }
                } catch (e: Exception) {
                    // 包含沒有背景權限時的 SecurityException；不可以把步數寫成 0
                    Log.w(TAG, "read steps failed: ${e.message}")
                    prefs.edit().putString("status", READ_FAILED).commit()
                }
            }
            renderAll(context)
        }

        fun lastSteps(context: Context): Pair<String, Long>? {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val day = prefs.getString("day", null) ?: return null
            return Pair(day, prefs.getLong("steps", 0))
        }

        private fun widgetIds(context: Context, manager: AppWidgetManager): IntArray =
            manager.getAppWidgetIds(ComponentName(context, WalkWidgetProvider::class.java))

        private fun renderAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            for (id in widgetIds(context, manager)) render(context, manager, id)
        }

        private fun render(context: Context, manager: AppWidgetManager, id: Int) {
            val state = readState(context)
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val status = prefs.getString("status", "") ?: ""
            val background = prefs.getBoolean("background", false)
            val fresh = prefs.getString("day", "") == LocalDate.now().toString()
            val steps = prefs.getLong("steps", 0)
            val at = prefs.getLong("at", 0)

            val views = RemoteViews(context.packageName, R.layout.widget_walk)
            val options = manager.getAppWidgetOptions(id)
            val widthDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 250).coerceAtLeast(1)
            val heightDp = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, 80).coerceAtLeast(1)
            views.setImageViewBitmap(R.id.walk_bg, roundedBitmap(context, widthDp, heightDp, state.bg))
            views.setTextColor(R.id.walk_steps, state.text)
            views.setTextColor(R.id.walk_distance, state.textSub)
            views.setTextColor(R.id.walk_note, state.textSub)
            views.setTextColor(R.id.walk_refresh, state.textSub)
            views.setTextColor(R.id.walk_more, state.textSub)

            var main = "—"
            var distance = ""
            val note: String
            when {
                !state.enabled -> note = context.getString(R.string.walk_widget_disabled)
                status == WalkSteps.UNSUPPORTED || status == WalkSteps.NEEDS_UPDATE ->
                    note = context.getString(R.string.walk_widget_unsupported)
                status == WalkSteps.NO_PERMISSION -> note = context.getString(R.string.walk_widget_no_permission)
                // 跨日不沿用昨天的數字
                !fresh -> note = context.getString(
                    if (background) R.string.walk_widget_waiting else R.string.walk_widget_open_app
                )
                else -> {
                    main = context.getString(
                        R.string.walk_widget_steps,
                        NumberFormat.getIntegerInstance(Locale.getDefault()).format(steps)
                    )
                    distance = context.getString(
                        R.string.walk_widget_distance,
                        String.format(Locale.US, "%.1f", steps * state.stride / 1000.0)
                    )
                    val time = DateFormat.getTimeFormat(context).format(Date(at))
                    note = context.getString(
                        if (status == READ_FAILED) R.string.walk_widget_failed else R.string.walk_widget_updated,
                        time
                    )
                }
            }
            views.setTextViewText(R.id.walk_steps, main)
            views.setTextViewText(R.id.walk_distance, distance)
            views.setTextViewText(R.id.walk_note, note)

            // 窄版只放得下一張頭像
            val slots = if (widthDp >= 220) 3 else 1
            for (i in AVATAR_VIEWS.indices) {
                val bitmap = if (state.enabled && i < slots && i < state.avatarCount) {
                    circleAvatar(context, i, state.circle)
                } else {
                    null
                }
                views.setViewVisibility(AVATAR_VIEWS[i], if (bitmap != null) View.VISIBLE else View.GONE)
                if (bitmap != null) views.setImageViewBitmap(AVATAR_VIEWS[i], bitmap)
            }
            val more = state.companionCount - minOf(slots, state.companionCount)
            views.setViewVisibility(R.id.walk_more, if (state.enabled && more > 0) View.VISIBLE else View.GONE)
            views.setTextViewText(R.id.walk_more, "+$more")

            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            val open = PendingIntent.getActivity(
                context, id,
                Intent(context, MainActivity::class.java)
                    .setAction("tw.nori.dest.walk.OPEN")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                flags
            )
            views.setOnClickPendingIntent(R.id.walk_root, open)
            // 沒有背景權限時在背景一定讀不到，↻ 改成開 App
            views.setOnClickPendingIntent(
                R.id.walk_refresh,
                if (!background) open else PendingIntent.getBroadcast(
                    context, id, Intent(context, WalkWidgetProvider::class.java).setAction(ACTION_REFRESH), flags
                )
            )
            manager.updateAppWidget(id, views)
        }

        private data class State(
            val enabled: Boolean = false,
            val stride: Double = 0.7,
            val companionCount: Int = 0,
            val avatarCount: Int = 0,
            val bg: Int = Color.parseColor("#FFF7FFFC"),
            val text: Int = Color.parseColor("#FF3D5A52"),
            val textSub: Int = Color.parseColor("#FF7AA898"),
            val circle: Int = Color.parseColor("#FFAAEEDD")
        )

        /** 解析 `walkBridge.ts` 寫的檔案；那邊改欄位這裡要跟著改。 */
        private fun readState(context: Context): State {
            val file = File(context.filesDir, STATE_FILE)
            val d = State()
            return try {
                if (!file.exists()) return d
                val o = JSONObject(file.readText(Charsets.UTF_8))
                val c = o.optJSONObject("colors")
                fun pick(key: String, fallback: Int): Int = try {
                    Color.parseColor(c?.optString(key, ""))
                } catch (_: Exception) {
                    fallback
                }
                State(
                    enabled = o.optBoolean("enabled", false),
                    stride = o.optDouble("strideMeters", d.stride),
                    companionCount = o.optInt("companionCount", 0),
                    avatarCount = o.optInt("avatarCount", 0),
                    bg = pick("bg", d.bg),
                    text = pick("text", d.text),
                    textSub = pick("textSub", d.textSub),
                    circle = pick("accentStrong", d.circle)
                )
            } catch (_: Exception) {
                d
            }
        }

        private fun roundedBitmap(context: Context, widthDp: Int, heightDp: Int, color: Int): Bitmap {
            val density = context.resources.displayMetrics.density
            val w = (widthDp * density).toInt().coerceIn(1, 1600)
            val h = (heightDp * density).toInt().coerceIn(1, 1000)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { this.color = color }
            val r = CORNER_RADIUS_DP * density
            Canvas(bmp).drawRoundRect(RectF(0f, 0f, w.toFloat(), h.toFloat()), r, r, paint)
            return bmp
        }

        /**
         * 底色圓要畫進 bitmap（去背角色才看得清楚），見 DeSTWidgetProvider 的同款說明。
         * 固定縮到小尺寸：RemoteViews 的 bitmap 總量有上限，三張原圖會整個更新失敗。
         */
        private fun circleAvatar(context: Context, index: Int, circle: Int): Bitmap? = try {
            val source = BitmapFactory.decodeFile(File(context.filesDir, "walk-widget/avatar$index.png").absolutePath)
            if (source == null) null else {
                val size = (44 * context.resources.displayMetrics.density).toInt().coerceIn(1, 200)
                val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
                val canvas = Canvas(out)
                val rect = RectF(0f, 0f, size.toFloat(), size.toFloat())
                val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
                paint.color = circle
                canvas.drawOval(rect, paint)
                val scale = size.toFloat() / minOf(source.width, source.height)
                paint.shader = BitmapShader(source, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply {
                    setLocalMatrix(Matrix().apply {
                        setScale(scale, scale)
                        postTranslate((size - source.width * scale) / 2f, (size - source.height * scale) / 2f)
                    })
                }
                canvas.drawOval(rect, paint)
                out
            }
        } catch (_: Exception) {
            null
        }
    }
}
