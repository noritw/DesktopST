# 手機獨立版 —— 精準鬧鐘與沉浸式提醒實作計畫 (Mobile Standalone Reminder Plan)

> **建立時間**：2026-08-10 (2026-08-10 補充情境綁定)
> **狀態**：規格與架構已定案，待實作
> **目標**：解決獨立版手機 App 劃掉（Force Closed）或休眠時提醒無法觸發的問題，並提供低耗電、雙喚醒模式、沉浸式離線開關、情境綁定與通知歷史紀錄功能。

---

## 1. 核心需求與背景

目前的提醒排程（`src/mobile/runtime/reminderScheduler.ts`）完全依賴前端 JavaScript 的 `setTimeout()`。當使用者將 App 上滑劃掉（Force Closed）或 Android 進入休眠模式時，WebView 與計時器即被系統銷毀，導致提醒無法觸發。

此外，使用者在不同情境與使用模式（如：日常閒聊 vs TRPG 角色扮演跑團）下有不同的提醒需求：
* **日常閒聊情境**：生活作息提醒（例：提醒睡覺、吃飯、喝水）。
* **TRPG 跑團 / 冒險情境**：劇情推進提醒（例：「巨龍正在逼近！」、「勇者該回歸冒險了」）。
* **防止 OOC 破壞體驗**：若使用者正在玩 TRPG，日常生活提醒（如「去洗澡」）若以 TRPG 角色或世界觀跳出會嚴重破壞沉浸感；因此需支援**選擇性綁定特定情境 / 對話**。

---

## 2. 系統架構與運作流程

```
[使用者建立/編輯提醒] (可自訂 wakeMode, offlineFallback, sceneId, conversationId)
       │
       ▼
[前端/Native 呼叫 AlarmManager] ────> 註冊精準鬧鐘 (setExactAndAllowWhileIdle)
                                      │ (待機期間 0% 額外電量消耗，App 可被劃掉)
                                      ▼
                             [到達提醒時間 Android 發出廣播]
                                      │
                                      ▼
                         [ReminderAlarmReceiver 廣播接收器]
                                      │
               ┌──────────────────────┴──────────────────────┐
               ▼                                             ▼
    【模式 A: screen_on_only】                    【模式 B: always】
   檢查 PowerManager.isInteractive()           直接啟動 ReminderWorker (3~5s)
               │                                             │
      ┌────────┴────────┐                                   │
      ▼                 ▼                                   │
  [螢幕亮起]        [螢幕休眠]                              │
 啟動 Worker        │                                       │
                    ├─> inactiveBehavior == 'skip': 直接略過  │
                    └─> inactiveBehavior == 'notify_on_unlock':
                        等待螢幕點亮時補發                  │
                                                            │
               ┌────────────────────────────────────────────┘
               ▼
      [ReminderWorker 背景作業]
               │
               ├─> 檢查 sceneConstraint（若設為限該情境且當前情境不符則略過）
               ├─> 讀取指定的 sceneId / conversationId 之對話歷史、角色卡與 API Key
               ├─> 現場請求 LLM API 生成當下情境的角色台詞
               │
               ├─> [LLM 成功] ──> 發送 High-Priority 通知
               │
               └─> [LLM 失敗/離線]
                        │
                        ├─> allowOfflineFallback == true  ──> 發送預設通知 (帶離線小字提示)
                        └─> allowOfflineFallback == false ──> 安靜略過 (維護 100% RP 沉浸感)
                               │
                               ▼
               [將結果寫入 files/reminder_history.json]
```

---

## 3. 自訂功能選項 (User Options)

在提醒編輯介面（`ReminderEditModal`）中，提供以下自訂選項：

### 基本設定
1. **觸發喚醒模式 (`wakeMode`)**：
   * `always`（預設）：待機依然背景喚醒（適合行程、鬧鐘、重要記事）。
   * `screen_on_only`：僅手機使用中才提醒（適合提醒睡覺、休息；待機時自動略過或順延）。

2. **休眠時處理邏輯 (`inactiveBehavior`)** *(當 `wakeMode == 'screen_on_only'` 時啟用)*：
   * `skip`（預設）：直接略過，不補發過時通知，等待下次時間到。
   * `notify_on_unlock`：亮屏解鎖時補發，使用者打開螢幕解鎖時自動跳出。

3. **連線失敗/離線處置 (`allowOfflineFallback`)**：
   * `true`（預設）：允許降級發送預設通知，並附帶 `(離線模式 - API 連線失敗)` 小字說明。
   * `false`（沉浸模式）：連線失敗時安靜略過，不跳死板通知，100% 維護角色扮演沉浸體驗。

### 進階選填（情境與對話綁定）
4. **指定發話角色 (`characterId`)** *(既有欄位)*：
   * 未指定時：預設使用當前情境發話角色。
5. **綁定特定情境 (`sceneId`) & 生效條件 (`sceneConstraint`)** *(新增進階欄位)*：
   * 未綁定（預設）：隨當前使用中的情境發話。
   * 綁定指定情境：
     * `any_scene`：觸發時強制使用該綁定情境的人設與世界觀脈絡生成台詞。
     * `match_scene_only`：**僅在目前作用中情境與此情境相符時才觸發**（避開日常提醒在 TRPG 跑團時跳出造成的 OOC 破壞）。
6. **綁定特定對話 (`conversationId`)** *(新增進階欄位)*：
   * 允許指定讀取哪一則對話的歷史記憶作為 LLM Prompt 脈絡（適合用於推進特定 TRPG 故事或劇情的提醒）。

7. **提醒通知歷史紀錄 (Notification History)**：
   * 在 `ReminderSettingsSection` 增加歷史紀錄視窗/分頁。
   * 呈現項目：角色頭像、名稱、提醒標題、角色發送台詞、時間與狀態標籤。
   * 支援**單則刪除**與**一鍵清空**（帶二次確認彈窗）。

---

## 4. 資料結構變更

### 4.1 `src/core/types.ts`

```typescript
export interface Reminder {
  id: string
  characterId?: string
  label: string
  prompt: string
  schedule: ReminderSchedule
  enabled: boolean
  notificationDevice?: 'desktop' | 'mobile' | 'both'
  /** 喚醒模式：'always'=待機依然背景喚醒；'screen_on_only'=僅手機使用中才提醒 */
  wakeMode?: 'always' | 'screen_on_only'
  /** 當 screen_on_only 遇到休眠時：'skip'=直接略過；'notify_on_unlock'=下次亮屏解鎖時補發 */
  inactiveBehavior?: 'skip' | 'notify_on_unlock'
  /** 連線失敗或離線時是否允許發送預設定型文通知（false 則安靜略過，維持沉浸感） */
  allowOfflineFallback?: boolean
  /** 綁定特定情境 id（可選）；未設定則跟隨當前使用中情境 */
  sceneId?: string
  /** 情境限制：'any_scene'=強制用綁定情境發話；'match_scene_only'=僅當前作用中情境為該 sceneId 時才響 */
  sceneConstraint?: 'any_scene' | 'match_scene_only'
  /** 綁定特定對話紀錄 id（可選）；用於載入特定對話歷史推進劇情 */
  conversationId?: string
  lastTriggeredAt?: number
  createdAt: number
}

export interface ReminderHistoryItem {
  id: string
  reminderId: string
  reminderLabel: string
  characterId?: string
  characterName?: string
  characterAvatar?: string
  text: string
  status: 'success' | 'offline_fallback' | 'skipped_offline' | 'skipped_idle' | 'skipped_scene_mismatch'
  timestamp: number
  errorMessage?: string
}
```

---

## 5. Android 原生層開發細節

### 5.1 權限與 AndroidManifest.xml
* `SCHEDULE_EXACT_ALARM` (Android 12+)
* `POST_NOTIFICATIONS` (Android 13+)
* `RECEIVE_BOOT_COMPLETED` (手機重開機時重新註冊鬧鐘)

### 5.2 Java/Kotlin 原生類別
* `ReminderAlarmReceiver.java`: 廣播接收器，處理休眠判定與 `sceneConstraint` 當前情境比對。
* `ReminderWorker.java`: 背景 Worker，根據 `sceneId` 與 `conversationId` 讀取指定 JSON 脈絡發送 LLM 請求、記錄歷史並發出通知。
* `ReminderNativeBridge.java`: Capacitor Bridge，提供前後端溝通方法。

---

## 6. 接手 AI 實作步驟順序

1. **第一步（核心資料型別）**：
   修改 `src/core/types.ts`，擴充 `Reminder` 介面（新增 `sceneId`、`sceneConstraint`、`conversationId`）與 `ReminderHistoryItem` 介面。

2. **第二步（Android 原生層廣播與 Worker）**：
   在 `android/app/src/main/java/tw/nori9/dest/` 新增 Receiver 與 Worker，支援綁定情境讀取與 `match_scene_only` 比對判定。

3. **第三步（Capacitor Bridge）**：
   連通前端與 Android `AlarmManager` 介面。

4. **第四步（UI 編輯器擴充）**：
   在 `ReminderEditModal` 進階摺疊區增加「指定情境 (`sceneId`)」、「僅限目前情境時才響 (`sceneConstraint`)」與「指定對話 (`conversationId`)」選單。

5. **第五步（歷史紀錄 UI 與操作）**：
   在 `ReminderSettingsSection.tsx` 實作歷史紀錄視窗、狀態標籤顯示、單則刪除與一鍵清空功能。

6. **第六步（測試與驗證）**：
   執行 `npm test` 並編譯 APK 進行實機煙測。
