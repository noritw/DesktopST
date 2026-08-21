# 手機獨立版 —— 精準鬧鐘與沉浸式提醒實作計畫 (Mobile Standalone Reminder Plan)

> **建立時間**：2026-08-10 (2026-08-10 補充 Token 省流優化；**2026-08-11 台詞生成策略改為 headless WebView，見 §2.1**)
> **狀態**：規格與架構已定案，待實作
> **目標**：解決獨立版手機 App 劃掉（Force Closed）或休眠時提醒無法觸發的問題，並提供低耗電、雙喚醒模式、沉浸式離線開關、情境綁定與通知歷史紀錄功能。

---

## 1. 核心需求與背景

目前的提醒排程（`src/mobile/runtime/reminderScheduler.ts`）完全依賴前端 JavaScript 的 `setTimeout()`。當使用者將 App 上滑劃掉（Force Closed）或 Android 進入休眠模式時，WebView 與計時器即被系統銷毀，導致提醒無法觸發。

此外，使用者在不同情境與使用模式（如：日常閒聊 vs TRPG 角色扮演跑團）下有不同的提醒需求：
* **日常閒聊情境**：生活作息提醒（例：提醒睡覺、吃飯、喝水）。
* **TRPG 跑團 / 冒險情境**：劇情推進提醒（例：「巨龍正在逼近！」、「勇者該回歸冒險了」）。
* **防止 OOC 破壞體驗**：若使用者正在玩 TRPG，日常生活提醒（如「去洗澡」）若以 TRPG 角色或世界觀跳出會嚴重破壞沉浸感；因此需支援**選擇性綁定特定情境 / 對話**。
* **Token 省流優化**：若發話角色**未設定任何表情圖片** (`emotions` / `spriteIds` 為空），背景提醒發話時直接略過情緒標籤與情緒分類 LLM 呼叫，節省寶貴的 Token 資源。

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
      [ReminderForegroundService 起 headless WebView]
               │  （原生層只負責喚醒與發通知，不碰 prompt 組裝）
               ▼
      [WebView 載入手機版 HTML（headless 旗標）→ 既有 TS 跑一遍]
               │
               ├─> 檢查 sceneConstraint（若設為限該情境且當前情境不符則略過）
               ├─> 讀取指定的 sceneId / conversationId 之對話歷史與角色卡
               ├─> 檢查角色有無表情圖檔：無圖檔則略過情緒分類 API 呼叫 (省 Token)
               ├─> 現場請求 LLM API 生成當下情境的角色台詞（reminderSpeak.ts）
               │
               ├─> [LLM 成功] ──> 回傳原生 ──> 發送 High-Priority 通知與更新小工具
               │
               └─> [LLM 失敗/離線/逾時]
                        │
                        ├─> allowOfflineFallback == true  ──> 發送**快取台詞**
                        │                                    （見 §2.1 底線機制，帶離線小字提示）
                        └─> allowOfflineFallback == false ──> 安靜略過 (維護 100% RP 沉浸感)
                               │
                               ▼
               [將結果寫入 files/reminder_history.json]
```

---

## 2.1 台詞生成策略（2026-08-11 決議）

**結論：現場生成為主、快取為底。原生層不重寫任何 prompt 邏輯。**

### 為什麼不預先生成

owner 的實際用法是「先設好提醒 → 之後才大量跟角色互動 → 再離開 App」。
若在**建立提醒時**就把台詞生好，這段互動全部不會反映在台詞裡，等於提醒永遠停在
設定當下的脈絡。因此預先生成不能當主線。

### 為什麼不是「劃掉 App 的當下生成」

Android 沒有可靠的「使用者上滑劃掉」回呼。從最近工作清單劃掉之前 App
**早就已經 `pause`**（按 home／叫出多工那一刻就 pause 了），`onTaskRemoved`
也不保證能跑完一次 LLM 往返。可攔截的是「離開前景」，不是「劃掉」。

### 主線：到點現場生成（headless WebView）

```
AlarmManager (setExactAndAllowWhileIdle)
  → ReminderAlarmReceiver
  → startForegroundService（short service）
  → 隱藏 WebView 載入既有手機版 HTML + headless 旗標
  → 既有 reminderSpeak.ts / chat.ts 原封不動執行
  → 結果經 Bridge 回傳原生 → 發通知 → stopSelf
```

採這條路的理由：

| 好處 | 說明 |
|---|---|
| **TS 邏輯零重寫** | `core/` 那套照用，桌面與手機仍是同一份，不會漂 |
| **API Key 直接可用** | 同一個 App 的 WebView，`@aparajita/capacitor-secure-storage` 正常運作 |
| 資料層一致 | 對話歷史從 `Filesystem` 讀，與前景時完全相同 |

**不要用 `@capacitor/background-runner`**：它是獨立的 QuickJS context，
拿不到 secure storage（＝拿不到 API Key），也讀不到現有資料層，等於被迫在
那個 context 裡重造一套——正是本計畫要避開的事。

時間預算：exact alarm 觸發時系統給暫時白名單豁免，允許從廣播啟動前景服務；
WebView 冷啟 1–3 秒 ＋ LLM 2–5 秒，short service 上限 3 分鐘，很寬裕。

**已知代價**：前景服務會在通知欄短暫出現一則「正在準備提醒…」（Android 規定，
避不掉）。做得低調即可，幾秒後就被角色的話取代。

### 生不出台詞時的三層（2026-08-11 修訂）

| 情況 | 行為 |
|---|---|
| 現場生成成功 | 角色講的話 |
| 失敗、有快取 | 先前生成的角色台詞（`offline_fallback`，掛回**原本那個角色**） |
| 失敗、沒快取，`allowOfflineFallback !== false` | **樸素提醒事項**（`offline_plain`，不裝成角色在講話、不進對話） |
| 失敗、沒快取，`allowOfflineFallback === false` | 安靜略過（沉浸模式，這是那個開關的用途） |

> 原本第三層是「沉默」。實機發現那等於騙人——開關的標籤是
> 「連不上網時仍要提醒」而且預設開著，勾了卻完全沒動靜，
> 連「有件事該做」都丟了，比一則樸素通知更糟（owner 2026-08-11）。

**⚠️ 刷快取時絕不降級。** 快取只放「成功生成的角色台詞」。
把降級結果存進去會毒化它：下次真的要用底線時拿到的是上一次的樸素通知
（而且 `characterId` 是空的），狀態也會被誤記成 `offline_fallback`。
實機踩過：離線時按 HOME → 刷快取失敗 → 樸素通知被存成快取 → 觸發時就用了它。

### 底線：快取台詞只當 fallback

另存一份「最近一次生成的台詞」，在**離開前景時**（`appStateChange` → inactive）
與**對話閒置一段時間後**刷新。只在現場生成失敗（離線／API 掛掉／逾時）
且該則提醒 `allowOfflineFallback === true` 時才拿出來用；設 `false` 就安靜略過。
沿用 §3 已設計好的開關，不另發明機制。

### 實作切成 ②a／②b（2026-08-11）

headless WebView 要能生成台詞，得先解決一件事：**API Key 是用 AndroidKeyStore 的
master key 加密後存在 `settings.json` 裡的**（`secretAdapter.ts` ＋ `secretCrypto.ts`），
headless 那側必須先拿到 master key 才解得開。這讓完整的 headless 比預期重，
所以拆成兩段：

| 階段 | 內容 | 狀態 |
|---|---|---|
| **②a** | AlarmManager ＋ 開機重註冊 ＋ 發通知，內容用**離開前景時生好的快取台詞** | **已完成** |
| **②b** | headless WebView 現場生成，把台詞升級成「當下的」 | **已完成** |

②a 已經解掉最核心的問題（App 劃掉之後不會響），而且完全不碰 prompt 邏輯——
原生只拿 JS 交給它的字串去發通知。

**雙路徑防重複**：JS 計時器與原生鬧鐘會在同一刻到期。原生鬧鐘刻意慢 15 秒
（`NATIVE_ALARM_GRACE_MS`），而且 JS 在**開始生成之前**就會 `cancelNativeAlarm`。

> ⚠️ 原本寫「②b 接上後這個偏移要拿掉」，**實作後發現不成立**（2026-08-11）。
> ②b 之後兩條路徑各自都會生成，同時跑的話是兩次 LLM 呼叫，
> 而且兩個 session 會同時寫同一個對話檔、後寫的蓋掉先寫的。
> 偏移必須留著，取消也必須在生成**之前**（不是成功之後，否則生成一慢就來不及）。

### ②b 的落地重點（2026-08-11）

| 元件 | 做什麼 |
|---|---|
| `ReminderForegroundService.java` | shortService ＋ 隱藏 WebView，載 `index.html?headless=reminder&reminderId=…&screenOn=…`；45 秒逾時退回快取台詞 |
| `HeadlessBridge.java` | `window.DestHeadless`：檔案（`getFilesDir()`，與 `Directory.Data` 同一處）、master key、原生 HTTP、`complete()`、`log()` |
| `SecureStoreReader.java` | 解出 master key。**與 `@aparajita/capacitor-secure-storage` 的內部格式綁定**（`WSSecureStorageSharedPreferences`、U+0010 分隔、KeyStore alias ＝ prefixedKey），升級外掛時要回頭確認 |
| `src/mobile/headless/` | `bridge.ts`（介面與旗標）、`bridgeAdapters.ts`（Storage／Http／Secret 三個 adapter）、`reminderHeadless.ts`（入口） |
| `main.tsx` | `?headless=reminder` 時**不掛 React**，改動態 import headless 入口 |
| `session.runReminderHeadless()` | 判定→發話→歷史，與前景**共用同一組函式**，不是平行實作 |

其他決定：

- **`useCache` 旗標**：只有 TS 整條路壞掉（拿不到 adapters、例外）時才讓原生補一則快取台詞。
  「情境不符」「使用者關掉離線降級」是判定結果，TS 已經把快取考慮進去了——
  原生再自作主張補一則會讓「安靜略過」失效。
- **回到前景一定要重讀對話**（`onAppResumed`）。背景那句話是 headless 那個 session
  寫進檔案的；前景記憶體裡是舊的，不重讀的話使用者隨便送一則訊息就會存回舊版本，
  提醒講的話就消失了，看起來像「根本沒觸發」。
- headless boot 用 `{ headless: true }`：不啟動排程器、不建立對話。
  背景跑的程式碼不該默默改動使用者的資料。

### 另外兩個限制（要寫進 UI 說明，不能靜默失敗）

1. **從系統設定按「強制停止」會清掉所有 alarm**，要重開 App 才會重註冊。
   從多工上滑劃掉則不受影響（那是主要使用情境，沒問題）。
2. Android 12+ 的 `SCHEDULE_EXACT_ALARM` **要引導使用者去系統設定開**，
   不是宣告就有。第一次建立提醒時要有說明頁。

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

* `FOREGROUND_SERVICE` ＋ `FOREGROUND_SERVICE_SHORT_SERVICE`（Android 14+）

### 5.2 Java/Kotlin 原生類別

> package 是 **`tw.nori.dest`**（不是 `tw.nori9.dest`；以 `android/app/src/main/java/tw/nori/dest/` 現況為準）。
> 原生層**只做喚醒、生命週期與發通知**，所有 prompt 組裝與 LLM 呼叫都留在 TS（見 §2.1）。

* `ReminderAlarmReceiver.java`: 廣播接收器。處理 `wakeMode` 的休眠判定
  （`PowerManager.isInteractive()`），決定略過／補發／啟動服務。
* `ReminderForegroundService.java`: short foreground service。建立隱藏 WebView、
  載入手機版 HTML 並帶 headless 旗標、等 TS 回傳結果、發通知、`stopSelf()`。
  逾時（建議 45 秒）則走 §2.1 的快取 fallback。
* `ReminderBootReceiver.java`: `RECEIVE_BOOT_COMPLETED`，開機後重新註冊所有 alarm。
* `ReminderNativeBridge.java`: Capacitor Bridge。前端註冊／取消 alarm、查詢
  `SCHEDULE_EXACT_ALARM` 授權狀態並導向系統設定、headless 端回傳生成結果。

---

## 6. 接手 AI 實作步驟順序

1. **第一步（核心資料型別）**：
   修改 `src/core/types.ts`，擴充 `Reminder` 介面與 `ReminderHistoryItem` 介面。

   同時在 `reminderSpeak.ts` 側加入「快取台詞」的寫入與讀取（§2.1 底線機制），
   並在 `appStateChange → inactive` 與對話閒置時刷新。

2. **第二步（Android 原生層：Receiver 與前景服務）**：
   在 `android/app/src/main/java/tw/nori/dest/` 新增 `ReminderAlarmReceiver`、
   `ReminderForegroundService`（headless WebView）、`ReminderBootReceiver`。
   `sceneConstraint` 比對與略過情緒分類等判斷**都在 TS 那側做**，原生只負責喚醒與發通知。

3. **第三步（Capacitor Bridge）**：
   連通前端與 Android `AlarmManager` 介面，含 `SCHEDULE_EXACT_ALARM` 授權引導。

4. **第四步（UI 編輯器擴充）**：
   在 `ReminderEditModal` 進階摺疊區增加「綁定情境 (`sceneId`)」、「僅限目前情境時才響 (`sceneConstraint`)」與「綁定對話 (`conversationId`)」選單。

5. **第五步（歷史紀錄 UI 與操作）**：
   在 `ReminderSettingsSection.tsx` 實作歷史紀錄視窗、狀態標籤顯示、單則刪除與一鍵清空功能。

6. **第六步（測試與驗證）**：
   執行 `npm test` 並編譯 APK 進行實機煙測。
