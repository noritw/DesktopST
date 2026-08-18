# 飲食記錄 App —— Health 讀（B9-Health-lite）開工指令

> **建立時間**：2026-08-18。owner 決定把 Health 讀（體重／體脂、手錶當日消耗熱量）
> 從 B9c 提前到 B9b（拍照估價 LLM）之前，見 `future-nutrition-module.md` §3.5／§6／§8。
> **狀態：規劃階段，尚未寫一行程式碼、尚未真機驗證任何 API 呼叫。**
> owner 目前人在外面、要回家才能實機測試——這份文件先把架構、資料流、
> 已知風險定案，開工時照著做，遇到真的測不出來的地方再回頭改這份文件。
> **這份是給接手 AI 的完整指令，照著這份就能開工，不必先讀長文。**
> 前置：`CLAUDE.md`（尤其 §5「進行中仍會踩的坑」，Capacitor 外掛的老問題這裡幾乎都會重踩一次）、
> `docs/nutrition-module-kickoff.md`（App 骨架與資料流的既有慣例）、
> `src/core/nutrition/types.ts`／`session.ts`（現有資料模型，這次是在上面加欄位，不是重做）。

---

## 0. 一句話

**只做手機端**：飲食 App（`nutrition/mobile`）透過 Android **Health Connect**
讀體重、體脂、當日消耗熱量三種數字——體重／體脂直接寫回 `BodyProfile`
（owner 說「直接同步」）；消耗熱量**不**直接覆蓋使用者手設的 `dailyKcalLimit`，
而是像現有的「套用 TDEE 建議」按鈕一樣，算出一個「今日建議上限」讓使用者按了
才套用——這是延續規格既有硬規則（§8 第 5 點：「日上限／蛋白目標隨時手改」），
不是這次新發明的限制。**桌面完全不碰**（原因見 §1），沒有 Health Connect 或
拒絕權限時全部功能原樣可用、只是拿不到這三個數字，跟現有「Health 選配」的
定位一致。

---

## 1. 平台現實查核（開工前務必先確認，不要照舊印象假設）

這節是這次規劃跟直覺最容易對不上的地方，先講清楚，省得走去半路才發現整個
方向錯了：

### 1.1 Google Fit REST API 不能用——已經在關閉中

- Google 從 2024-05-01 起**不再開放新開發者申請** Google Fit REST API／
  Android Fit SDK，且**整條 API 線預告在 2026 年底前完全關閉**（Google 官方
  沒公布確切關閉日，但已經是「不要在這條線上蓋新東西」的狀態）。
- 這條 API 本來是唯一可能讓「桌面（沒有 Android，沒有 Google Play 服務）」
  用 REST 呼叫拿到雲端健康資料的路——它一關，**桌面就沒有直接讀 Google
  雲端健康資料的官方管道了**。
- 結論：**這次規劃完全不碰 Google Fit REST API**，也不要為桌面另外設計一條
  走這個 API 的路徑，那是蓋在快關閉的地基上。
- 來源：[Google Fit Migration FAQ（Android Developers）](https://developer.android.com/health-and-fitness/health-connect/migration/fit/faq)、
  [Release Notes | Google Fit](https://developers.google.com/fit/rest/v1/reference/releases)

### 1.2 Health Connect 是「手機本機資料層」，不是雲端服務

- **Health Connect 只存在於 Android 手機上**，是同一支手機上各 App
  （體重計 App、Fitbit、Samsung Health、Wear OS 的 Health Services…）
  互相分享健康資料的**本機共用資料庫**，不是 Google 的雲端服務、沒有
  REST API、桌面／Windows 完全碰不到。
- Android 14 以上：Health Connect 是系統內建的一部分（設定裡看得到，
  裝置上一定有，不能被解除安裝）。
- Android 13 以下：Health Connect 是 Play Store 上的**獨立 App**，使用者
  要先自己裝（或我們的 App 偵測到沒裝時導去 Play Store）。
- 來源：[Check Health Connect availability](https://developer.android.com/health-and-fitness/health-connect/availability)、
  [About Health Connect integration to Android 14](https://support.google.com/android/answer/14119325)

### 1.3 對這次規劃的實際影響

| 項目 | 現實 | 這次的做法 |
|---|---|---|
| 手機讀體重／體脂／消耗熱量 | 可行，走 Health Connect（本機） | **做**，見 §2、§3 |
| 桌面直接讀「雲端」健康資料 | **沒有官方管道**（Fit REST API 快關了，Health Connect 是手機本機的） | **不做**。桌面這次維持純手動輸入 `BodyProfile`，不新增任何 Health 相關程式碼 |
| 桌面「間接」拿到手機同步下來的數字 | 技術上可行（例如手機把 Health Connect 讀到的值塞進既有的搬家包 N1 匯出／匯入），但那是「手動搬一次」，不是「同步」 | **這次不做**，只在 §7「不做」列出來、留給以後真的要做跨裝置同步時再設計（跟 owner 之前否決「雲端同步後端」的原則一致——見 CLAUDE.md §3「已否決、不要重提」） |
| owner 這次真正要用的裝置 | 從「手錶當日消耗熱量」「體重體脂雲端資料」的描述看，**主要使用情境是手機**（手錶資料本來就要先經過手機上的某個 App 才會進 Health Connect） | 把手機做好即可滿足自用需求；桌面的 `BodyProfile` 保持手動編輯，兩邊本來就是各自獨立的資料（跟 App 是獨立安裝包的既有決定一致） |

**開工時第一步要跟 owner 確認的事實性問題**（不是設計選擇，是「到底有沒有資料」
的問題，AI 自己猜不出來，見 §8）：手錶跟體重計實際上是透過哪個 App 把資料
寫進 Health Connect 的（Wear OS 內建的健康服務？Fitbit App？小米/華米？
其他品牌 App？）——這決定了 Health Connect 裡查不查得到資料，以及「今日」
的資料多久會從手錶同步到手機（有些 App 是即時、有些要打開該 App 才同步，
這會直接影響「今日消耗熱量」數字準不準、新不新）。

---

## 2. 這次的範圍

### 2.1 做

1. **手機讀 Health Connect** 三種紀錄：
   - 體重（`WeightRecord`）
   - 體脂率（`BodyFatRecord`）
   - 當日消耗熱量（`TotalCaloriesBurnedRecord`，若裝置/來源 App 沒寫這個，
     退回用 `ActiveCaloriesBurnedRecord` 疊加估計的 BMR——細節見 §3.3）
2. **權限請求流程**：App 內有明確的「連接 Health」開關（**預設關**，延續規格
   §3.5「Health 選配，兩層，皆預設關」），開啟時才跳系統權限對話框；
   沒開的使用者完全不受影響、不彈任何 Health 相關提示。
3. **體重／體脂**：讀到就直接寫回 `BodyProfile.weightKg`／`bodyFatPercent`
   （owner 明講「直接同步」），並記錄「上次從 Health 同步時間」給使用者看。
   使用者仍可在身體資料表單手動覆蓋——手動編輯之後**不會**被下一次自動同步
   立刻蓋回去；同步時機與覆蓋規則的細節開放問題見 §5.2。
4. **消耗熱量 → 今日建議上限**：算出一個「今日參考熱量上限」，比照現有
   「套用 TDEE 建議」按鈕的互動模式（算給你看、你按了才套用），**不自動
   覆寫** `dailyKcalLimit`。算法本身是這次唯一需要 owner 先拍板的設計問題，
   見 §5.1，開工前務必先確認，不要自己選一個公式就開始寫。
5. **Health Connect 未安裝／未授權／查無資料**時的空狀態文案，功能其餘部分
   （手動輸入、關鍵字入帳等）完全不受影響——這是延續規格「模組本體不依賴
   Health」的既有硬規則。

### 2.2 不做（這次的邊界，不要順手做超過）

- **Health 寫**（把飲食 log 寫回 Health Connect／手錶）——維持在 B9c，
  這次只做讀。
- **桌面任何 Health 相關程式碼**——理由見 §1.3。
- **跨裝置同步**（手機讀到的值自動出現在桌面）——見 §1.3 表格。
- **iOS／HealthKit**——這個 App 目前沒有 iOS 版本，不在範圍內。
- **拍照估價 LLM（B9b）**——雖然這次插隊排到它前面，但兩者是各自獨立的
  工作項，這份文件不涉及 B9b 的任何實作。
- **把消耗熱量／體重數字餵進角色聊天**——規格 §3.3 本來就講明「角色只吃
  偏好，不吃營養數字」，Health 數字比營養數字更敏感，一樣不注入。

---

## 3. 架構決定

### 3.1 資料流

```
手錶／體重計等來源 App（Fitbit／Samsung Health／Wear OS Health Services…）
        │  各自 App 自己的同步機制（不是這次要做的事）
        ▼
   Health Connect（手機本機資料庫）
        │  我們的 App 用 Capacitor 外掛讀（唯讀權限）
        ▼
  nutrition/mobile 的 HealthAdapter（新介面，見 §3.2）
        │
        ▼
  core/nutrition/health.ts 的純函式（比對、換算、決定要不要更新 BodyProfile）
        │
        ▼
  NutritionSession（既有的 saveBodyProfile，不用新增 session 方法）
```

**手動同步為主，不做背景常駐輪詢**：App 開啟時（或使用者按「立即同步」）
才查一次 Health Connect，寫回 `BodyProfile` 後正常走既有的
`state-invalidated` 事件更新畫面。**不**在背景排程定時輪詢——這跟現有
「不做背景定時抓新聞」的既有決定（`CLAUDE.md` §6「新聞報」列的「不做」）
是同一種取捨：手機背景任務本身就麻煩（電池最佳化、Doze 模式），這個功能
的急迫性不需要背景輪詢，App 開啟時同步一次已經滿足「自己要看今天的數字」
的需求。

### 3.2 core 新增 `HealthAdapter` 介面（比照既有的 `StorageAdapter`／`HttpAdapter`）

`src/core/adapters/` 目前已經有 `StorageAdapter`／`HttpAdapter`／
`SchedulerAdapter`／`NotifierAdapter`／`SecretAdapter` 這一套「core 只認
介面，平台各自實作」的慣例（`src/core/adapters/index.ts` 檔頭註解講得很
清楚：「`core/` 的邏輯一律透過這些介面碰外界，不直接碰 `fs` / `electron` /
平台 API」）。這次新增 `HealthAdapter` 照同一個模式：

```ts
// src/core/adapters/health.ts（新檔，比照 storage.ts／http.ts 的寫法）
export interface HealthSnapshot {
  weightKg?: number
  bodyFatPercent?: number
  /** 今天（裝置本地時區）的總消耗熱量估計，Health Connect 查不到時整個欄位省略。 */
  totalCaloriesBurnedToday?: number
  /** 資料實際的時間戳（不是查詢當下的時間）——用來判斷資料新不新鮮，見 §6 坑 4。 */
  measuredAt: number
}

export interface HealthAdapter {
  /** 這個平台/裝置能不能用 Health（例如手機才 true，桌面永遠 false）。 */
  isAvailable(): Promise<boolean>
  /** 目前是否已經有讀取權限（不會跳系統對話框）。 */
  hasPermission(): Promise<boolean>
  /** 跳系統權限對話框；使用者拒絕時回傳 false，不要 throw。 */
  requestPermission(): Promise<boolean>
  /** 讀一次快照；沒有權限或查無資料的欄位省略，不要用 0 或 null 假裝有資料。 */
  readSnapshot(): Promise<HealthSnapshot>
}
```

**只有 `nutrition/mobile` 有真的實作**（走 §3.3 選定的 Capacitor 外掛）；
桌面完全不 import 這個介面，`nutrition/desktop` 的程式碼裡不應該出現
`HealthAdapter` 字樣。

要不要放進共用的 `src/core/adapters/`（跟 DeST 主體共用檔案）還是放
`src/core/nutrition/` 底下自己一份：**建議放 `src/core/adapters/`**，
跟其餘 adapter 介面放一起，方便維護慣例一致；但因為只有飲食 App 用得到，
放 `src/core/nutrition/` 底下自成一個 `health.ts` 也說得通，**開工時挑一個
就好，不用為此糾結**（`nutrition-module-kickoff.md` §9 的既有態度：卡在
次要問題就照常識選一個，不要為此停工）。

### 3.3 Capacitor 外掛選擇

**這次規劃只列出候選，不釘死版本**——外掛生態變動快，開工當下務必重新
查證維護狀態（是否還在更新、issue 回應速度、支援的 Capacitor 主版本），
不要照抄這份文件列的版本號：

- `@capgo/capacitor-health`——同時支援 Apple HealthKit（iOS）與 Health
  Connect（Android）的統一 API，維護活躍。這個 App 目前沒有 iOS 版，用不到
  它的 HealthKit 那半邊，但統一 API 通常代表文件與範例比較完整。
- 其餘社群外掛（`capacitor-health-connect` 系列，多個 fork）——部分是
  Health Connect 專用、不含 iOS，可能更輕量，但要注意有些 fork 更新間隔
  很長，開工時檢查一下最後一次發布時間跟開著的 issue。

選擇標準（開工時實際比較，不要只看星數）：
1. 支援讀 `WeightRecord`／`BodyFatRecord`／`TotalCaloriesBurnedRecord`（或
   等價的原生型別名稱）。
2. 支援目前專案的 Capacitor 主版本（查 `nutrition/mobile/package.json`
   的 `@capacitor/core` 版本）。
3. 型別宣告完整（TS 專案，介面裡有 `any` 太多會拖慢後續開發）。

**放進 `dependencies`，不是 `devDependencies`**——這是 `CLAUDE.md` §5 已經
記錄過的坑（Capacitor 外掛要能在 build 產物裡），這次新加的外掛一樣要注意。

**外掛一律動態 `import()` 載入**（`CLAUDE.md` §5 既有規則），理由跟現有
`@capacitor/geolocation`／`@capacitor/app` 用法一致：瀏覽器煙測、vitest
都不該在載入時就因為原生外掛不存在而炸掉。`HealthAdapter` 的手機實作
（例如 `nutrition/mobile/src/adapters/health.ts`）內部才 `import()` 這個
外掛，`isAvailable()` 在瀏覽器/桌面環境下直接回傳 `false`。

### 3.4 AndroidManifest.xml 與權限宣告

比照 `CLAUDE.md` §5 已經記錄的坑（`@capacitor/geolocation` 的權限不會自動
合併進 manifest）：**這次新外掛的權限多半也要自己手動寫進
`nutrition/mobile/android/app/src/main/AndroidManifest.xml`**，開工時
不要假設外掛的 Gradle 腳本會自動處理，裝進手機實測一次才算數。

需要的權限（實際名稱以外掛文件為準，Health Connect 的權限字串大致是這個
形狀）：
- `android.permission.health.READ_WEIGHT`
- `android.permission.health.READ_BODY_FAT`
- `android.permission.health.READ_TOTAL_CALORIES_BURNED`
- 如果 §3.1 決定要疊加估計，還需要 `android.permission.health.READ_ACTIVE_CALORIES_BURNED`

另外 Android 14+ 要求在 manifest 裡宣告一個
`<intent-filter>`／`android:value` 指向「隱私權政策」頁面，說明為何要讀
健康資料（Health Connect 的權限流程比一般 Android 權限多一道審查／揭露
要求）——開工時查 Health Connect 官方文件當時最新的宣告方式，這塊 Google
的要求偶爾會調整。

---

## 4. 資料模型變動

`src/core/nutrition/types.ts` 的 `BodyProfile` 加兩個可選欄位（不是破壞性
變更，舊資料沒有這兩個欄位時當作「從沒同步過」）：

```ts
export interface BodyProfile {
  // ...現有欄位不動...
  /** 體重／體脂上次從 Health Connect 同步的時間；手動編輯不會更新這個欄位。 */
  healthSyncedAt?: number
  /** 這次同步時 Health Connect 回報的資料時間戳（見 §6 坑 4，用來判斷資料新不新鮮）。 */
  healthMeasuredAt?: number
}
```

**不要**把「今日參考熱量上限」存進 `BodyProfile`——那是每天會變的**衍生值**，
比照 `buildDailyView()` 的模式，用一個 core 純函式現算現用
（`core/nutrition/health.ts` 或 `dailyView.ts` 加一個
`suggestTodayKcalLimit(bodyProfile, healthSnapshot): number | null`），
不要在資料模型裡多存一個容易跟 `dailyKcalLimit` 搞混、又要記得每天清掉的
欄位。

`NutritionAppSettings` 加一個開關（延續「Health 選配預設關」）：

```ts
export interface NutritionAppSettings {
  llm: NutritionLlmSettings
  // 新增：
  health?: {
    enabled: boolean // 預設 false／未定義視為 false
  }
}
```

---

## 5. 開工前一定要先問 owner、不要自己拍板的設計問題

### 5.1 「今日建議熱量上限」怎麼算——這是本次唯一真正的設計決策

現有 `calculateTdeeKcal()`（`src/core/nutrition/tdee.ts`）已經用
`activityLevel`（久坐／輕度／中度／高度／非常高度）當乘數估算 TDEE。如果
Health Connect 的「今日消耗熱量」也疊加在這個估算之上，**會重複計入活動量
兩次**（一次是使用者自選的活動量係數、一次是手錶實際量到的消耗）。有兩種
合理做法，**開工時要先讓 owner 選一個，不要自己選**：

| 做法 | 算法 | 特性 |
|---|---|---|
| A：手錶資料整個取代當日的 TDEE 估算 | `今日建議上限 = calculateGoalAdjustedKcal(健康資料的 TotalCaloriesBurnedToday, goal)`，`BodyProfile.activityLevel` 對「今日建議值」不再生效（但仍用在「沒有手錶資料的日子」的靜態 TDEE 備援） | 最準，但「今日建議上限」會隨手錶資料每天浮動，使用者可能覺得「怎麼一直在變」 |
| B：手錶資料只補足「額外消耗」的差額 | `今日建議上限 = 靜態 TDEE（維持原本活動量估算）+ max(0, 手錶當日消耗 − 靜態 TDEE 裡活動量那部分的估計值)` | 邏輯上更保守，但額外消耗的估計值要另外拆算，複雜一截、還是有雙重計算的風險 |

**目前傾向 A**（比較單純、跟 owner 原話「熱量上限直接抓手錶當日記錄消耗熱量」
的字面意思更接近），但這是使用者體感層面的決定，開工時務必用一句話跟 owner
確認再動手，不要悶頭寫。

### 5.2 體重／體脂「直接同步」跟手動編輯衝突時怎麼辦

owner 說「直接同步」，但如果使用者在同步之後、下次自動同步之前，自己在
身體資料表單手動改了體重呢？兩個候選規則，開工時一併確認：

- **規則一（建議）**：每次同步（App 開啈或按「立即同步」）都直接覆蓋
  `weightKg`／`bodyFatPercent`，不管使用者中間有沒有手動改過——因為
  Health Connect 的資料本來就代表「最新量測值」，手動編輯的意義比較接近
  「這次先手動填一下，之後同步會蓋過去」，跟現有 TDEE 那條「隨時手改」
  規則的精神不同（那條是「系統只給建議，最終數字由使用者決定」；這次體重
  同步是「系統就是資料來源」）。
- **規則二**：手動編輯之後標記一個「已手動覆蓋」旗標，下次自動同步時跳過，
  除非使用者自己按「重新從 Health 同步」——實作起來多一個狀態要處理。

### 5.3 Health Connect 未安裝時要不要主動導去 Play Store

Android 13 以下裝置沒有 Health Connect 時，是要主動彈「請安裝 Health
Connect」帶去 Play Store，還是只在設定頁靜靜顯示「這個功能需要 Health
Connect，目前偵測不到」？前者比較主動、但等於要求使用者為了一個非核心
功能多裝一個系統元件；後者比較保守。這次因為使用者只有 owner 自己，
**開工前直接問 owner 手機是哪個 Android 版本、需不需要這段引導**，
比預先設計一套通用流程更省事。

---

## 6. 已知會踩的坑（先寫在這裡，省得重踩）

沿用 `CLAUDE.md` §5 已經記錄過的 Capacitor 通病，這次幾乎都會再踩一次：

1. **`timeout` 選項不保證兌現**（`CLAUDE.md` §5 已記錄 `Geolocation` 的
   同款問題）——`requestPermission()`／`readSnapshot()` 沒權限或裝置忙碌時
   可能永遠不 `resolve`，外面要自己包一層計時器（`Promise.race`），不要信
   外掛自帶的 timeout 參數。
2. **絕對不要讓 async function 直接 `return` Capacitor 外掛物件本身**——
   `CLAUDE.md` §5 記錄過 `Geolocation.then()` 那個經典坑（plugin proxy 把
   任何屬性存取當成原生方法呼叫，`await` 直接卡死）。`HealthAdapter` 的
   手機實作一樣要包一層：`return { plugin: mod.HealthConnect }`，不要
   `return mod.HealthConnect`。
3. **權限被拒絕不是錯誤，是正常分支**——使用者第一次可能就是不給權限，
   `requestPermission()` 回 `false` 時 UI 要走「功能維持關閉、顯示可以
   之後再到系統設定開權限」的路徑，不要當成例外拋出打斷整個 App。
4. **Health Connect 的資料是「來源 App 寫入的時間」，不是「查詢當下」**：
   手錶如果很久沒跟手機同步（例如手錶沒戴、藍牙斷線、來源 App 好幾天沒開），
   Health Connect 裡可能是三天前的舊資料，`readSnapshot()` 要老實回報
   `measuredAt`，UI 上「今日消耗熱量」旁邊要顯示資料實際的時間，**不要**
   讓使用者誤以為那是即時數字。如果 `measuredAt` 不是今天，§5.1 的公式
   要有對應退回（沒有今天的資料就退回靜態 TDEE，不要拿舊資料當「今日」算）。
5. **「今日」的邊界用裝置本地時區**，比照現有 `nowOnDate()`／
   `toIsoDateString()`（`nutrition/mobile/src/main.tsx`、
   `core/nutrition/dailyView.ts`）已經在用的模式，不要另外發明一套時間
   判斷邏輯，兩處對不上使用者會覺得「昨天的紀錄跑到今天」。
6. **Health Connect 不支援 Work Profile（公司雙開帳號）裝置**——這個機率
   低（owner 自用機器），但如果真機測試時發現权限一直要不到，先確認手機
   有沒有開雙開/工作設定檔，省得白繞。
7. **`llm.provider` 那類「改設定要同步鏡像欄位」的坑這裡不會發生**——
   Health 開關是全新欄位、沒有舊鏡像需要顧，提這點只是提醒：**新增
   `NutritionAppSettings.health` 時不需要模仿 `CLAUDE.md` §5 那條
   `llm.endpoint` 鏡像同步的坑，那是另一個問題，這裡沒有對應複雜度**。

---

## 7. 建議實作順序（每步都能獨立驗證）

| 步驟 | 內容 | 驗證方式 |
|---|---|---|
| ① | 跟 owner 確認 §5 三個開放問題（尤其 §5.1 算法），以及手錶/體重計實際寫入 Health Connect 的來源 App 是什麼 | 一句話回覆即可，不是等真機才能做的事 |
| ② | 選定 Capacitor 外掛（§3.3），裝進 `nutrition/mobile`，`dependencies` 不是 `devDependencies` | `npm run build:nutrition:mobile` 過；先不接任何 UI |
| ③ | `src/core/adapters/health.ts`（或 `core/nutrition/health.ts`）定義 `HealthAdapter`／`HealthSnapshot` 介面 | 純型別，`npm run typecheck` 過 |
| ④ | `core/nutrition/` 純函式：`suggestTodayKcalLimit()` 等，餵假的 `HealthSnapshot` 驗證 §5.1 選定的公式 | `tests/core/nutrition/health.test.ts`，覆蓋「有今日資料」「資料是舊的」「完全沒資料」三種情況 |
| ⑤ | `BodyProfile`／`NutritionAppSettings` 型別加欄位（§4），`saveBodyProfile` 等既有 session 方法不用改 | `npm run typecheck`；既有 `tests/core/nutrition/*` 不能壞 |
| ⑥ | 手機端 `HealthAdapter` 實作（動態 `import()`，AndroidManifest 權限，§3.4） | 先只加一個除錯用的按鈕呼叫 `readSnapshot()`，`console.log` 結果，裝到手機上跑一次 |
| ⑦ | 設定頁「連接 Health」開關＋權限請求流程＋空狀態文案（§2.1 第 2、5 點） | 手動測：關閉時完全不彈任何 Health 提示；開啟時走一次完整授權流程 |
| ⑧ | 身體資料頁接上「立即同步」按鈕＋上次同步時間顯示（§2.1 第 3 點） | 真機：改手錶/體重計那邊的資料、等它同步進 Health Connect、在 App 裡按同步，確認數字跟時間戳都對 |
| ⑨ | 每日快覽／身體資料頁加「今日參考熱量上限」顯示＋套用按鈕（§2.1 第 4 點，不自動覆寫） | 真機：確認 `dailyKcalLimit` 不按「套用」不會變 |
| ⑩ | 全部串起來後，補 §6 那幾個坑各自的防禦（timeout 包裝、拒絕權限分支、資料新鮮度判斷） | 真機：拔藍牙/關來源 App 讓資料變舊，確認 UI 誠實顯示舊資料而不是裝作最新 |

每步 `npm run typecheck` 與 `npm test` 都要過（跟現有慣例一致，兩個分開跑）。

---

## 8. 完工判準（B9-Health-lite）

- [ ] 「連接 Health」開關預設關，關閉時 App 其餘功能完全不受影響、不彈
      任何 Health 相關對話框
- [ ] 開啟後走一次系統權限流程，拒絕權限時 UI 給出合理的下一步指引
      （不是白屏或原始錯誤訊息）
- [ ] 手動按「立即同步」能把 Health Connect 目前的體重／體脂寫回
      `BodyProfile`，並顯示「上次同步」時間
- [ ] 手錶當日消耗熱量能算出「今日參考熱量上限」並顯示，**不按套用不會
      覆蓋** `dailyKcalLimit`
- [ ] Health Connect 資料是舊的（非今日）時，UI 誠實標示、不假裝是即時值
- [ ] Health Connect 未安裝／裝置不支援時，功能自然降級成看不到 Health
      相關 UI（或顯示引導文案），不會讓 App 打不開或報錯
- [ ] 桌面（`nutrition/desktop`）完全沒有新增 Health 相關程式碼
- [ ] `npm run typecheck`、`npm test` 全過
- [ ] 真機驗證：Pixel 或 owner 自己的手機，實際走一輪「開權限→同步體重→
      看今日建議熱量上限」

---

## 9. 完工後要更新的文件

- `docs/future-nutrition-module.md` §3.5／§6：把「B9-Health-lite」從
  「排程中」改成打勾，補實際落地跟規劃不同的地方（尤其 §5.1 最後選了
  哪個公式）
- `CLAUDE.md` §4 現況表：加一行
- `docs/progress-log.md`：照慣例補一筆，含真機驗證結果
- `TODO.md`：更新完成狀態

---

## 10. 給接手 AI 的一句話總結

這次規劃的核心是**平台事實**：Google Fit REST API 快關了、Health Connect
是手機本機資料層不是雲端服務，所以桌面這次完全不碰，只做手機端讀取。
體重／體脂「直接同步」寫回 `BodyProfile`，但熱量上限比照現有 TDEE 按鈕的
互動模式——算給你看、按了才套用，不要因為「同步」兩個字就自動覆寫使用者
手改過的上限，那違反規格既有的硬規則。開工第一步是找 owner 確認 §5 的
開放問題（尤其 §5.1 的算法選擇），不是直接開始寫程式碼。
