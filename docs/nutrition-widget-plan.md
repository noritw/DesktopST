# 飲食記錄 App —— Android 桌面小工具設計文件 (Nutrition Widget Plan)

> **建立時間**：2026-08-21
> **狀態**：**已實作，自動測試通過，真機部分驗證**（2026-08-21）。§9 七步全做完，
> Pixel 10a 裝機驗證了 App 啟動、三個深連結導覽、重新整理 broadcast 不 crash；
> **沒驗到的**：把小工具真的拖上主畫面看三種尺寸實際排版（owner 主畫面被自訂
> 桌布/小工具塞滿，找不到空白處安全長按，留給 owner 自己找時間試）。
> 實作跟本文件的差異：檔案結構多了一支 `NutritionWidgetBridgePlugin.kt`
> （最小 Capacitor 外掛，JS 沒辦法直接發 Android broadcast，存檔／App 離開前景
> 這兩個更新時機要靠它跳回原生層呼叫 `NutritionWidgetProvider.updateAll()`）；
> 點擊行為沒有走自訂 intent scheme 常數，而是沿用 Capacitor 產生的
> `custom_url_scheme` 字串資源＋`@capacitor/app` 的 `getLaunchUrl()`／`appUrlOpen`
> 標準深連結模式。專案原本是純 Java，這次加了 Kotlin 工具鏈，版本對齊
> `@capgo/capacitor-health` 已在用的 2.4.10（`android/build.gradle` 同時設
> `kotlinVersion`／`kotlin_version` 兩個 property 名字，因為不同 Capacitor 外掛
> 各自讀不同名字，混版會出現「compiled with an incompatible version of
> Kotlin」）。
> **對象**：`nutrition/mobile/`（獨立飲食記錄 App，`applicationId: tw.nori.destnutrition`），
> **不是** DeST 主 App 小工具（那份是 `docs/mobile-android-widget-plan.md`，兩者原生專案完全分開）

---

## 1. 需求（owner 原話）

小工具上顯示：

1. 目前攝取熱量／熱量上限
2. 目前攝取蛋白質／每日期望蛋白質
3. 拍照記錄按鈕（相機圖示）→ 點下去直接進入 AI 拍照估算頁面並開啟相機
4. 快速記錄按鈕（鉛筆圖示）→ 點下去直接進入快速入帳頁面

尺寸：**多尺寸自適應**。
更新時機（2026-08-21 owner 定案，取代下方 §3 原本的 A/B 待選）：
1. 使用者存入飲食記錄時（新增／編輯／刪除 MealLog）
2. 使用者離開 App（背景／關閉）時——**App 跟小工具不會同時使用**，
   所以「離開時同步一次」等同於「回頭看小工具時資料是新的」
3. 小工具上放一顆小的「重新整理」按鈕，**使用者主動按了才即時重抓**；
   沒按就維持顯示既有資料，不做背景輪詢
4. 小工具本身**不做其他操作**，三個按鈕（相機／鉛筆／重新整理）之外，
   點其餘區域一律進 App

---

## 2. 資料來源（已確認，不用另做 Bridge）

飲食 App 完全本機存檔，Capacitor `Directory.Data` 在 Android 上就是
`context.filesDir`，檔案是**攤平的 JSON**（見 [storage.ts](../src/core/nutrition/storage.ts)）：

```
files/body-profile.json   # BodyProfile：dailyKcalLimit、dailyProteinGoalG
files/food-items.json     # FoodItem[]：perServing.kcal / proteinG
files/meal-logs.json      # MealLog[]：eatenAt、foodItemId、servings、override
files/settings.json       # NutritionAppSettings（含 health 子物件）
```

**原生層可以直接讀這四個檔案**，不需要 App 前景時特地 push 一份快照到
`SharedPreferences`——這點跟 DeST 主 App 那份小工具計畫書（角色對白／便利貼）不同，
那邊資料只存在 JS 記憶體裡才需要 Bridge，這邊資料本來就落地成檔案。

今日合計的算法照抄 [aggregation.ts](../src/core/nutrition/aggregation.ts) 的
`aggregateDailyNutrition()`：篩 `eatenAt` 落在今天（用裝置本地時區的年月日）的
`MealLog`，用 `override` 覆蓋或退回 `FoodItem.perServing` 算熱量／蛋白質總和。
**這段邏輯要在 Kotlin side 重寫一份**（沒有 JS runtime 可以呼叫 core），
是這個小工具最大的維護風險——見 §7 的踩坑預告。

### 2.1 熱量上限：靜態 vs Health 動態

`bodyProfile.dailyKcalLimit` 是靜態上限。若使用者開了「手錶消耗熱量當上限」
（`settings.health.useWatchCalorieLimit`），App 前景時會用
[health.ts](../src/core/nutrition/health.ts) 的 `suggestTodayKcalLimit()`
即時算一個動態上限（已消耗＋剩餘時間 × BMR/24），**這個數字目前完全不落地**，
只存在 `main.tsx` 的 React state。

小工具沒有能力自己重算這個（要嘛重新實作 Health Connect 查詢＋BMR 公式，
要嘛等 App 算完寫檔）。**這版小工具先只支援靜態上限**：
- `useWatchCalorieLimit` 關閉時：小工具顯示 `bodyProfile.dailyKcalLimit`，跟 App 內一致。
- 開啟時：小工具退回顯示靜態 `dailyKcalLimit`，但在上限數字旁加一個小提示
  （例如淡化处理或加註記），避免使用者誤以為那是含手錶動態調整的即時上限。
- 之後要接動態上限，见 §8「暫不做」。

---

## 3. 更新時機（已定案）

原本考慮過「解鎖即時更新」，但 Android 8（API 26）起
`ACTION_USER_PRESENT`／`ACTION_SCREEN_ON` 這類「隱含廣播」**不能用
`AndroidManifest.xml` 靜態註冊接收**（省電限制，全機不分廠牌），真要做到
「解鎖當下更新」需要一個常駐 `ForegroundService`（Android 8+ 前景服務必須顯示
持續通知），成本／體感都不划算，**owner 拍板不做**，改用下面三個觸發點——
剛好也對齊「App 跟小工具不會同時使用」這個前提，不需要背景輪詢：

1. **存入飲食記錄時**：App 內任何 MealLog 新增／編輯／刪除存檔成功後，
   立刻 `AppWidgetManager.updateAppWidget()` 推一次。
2. **App 離開前景時**：`App.addListener('appStateChange')` 偵測到
   `isActive: false`（背景或被關閉前）時推一次——這是「回頭看小工具」前
   最後一次能確保資料新鮮的時機。
3. **小工具上的「重新整理」按鈕**：使用者主動按下才即時重讀四個 JSON 檔重算，
   沒按就維持顯示既有資料，**小工具本身完全不做背景輪詢／排程**。
   `AppWidgetProvider.onUpdate()` 的系統排程週期可以設保守值（例如 1 小時）
   當作保底，但不是主要更新路徑。

小工具上除了相機／鉛筆兩個入口按鈕，再加**第三個小圖示：重新整理**
（比照 §4 版面，窄尺寸可能要跟另外兩個按鈕共用一行或退到最小可視大小）。
點小工具其餘區域一律進 App，**小工具本身不提供除了這三顆按鈕以外的任何操作**。

---

## 4. 小工具尺寸與版面（多尺寸自適應）

用 Android 12（API 31）的 Responsive Layout：`AppWidgetProviderInfo` 用
`targetCellWidth`/`targetCellHeight` 宣告最小網格，讓使用者可自由拖拉調整大小
（`resizeMode="horizontal|vertical"`），API 31+ 用
`RemoteViews(Map<SizeF, RemoteViews>)` 依實際尺寸挑對應排版；API 26–30
（本專案 `minSdkVersion` 已是 26，見 [nutrition-health-lite-kickoff.md](nutrition-health-lite-kickoff.md)）
退化用 `onAppWidgetOptionsChanged()` 讀 `OPTION_APPWIDGET_MIN_WIDTH` 手動判斷寬度切換 layout。

三種斷點（寬度用 dp 概估，對齊 Android 標準 1 格 ≈ 70dp）：

> **⚠️ 2026-08-22 owner 逐尺寸定案後，下表已經不準，以原始碼為準**
> （`res/layout/widget_nutrition_{narrow,medium,wide}.xml` 的檔頭有完整說明）：
>
> | 版面 | 尺寸 | 內容 |
> |---|---|---|
> | `narrow` | 2x1（矮又窄） | **不顯示標籤**，空間全給數字；按鈕圓形**直排** |
> | `medium` | 3x1／4x1（矮而寬） | 標籤移到**數字左邊**；按鈕圓形**並排**；沒有進度條 |
> | `square` | 2x2（夠高但窄） | 標籤在上、**按鈕移到最底下一列**讓數字吃整個寬度；**進度條放在標籤同一行的右邊**（垂直零成本） |
> | `wide` | 4x2 以上（夠高夠寬） | 標籤在上、**有進度條**、按鈕**直排**且隨尺寸縮放 |
>
> 按鈕與圖示大小一律由 `buttonSizeDp()`／`applyButtonSizes()` 依**寬高兩者**算
> （`setViewLayoutWidth/Height` ＋ `setViewPadding`）。**放大邊框時內距一定要跟著放大**，
> 否則圖示會撐滿整個圓看起來像溢出；**大小也一定要看寬度**，否則 2x2 會被按鈕擠掉文字。
>
> 數字字級由 `valueTextSizeSp()` 算，**高度與寬度兩個上限取小的**——只看高度會算出
> 「高度放得下、寬度卻塞不進」的字級，尾巴就被 ellipsize 吃掉（owner 回報的
> 「2x2 上限數字被卡掉」）。上下限那行是大數字的 `SUFFIX_RATIO`（0.45）倍，
> **估算字寬與實際設定共用同一個常數，不可以各寫各的**。
>
> 想用真實資料看版面（小工具只顯示今天，常常是 0）→ progress-log 2026-08-22
> 「怎麼用真實資料測小工具版面」有安全的操作順序與還原驗證方式。
>
> **進度條只在最大尺寸出現**——一格高只有 60～90dp，多兩條就會把數字擠爆。
> 完整版一整欄需要 `82 + 2×數字高度`，所以 `BREAKPOINT_TALL_HEIGHT_DP = 140`，
> 字級由 `valueTextSizeSp()` 反推。**這條公式跟版面 XML 綁死，改一邊就要改另一邊**
> ——沒同步正是 owner 兩度回報「數字被裁掉」的原因。
>
> 另外兩個 API 實機驗證後**確定不用**（細節見 progress-log 2026-08-22）：
> `RemoteViews(Map<SizeF, …>)`（系統挑選規則不直覺，373×204dp 時挑了中版而非
> 完整版）與 `autoSizeTextType`（RemoteViews 裡不會正確重算，實機上蛋白質數字
> 整個不顯示）。現在**自己讀 options、自己挑版面**，字級由
> `valueTextSizeSp(heightDp)` 給。真機除錯：`adb logcat -s NutritionWidget`
> 會印出「實際幾 dp → 挑了哪個版面」。

**版面原則（2026-08-21 owner 追加）：重新整理按鈕要跟相機／鉛筆分開放，
不能緊鄰**——記帳／拍照是常按的主要動作，重新整理是偶爾才按的次要動作，
挨在一起容易手滑誤按。統一規則：相機／鉛筆兩個主要入口維持成組並排，
**重新整理獨立放在小工具的另一個角落**（例如數字區塊那一角，跟主要按鈕組
保持一段間距），窄尺寸空間不夠時寧可讓重新整理圖示縮到最小、甚至退到只佔
一個角落的極小點擊區，也不要跟主要按鈕擠在一起。

| 斷點 | 約略格數 | 內容 |
|---|---|---|
| **窄（2x1）** | ≤ 2 格寬 | 兩行文字：`熱量 攝取/上限`、`蛋白 攝取/目標`；右側相機／鉛筆兩個主要按鈕並排；**重新整理縮到左上角一個小圖示**，跟主要按鈕組不相鄰 |
| **中（3x1～4x1）** | 3–4 格寬、1 格高 | 一行擺兩組數字（熱量、蛋白質並排）＋ 最右側相機／鉛筆兩個主要按鈕；**重新整理放在最左側或數字區塊上方**的獨立小圖示 |
| **寬（4x2 以上）** | ≥ 4 格寬、≥ 2 格高 | 兩組數字各自一行、附簡易進度條（超標變色，比照桌面版「紅字」慣例）＋ 底部或右側相機／鉛筆主要按鈕（可放大）；**重新整理放在小工具右上角**，跟主要按鈕群明顯分開 |

三種都遵守 §3（視覺）硬規則：扁平圓潤、薄荷／天藍主色、無厚陰影／毛玻璃／尖角。
背景用 App 目前的配色 token（讀 `src/mobile/ui/theme.ts` 對應色票，若飲食 App
是獨立配色再確認一次）。

---

## 5. 點擊行為

- **相機圖示**：`PendingIntent` 帶 extra（例如 `dest_nutrition_action=photo`）
  啟動 `MainActivity`，App 啟動時偵測這個 extra，直接導覽到拍照估算頁並呼叫
  既有的「開啟相機」邏輯（複用 [imageInput.ts](../nutrition/mobile/src/imageInput.ts)
  既有流程，不重寫）。
- **鉛筆圖示**：同樣模式，extra 帶 `dest_nutrition_action=quick-entry`，導覽到
  快速入帳頁面。
- **重新整理圖示**：**不啟動 App**，`PendingIntent` 直接指向
  `NutritionWidgetProvider` 自己（`ACTION_NUTRITION_WIDGET_REFRESH` 自訂
  broadcast action），`onReceive()` 收到後呼叫 `NutritionWidgetDataReader`
  重讀四個 JSON 檔、重算、更新 RemoteViews——全程停留在小工具，使用者不會被
  跳去 App。
- **小工具其餘區域（數字部分）**：點擊開 App 到「每日飲食列表」（今天）。
- 四個 `PendingIntent`（相機／鉛筆／重新整理／其餘區域）都用
  `FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE`。
- App 端要在冷啟動（`onCreate`）與已在背景被喚醒（`onNewIntent`）兩條路徑都處理
  相機／鉛筆的 extra，否則「App 已開著、只是在背景」時點小工具會回到上次畫面
  而不是導覽過去。重新整理不涉及 App，不受這個問題影響。

---

## 6. 原生元件與檔案結構（比照主 App 小工具計畫書慣例）

```
nutrition/mobile/android/app/src/main/java/tw/nori/destnutrition/widget/
  NutritionWidgetProvider.kt      # onUpdate / onAppWidgetOptionsChanged / 點擊 PendingIntent
  NutritionWidgetDataReader.kt    # 讀 4 個 JSON 檔、重算今日合計（aggregation.ts 的 Kotlin 版）
  NutritionWidgetRemoteViews.kt   # 依尺寸組 RemoteViews（三種斷點）

nutrition/mobile/android/app/src/main/res/
  layout/widget_nutrition_narrow.xml
  layout/widget_nutrition_medium.xml
  layout/widget_nutrition_wide.xml
  xml/widget_nutrition_info.xml   # AppWidgetProviderInfo：targetCellWidth/Height、resizeMode
```

`AndroidManifest.xml` 註冊 `NutritionWidgetProvider`（`<receiver>` +
`ACTION_APPWIDGET_UPDATE` **與** 自訂的 `ACTION_NUTRITION_WIDGET_REFRESH`
兩個 intent-filter + `meta-data` 指到 `widget_nutrition_info.xml`）。
不需要前景服務、不需要額外權限。

---

## 7. 已知風險 / 之後會踩的坑（先寫在這裡，省得重踩）

- **Kotlin 版今日合計邏輯會跟 `core/nutrition/aggregation.ts` 漂移**：
  兩邊各自維護一份「今天」判定＋加總公式，改動 core 那份（例如換時區判定方式、
  改 override 優先序）務必回來同步這份 Kotlin 版。之後若小工具愈做愈重，
  可以考慮把這段邏輯抽成一份「跨語言規格測試」（兩邊餵同一組 fixture 比對輸出），
  但 MVP 先手動同步。
- **`Directory.Data` 對應 `filesDir` 是 Capacitor Filesystem 現在的行為**，
  若之後 Filesystem 外掛版本升級改了對應目錄，原生層讀檔路徑要跟著確認。
- **多尺寸自適應在 API 26–30 上是手動判斷寬度**，不像 API 31+ 有系統選圖，
  斷點數字要抓寬鬆一點（不同launcher 格子寬度不完全一致），避免文字被裁切。
- **「App 離開前景時同步」需要 Capacitor `App` plugin 的 `appStateChange`
  事件**（`isActive: false`），要用動態 `import()`（專案慣例，見 CLAUDE.md §5
  「外掛一律用動態 import() 載」），且要確認飲食 App 的 `package.json` 有裝
  `@capacitor/app`（依賴要放 `dependencies` 不是 `devDependencies`）。
  另外 `appStateChange` 在「App 被系統直接殺掉」（非使用者正常返回）時不一定
  觸發，這種情況只能靠「存入飲食記錄時」那個觸發點兜底，不用特別再處理。
- **重新整理按鈕點擊後要有視覺回饋**：`RemoteViews` 沒有 loading spinner，
  重算通常很快（純讀本機小 JSON），但若檔案很大或裝置慢，考慮點下去先把
  按鈕圖示換成一個簡單的「更新中」狀態，重算完再換回來，避免使用者連點。
- **PendingIntent 的 extra 導覽**：飲食 App 目前是單一 `main.tsx` SPA，沒有
  路由框架，需要確認「用什麼狀態變數導覽到指定頁」的既有機制（如果沒有，
  這次要順手加一個，不要另外發明一套跟現有頁面切換邏輯不一致的做法）。

---

## 8. 這次刻意不做

- Health 動態熱量上限即時反映到小工具（§2.1）——等有真的需求或
  Health 讀資料落地存檔後再說，不要為了小工具去改 App 的 Health 快照儲存策略。
- 小工具內直接記帳（不開 App）——超出「快速入口」的範疇，且小工具無法安全地
  跑 LLM 拍照辨識流程。
- iOS（沒有這回事，本專案沒有 iOS 版）。

---

## 9. 接手 AI 實作步驟順序

1. `NutritionWidgetDataReader.kt`：讀四個 JSON 檔、重算今日合計＋靜態上限。
2. 三種尺寸的 layout XML ＋ `widget_nutrition_info.xml`（responsive 宣告）。
3. `NutritionWidgetProvider.kt`：`onUpdate`／`onAppWidgetOptionsChanged`／組
   四個 `PendingIntent`（含 §5 四種點擊行為，含重新整理自迴圈 broadcast）。
4. `AndroidManifest.xml` 註冊 `NutritionWidgetProvider`（兩個 intent-filter）。
5. App 端接收相機／鉛筆 extra 並導覽到對應頁面（拍照估算／快速入帳）；
   小工具其餘區域固定導覽到今日列表。
6. 接 `appStateChange`（`isActive: false`）與記帳存檔成功後，觸發
   `AppWidgetManager.updateAppWidget()`。
7. 真機測試：放置三種尺寸、旋轉/拖拉調整大小、點四個按鈕、記帳後回主畫面看
   小工具是否更新、離開 App 後小工具是否更新、單獨按重新整理是否正確重抓且
   不誤觸開 App。
