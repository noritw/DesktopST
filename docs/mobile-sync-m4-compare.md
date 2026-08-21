# S2 M4：切換模式時逐項比對（取代 M3 的整包帶過去）

> 2026-08-13～14 實作。前情：`mobile-sync-m3-kickoff.md`、`mobile-mode-switch-sync.md`。
> **這份文件取代 M3 的切換流程**；M3 的推／拉模組已經沒有呼叫端。

---

## 1. 為什麼要重做

owner 2026-08-13 實測「手機 ↔ 電腦」兩個方向切換之後回報：資料是有過去，
但**重複資料愈來愈多**。實際清點電腦端資料夾：

| | 實測筆數 | 真正應有 |
|---|---|---|
| 情境 | 23 | 7 |
| 世界觀 | 10 | 6 |
| 使用者設定 | 10 | 5 |

同時手機端也有重複（`測試使用者`×2），而且電腦上有 10 處參照指向不存在的 id。

### 1.1 根因一：基準表整份是假的

`sync-baseline.json` 裡 28 筆對應，**每一筆 `remoteId` 都等於手機自己的 local id**。

`syncPush.ts` 推完之後寫 `updates.personas[id] = { remoteId: id, … }`，
但電腦端 `savePersonaPresetDirect()` 是：

```ts
id: existing?.id ?? uuidv4()
```

電腦上沒有那個 id 就**丟掉手機送來的 id、自己發一顆新的**。手機從來沒讀過回應，
於是對應表每一筆都指向電腦上不存在的東西 → `computeDiff` 永遠判成「電腦上沒有這筆」
→ 每推一次就多一份。

**基準壞掉之後沒有任何自我修復路徑**，只會愈錯愈多。這是重做的決定性理由。

### 1.2 根因二：diff 的名字後備配對會讓資料永遠過不去

`core/sync/diff.ts` 對「沒有基準紀錄、但兩邊同名」的實體視為「已經對應過」，
既不算新增也不算修改。但它**不會寫任何基準**，而 `syncPush` 又照 diff 過濾要推什麼——
結果是這類實體永遠不推、也永遠不收斂。owner 回報的「使用者資料沒過去」就是這個。

### 1.3 根因三：推送情境沒有翻譯交叉參照

情境的 `activePersonaId` / `activeWorldId` / `desktopCharacters[].characterId`
存的是**本機 id**。M3 原樣送出，電腦上那些 id 根本不存在——電腦端因此有 10 處死參照。
畫面不報錯，只是套用情境時該有的設定沒被套上。

### 1.4 根因四：取消被誤報成連線失敗

`tryConnect` 用 boolean 回報，「使用者按取消」與「電腦連不上」都是 `false`，
於是取消會跳出「上次那台電腦連不上了，請重新配對」。

---

## 2. owner 拍板的新設計

> 「切換模式的時候應該要所有有變動的部分列出來一項項比對，左邊手機版，右邊電腦版，
> 名稱／ID 相同視為同個物件，勾選要留哪個，還要有選項『全部用手機』『全部用電腦』
> 『保留差異』，而不是像現在這樣重複資料越來越多。」

### 2.1 身分判定不再依賴基準

`core/sync/pair.ts` 每次切換**當場**配對：

1. id 精確配對
2. 剩下的用正規化名稱（trim ＋ 小寫）配對
3. 同一側多筆同名時依 `updatedAt` 由新到舊依序配對，多的自成一列

基準表退化成可有可無的最佳化提示。就算它整份是錯的，也不會再累積傷害。

### 2.2 「內容一不一樣」看雜湊，不看時間

`core/sync/contentHash.ts`。**`updatedAt` 跨裝置不可比**：推送本身會把接收端的
時間設成現在，推完永遠是對面比較新，拿時間判斷會退化成單向覆蓋。

排除三類跨裝置必然不同的欄位：id 與時間、檔案路徑（`avatar`／`emotions`）、
桌面專屬配置（座標／視窗位置／`colorTheme`）。交叉參照一律先換成名稱再雜湊。

⚠️ 算法只有一份（`core/sync/manifestBuild.ts`），桌面端與手機端都 import 它。
兩邊各自抄一份的話只要漂移一個欄位，使用者會看到一整頁假衝突且毫無錯誤訊息。

### 2.3 三顆快捷鍵都不刪東西

「全部用手機」只把**兩邊都有**的列選成手機那份；只有單邊獨有的仍然補到對面。
不會因為電腦上有一隻手機沒有的角色就刪掉它。同步不做破壞性動作。

「保留差異」＝只補缺的、衝突的一律不動（owner 選定的語意）。

### 2.3b 選了空的那一邊 ＝ 刪除（owner 2026-08-14 追加）

owner 在電腦上刪掉測試資料後，想讓手機跟著刪，但那一列的電腦側是空的、按鈕
是停用的——**沒有任何方式能表達「我要的就是沒有」**。

現在選擇的語意統一成「以這一邊為準」，包含那一邊是空的情況：

| 選了 | 兩邊都有 | 只有手機 | 只有電腦 |
|---|---|---|---|
| 手機 | 覆蓋電腦 | 推過去 | **刪掉電腦那份** |
| 電腦 | 覆蓋手機 | **刪掉手機那份** | 拉回來 |
| 不動 | 不動 | 不動 | 不動 |

三道防線（owner 指定前兩道）：
1. 選中的空邊畫成 `--danger` 警告色，副標變「刪除另一邊」，整列外框轉紅，
   底下多一行「會從這支手機／電腦刪掉」
2. 按確認時**再跳一次確認視窗**，而且逐筆列出名字（只講數量的話使用者
   發現不了自己選錯哪一列）。純複製不問，否則每次同步都多按一下
3. **三顆快捷鍵一律不產生刪除**——一顆按鈕如果能一次刪幾十筆，遲早會被手滑
   按到。刪除只能逐列明確指定（`tests/core/sync/pair.test.ts` 有守這條）

刪除一律走 session 既有的 `remove*` 方法／電腦端既有的 delete 端點，不自己動
storage：那些方法還負責清參照、處理「刪到正在用的那組」、以及「最後一組不給刪」
的保護。保護擋下來時記進 `failed` 回報，不會讓整趟中斷。

**執行順序**：所有刪除排在所有複製之後，而且順序與複製相反
（情境 → 世界觀 → 人設 → 角色 → 用語解說）。同一趟裡可能「推情境」又「刪角色」，
先刪的話情境推送會翻不到那個角色而把它默默丟掉。

### 2.4 方向變成資料，不再是程式分支

`applySync()` 逐列執行 `local`／`remote`／`keep`，同一趟裡兩個方向可以並存。
M3 那種「推與拉是兩條路徑、掛錯呼叫端就整個反了」的錯誤類別因此消失。

---

## 3. 執行順序不能改

```
lorebooks → characters → personas → worlds → scenes
```

情境參照其他全部四種，必須最後做，而且要用前面幾輪建立起來的 id 對應表翻譯參照。
用語解說排最前面因為角色與世界觀都會參照它。

推送情境時，座標／大小／翻面／視窗位置**一律沿用電腦上原本那份**
（先 `GET /api/presets/scene/:id` 取回再合併）——手機那些欄位多半是匯入時的預設值，
推過去等於把使用者擺好的桌面洗掉。

---

## 4. 改了哪些檔

**新增**
- `src/core/sync/pair.ts`：配對、預設決定、三顆快捷鍵、統計（純函式）
- `src/core/sync/contentHash.ts`：跨裝置內容雜湊
- `src/core/sync/manifestBuild.ts`：桌面／手機共用的清單產生器
- `src/mobile/runtime/syncApply.ts`：逐列執行推／拉，含參照翻譯
- `src/mobile/ui/shell/SyncComparePicker.tsx`：比對畫面
- `tests/core/sync/pair.test.ts`（20 項）、`tests/mobile/syncApply.test.ts`（8 項）

**修改**
- `main/ipcHandlers.ts`：`importDstPackDirect` 回傳 `ids`（實際落地的 id）＋
  新增 `targetId` 讓呼叫端指定要蓋哪一隻
- `main/mobileServer.ts`：`/api/sync-manifest` 改用 `buildManifest`（多帶 contentHash）；
  `import-pack` 支援 `?targetId=` 並回傳 `ids`
- `mobile/runtime/syncTransport.ts`：新增 `postJson`（**回應一定要用**）
- `mobile/runtime/session.ts`：`exportPack` 新增 `remapLorebookIds`
- `mobile/ui/shell/ModeSwitcher.tsx`：`SwitchOutcome`（取消 ≠ 失敗）＋接上新流程
- `mobile/ui/stores/uiStore.ts`：`openSyncCompare`（比照 `openNameConflicts` 的 Promise 包裝）

---

## 5. 一次性清理（已執行，2026-08-13）

`scripts` 之外的臨時腳本，合併同名重複（留 `updatedAt` 最新）＋改寫參照＋
修復死參照（用另一台的 id→名稱對照表接回同名物件）。

電腦端結果：使用者設定 10→5、世界觀 10→6、情境 23→7、死參照 10→0。
備份在 `%APPDATA%\desktop-st\Data.backup-2026-08-13T15-59-48`。

手機端**尚未清理**——刻意留著當比對畫面的第一場真機驗證素材。

---

## 6. 尚未做

- **對話同步**：仍未做。量體大、內容最私密（S1 匯入時對話預設全不勾），
  是 append-only 結構，現有的 `PairRow`（單一名稱＋單一時間戳）撐不住
  「兩邊都改了同一則對話」這種情況——衝突要怎麼呈現需要另外設計，
  不是套用同一套框架就能解決。
- ~~設定同步~~ 已完成，見 §8（S2 M5，2026-08-14）。
- **M3 的殘留模組**：`syncPush.ts`／`syncPull.ts`／`modeSwitchSync.ts` 已無呼叫端
  （`syncImport.ts` 仍在用，那是 S1 匯入，要留）。要不要刪待 owner 決定——
  留著的風險是有人把寫錯基準的邏輯接回去。

---

## 7. 真機待驗

1. 獨立 → 遙控：比對畫面出現、左右各自可選、三顆快捷鍵、確認後電腦端**不長重複**
2. 遙控 → 獨立：同上，手機端不長重複
3. 電腦上把某筆改名 → 比對畫面應仍配成同一列（靠 id）並標「電腦上叫⋯⋯」
4. 兩邊完全相同時：該分頁顯示「完全相同」，確認鍵變成「直接切換」
5. 比對畫面按取消 → **不應**出現「上次那台電腦連不上了」
6. 推情境後檢查電腦端 `scenes/*.json`：`activePersonaId` 要指向電腦上真的存在的 id，
   `desktopCharacters` 的座標要維持電腦原本的值
7. **刪除**（2026-08-14 追加）：在電腦上刪掉一筆 → 手機比對畫面該列選「電腦」→
   按鈕與外框轉成警告色、副標變「刪除另一邊」→ 確認時跳出逐筆清單 →
   同步後手機那份真的消失。反方向（選「手機」刪掉電腦那份）同理
8. 快捷鍵防呆：按「全部用電腦」不該產生任何刪除（單邊獨有的仍是補到對面）
9. **設定分頁**（S2 M5）：改電腦上的配色主題／對話限制／模組開關 → 開比對畫面
   「設定」分頁該欄位顯示不同 → 選一邊 → 同步後另一邊的值真的變成一樣，
   且**沒被選中的其餘欄位不受影響**（尤其驗證「對話限制」三欄只改一欄時，
   電腦端另外兩欄不會被送過去的請求覆蓋——見 §8.3）

## 8. S2 M5：設定同步（逐欄位比對）

owner 2026-08-14 要求：跟資料同步用類似的 UI 格式，逐項比對；選項語意
與資料同步一致（本機／電腦／不動），沿用同一個比對畫面，多開一個「設定」分頁。

### 8.1 跟資料同步（`pair.ts`）刻意不共用型別

`pair.ts` 比對的是「一筆一筆、各自有 id 的實體」，兩邊都有時才談「是不是同一個」。
設定不是這樣——`llm.provider` 這種欄位**兩邊永遠都有值**，沒有「只有手機有」
這種狀態，所以：
- 不需要 id 配對（`core/sync/settingsPair.ts` 的 `pairSettings()` 直接比對固定的欄位集合）
- 沒有 M4 那種「選空的一邊＝刪除」的語意——三個選項就是單純的
  `'local' | 'remote' | 'keep'`，`keep` 是預設值（跟資料不同：資料的單邊獨有
  預設會補齊，但設定兩邊永遠都有值，不能替使用者決定要用哪一個）

### 8.2 涵蓋範圍

沿用 S2 M2 就定義好的子集（`buildSettingsManifestHash` 的舊範圍），現在唯一定義
在 `core/sync/settingsSnapshot.ts`：
- LLM：使用中的供應商、**每個供應商各自的模型**（拆成 4 列，不是整包比）、
  自訂端點、對話限制三欄（回應字數／群組角色數／圖片上限）
- 記憶：完整保留則數、自動摘要門檻、自動摘要開關
- 外觀：配色主題
- 模組：逐一模組開關

**不同步**：API Key（S2 任何情況都不碰金鑰，roadmap §4.7）、utility 模型設定
（輔助模型走另一套獨立欄位，範圍已經夠大，之後有需要再加）。

### 8.3 三個欄位共用一支電腦端端點時怎麼辦

`llm-chat-limits`／`memory` 這兩支端點各自一次要三個數字。使用者可能只選其中
一兩個欄位「用手機的」，這不衝突——**推送前算出「電腦端最終要維持的三個值」**：
被選中要推的欄位用手機值，其餘（不動或被拉）維持電腦原本的值。絕不能只送
「被選中的那個」，端點沒有「只改一欄」的介面，漏送的欄位會被電腦端當成
「沒傳＝清空」處理。`tests/mobile/syncSettingsApply.test.ts` 有專門守這條
（`三個欄位只有一個要推時，仍然送出三個數字`）。

### 8.4 桌面／手機共用同一份子集定義

跟 M4 的 `contentHash.ts` 同一個教訓：改之前，桌面 `buildSettingsManifestHash`
與手機 `buildLocalManifest` 的設定子集是兩邊分別手打的物件字面量，欄位只要
漂移一個，雜湊就永遠對不起來、而且不會有任何錯誤訊息。現在唯一定義在
`core/sync/settingsSnapshot.ts`，兩端都 import；順手加了 `GET /api/settings/sync-snapshot`
回傳完整快照（不只雜湊），手機才能把兩邊的值並排顯示。

### 8.5 改了哪些檔

**新增**
- `core/sync/settingsSnapshot.ts`：共用子集定義＋雜湊
- `core/sync/settingsPair.ts`：逐欄位比對、預設值、三顆快捷、統計
- `mobile/runtime/syncSettingsApply.ts`：執行推／拉，含分組端點的「算最終值」邏輯
- `tests/core/sync/settingsPair.test.ts`（8 項）、`tests/mobile/syncSettingsApply.test.ts`（11 項，
  含 §8.5b 補的 `weather.polish` 兩項）

**修改**
- `main/mobileServer.ts`：新增 `GET /api/settings/sync-snapshot`；
  `buildSettingsManifestHash` 改成呼叫共用子集
- `mobile/runtime/syncManifest.ts`：新增 `buildLocalSettingsSnapshot`／
  `fetchRemoteSettingsSnapshot`；`buildLocalManifest` 改用共用子集
- `mobile/ui/stores/uiStore.ts`：`openSyncCompare` 多帶 `settingsRows`，
  `resolve` 回傳 `{ choices, settingsChoices }`
- `mobile/ui/shell/SyncComparePicker.tsx`：加「設定」分頁（獨立的 row 元件，
  沒有刪除語意）
- `mobile/ui/shell/ModeSwitcher.tsx`：切換前一併抓兩邊設定快照、比對、套用
- `mobile/ui/shell/syncDiffMessage.ts`：`formatApplyMessage` 多收一個可選的
  設定結果參數，合成同一則完成訊息（不彈兩個對話框）

### 8.5b 漏掉的欄位：`weather.polish`（owner 2026-08-14 真機回報）

第一版比對範圍是直接沿用 S2 M2 的 `buildSettingsManifestHash` 舊子集，但那個子集本來就
**沒有天氣的子設定**——`weather.polish`（天氣訊息要不要先過一次輔助模型潤飾文字）
只存在 `session.settings.weather.polish`，跟「天氣模組開關」是完全不同的兩個欄位，
`modules` 那組只比對得到 `enabled`。真機測完全五類（LLM／記憶／外觀／模組）都對得起來，
唯獨這個子設定沒被列進比對畫面，也就永遠不會被同步。

修法：`SettingsSnapshot` 加一個 `weather: { polish: boolean }`（**只有 `polish`**，
地點座標／地名／定位來源刻意不放進去——CLAUDE.md §4 天氣段落早就定調
「地點不帶：手機會移動、也有 GPS，帶座標只會讓它出門顯示家裡的天氣」，
S1 初始化匯入就是這條規則，這裡沒有理由破例）。歸進 `modules` 分組顯示，
列在天氣模組開關附近。

寫回手機那份要**跟預設值合併**（比照 `localDataSource.ts` 的 `setWeather()`），
不能直接整個物件覆蓋——`session.settings.weather` 缺欄位的話合併邏輯會用預設值
補上，如果不小心用「只有 polish 的物件」整個蓋過去，會把地點座標／定位來源
一起清空（`tests/mobile/syncSettingsApply.test.ts` 的「不清空既有的地點資料」
就是守這個）。

**這提醒了一件事**：模組除了 `enabled` 之外常常還帶自己的子設定（新聞的關鍵字組、
提醒的喚醒模式……），這些子設定要不要進同步範圍是逐個判斷的產品決定，不是
「加了 modules 分組就自動涵蓋」。目前只確認天氣的 `polish` 該同步；其餘模組
的子設定尚未逐一檢查過，之後如果有人回報「這個模組的某個開關沒有一起帶過去」，
大概率也是同一類遺漏。

### 8.6 真機待驗

1. 在電腦上改配色主題 → 手機比對畫面「設定」分頁該列顯示「電腦：〈新主題〉」
2. 只選「對話限制」三欄裡的一欄用手機 → 同步後電腦上**其餘兩欄維持電腦原值**，
   不會被送出的請求覆蓋成手機的值
3. 切換供應商（選電腦） → 手機那個供應商如果原本沒設過模型，要補目錄預設值，
   不留空模型
4. 模組開關（例如天氣）從電腦帶回手機 → 手機的天氣模組真的被打開，
   不是只有 `enabled` 欄位變了但功能沒生效
5. 兩邊設定完全相同時，「設定」分頁顯示「設定兩邊完全相同」
6. 快捷鍵「全部用電腦」只在設定分頁生效，不影響資料分頁的選擇，反之亦然
