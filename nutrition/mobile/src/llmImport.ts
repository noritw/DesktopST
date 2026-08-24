import { Capacitor } from '@capacitor/core'
import { decodeLlmExportPayload, type LlmExportPayload } from '@core/llm/exportPayload'

/**
 * 從 DeST（手機版）匯入 AI 服務設定，三種管道收斂成同一段編碼字串：
 * - 掃 QR（跨裝置，複製 DeST 手機版 `scannerAdapter.ts` 的做法，
 *   Google code scanner 不需要相機權限，沒有 Play services 就退回貼上）
 * - Android 分享面板送過來（同一支手機，見 `ShareReceiverPlugin`）
 * - 手動貼上文字（永遠可用的保底路徑）
 */

export async function isScannerAvailable(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
    const { supported } = await BarcodeScanner.isSupported()
    return supported
  } catch {
    return false
  }
}

/** 使用者按返回／取消時回 `null`，不是錯誤。 */
export async function scanQr(): Promise<string | null> {
  const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
  if (!available) await BarcodeScanner.installGoogleBarcodeScannerModule()
  const { barcodes } = await BarcodeScanner.scan()
  return barcodes[0]?.rawValue?.trim() || null
}

/**
 * 讀一次 Android 分享面板送過來、還沒被讀過的內容（見 `ShareReceiverPlugin.kt`）。
 * 原生層收到 `ACTION_SEND` 會把文字存起來，這裡讀完之後原生層會清掉，
 * 避免下次啟動又跳出同一筆——所以只能呼叫一次，不要輪詢。
 */
export async function consumePendingShare(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const core = await import('@capacitor/core')
    const plugin = core.registerPlugin<{ consume(): Promise<{ text: string | null }> }>('ShareReceiver')
    const { text } = await plugin.consume()
    return text?.trim() || null
  } catch {
    return null
  }
}

export { decodeLlmExportPayload }
export type { LlmExportPayload }
