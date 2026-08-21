package tw.nori.destnutrition.widget

import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * JS 端沒有辦法直接發 Android broadcast，存 MealLog／App 離開前景這兩個觸發點
 * （`docs/nutrition-widget-plan.md` §3）都要靠這支薄橋接跳回原生層叫
 * [NutritionWidgetProvider.updateAll]。**只有小工具重新整理按鈕不經過這裡**——
 * 那顆是原生層自己收廣播，不啟動 App（見計畫書 §5）。
 */
@CapacitorPlugin(name = "NutritionWidgetBridge")
class NutritionWidgetBridgePlugin : Plugin() {
    @PluginMethod
    fun refresh(call: PluginCall) {
        NutritionWidgetProvider.updateAll(context)
        call.resolve()
    }
}
