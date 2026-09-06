# 天氣主動發話 ＋ 今日初次問候（手機獨立版）— 開工指令

> 前置：`docs/weather-proactive-speech-kickoff.md`（桌面版，已完成）、
> `docs/morning-briefing-kickoff.md`（桌面版，已完成）。
> **那兩份的 §6.2「這一階先不做手機」由本文件取代。**
>
> 這份是唯一的開工依據。判斷邏輯已經寫好而且是平台無關的，
> 本階段的工作幾乎全部在「什麼時候醒來」與「醒來之後誰來跑」。

---

## 1. 這是什麼

把兩個桌面已完成的功能搬到手機獨立版：

1. **天氣主動發話** — 偵測天氣「轉變」（地震／颱風／明日降雨／變天／久違放晴），
   命中就讓角色主動講一句。
2. **今日初次問候（早安簡報）** — 今天第一次理這個 App 時，角色主動打招呼並
   帶一則當日資訊。

兩者合併成一階做，因為**它們共用同一個觸發點與同一套「對話進行中不插話」判斷**，
拆開做會把同樣的排程接線寫兩次。

### 不是什麼

- **不做背景即時地震速報。** 見 §2。
- **不自建伺服器、不接 FCM。** 見 §2。
- **不碰遙控模式。** 遙控模式下電腦那邊本來就在跑桌面版的 watcher，
  手機再跑一份等於同一件事講兩次。本功能**只在獨立模式啟用**。

---

## 2. 為什麼不接推播（這節是為了避免以後有人重提）

owner 2026-09-04 問過「民生示警 App 是去哪裡拿消息的」，調查結論如下，**已否決**：

- 台灣的公開來源是 NCDR **民生示警公開資料平台**（CAP 1.2）。它確實提供訂閱推播，
  但推播方式只有 Email／**HTTPS callback**／Atom feed —— 收件端必須是一台
  隨時在線的伺服器。
- 所以 `:posup` 那類 App 的真實架構是**自家伺服器訂閱 CAP → 轉 FCM 推給手機**。
  手機端不耗電，是因為耗電的部分搬到人家機房了。
- 這條路撞到 roadmap §2 的目標②（不另付費／無須營運後端）與③（敏感資料不放第三方），
  **直接否決**。
- Android 的「國家級警報」走**細胞廣播（PWS/CBS）**，系統直接跳，
  **App 沒有任何 API 可以程式化接收**。
- ExpTech TREM 有 client 端可直連的 WebSocket，但只有地震、是第三方民間服務，
  且手機背景長連線要靠前景服務常駐（使用者會看到一則永遠不消失的通知）。
  **成本不划算，本階段不做。**

**而且關鍵是：六種事件裡只有地震／颱風算「示警」。**
明日降雨、變天、久違放晴這三種是我們自己從預報算出來的，沒有任何來源會推給你——
那本來就得拉預報，而拉一次 CWA 就順便把地震颱風也拿到了。
推播就算接上也只能砍掉三分之一的需求，卻要多養一套完全不同的傳輸機制。

---

## 3. 觸發模型（本階段的核心）

### 3.1 成本結構（決定該省哪裡）

單次輪詢＝三個 CWA HTTP 請求、幾 KB、CPU 幾乎不可測。
**手機真正貴的是每次都要起一個 headless WebView**（因為 `diffWeatherEvents()` 是 TS，
原生層跑不了）。所以節流要節的是「起 WebView 的次數」，不是「打 API 的次數」。

另外：**只有真的偵測到事件才會呼叫 LLM**。沒有轉變的那些次不花 token。

### 3.2 兩個觸發來源

| 來源 | 頻率 | 說明 |
|---|---|---|
| **小工具 `onUpdate`** | 系統排程，目前 `updatePeriodMillis="3600000"` | **主力。** 不需要使用者做任何事 |
| **App resume** | 使用者點開 App 時 | 後備；同時是今日初次問候的觸發點 |

⚠️ **Android 沒有「小工具被看到」的回呼。** `onUpdate` 是排程觸發，跟使用者有沒有
在看主畫面無關；`onAppWidgetOptionsChanged` 只在調整大小時觸發，API 31+ 也沒補。
別去找那個事件，不存在。

但 `updatePeriodMillis` 的性質剛好對我們有利：

- 語意是「**不早於**」而不是保證，系統會批次合併多個 App 的喚醒；
- **不會為它喚醒睡眠中的裝置**，會延到裝置醒來才補跑 —— 效果上就已經很接近
  owner 要的「手機開著時才跑」；
- 下限 30 分鐘（設更小會被當成 30 分鐘）；
- 部分 OEM ROM 會額外節流（Pixel 上通常正常）。

**沒放小工具就沒有主動發話**，這是設計前提，不是 bug，要寫進設定頁說明。

### 3.3 節流

兩個來源**共用同一個最小間隔**，預設 **3 小時**。
小工具每小時醒來，但只有距上次檢查滿 3 小時才真的起 WebView（一天最多 8 次），
其餘的 tick 原生層判斷完直接返回，成本趨近於零。

判斷依據是快照裡的 `lastPolledAt`，**原生層要能自己讀到它**，
否則就得先起 WebView 才知道不用起 WebView。詳見 §5.2。

### 3.4 `onUpdate` 不能自己做這件事

`onUpdate` 跑在原生 broadcast，有大約 10 秒執行上限，塞不下 HTTP ＋ LLM。
它只做一件事：**判斷「距上次檢查夠久了嗎」，是就轉交給既有的
`ReminderForegroundService` ＋ headless WebView，然後立刻返回。**

那套機制提醒功能已經驗證過了（`android/app/src/main/java/tw/nori/dest/reminder/`），
**直接複用，不要另寫一套**。headless 入口比照
`src/mobile/headless/reminderHeadless.ts` 新增一支。

---

## 4. 地震分級（跨平台改動）

### 4.1 問題

桌面的 30 分鐘時效（`earthquakeMaxAgeMs`）夠用，是因為它 5 分鐘輪詢一次，
幾乎不可能錯過。手機是小時級觸發，**套同一個窗口的話地震會幾乎永遠過期，
這個事件類型等於白做**。

### 4.2 改法：兩段式，過期不丟掉而是降級

改 `core/weather/proactive.ts` 的地震段（目前在「地震：新編號 + 在時效內 + 震度達標」）：

| 時效 | 行為 |
|---|---|
| ≤ `earthquakeMaxAgeMs`（30 分鐘） | 現行的「剛剛發生地震」，警報語氣 |
| 30 分鐘 ~ `earthquakeStaleWindowMs` | **降級成閒聊**：「稍早發生地震⋯⋯你可能有感覺到」 |
| 超過 `earthquakeStaleWindowMs` | 丟掉 |

新增門檻欄位 `earthquakeStaleWindowMs`，**桌面與手機預設都是 6 小時**
（owner 2026-09-04 拍板）。設 `0` ＝ 關閉降級，行為回到現狀。

⚠️ **「關閉降級」不影響輪詢頻率。** 這兩件事完全獨立：輪詢決定「多快發現」，
降級窗口決定「發現了還值不值得講」。設定頁的文案不要讓使用者以為關掉會少查。

### 4.3 降級事件的剎車待遇不一樣

新鮮地震是警報，**不受靜音時段限制**（現行行為，保留）。
降級後的地震是**話題不是警報**，所以：

- **受靜音時段限制**
- **佔每日額度**
- 在 `gateProactiveEvents()` 的處理順序上**排在其他事件之後**
  （同一次輪詢同時有降級地震與明日降雨時，先讓位給後者）

實作建議：加一個新的 `WeatherEventKind`（`earthquake_stale`），
不要用 `WeatherEvent.stale?: boolean` —— 後者會讓 `KIND_TO_TOGGLE` 與剎車判斷
到處長出 `if (ev.stale)`，而 kind 本來就是這套設計的分派鍵。
`KIND_TO_TOGGLE` 裡 `earthquake_stale` 沿用 `earthquake` 這個開關
（使用者關掉地震就是兩種都不要，不需要兩個勾選框）。

### 4.4 桌面的實際影響

桌面 5 分鐘輪詢，絕大多數情況完全沒差。會踩到降級的只有：電腦剛開機／從休眠喚醒、
網路斷線後恢復、App 關掉一陣子再開。
**實際效果 = 早上開電腦時角色會提一下你睡覺時發生的地震**，這是預期中的改進。

---

## 5. 設定與狀態

### 5.1 設定分成兩類（這節照做，不要全部丟進同步）

先例：提醒同步時 `notificationDevice`／`wakeMode` 這些裝置本地狀態，
push/pull 都保留接收端原值（`CLAUDE.md` 的 S2 提醒同步那列）。天氣照抄。

| 類別 | 欄位 | 同步？ |
|---|---|---|
| **判斷品味**（兩邊該一致） | `enabled`、各事件開關、`earthquakeMinIntensity`、`rainThreshold`、`tempSwingThreshold`、`niceDayMinIntervalDays`、`dailyLimit`、`quietHours`、`shadowMode` | ✅ 進 S2 M5 同步子集 |
| **排程／耗電**（裝置本地） | 觸發來源開關（小工具／resume）、最小間隔、`earthquakeStaleWindowMs` | ❌ 不同步 |

⚠️ **`weather.proactive` 目前完全不在 `core/sync/settingsSnapshot.ts` 裡。**
這正是 `CLAUDE.md` 記過的「模組除了 enabled 還有自己的子設定容易漏」那一類坑
（M5 上線時 `weather.polish` 就漏過一次）。這次要主動補進去，**而且只補品味那半**。

裝置本地那半建議另立 `weather.proactiveLocal`（或等價命名），
**放在同步子集之外**，這樣 M5 的比對畫面不會出現「兩邊本來就該不一樣」的欄位。

### 5.2 必須落盤的狀態

桌面的 `firedTodayDate`／`firedTodayCount` 是**模組層記憶體變數**
（`main/weatherWatcher.ts`）。桌面常駐所以沒事，**手機每次 headless 都是全新程序，
不落盤的話 `dailyLimit` 等於完全失效**。

所以手機端的快照檔要比桌面多存兩個欄位：

- `firedTodayDate` / `firedTodayCount`
- `lastPolledAt`（已經有了，但 §3.3 的節流依賴它，**而且原生層要讀得到**）

原生層讀取路徑比照 `ReminderAlarmStore`／`SecureStoreReader` 的既有做法
（直接讀 app 私有目錄下的 JSON）。**不要為了讓原生讀得到而把快照搬去 SharedPreferences**
——那會變成兩份真相。若原生解析 JSON 太囉唆，可以由 TS 端在每次跑完後
額外寫一個只有 `lastPolledAt` 的極簡檔給原生看，**但要註明它是衍生檔、不是真相**。

### 5.3 `lastUserMessageAt`

`gateProactiveEvents()` 的「對話進行中 2 分鐘不插話」需要它。
headless 模式沒有 UI 狀態可問，要從檔案讀當前對話最後一則 user 訊息的時間戳。
桌面對應的是 `getLastUserMessageAtDirect()`。

---

## 6. 發話走哪條路

比照桌面：合成一則**虛擬提醒**丟給既有的發話管線，不要另寫一條。

- 桌面：`speakWeatherEventDirect()`（`main/ipcHandlers.ts`）→ `triggerReminderSpeak()`
- 手機：新增等價函式 → `src/mobile/runtime/reminderSpeak.ts`

措辭要與桌面逐字對齊 —— 同一則事件在兩台裝置聽起來不一樣就等於兩套人格
（`reminderSpeak.ts` 檔頭已經寫過這條原則）。

### 6.1 輸出到哪裡

兩個管道，**都要**：

1. **通知**（比照提醒，用既有的 `dest-reminders-v1` 那套 importance 4 channel；
   若要獨立控制可另開 channel id，注意 **channel 建好後 importance 改不動**）
2. **小工具**（`DeSTWidgetProvider.updateAll()`）—— owner 小工具常駐桌面，
   這是他實際會看到的地方。訊息本來就會寫進對話，小工具顯示的是最新訊息，
   所以理論上「什麼都不用做」，但**要確認發話後有觸發小工具更新**
   （`src/mobile/runtime/widgetBridge.ts`）。

---

## 7. 今日初次問候（早安簡報）手機版

### 7.1 現況

`core/greeting/morningBriefing.ts` 是平台無關的純函式（旗標、台北日期、
`isConversationTooRecent`），**手機直接 import 就能用，不用改**。
手機端目前**一行都沒有**。

### 7.2 差異：只有兩層

桌面是**天氣 → 行程 → 熱搜**三選一（`main/morningBriefing.ts` 的三個 layer）。
**手機獨立版沒接行事曆**（Google 授權仍只在桌面），所以是**天氣 → 熱搜兩層**。
`fetchCalendarLayer()` 的對應層直接省略，不是 bug。

### 7.3 觸發

`App resume`（`@capacitor/app` 的 `appStateChange`），與 §3.2 的 resume 來源共用。

**順序：先看有沒有天氣事件要講（比較急），沒有再看要不要今日問候。**
不要讓使用者一開 App 被連講兩句。

### 7.4 已知的坑（桌面踩過，別重演）

`main/morningBriefing.ts` 檔頭記著：功能內部代號叫「早安簡報」，
但**實際觸發時機是「今天第一次理這個 App」，不保證是早上**。
2026-09-04 owner 半夜實測抓到角色把「早安簡報」四個字照唸出來。
**塞進 prompt 的文字絕對不能寫死「早安」**，要讓角色自己依當下時間判斷問候語。

另外桌面用了一個**記憶體旗標**擋併發（磁碟旗標要等內容抓完＋講完才落盤）。
手機 resume 一天會觸發很多次，同樣需要；但 headless 與前景是不同程序，
**記憶體旗標擋不到跨程序**，要靠磁碟旗標 ＋ 寫入前再讀一次。

---

## 8. 實作順序

1. **`core/weather/proactive.ts` 的地震分級**（§4）。純函式改動，先補測試
   （新鮮／降級／過期三段各一），`npm test` 要綠。**這步做完桌面就已經受益。**
2. **設定型別與預設值**（§5.1）：`earthquakeStaleWindowMs` 進 `ProactiveThresholds`
   與 `defaultProactiveWeatherSettings()`，桌面預設 6 小時。
3. **手機端的 poll 函式**（TS）：讀設定 → `observeWeather()` → `diffWeatherEvents()`
   → `gateProactiveEvents()` → 發話。快照與每日計數落盤（§5.2）。
   這一步**先只接 resume 觸發**，不碰原生，可以在瀏覽器／`MobileST.bat [3]` 直接驗。
4. **今日初次問候**（§7）。同樣只走 resume，與第 3 步共用觸發點與順序判斷。
5. **設定頁**：手機新增天氣主動發話區塊（品味欄位）＋ 排程區塊（裝置本地欄位）。
   照 `CLAUDE.md` 的清單列慣例。
6. **S2 M5 同步子集**（§5.1）：只補品味那半，`core/sync/settingsSnapshot.ts`
   桌面手機兩邊定義要一起改（M4 `contentHash.ts` 那次雙邊漂移的坑）。
7. **原生：小工具 `onUpdate` 轉交**（§3.4）。`DeSTWidgetProvider.onUpdate` 加節流判斷
   ＋ 啟動前景服務；新增 headless 入口。**這步一定要真機驗。**
8. **影子模式觀察**（§9.3），確認頻率不煩人後才談關閉影子模式。

第 1–6 步完全不碰原生層，可以先合。第 7 步才需要打 APK。

---

## 9. 怎麼驗

### 9.1 自動測試

地震分級三段（§8 第 1 步）、節流判斷、每日計數跨程序落盤後仍正確。
`core/` 的部分走 `npm test`；手機 runtime 的部分放 `tests/mobile/`。

### 9.2 手機模擬觸發

設定頁加一顆 debug 按鈕「立即檢查一次」，比照桌面的
`triggerManualPoll()`（**記得那個 15 秒逾時保險絲，畫面卡死一次代價很大**）。
不必等 3 小時節流。

### 9.3 影子模式（最重要的一層）

`shadowMode` 預設**開著**。開著時不發話，只寫 log：

- 醒來幾次（分別來自小工具／resume）
- 真的跑幾次（節流擋掉幾次）
- 產生什麼事件、剎車擋掉哪些

觀察幾天再決定最小間隔要不要從 3 小時調整 —— **這比現在憑空猜一個數字準**。
log 位置比照桌面的 `weather-proactive-shadow.log`，手機用
`adb shell run-as tw.nori.dest cat files/...` 讀（debug build）。

### 9.4 真機待驗清單

- [ ] 小工具 `onUpdate` 真的會週期性觸發（先量實際間隔，別假設就是一小時）
- [ ] App 完全劃掉後，小工具觸發仍能起 headless 並跑完
- [ ] 節流有效：連續多次 `onUpdate` 只有第一次真的起 WebView
- [ ] 每日額度跨程序有效（連續觸發多則事件，第 4 則被擋）
- [ ] 靜音時段：降級地震被擋、新鮮地震不被擋
- [ ] 發話後小工具有更新、通知有橫幅彈出
      （⚠️ 配對的 Wear OS 手錶會把通知轉走並清掉手機那則，通知欄看不到不代表沒發出去）
- [ ] 今日初次問候一天只講一次，且半夜觸發時角色不會說「早安」
- [ ] 遙控模式下**不會**跑這套（§1）
- [ ] 耗電：連續觀察數日，電池用量頁面沒有異常

---

## 10. 已知風險

- **小工具 `onUpdate` 的實際間隔不受我們控制**，且 OEM ROM 可能節流。
  若實測發現太稀疏，備案是把 resume 的節流放寬，而不是改用 exact alarm
  （那會回到耗電問題）。
- **地震仍然不即時。** 這是本階段刻意接受的取捨（§2）。若日後 owner 覺得需要，
  再單獨評估 WorkManager 或 TREM WebSocket，**不要在本階段順手做**。
- **沒放小工具的使用者只有 resume 觸發**，主動發話會很少。設定頁要說明。
