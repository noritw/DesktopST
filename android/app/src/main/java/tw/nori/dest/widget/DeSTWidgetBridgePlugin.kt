package tw.nori.dest.widget

import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * JS 沒辦法直接發 Android broadcast，`widgetBridge.ts` 存好 widget-cache 底下的
 * 檔案之後靠這支薄橋接跳回原生層叫 [DeSTWidgetProvider.updateAll]（照抄飲食小工具
 * `NutritionWidgetBridgePlugin` 的做法，見計畫書 §4.2 步驟 6／§7）。
 */
@CapacitorPlugin(name = "DeSTWidgetBridge")
class DeSTWidgetBridgePlugin : Plugin() {
    @PluginMethod
    fun refresh(call: PluginCall) {
        DeSTWidgetProvider.updateAll(context)
        call.resolve()
    }

    /** App 內的小工具設定頁用來顯示「主畫面上現在有幾個小工具」。 */
    @PluginMethod
    fun count(call: PluginCall) {
        val result = JSObject()
        result.put("count", DeSTWidgetProvider.placedCount(context))
        call.resolve(result)
    }
}
