# 新聞模組 — 實作交接文件(給下一個工作串)

> **狀態(2026-06-05 更新):MVP 已完成,分支 `feat/news-module`。** 階段 A→E 全數落地,
> §6 驗收標準已全部達成(見下方勾選)。本文件保留為實作歷程與驗收紀錄;
> 後續演進(角色卡關鍵字 / 關鍵字情境分組)見 `docs/news-future-keyword-groups.md`。
>
> 這份原本是「開新串實作新聞模組」的起點。設計已定案。
> 本文件負責把實作要點、現有可重用程式、階段順序、驗收標準整理清楚,讓實作串照著做。

---

## 0. 開始前必讀(依序)

1. `CLAUDE.md` — 專案總則與視覺/開發原則
2. `docs/news-module-design.md` — **新聞模組統一定案設計(詳細設計唯一來源)**
3. `docs/module-system-roadmap.md` — 共用 module host 架構(新聞掛在這之下)
4. `DesktopST-Spec.md` **§15** — 規格摘要
5. `docs/news-feed-spec.md` — json 類來源的資料契約(站方已實作並驗收通過)
6. `PLAN-prompt-and-routing.md` Part B — 輔助模型(utilityModel)分流,新聞 LLM 走這條
7. 本文件 — 實作落地細節

---

## 1. 一句話目標

桌面角色像朋友一樣,**按「說點什麼」時偶爾抽一則新聞**跟使用者聊聊(不照念、不簡報);
使用者用極簡標籤設定興趣、黑名單、來源、權重、地方新聞、破圈,並用隱性回饋微調。
新聞是 **module host 下的可選模組**,LLM 一律走**輔助模型**。

---

## 2. 不可違背的專案原則(實作時隨時對照)

- **全程繁體中文、台灣用語**(UI 文案、角色輸出)。
- **功能走 GUI 面板,不靠斜線指令**(使用者覺得指令不直覺)。
- **極簡優先**:興趣設定就一個標籤框,技術詞(RSS/來源類型/地區)全藏進階區。聰明預設不問人。
- 視覺只改 `src/styles/theme.css`、`tailwind.config.ts`、`src/styles/global.css`,**不動邏輯**;遵守粉彩圓潤風(規格 §13)。
- 使用者資料一律存 `%APPDATA%\DesktopST\`。
- **不做規格外功能**;有想法先提出討論。X/Threads/Reddit/PTT 不做(見 §15.11)。

---

## 3. 現有可重用程式(已確認存在,照抄模式)

| 現有檔案 | 可重用什麼 |
|---|---|
| `src/main/reminderScheduler.ts` | 排程器模式:`init/reload/scheduleOne/fire`、四種 `ReminderSchedule`、`setTimeout` 管理。新聞排程沿用,新增 `news` 觸發類型 |
| `src/main/spotifyService.ts` | 「抓外部資料 → 組字串 → 注入對話 prompt」的整體模式 |
| `src/main/weatherService.ts` | **`geocodeCity()`、`detectLocationByIP()` 直接重用**做「縣市名 ↔ 定位」;`WeatherSettings` 已存縣市,地方新聞沿用 |
| `src/main/fileStore.ts` | 讀寫 `%APPDATA%\DesktopST\*.json` 的存取模式 |
| `src/main/ipcHandlers.ts` | IPC handler 註冊位置與寫法 |
| `src/main/types.ts` / `src/renderer/src/types/index.ts` | `AppSettings` 型別定義(兩邊要同步) |
| `src/renderer/src/windows/SpotifySettingsWindow.tsx` | 設定視窗範本(若新聞設定要獨立視窗) |
| `src/renderer/src/windows/RemindersManagerWindow.tsx` | CRUD 管理視窗範本 |
| `src/renderer/src/windows/BubbleWindow.tsx` | 對話泡泡;「不想聽這個」按鈕要加在這裡 |
| `src/renderer/src/windows/SettingsWindow.tsx` | 全域設定分頁;新聞設定建議當新分頁併入 |

---

## 4. 建議實作階段(由內而外,每階段可獨立驗證)

> **前置**:module host 需先有最小可用版(見 `module-system-roadmap.md` §6,遠端遙控已先行拆模組)。
> 若 host 尚未就緒,階段 A 可先以「過渡模式」把設定暫放 `settings.modules['desktopst.news']`,之後再搬。

**階段 A — 資料與抓取核心(無 UI)**
- 加 `NewsModuleSettings` / `NewsSource` / `NewsWeight` / `LangMode` / `SpeakMode` 型別(結構見 design §12 / 規格 §15.9,**注意 localNews.locations 多地點、breakout、reminder、speakButton**)。
- 新增 `src/main/modules/news/`(`sources.ts` / `filter.ts` / `settings.ts` / `types.ts`):
  - 來源抓取:`keyword`(組 Google News RSS)、`rss`(`rss-parser`)、`json`(fetch + 驗 `news-feed-spec.md` 格式)。
  - **六層篩選**(design §6):來源排除 → 黑名單(含 source 子字串) → 整類 → 語言(輕量偵測 + 三選一) → 興趣正向比對 → 加權隨機抽一則 + `seenIds` 去重。
- 先用假設定 + log 驗證能抓回並正確篩選/挑選。

**階段 B — 觸發與注入(按鈕主力)**
- **主力**:`forceSpeakDirect`(`ipcHandlers.ts`)依 `speakButton`(關/偶爾/每次)決定是否抽一則塞進 `ctxParts`(與天氣/Spotify 並排)。
- **選配**:`reminderScheduler.ts` 加 `news` 觸發類型,預設關。
- 角色化輸出**走輔助模型**(`utilityModel`);prompt 當背景知識、「不照念、用自己口吻」;translate 模式加「請用繁中轉述、別貼原文、不講成親眼見、保留不確定性」。

**階段 C — 興趣標籤 UI(極簡)**
- 新聞模組設定面板(`src/renderer/src/modules/news/SettingsPanel.tsx`):興趣標籤框 + 黑名單框 + 進階收合區(RSS/json 來源、整類/來源排除勾選、speakButton 三選一、提醒)。
- 標籤點一下循環 常聊/普通/偶爾。批次匯入多行輸入。**不做推薦標籤、不做 onboarding 問卷。**

**階段 D — 地方新聞 + 破圈**
- 地方:多地點清單 UI,首開帶入偵測縣市(`fromDetection`),可新增多縣市、各自權重、各自刪。開關預設關。
- 破圈:可選開關 + 頻率(常聊/普通/偶爾),從 Google Trends 台灣熱搜抽,仍受黑名單/來源排除過濾。預設關。

**階段 E — 回饋機制**
- 泡泡加「🙅 不想聽這個」按鈕 → 彈小選單(兩個預設不勾核取方塊:封鎖關鍵字/封鎖來源,後面顯示內容;**無長按**)。
- 隱性訊號:回話=正向微加、點掉=弱負向微減。回饋寫**新聞模組 profile,不污染角色記憶**。學習在手設基準上微調,**一鍵重置**。

---

## 5. 預定新增/修改清單(module host 結構)

**新增**
- `src/main/modules/news/`:`index.ts`(接入 host)、`sources.ts`、`filter.ts`、`trigger.ts`、`settings.ts`、`types.ts`
- `src/renderer/src/modules/news/SettingsPanel.tsx`
- 設定檔 `%APPDATA%\DesktopST\modules\desktopst.news\settings.json`(**與站方 news.json 不同檔**)

**修改**
- `src/main/reminderScheduler.ts`:`news` 觸發類型(選配)
- `src/main/ipcHandlers.ts` 的 `forceSpeakDirect`:注入新聞素材(走 utilityModel)
- module host registry:註冊 `news:*` IPC、scheduler job、capability
- preload 對應 IPC 白名單
- `BubbleWindow.tsx`:加「不想聽這個」按鈕

**套件**
- `rss-parser`(RSS/Atom 解析)

---

## 6. 驗收標準

- [x] 新聞模組可在設定中**啟用 / 停用**;停用時其他功能無影響。
- [x] 興趣設定面板:打字→Enter→變標籤,點標籤循環常聊/普通/偶爾,**全程不需碰 RSS 字眼**。
- [x] 黑名單命中(title/summary/tags/category/source 任一含關鍵字)即不出現;來源/整類排除生效。
- [x] 語言三選一:translate 模式下,日文/簡中新聞由角色用繁體中文轉述,不貼原文。
- [x] 接 `https://news.nori.idv.tw/news.json` 為 json 來源能正常抓取與去重(同一 id 不重複聊)。
- [x] `keyword` 來源能正確組出 Google News RSS 並抓到結果。
- [x] **按「說點什麼」**:偶爾/每次模式會抽新聞來聊,點掉後再按能抽下一則。
- [x] 提醒觸發預設關;開啟後能定時抽。
- [x] 地方新聞:首開帶入定位縣市,可加台北/新北/台南多個、各自權重、各自刪。
- [x] 破圈:可開關、可設頻率,從熱搜抽且仍受黑名單過濾。
- [x] 「不想聽這個」按鈕:純略過 / 勾選封鎖關鍵字或來源 兩種行為正確;**無長按**。
- [x] 學習權重可一鍵重置。
- [x] 新聞 LLM 角色輸出是聊天口吻、繁體中文,不像播報。(模型路由後改為 `replyModel` 可選**主要/輔助、預設主要**,以口吻優先;見 design §11)
- [x] `npm run typecheck` 通過。

---

## 7. 已知範圍限制(別踩)

- 無法同步 Google News 個人化版面(綁帳號、無公開 API)→ 用「批次貼關鍵字」折衷。
- 社群熱門僅 **Google Trends 台灣熱搜 RSS**;X/Threads/噗浪/Reddit/PTT 不做。
- 語言偵測用輕量字元判斷即可,不引入完整語言偵測庫。
- **不做每日/每週簡報、不做影響半徑評分、不蒐集任何身份/人口屬性 profile**(舊 Codex 版設計已廢棄)。

---

## 8. 給新串的開場指令(可直接貼)

```
我要開始實作 DesktopST 的「新聞模組」。設計已定案,請先讀:
1. CLAUDE.md
2. docs/news-module-design.md(統一定案設計,詳細設計唯一來源)
3. docs/module-system-roadmap.md(共用 module host 架構)
4. DesktopST-Spec.md §15(規格摘要)
5. docs/news-feed-spec.md(json 來源契約,站方已驗收)
6. docs/news-module-impl-kickoff.md(實作交接,含階段與驗收標準)

請依 kickoff 文件的階段 A→E 進行,先從階段 A(型別 + 抓取/篩選核心,無 UI)開始,
完成後跑 npm run typecheck 並跟我確認再進下一階段。
新聞是 module host 下的可選模組、LLM 走輔助模型;
全程繁體中文、功能走 GUI 不靠指令、極簡優先,遵守專案視覺與資料夾原則。
```
