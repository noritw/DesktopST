/**
 * Health adapter —— 只有飲食記錄 App 的手機端（`nutrition/mobile`）有真的實作
 * （走 Android Health Connect）。桌面（`nutrition/desktop`）不 import 這個介面，
 * 也不應該出現任何 Health 相關程式碼——桌面沒有官方管道讀雲端健康資料
 * （Google Fit REST API 已在關閉中，Health Connect 是手機本機資料層）。
 * 細節見 `docs/nutrition-health-lite-kickoff.md` §1。
 *
 * 手機外的呼叫端（瀏覽器煙測、桌面、vitest）一律拿到 `isAvailable() → false`
 * 的實作，其餘方法不會被呼叫。
 */
export interface HealthSnapshot {
  weightKg?: number
  bodyFatPercent?: number
  /**
   * 「今天凌晨到查詢當下」這段區間的累計消耗熱量（不是全天預估，是已經
   * 發生的實際量測值）。查不到時整個欄位省略，呼叫端不要用 0 假裝有資料。
   */
  caloriesBurnedSoFarToday?: number
  /**
   * 資料實際的時間戳（來源 App 寫入 Health Connect 的時間，不是查詢當下）。
   * 用來判斷資料新不新鮮——手錶很久沒同步時這裡可能是好幾天前。
   */
  measuredAt: number
}

export interface HealthAdapter {
  /** 這個平台/裝置能不能用 Health（手機才可能 true，桌面／瀏覽器永遠 false）。 */
  isAvailable(): Promise<boolean>
  /** 目前是否已經有讀取權限（不會跳系統對話框）。 */
  hasPermission(): Promise<boolean>
  /** 跳系統權限對話框；使用者拒絕時回傳 false，不要 throw。 */
  requestPermission(): Promise<boolean>
  /** 讀一次快照；沒有權限或查無資料的欄位省略。 */
  readSnapshot(): Promise<HealthSnapshot>
  /**
   * 查詢某個過去日期（裝置本地時區的整天，`dateIso` 格式同 `toIsoDateString()`）
   * 的累計消耗熱量。跟 `readSnapshot()` 的 `caloriesBurnedSoFarToday` 不同——
   * 這裡查的是「已經過完的一整天」，不是「到查詢當下」，呼叫端不需要再做
   * 剩餘時間外推。查無資料或沒有權限時回傳 `undefined`，不要用 0 假裝有資料。
   */
  readDailyCaloriesBurned(dateIso: string): Promise<number | undefined>
  /** 寫入權限（獨立於讀取權限，是不同的授權範圍）目前是否已經有（不會跳系統對話框）。 */
  hasWritePermission(): Promise<boolean>
  /** 跳系統寫入權限對話框；使用者拒絕時回傳 false，不要 throw。 */
  requestWritePermission(): Promise<boolean>
  /**
   * 寫入一筆熱量攝取紀錄到 Health（Health Connect 的 `NutritionRecord`，
   * `startDate`／`endDate` 都用 `atMs`）。**只能寫熱量**——外掛的 `saveSample`
   * 沒有暴露蛋白質／脂肪／碳水欄位，不是這裡刻意省略。呼叫端負責避免重複寫入
   * （這支只管寫一次，沒有 update／delete，寫兩次就是兩筆）。沒有權限或寫入失敗
   * 回傳 `false`，不要 throw。
   */
  writeCalories(kcal: number, atMs: number): Promise<boolean>
}
