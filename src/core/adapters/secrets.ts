/**
 * 金鑰保管 adapter —— 平台各自實作
 * （Electron: `safeStorage`／Windows DPAPI；Capacitor: Android Keystore）。
 *
 * 刻意維持**同步**：現行 `secureStore.ts` 是同步的，而它被 `fileStore` 的
 * 讀寫路徑直接呼叫。改成非同步會讓整條存檔鏈都得改，風險遠大於收益。
 * Android Keystore 的封裝也能做成同步（值在記憶體中解封一次後快取）。
 *
 * 密文格式為 `enc:v1:<base64>`，桌面與手機**共用同一個前綴**，
 * 但**密文本身不可跨裝置搬移**（各裝置的金鑰不同）。
 * 這與 §4.7「API Key 永不參與雙向同步」一致。
 */
export interface SecretAdapter {
  /** 平台是否真的有安全儲存。false 時 encrypt 應原樣回傳明文並自行警告。 */
  isAvailable(): boolean

  /** 明文 → `enc:v1:...`；失敗或不可用時回傳原明文（絕不可回傳空字串）。 */
  encrypt(plain: string): string

  /**
   * `enc:v1:...` → 明文；非本格式者原樣回傳。
   *
   * ⚠️ 解密失敗時**必須回傳原本的密文**，不可回傳空字串——
   * 回傳空字串會永久毀掉使用者的金鑰。詳見 `main/secureStore.ts` 的註解。
   */
  decrypt(stored: string): string
}

/** 密文前綴。判斷「這個值是否已加密」時一律用它，不要各處寫死字串。 */
export const SECRET_PREFIX = 'enc:v1:'
