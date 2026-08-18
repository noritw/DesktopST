# 飲食記錄 App —— Health 讀（B9-Health-lite）開工指令

> **建立時間**：2026-08-18；同日 owner 回覆 §5 三個開放問題（三個開關＋動態
> 熱量上限公式），§5 已改成「已拍板」定案內容，不再是開放問題。
> owner 決定把 Health 讀（體重／體脂、手錶當日消耗熱量）
> 從 B9c 提前到 B9b（拍照估價 LLM）之前，見 `future-nutrition-module.md` §3.5／§6／§8。
> **狀態：規劃階段，尚未寫一行程式碼、尚未真機驗證任何 API 呼叫。**
> owner 目前人在外面、要回家才能實機測試——這份文件先把架構、資料流、
> 已知風險定案，開工時照著做，遇到真的測不出來的地方再回頭改這份文件。
> **規格取捨原則（owner 原話）**：這是做給自己用、但免費公開的 App——
> **以 owner 自己能跑最優先**，其他環境（例如手錶不是 Health Connect
> 相容）留擴充空間（就是 §3.2 的 `HealthAdapter` 介面）但**不必實作**，
> 別人規格不同就請他們自己拿這份文件跟程式碼去給 AI 改，**不要為了遷就
> 未知的其他裝置去增加這次的設計複雜度**。
> **這份是給接手 AI 的完整指令，照著這份就能開工，不必先讀長文。**
> 前置：`CLAUDE.md`（尤其 §5「進行中仍會踩的坑」，Capacitor 外掛的老問題這裡幾乎都會重踩一次）、
> `docs/nutrition-module-kickoff.md`（App 骨架與資料流的既有慣例）、
> `src/core/nutrition/types.ts`／`session.ts`（現有資料模型，這次是在上面加欄位，不是重做）。

---

## 0. 一句話

**只做手機端**：飲食 App（`nutrition/mobile`）透過 Android **Health Connect**
讀體重、體脂、當日消耗熱量三種數字。使用者用**三個開關**控制（§2.1、§5 已定案）：
要不要接 Health Connect、要不要自動同步（開 App／小工具顯示時 vs. 手動按鈕）、
要不要讓手錶消耗熱量動態決定今日熱量上限。體重／體脂一經同步就直接寫回
`BodyProfile`（owner 說「直接同步」）；熱量上限則是**開了才動態顯示**、
沒開或今天沒有手錶資料時完全維持使用者手設的 `dailyKcalLimit` 不變——
延續規格既有硬規則（§8 第 5 點：「日上限／蛋白目標隨時手改」），不是這次
新發明的限制。**桌面完全不碰**（原因見 §1），三個開關預設全關時全部功能
原樣可用、不彈任何 Health 相關提示，跟現有「Health 選配」的定位一致。

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

### 2.1 做：三個使用者可控的開關（owner 2026-08-18 定案）

設定頁三顆開關，**由上到下有依賴關係**——下面的開關在上面沒開時直接隱藏
或顯示為不可互動（不要讓使用者以為三個是平行選項）：

| # | 開關 | 預設 | 關閉時 | 開啟時 |
|---|---|---|---|---|
| 1 | **和 Health Connect 同步** | 關 | App 行為完全不變，不彈任何 Health 相關提示、看不到開關 2、3 | 顯示開關 2、3；開啟當下才跳系統權限對話框 |
| 2 | **自動同步** | 開（開關 1 開啟之後的預設值，未定案細節可開工時再跟 owner 對一次） | App 開啟／小工具顯示**不會**自動打 Health Connect；改顯示一顆「手動同步」按鈕，按了才更新 | 每次 App 開啟或小工具顯示（見下方备註）自動讀一次最新資料 |
| 3 | **以手錶消耗熱量做為當日上限** | 關 | 完全用手動輸入的 `dailyKcalLimit`，跟現在行為一樣 | 有今天的手錶資料時，今日上限**動態顯示**算出來的值（算法見 §5.1）；沒有手錶或今天沒資料時自動退回手動輸入值 |

> 小工具目前還沒做（飲食 App 的 Android 小工具是 B9b 範圍，這裡只是先把
> 「小工具顯示時也算一次自動同步」這個介面設計進去，**開工當下小工具還
> 不存在，這條先不用真的實作，等 B9b 做小工具時再接上**）。

1. **手機讀 Health Connect** 三種紀錄：
   - 體重（`WeightRecord`）
   - 體脂率（`BodyFatRecord`）
   - 當日累計消耗熱量（`TotalCaloriesBurnedRecord`，查「從今天凌晨到現在」
     這段區間的累計值，不是全天預估——細節見 §5.1、§6 坑 4）
2. **權限請求流程**：只有開關 1 打開時才跳系統權限對話框；開關 1 關閉的
   使用者完全不受影響、不彈任何 Health 相關提示。
3. **體重／體脂**：每次同步（不管是開關 2 的自動同步、還是關閉自動同步時
   按的手動同步按鈕）都直接寫回 `BodyProfile.weightKg`／`bodyFatPercent`
   （owner 明講「直接同步」），並記錄「上次從 Health 同步時間」給使用者看。
   因為同步永遠是使用者自己開啟或按下才會發生（見 §5.2），不需要另外處理
   「跟手動編輯衝突」——每一次同步本身就代表使用者這次要更新資料。
4. **消耗熱量 → 今日上限**：開關 3 開啟時，今日熱量上限**動態顯示**算出來的
   值（不是按鈕套用、也不寫回 `BodyProfile.dailyKcalLimit`——那個欄位永遠是
   使用者手設的靜態值，動態值只在畫面上現算現顯示，見 §4、§5.1 的公式）。
5. **Health Connect 未安裝／未授權／查無資料**時的空狀態文案，功能其餘部分
   （手動輸入、關鍵字入帳等）完全不受影響——這是延續規格「模組本體不依賴
   Health」的既有硬規則。**不主動導去 Play Store**（owner 2026-08-18 定案，
   見 §5.3）。

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

**同步永遠由前景事件觸發，不做背景常駐輪詢**：開關 2（自動同步）開啟時，
「App 開啟」「小工具顯示」都是**前景事件**（App 被打開、小工具被系統重繪）
觸發的一次性查詢，不是我們自己起一個背景服務定時打 Health Connect——這跟
現有「不做背景定時抓新聞」的既有決定（`CLAUDE.md` §6「新聞報」列的
「不做」）是同一種取捨：手機背景任務本身就麻煩（電池最佳化、Doze 模式），
App／小工具本來就會在使用者互動或系統既有的重繪週期觸發，不需要額外自己
輪詢。開關 2 關閉時退化成使用者按「手動同步」按鈕才查一次。查完寫回
`BodyProfile` 後正常走既有的 `state-invalidated` 事件更新畫面。

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
  /**
   * 「今天凌晨到查詢當下」這段區間的累計消耗熱量（不是全天預估，是已經
   * 發生的實際量測值），查詢時用 Health Connect 的 aggregate API 查
   * [今日 00:00 裝置本地時區, now) 這段區間。查不到時整個欄位省略。
   */
  caloriesBurnedSoFarToday?: number
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

### 3.4 AndroidManifest.xml 與權限宣告——**已查證，跟原本假設不同**

> **2026-08-18 動工時更新**：這節原本比照 `@capacitor/geolocation` 的坑，
> 假設要手動把權限寫進我們自己的 `AndroidManifest.xml`。實際打開
> `node_modules/@capgo/capacitor-health` 的 manifest 後發現**這個外掛已經
> 完整宣告了所有 Health Connect 權限**（含 `READ_WEIGHT`／`READ_BODY_FAT`／
> `READ_TOTAL_CALORIES_BURNED`，以及 `<queries>` 宣告與 Android 14+ 需要的
> `PermissionsRationaleActivity`／`ViewPermissionUsageActivity`），會透過
> 標準 Android Gradle 的 manifest merger 自動併入我們的 App——**這次不需要
> 手動加任何 `<uses-permission>`**，跟 geolocation 那個外掛（manifest 是空的）
> 情況不同，不要照抄。這件事還是要在真的組 APK（Gradle build）時才會真正
> 驗證 merge 有沒有生效，`cap sync` 本身不會觸發 manifest merge。

**隱私權政策頁面**：外掛要求 App 提供隱私權政策頁，Health Connect 權限對話框
裡「Privacy policy」連結會顯示它。做法（README Option 1）：把 HTML 放在
`android/app/src/main/assets/public/privacypolicy.html`——因為這個專案是
Vite 專案，正確做法是放進 **`nutrition/mobile/src/public/privacypolicy.html`**
（Vite 的 `publicDir`，`root` 設定是 `src`），`npm run build:nutrition:mobile`
會自動複製進 `www/`，`cap sync` 再複製進 Android assets，這樣每次重建
都不會被清掉。已建立好這個檔案，內容照實描述讀哪些資料、用途、資料不上傳。

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

**不要**把「今日動態熱量上限」存進 `BodyProfile`——那是每天、甚至每小時都會變的
**衍生值**，比照 `buildDailyView()` 的模式，用一個 core 純函式現算現用，
不要在資料模型裡多存一個容易跟 `dailyKcalLimit` 搞混、又要記得清掉的欄位：

```ts
// core/nutrition/health.ts（新檔）
/**
 * 開關 3 開啟時的今日動態熱量上限（§5.1 公式）。
 * `now` 用參數注入，不要在純函式裡呼叫 Date.now()（跟現有測試慣例一致，
 * 可注入固定時間驗證）。沒有今日資料（healthSnapshot.measuredAt 不是今天，
 * 或整個 caloriesBurnedSoFarToday 缺欄位）時回傳 null，呼叫端退回
 * bodyProfile.dailyKcalLimit。
 */
export function suggestTodayKcalLimit(
  bodyProfile: BodyProfile,
  healthSnapshot: HealthSnapshot,
  now: number
): number | null
```

`NutritionAppSettings` 加三個開關（對應 §2.1 表格，延續「Health 選配預設關」）：

```ts
export interface NutritionAppSettings {
  llm: NutritionLlmSettings
  // 新增：
  health?: {
    /** 開關 1：總開關，預設 false／未定義視為 false。 */
    connected: boolean
    /** 開關 2：App／小工具顯示時自動查一次；關閉則只能手動按同步。 */
    autoSync: boolean
    /** 開關 3：今日熱量上限是否用 §5.1 公式動態算，而不是固定用 dailyKcalLimit。 */
    useWatchCalorieLimit: boolean
  }
}
```

---

## 5. 三個設計問題——owner 2026-08-18 已拍板，直接照做

> 這節原本是「開工前要問 owner」的開放問題，owner 已經回覆，內容改成定案
> 記錄。三個問題其實是同一組設計（§2.1 的三個開關），這裡補完整算法與細節。

### 5.1 「今日熱量上限」怎麼算——已拍板

**公式（owner 原話換算成算式）**：

```
今日動態上限 = 今天已消耗的熱量（Health Connect 累計值，到查詢當下為止）
             + 今天剩餘時間（到 23:59）× 靜止代謝率的每小時消耗量
```

owner 舉的例子：現在已消耗 1187 kcal，距離 23:59 還剩約 5.5 小時，
上限 = `1187 + 5.5 × 靜止不動時每小時消耗的熱量`。

換成程式碼概念：

```ts
const hoursRemaining = hoursUntil2359(now) // 裝置本地時區，比照 nowOnDate() 的日期邊界
const restingKcalPerHour = calculateBmr(bodyProfile) / 24 // 現有 tdee.ts 的 BMR 公式，直接重用
const todayDynamicLimit = healthSnapshot.caloriesBurnedSoFarToday + hoursRemaining * restingKcalPerHour
```

要點：

- **重用既有的 `calculateBmr()`**（`src/core/nutrition/tdee.ts`），不需要新寫
  代謝率公式——這正是「靜止不動時每小時消耗的熱量」，`BMR / 24`。
- **`caloriesBurnedSoFarToday` 是「已經發生」的量測值**，不是全天預估——
  來自 Health Connect 的 `TotalCaloriesBurnedRecord`，查
  `[今日 00:00 裝置本地時區, now)` 這段區間的累計。這跟原本規劃版本的
  「今日總消耗預估」是不同概念，`HealthAdapter`／`HealthSnapshot` 的欄位
  名稱已經在 §3.2、§4 改成 `caloriesBurnedSoFarToday` 反映這點。
- **有意不套用 `activityLevel` 活動量乘數、也先不套用 `calculateGoalAdjustedKcal()`
  的目標調整比例**——owner 的算法是直接把「已消耗＋預計靜止消耗」當上限，
  隱含的意思是「今天燃燒多少就大概能吃多少」，不是先套一層減重/增重的
  百分比折讓。**這點如果要加目標調整（例如減重要打 85%），開工時再跟
  owner 確認一次**，這份文件先照 owner 原話的字面公式實作，不要自己多加
  一層調整。
- **回傳 `null` 的情況**：`healthSnapshot.measuredAt` 不是今天、或
  `caloriesBurnedSoFarToday` 整個缺欄位時，`suggestTodayKcalLimit()` 回傳
  `null`，UI 顯示手動輸入的 `dailyKcalLimit`，並可以加一行小字說明
  「今天沒有手錶資料，顯示手動設定的上限」（呼應 §2.1 開關 3 的「自動退回
  手動輸入值」）。
- **這個值只在畫面上現算現顯示**，不寫回 `BodyProfile.dailyKcalLimit`（§4
  已經講過），所以會隨著一天過去、`caloriesBurnedSoFarToday` 增加、
  `hoursRemaining` 減少而持續變動，最終收斂到「今天實際總消耗」——這是
  設計上刻意的行為，不是要修的 bug。

### 5.2 體重／體脂「直接同步」跟手動編輯衝突——已拍板（用開關 2 解決，不需要額外規則）

owner 沒有另外設計「誰贏」的規則，而是用**開關 2（自動同步）**從源頭解決：
同步永遠是使用者主動觸發的（自動同步開著時是「App 開啟／小工具顯示」這種
使用者自己造成的前景事件；關閉時是使用者自己按「手動同步」）。**既然每一次
同步都代表使用者這次要更新資料，就不需要額外的「跟手動編輯衝突時怎麼辦」
規則**——直接覆蓋即可（原本規劃的「規則一」），因為「同步發生」這件事本身
已經隱含使用者的同意，跟一般背景自動同步覆蓋使用者不知情的編輯是不同情境。

### 5.3 Health Connect 未安裝時要不要主動導去 Play Store——已拍板：不用

owner 直接回覆「不用」。Android 13 以下沒有 Health Connect 時，設定頁靜靜
顯示「這個功能需要 Health Connect，目前偵測不到」即可，**不要**跳出導去
Play Store 的彈窗或提示。（owner 手機實際是哪個 Android 版本、有沒有內建
Health Connect，開工前用一句話確認即可，不影響這條「不主動導去」的決定。）

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
   讓使用者誤以為那是即時數字。如果 `measuredAt` 不是今天，§5.1 的
   `suggestTodayKcalLimit()` 回傳 `null`，UI 退回開關 3 關閉時本來就會用的
   `dailyKcalLimit`（不是退回某個靜態 TDEE 估算——這個功能沒有另外算一個
   TDEE 備援，就是直接用使用者手設的上限，見 §5.1 最後一點）。
5. **`TotalCaloriesBurnedRecord` 的區間查詢要抓「今日 00:00 到 now」，不是
   「單一天的紀錄」**：Health Connect 的紀錄型別本身可能是多筆分段寫入
   （來源 App 每次同步寫一段），要用 aggregate API 對區間**加總**，不是
   直接讀一筆「今天的總量」欄位——開工時查當時 Health Connect／外掛文件
   實際的 aggregate 呼叫方式，不要假設有一個現成的「今日累計」欄位可以
   直接讀。
6. **「今日」的邊界用裝置本地時區**，比照現有 `nowOnDate()`／
   `toIsoDateString()`（`nutrition/mobile/src/main.tsx`、
   `core/nutrition/dailyView.ts`）已經在用的模式，不要另外發明一套時間
   判斷邏輯，兩處對不上使用者會覺得「昨天的紀錄跑到今天」。
7. **Health Connect 不支援 Work Profile（公司雙開帳號）裝置**——這個機率
   低（owner 自用機器），但如果真機測試時發現權限一直要不到，先確認手機
   有沒有開雙開/工作設定檔，省得白繞。
8. **`llm.provider` 那類「改設定要同步鏡像欄位」的坑這裡不會發生**——
   Health 開關是全新欄位、沒有舊鏡像需要顧，提這點只是提醒：**新增
   `NutritionAppSettings.health` 時不需要模仿 `CLAUDE.md` §5 那條
   `llm.endpoint` 鏡像同步的坑，那是另一個問題，這裡沒有對應複雜度**。

---

## 7. 建議實作順序（每步都能獨立驗證）

| 步驟 | 內容 | 驗證方式 |
|---|---|---|
| ① | 跟 owner 確認手錶/體重計實際寫入 Health Connect 的來源 App 是什麼、開關 2 的預設值要不要跟這份文件的建議（開）一致 | 一句話回覆即可，§5 的三個設計問題已經拍板不用再問 |
| ② | 選定 Capacitor 外掛（§3.3），裝進 `nutrition/mobile`，`dependencies` 不是 `devDependencies` | `npm run build:nutrition:mobile` 過；先不接任何 UI |
| ③ | `src/core/adapters/health.ts`（或 `core/nutrition/health.ts`）定義 `HealthAdapter`／`HealthSnapshot` 介面 | 純型別，`npm run typecheck` 過 |
| ④ | `core/nutrition/` 純函式：`suggestTodayKcalLimit()`（§5.1 公式，重用 `calculateBmr()`） | `tests/core/nutrition/health.test.ts`，覆蓋「有今日資料」「資料是舊的（回傳 null）」「完全沒資料」三種情況，另外驗證公式本身（例如餵 owner 那組 1187 kcal／5.5 小時的例子） |
| ⑤ | `BodyProfile`／`NutritionAppSettings` 型別加欄位（§4，三個開關＋兩個同步時間戳），`saveBodyProfile` 等既有 session 方法不用改 | `npm run typecheck`；既有 `tests/core/nutrition/*` 不能壞 |
| ⑥ | 手機端 `HealthAdapter` 實作（動態 `import()`，AndroidManifest 權限，§3.4） | 先只加一個除錯用的按鈕呼叫 `readSnapshot()`，`console.log` 結果，裝到手機上跑一次 |
| ⑦ | 設定頁三個開關的 UI（§2.1 表格，開關 1 關閉時隱藏 2、3；開關 2 決定顯示自動同步或手動同步按鈕）＋權限請求流程＋空狀態文案（不主動導去 Play Store，§5.3） | 手動測：開關 1 關閉時完全不彈任何 Health 提示；開啟時走一次完整授權流程 |
| ⑧ | 身體資料頁接上同步（自動或手動視開關 2）＋上次同步時間顯示（§2.1 第 3 點） | 真機：改手錶/體重計那邊的資料、等它同步進 Health Connect、在 App 裡觸發同步，確認數字跟時間戳都對 |
| ⑨ | 每日快覽／身體資料頁：開關 3 開啟時把「今日上限」換成 `suggestTodayKcalLimit()` 動態顯示（不寫回 `dailyKcalLimit`），沒有今日資料時退回顯示手動值 | 真機：確認 `BodyProfile.dailyKcalLimit` 本身完全不會被動態值覆蓋；把開關 3 關掉能立刻退回原本的固定上限 |
| ⑩ | 全部串起來後，補 §6 那幾個坑各自的防禦（timeout 包裝、拒絕權限分支、資料新鮮度判斷、aggregate 區間查詢） | 真機：拔藍牙/關來源 App 讓資料變舊，確認 UI 誠實顯示舊資料而不是裝作最新 |

每步 `npm run typecheck` 與 `npm test` 都要過（跟現有慣例一致，兩個分開跑）。

---

## 8. 完工判準（B9-Health-lite）

- [ ] 開關 1（連接 Health）預設關，關閉時 App 其餘功能完全不受影響、不彈
      任何 Health 相關對話框、看不到開關 2、3
- [ ] 開啟開關 1 後走一次系統權限流程，拒絕權限時 UI 給出合理的下一步指引
      （不是白屏或原始錯誤訊息）
- [ ] 開關 2 開啟時 App 開啟會自動同步；關閉時改顯示手動同步按鈕，不按
      不會更新
- [ ] 同步（不管自動或手動）能把 Health Connect 目前的體重／體脂寫回
      `BodyProfile`，並顯示「上次同步」時間
- [ ] 開關 3 開啟、且今天有手錶資料時，今日上限顯示 `suggestTodayKcalLimit()`
      算出的動態值；開關 3 關閉，或今天沒有手錶資料時，顯示的是
      `BodyProfile.dailyKcalLimit` 本人，**這個欄位本身永遠不會被動態值
      覆寫**
- [ ] Health Connect 資料是舊的（非今日）時，UI 誠實標示、不假裝是即時值
- [ ] Health Connect 未安裝／裝置不支援時，功能自然降級成看不到 Health
      相關 UI（或顯示偵測不到的文案），**不彈 Play Store 導引**，也不會
      讓 App 打不開或報錯
- [ ] 桌面（`nutrition/desktop`）完全沒有新增 Health 相關程式碼
- [ ] `npm run typecheck`、`npm test` 全過
- [ ] 真機驗證：owner 自己的手機，實際走一輪「開三個開關→同步體重→看今日
      動態熱量上限」，並驗證 owner 那組「1187 kcal／5.5 小時」量級的例子
      算出來的數字合理

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
使用者用三個開關控制（§2.1、§5，owner 已拍板）：連接 Health、自動同步或
手動同步、要不要讓今日熱量上限跟著手錶動態算。體重／體脂只要同步發生就
直接覆蓋 `BodyProfile`（同步本身就是使用者觸發的，不需要額外的衝突規則）；
熱量上限的公式是「今天已消耗＋剩餘時間 × 靜止代謝率」（§5.1，直接重用
`calculateBmr()`），且**只在畫面上動態顯示，不寫回** `BodyProfile.dailyKcalLimit`
——那個欄位永遠是使用者手設的靜態值。owner 的取捨原則：這是做給自己用、
免費公開的 App，**以 owner 自己的裝置能跑最優先**，`HealthAdapter` 介面
留擴充空間但不用照顧其他手錶生態，別人規格不同就是他們自己拿去改。
開工第一步是跟 owner 確認 §7 步驟①剩下的兩個小問題（來源 App、開關 2
預設值），不是重新討論 §5 那三個已經拍板的設計問題。
