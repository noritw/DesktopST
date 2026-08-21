import { Capacitor } from '@capacitor/core'

/**
 * QR 掃描（S1 配對用）。
 *
 * 用 ML Kit 的 **Google code scanner**（`scan()`）而不是 `startScan()`：
 * 掃碼介面由 Google Play services 提供、在我們的畫面之外跑，
 * 因此**不需要相機權限**，也不必自己做取景框與 UI。代價是需要裝置有
 * Play services，沒有時 `isSupported()` 回 false —— 呼叫端要落回手動輸入，
 * 不可以把掃碼當成唯一入口。
 *
 * 模組是隨用隨載的（Android 首次使用會下載幾百 KB），`ensureModule()` 負責等它好。
 */

export interface ScanOutcome {
  /** 掃到的原始字串，通常是 `http://192.168.x.x:3721?token=…` */
  value: string
}

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

/**
 * 叫出掃碼介面。使用者按返回／取消時回 `null`（不是錯誤，不要跳提示）。
 */
export async function scanQr(): Promise<ScanOutcome | null> {
  const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')

  const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
  if (!available) {
    await BarcodeScanner.installGoogleBarcodeScannerModule()
  }

  const { barcodes } = await BarcodeScanner.scan()
  const value = barcodes[0]?.rawValue?.trim()
  return value ? { value } : null
}

/**
 * 從 QR 內容拆出位址與權杖。
 *
 * 電腦端的 QR 就是手機網頁的網址（`http://<ip>:<port>?token=…`），
 * 所以這裡直接吃同一份，不另外定義配對格式。
 */
export function parsePairingUrl(raw: string): { baseUrl: string; token: string } | null {
  const text = raw.trim()
  if (!text) return null
  try {
    const u = new URL(text)
    if (!/^https?:$/.test(u.protocol)) return null
    const token = u.searchParams.get('token')?.trim() ?? ''
    if (!token) return null
    // 去掉 query 與結尾斜線，只留 origin＋path
    const path = u.pathname.replace(/\/$/, '')
    return { baseUrl: `${u.origin}${path}`, token }
  } catch {
    return null
  }
}
