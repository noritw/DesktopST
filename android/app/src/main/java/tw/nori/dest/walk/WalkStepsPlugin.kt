package tw.nori.dest.walk

import androidx.activity.result.ActivityResult
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import android.content.Intent
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import java.time.LocalDate

/** JS 端見 `src/mobile/runtime/walkBridge.ts`。 */
@CapacitorPlugin(name = "WalkSteps")
class WalkStepsPlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun handleOnDestroy() {
        scope.cancel()
        super.handleOnDestroy()
    }

    @PluginMethod
    fun status(call: PluginCall) = resolveStatus(call)

    /** 一次要求步數＋（支援時）背景讀取；使用者可以只同意其中一項。 */
    @PluginMethod
    fun requestAccess(call: PluginCall) {
        if (WalkSteps.sdkState(context) != WalkSteps.OK) {
            resolveStatus(call)
            return
        }
        try {
            val wanted = mutableSetOf(WalkSteps.STEPS_PERMISSION)
            if (WalkSteps.backgroundSupported(context)) wanted.add(WalkSteps.BACKGROUND_PERMISSION)
            val contract = PermissionController.createRequestPermissionResultContract()
            startActivityForResult(call, contract.createIntent(context, wanted), "onAccessResult")
        } catch (e: Exception) {
            call.reject("無法開啟授權畫面: ${e.message}")
        }
    }

    @ActivityCallback
    private fun onAccessResult(call: PluginCall?, @Suppress("UNUSED_PARAMETER") result: ActivityResult) {
        // 不看回傳內容，直接重查實際授權——使用者按返回時結果不可靠
        if (call != null) resolveStatus(call)
    }

    /** 連續拒絕後系統不再跳授權畫面，只能請使用者到 Health Connect 手動開。 */
    @PluginMethod
    fun openSettings(call: PluginCall) {
        try {
            val intent = Intent(HealthConnectClient.ACTION_HEALTH_CONNECT_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject("無法開啟 Health Connect: ${e.message}")
        }
    }

    /** `{ days: ['2026-11-23', …] }` → `{ totals: { 日期: 步數 } }`；任何一天失敗就整批 reject。 */
    @PluginMethod
    fun readDays(call: PluginCall) {
        val days = call.getArray("days") ?: JSArray()
        scope.launch {
            try {
                val names = (0 until days.length()).map { days.getString(it) }
                // 一天一個請求，依序讀會慢好幾倍
                val counts = coroutineScope {
                    names.map { async { WalkSteps.readDay(context, LocalDate.parse(it)) ?: 0L } }.awaitAll()
                }
                val totals = JSObject()
                names.forEachIndexed { i, day -> totals.put(day, counts[i]) }
                call.resolve(JSObject().apply { put("totals", totals) })
            } catch (e: Exception) {
                call.reject("讀取步數失敗: ${e.message}")
            }
        }
    }

    /** 小工具上次讀到的步數，不必等 Health Connect；沒讀過就沒有 `day`。 */
    @PluginMethod
    fun lastSteps(call: PluginCall) {
        call.resolve(JSObject().apply {
            WalkWidgetProvider.lastSteps(context)?.let { (day, steps) ->
                put("day", day)
                put("steps", steps)
            }
        })
    }

    @PluginMethod
    fun refreshWidget(call: PluginCall) {
        scope.launch {
            try {
                WalkWidgetProvider.refresh(context)
            } catch (_: Exception) {
                // 小工具是輔助功能
            }
            call.resolve()
        }
    }

    private fun resolveStatus(call: PluginCall) {
        scope.launch {
            try {
                val s = WalkSteps.status(context)
                call.resolve(JSObject().apply {
                    put("state", s.state)
                    put("backgroundSupported", s.backgroundSupported)
                    put("backgroundGranted", s.backgroundGranted)
                })
            } catch (e: Exception) {
                call.reject("查詢授權失敗: ${e.message}")
            }
        }
    }
}
