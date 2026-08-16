# 飲食熱量模組（B9a MVP）—— 開工指令

> **建立時間**：2026-08-17。owner 要自用優先，插隊到 B3 APK 正式發布之前。
> **狀態**：待開工，尚未寫過一行程式碼。
> **這份是給接手 AI 的完整指令，照著這份就能開工，不必先讀長文。**
> **前置**：`CLAUDE.md`（必讀，尤其 §3 硬規則、§5 踩過的坑）。
> 完整規格在 `docs/future-nutrition-module.md`——**這份文件已經定案**，
> 不要重新設計產品形狀，有疑問先看那份的對應章節，不要自己另外決定。

---

## 0. 一句話

新增一個可選模組（`desktopst.nutrition`，比照天氣／新聞模組），讓使用者記錄
飲食熱量與蛋白質：本機食物庫＋關鍵字快速入帳（免 LLM）、新食物才用便宜模型
估營養、每日飲食列表、TDEE 抓建議但上限可手改。**桌面與手機都要做**（跟天氣／
新聞一樣是「一套邏輯、兩個 UI」），且**第一期就要有搬家包匯出／匯入**（不等 S2）。

owner 自用優先，只要 B9a（MVP）能動、能記、能搬家就算完工——B9b（拍照 LLM
估價、桌面小工具、報表頁）與 B9c（Health、接 S2、角色偏好注入）**這次都不做**。

---

## 1. 先讀哪些（不要整份掃）

| 順序 | 讀什麼 | 為什麼 |
|---|---|---|
| 1 | `CLAUDE.md` 全文（本來就短） | 硬規則、目錄結構、踩過的坑 |
| 2 | `docs/future-nutrition-module.md` **§8「已定案摘要」＋ §4 資料模型＋ §6 分期表** | 這就是規格，B9a 範圍以 §6 那一列為準 |
| 3 | 需要時再讀 §3（產品形狀）、§5（換機／搬家包） | 細節，不必一開始就啃完 |

**不要讀**：§9（開工前可微調，那些是次要問題，卡住就照常識選一個，不要為此停工）、
`docs/multi-device-platform-roadmap.md` 整份（只在需要對照四大目標時才翻）。

---

## 2. 這次的範圍（B9a MVP，對齊規格 §6）

### 要做

1. **資料模型 ＋ core 純函式**：`FoodItem`／`MealLog`／`BodyProfile`／模組設定，
   關鍵字對庫比對、每日/週/月聚合、TDEE 計算——全部放 `core/nutrition/`
   （比照 `core/weather/`／`core/news/`），**不 import electron／fs／path**。
2. **每日飲食列表**（規格 §3.2b）：翻日、當日合計、點名稱編 `FoodItem`。
3. **關鍵字入帳**（免 LLM）：打關鍵字比對食物庫別名，選了就記一筆。
4. **手建食物**：名稱／別名／品牌／店家／口味／每份營養／1～3 張照片。
5. **TDEE**：身高／體重／年齡／活動量算建議，「套用」寫進
   `dailyKcalLimit`／`dailyProteinGoalG`，兩者之後**隨時手改**、TDEE 只是墊初始值。
6. **應用內快覽**：今日 `kcal／上限`、`蛋白／目標`，超標紅字。
7. **N1 搬家包匯出／匯入**（規格 §5.2）：`.destnutrition`，含食物庫＋照片＋
   餐次＋身體檔＋模組設定，**不含 API Key**。合併規則：同 id 取 `updatedAt`
   較新者勝，衝突可選；也要有「僅補缺」「覆蓋本機」兩個選項。
8. **N2 手動編輯**：改食物／餐次/上限都要能改，不能只有「新增」沒有「編輯」。
9. **雙入口可互關**：模組關閉時飲食 icon／選單全隱；只開飲食可不填 API Key
   （關鍵字入帳本來就不用 LLM）。
10. **桌面＋手機都要有**：跟天氣／新聞一樣，UI 各自做，邏輯共用 `core/`。

### 不要做（B9b／B9c，這次不碰）

- 拍照／標示給 LLM 估營養（新食物）——B9a 先只能手動輸入營養數字，
  之後 B9b 再補「拍照估價」這條路。**這條路留好擴充點但不用實作**
  （例如 `FoodItem.source` 欄位先預留，實際的 vision 呼叫先不寫）。
- 桌面小工具（Widget）、本機報表頁（日/週/月圖表）。
- Health 讀寫（Google Health／Health Connect）。
- 接 S2 同步（規格 §5.4 的 N3）——手機／桌面各自獨立運作，換機靠 N1 搬家包。
- 角色聊天素材注入（§3.3／§3.3b 的「愛吃什麼」「攝取消耗差異」）——B9a 不接
  聊天管線，飲食模組先當獨立帳本用。

---

## 3. 架構決定（照抄既有模組的做法，不要自己另外發明一套）

### 3.1 模組註冊

- module id：`desktopst.nutrition`，label「飲食記錄」。
- 手機端模組清單：`src/mobile/runtime/session.ts` 的 `MODULE_DEFS`
  （目前有 weather／news／spotify／calendar 四項，照樣加一項，預設 `enabled: false`）。
- 桌面端對應清單：搜尋 `WEATHER_MODULE_ID`／`listMobileModuleTogglesDirect`
  在 `src/main/ipcHandlers.ts` 的用法，照抄同一套。
- **不要**把飲食開關塞進 `settings.json`——比照新聞模組，開關住在
  `modules/desktopst.nutrition/settings.json`（`session.ts` 的
  `listModules`／`setModuleEnabled` 對新聞是 async 的，飲食也要是）。

### 3.2 儲存

- 桌面根目錄：`%APPDATA%\DesktopST\modules\desktopst.nutrition\`
  （比照規格 §4，`core/store/keys.ts` 的 `MODULES_DIR` 慣例）。
- 手機：透過 `StorageAdapter`，key 佈局要跟桌面**逐字一致**（不然日後接 S2
  或搬家包互通會對不起來——`news-standalone-kickoff.md` §3.2 踩過這個坑，
  這次直接照做，不要重蹈覆轍）。
- 照片：**不進 APK**，存進資料目錄，key 形如
  `modules/desktopst.nutrition/food-items/<id>/01.webp`，壓縮後存
  （比照 `characterCardKey`／頭像的做法，`session.ts` 裡的 `ALLOWED_AVATAR_EXT`
  與壓縮邏輯可以直接抄，不要重新設計圖片管線）。

### 3.3 LLM（B9a 用得到的部分只有「共用金鑰判斷」，不用真的呼叫 vision）

- B9a 不呼叫任何 LLM（關鍵字入帳免 LLM，手動輸入不用 LLM）。
- 但**只開飲食模組時不該要求填 API Key**——沿用既有的
  `hasUsableApiKey(settings)` / `providerNeedsApiKey()` 判斷（CLAUDE.md §5
  已經寫死這條規則：不要自己手寫 `apiKeys[provider]?.trim()`），飲食模組的
  入口判斷邏輯要跟著這套，不要另開一條「有沒有填金鑰」的檢查。

### 3.4 UI

- 手機：新畫面放 `src/mobile/ui/nutrition/`（比照 `src/mobile/ui/news/`
  的目錄結構：一個列表頁、一個詳情/編輯頁、一個設定頁）。
- 桌面：新視窗或新分頁，比照 `src/renderer/` 既有模組（天氣／新聞）的掛法。
- 配色**只能用 `theme.ts`／`theme.css` 既有的 CSS 變數**，不要自己配新顏色
  （CLAUDE.md §3「視覺」硬規則）。圖示只改 `src/shared/MonoIcon.tsx`。
- 手機 sheet／modal 記得留 `paddingBottom: calc(var(--safe-bottom) + Npx)`——
  這次 v0.4.0 煙測才因為漏了這個讓按鈕被手勢列擋住（`Composer.tsx`／
  `NewsContextSheet.tsx` 都踩過），新畫面直接照抄這個慣例，不要重踩。

---

## 4. 建議實作順序（每步都能獨立驗證，`npm test` 是唯一測試指令）

| 步驟 | 內容 | 驗證方式 |
|---|---|---|
| ① | `core/nutrition/types.ts` 定義 `FoodItem`／`MealLog`／`BodyProfile`／模組設定型別 | 純型別，`npm run typecheck` 過 |
| ② | `core/nutrition/` 純函式：關鍵字比對、TDEE 計算、日/週/月聚合（吃 `MealLog[]`，可注入 `now`） | 各自寫 `tests/core/nutrition/*.test.ts`，餵固定資料驗證輸出 |
| ③ | 模組設定讀寫（`StorageAdapter` 版），桌面／手機共用同一份 key 佈局（§3.2） | `npm test`；桌面／手機分別存一筆、重開還在 |
| ④ | 手機：食物庫 CRUD＋照片（先不接列表 UI，只接資料層＋薄轉呼叫） | `LocalDataSource` 對應方法，vitest 走 `tests/mobile/` |
| ⑤ | 手機 UI：每日飲食列表＋翻日＋合計（規格 §3.2b） | `MobileST.bat [3]` 或 `preview_start` 手動點一輪 |
| ⑥ | 手機 UI：關鍵字入帳＋手建食物 | 同上 |
| ⑦ | 手機 UI：TDEE 表單＋快覽 | 同上 |
| ⑧ | 桌面：比照手機做同一套 UI（邏輯已經在 core，這步應該最快） | 開桌面版手動點一輪 |
| ⑨ | N1 搬家包匯出／匯入（規格 §5.2），桌面／手機都要有入口 | 桌面匯出→手機匯入（或反過來），資料對得起來 |
| ⑩ | N2 編輯（改食物／餐次／上限），確認「改主檔」跟「改單筆餐次」的邊界清楚 | 手動測：改一筆 `FoodItem` 名稱，該食物所有 `MealLog` 顯示跟著變 |

每步做完 `npm run typecheck` **與** `npm test` 都要過，兩個分開跑
（CLAUDE.md §6：`npm test` 綠不等於 `typecheck` 綠，vitest 不做型別檢查）。

---

## 5. 一定會踩、先寫在這裡的坑（抄 CLAUDE.md §5，套用到這個新模組）

1. **改完資料一定要 `events.push({ kind: 'state-invalidated', reason: 'desktop' })`**
   （手機端），否則畫面停在舊清單。這是全站最常忘記的一步。
2. **HTTP 一律走注入的 `HttpAdapter`，不要用全域 `fetch`**——B9a 雖然不呼叫
   LLM，但如果任何一步意外需要打網路（例如日後接 vision），現在就要照這個
   規則寫，不要留一個要重寫的坑給 B9b。
3. **手機通知／逾時相關的坑跟這次無關**（飲食模組不涉及提醒排程），
   但如果 B9c 之後要加「該記飲食了」提醒，要先讀
   `docs/mobile-standalone-reminder-plan.md`，不要另開一套排程機制。
4. **模組設定不要塞進 `settings.json`**——見 §3.1，這是新聞模組吃過的虧
   （`session.ts` 的 `listModules` 原本沒接新聞，靠一次真機回報才發現）。
5. **改 vite alias 或 tailwind `content` 後一定要重開 `dev:mobile`**，
   否則圖示無聲消失（CLAUDE.md §5 已知坑，跟這次無關但常被踩到）。
6. **搬家包裡絕對不能有 API Key**——B9a 雖然不涉及 LLM 金鑰，但如果模組設定
   物件裡意外夾帶了 `nutrition.llm.apiKey` 之類的欄位，匯出時要記得剝除
   （規格 §5.2 已經明講「API Key 永不進包」，跟 DST Pack／S2 同一條規則）。
7. **同一 `foodItemId` 的多筆餐次要真的共用同一份資料**，不要在 `MealLog`
   裡複製一份營養數字快照——改食物主檔要能讓所有引用它的餐次顯示跟著變
   （規格 §3.2b 已經講明這是設計重點，不是可選的最佳化）。

---

## 6. 完工判準（B9a）

- [ ] 桌面／手機都能：關鍵字入帳、手建食物（含 1～3 張照片）、看每日飲食列表
      （翻日、合計正確）
- [ ] TDEE 套用建議後，`dailyKcalLimit`／`dailyProteinGoalG` 可再手改，
      改完 TDEE 重算不會覆蓋手改值
- [ ] 應用內快覽顯示今日 `kcal／上限`、`蛋白／目標`，超標變紅
- [ ] 模組關閉時，飲食入口（icon／選單）完全隱藏；只開飲食時不需要填 API Key
- [ ] 搬家包匯出→在另一台裝置（或同裝置清空後）匯入，食物庫／餐次／身體檔／
      照片都正確還原，且**沒有 API Key 混進去**
- [ ] 改一筆 `FoodItem` 的名稱或營養值，所有引用它的 `MealLog`（含歷史）
      顯示跟著變
- [ ] `npm run typecheck` 與 `npm test` 都過

真機驗證（Pixel 10a 或你自己的機器）留到 B9a 全部功能做完、瀏覽器煙測過一輪
之後再做，不用每一步都連真機。

---

## 7. 完工後要更新的文件

- `docs/future-nutrition-module.md` §6 分期表：B9a 打勾，補落地筆記（哪裡跟規格不同、為什麼）
- `TODO.md`：從「延後／已排程」搬到「現在該做的」對應完成狀態
- `CLAUDE.md` §4 現況表：加一行
- `docs/progress-log.md`：照慣例補一筆

---

## 8. 給接手 AI 的一句話總結

這是全新模組，不是接線任務。**先把 core 的資料模型與純函式做完並測過，
UI 邏輯全部薄轉呼叫**——這是天氣／新聞模組已經驗證過的分工方式，照做就對，
不要自己發明新的分層方式。手機跟桌面 UI 各自實作，但存檔格式、模組設定
儲存位置、照片管線，兩邊必須從一開始就對齊，不要「先做完手機再讓桌面對齊」，
那樣事後要花更多力氣調格式。
