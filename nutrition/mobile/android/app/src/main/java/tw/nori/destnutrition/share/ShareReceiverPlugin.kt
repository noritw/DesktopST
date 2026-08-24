package tw.nori.destnutrition.share

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * 接收 DeST 手機版透過 Android 分享面板（ACTION_SEND, text/plain）送來的
 * AI 設定匯出字串（`docs`：食記 AI 金鑰同步設計，2026-08-25）。
 *
 * 冷啟動時分享的 intent 在 [android.app.Activity.getIntent]；App 已在背景時
 * 走 `onNewIntent()`（MainActivity 用 `singleTask`，不會另開一個實例）。
 * 兩種情形都由 MainActivity 轉呼叫 [deliver] 存起來，JS 端只在自己想讀的時候
 * 呼叫 [consume]，讀完就清掉——不清的話下次隨便重開 App 都會再跳出同一筆。
 */
@CapacitorPlugin(name = "ShareReceiver")
class ShareReceiverPlugin : Plugin() {
    companion object {
        private var pendingText: String? = null

        // MainActivity 是 .java，Kotlin companion object 的方法預設不會變成 Java
        // 看得到的 static——沒有 @JvmStatic 的話 `ShareReceiverPlugin.deliver(...)`
        // 編譯不過，要嘛加這個標記、要嘛改叫 `ShareReceiverPlugin.Companion.deliver(...)`。
        @JvmStatic
        fun deliver(intent: Intent?) {
            if (intent?.action == Intent.ACTION_SEND && intent.type == "text/plain") {
                pendingText = intent.getStringExtra(Intent.EXTRA_TEXT)
            }
        }
    }

    @PluginMethod
    fun consume(call: PluginCall) {
        val result = JSObject()
        result.put("text", pendingText)
        pendingText = null
        call.resolve(result)
    }
}
