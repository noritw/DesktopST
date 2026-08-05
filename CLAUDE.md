# DesktopST — 專案說明（給 AI 助手讀的）

這個資料夾是一個桌面 AI 角色扮演寵物程式的開發工作區。
**請先讀完這份文件再開始任何工作。**

---

## 這個專案是什麼

一款 Windows 桌面寵物程式，結合 LLM 即時對話與角色扮演。
類似 SillyTavern 的功能，但介面更簡單直覺，以「桌面寵物」為主體而非聊天視窗。

- 角色站在桌面上，點擊才叫出輸入框
- 支援多角色同時在桌面、群組互相對話
- 相容 SillyTavern 角色卡格式（匯入）
- 可自訂角色圖片、人格、情緒

---

## 必讀規格書

**`DesktopST-Spec.md`**（同資料夾）— 所有功能、UI、資料結構、LLM 整合的完整規格。
實作前務必讀完對應章節，不要憑空猜測規格。

**`docs/multi-device-platform-roadmap.md`** — 手機獨立版與平台擴充的評估與規劃。
**動到手機版／跨平台／多電腦／散布方式之前先讀完**，特別是：
§2「公開版四大目標」（所有提案要先過這四把尺）、§8「已否決的方案」（不要重新提案）。

---

## 技術棧

| 項目 | 選用 |
|---|---|
| 桌面框架 | Electron |
| 前端 | React + TypeScript |
| 樣式 | Tailwind CSS |
| 狀態管理 | Zustand |
| 資料儲存 | 本地 JSON（AppData）|
| 打包 | electron-builder |

程式碼放在 `src/` 資料夾（尚未建立時由 AI 初始化）。

---

## 資料夾結構

```
DesktopST\
├── CLAUDE.md               ← 本文件
├── DesktopST-Spec.md       ← 完整規格書
├── src\                    ← 程式碼（Electron + React）
├── assets\                 ← 設計素材（owner 製作的圖片）
└── dist\                   ← 打包輸出（不要 commit）
```

---

## 視覺設計原則（不可隨意變更）

- **風格**：扁平化、圓潤、春夏粉彩、可愛
- **主色系**：薄荷綠 `#CBFBC4` / 薄荷 `#AAEEDD` / 天藍 `#AAEEFF`（清爽綠藍優先）
- **輔色**：奶油黃 `#FFE8AA` / 粉紅 `#FFBBBB` / 薰衣草 `#F0BBFF`
- **背景**：`#F7FFFC`（薄荷白）、文字：`#3D5A52`（深綠灰）
- **圓角**：盡量多用，面板 16–24px，按鈕/圖示用圓形（50%）
- **禁止**：厚重陰影、毛玻璃、純黑色文字、尖角設計

色票與字型細節在規格書 §13。

**視覺修改只改這幾個檔案，不要動邏輯程式碼：**
- `src/styles/theme.css`
- `tailwind.config.ts`
- `src/styles/global.css`

---

## 開發原則

- 不要做規格書範圍外的功能，有想法先提出討論
- 第一版不實作：自動發話、TTS、Live2D、ST 對話記錄匯入
  - ⚠️ **Lorebook 已於 2026-08-03 改為要做**（owner 決議），規格見 `docs/future-lorebook.md`。
    做的是**用語解說**（角色聽得懂專有名詞）而非完整 ST World Info，
    但資料格式吃 ST `character_book` 子集。排程為 B2.5／B2.6，見 roadmap §10
- 桌面上至少保留一個角色，只剩一個時隱藏移除按鈕
- API Key 必須加密（`safeStorage`），不可存純文字
- 所有使用者資料存 `%APPDATA%\DesktopST\`，解除安裝不刪資料

---

## 開發指令

```bash
npm install       # 安裝套件（第一次）
npm run dev       # 開發模式（熱重載）
npm run build     # 打包成 .exe
npm run typecheck # 型別檢查
npm test          # 自動測試（vitest，只測 src/core/）
npm run test:watch # 測試 watch 模式（存檔自動重跑）
```

測試說明見 `tests/README.md`（測什麼、不測什麼、快照怎麼更新）。

---

## 開源資訊

- **授權**：採作者**自訂條款**（非 MIT／非標準 CC 單檔套用）；禁止將程式與官方素材以重新打包等方式作為商品販售；修改後若免費再發布無須事先徵詢，欲販售或為營利目的單獨發行須事先取得作者同意。公開全文：**https://nori.tw/DeST/license.html**（設定「關於」可開啟）；本 repo 亦含 `docs/license.html` 供離線／打包附帶。
- **素材**：`assets/` 等官方美術之使用範圍以網站／repo 內公告為準。
- 目標：程式碼可閱讀與社群貢獻，owner 維護主 repo；免費再散布原則上自由，販售或營利單獨發行依自訂條款須作者同意。
- 平台：Windows 10/11 優先，保留跨平台擴充空間

---

## 目前進度

> **這裡只列標題，一行一項。** 每項當初的設計取捨、踩過的坑、⚠️ 警告，
> 全部原文搬到 `docs/progress-log.md`——動到對應功能、或懷疑自己在重踩已知的坑時才去查，
> **不要每次開工都整份讀過**（那份很長，是專門拿來搬出 CLAUDE.md 節省每次對話成本用的）。

**桌面版（MVP → 完整功能，早期階段）：**
規格書完成 v1.3・專案骨架・階段 1 MVP（角色視窗／輸入視窗／LLM 對話）・
UI 操作優化・角色縮放・輔助視窗記憶・Persona/World Preset・便利貼・色彩主題（9 種）・
Emoji 選擇器・圖片附件/截圖・角色翻轉・DST Pack & ST PNG 格式・對話記錄管理・
LLM 多供應商（OpenAI/Claude/Gemini/Grok）・資料夾搬遷・系統托盤・提醒/定時發話・
API Key safeStorage 加密・Spotify 音樂偵測・多人聊天與泡泡效能優化

**桌面版（進階功能）：**
- [x] 新聞陪聊模組 → 未解決構想見 `docs/news-future-*.md`
- [x] 情境模組開關覆蓋（Scene Module Overrides）
- [x] 訊息 emoji reaction
- [x] 記憶摘要（自動＋手動）
- [x] 時間感知強化
- [x] 手機版個人新聞報 ＋ 遠端同步修正 → `docs/news-reader-mobile-plan.md`
- [x] Google 日曆模組（唯讀）→ 設定教學 `docs/google-calendar-setup.html`

**core 抽離與手機平台地基（B1／B2）：**
- [x] B1：抽出 `src/core/`（純 TS，禁止 import electron/fs/path，禁止反向 import `src/main/`）
- [x] B2：Capacitor 骨架 ＋ 五個 adapter 介面（Storage/Secret/Http/Scheduler/Notifier）
- [x] B2.7：`fileStore` 邏輯抽 core（`core/store/` 零 I/O）
- [x] APK 試打成功（實機 Pixel 10a／Android 17）
- [x] `mobile.html` 功能對照清單 → `docs/mobile-html-feature-inventory.md`（B3 範圍定義）
- [x] 自動測試導入（vitest）→ `tests/README.md`
- [x] 隨機工具搬進 core（御神籤／擲筊機率桌面手機統一）
- [x] B2.5 Lorebook core ＋ B2.6 Lorebook 桌面 UI → `docs/future-lorebook.md`

**B3 手機 UI（進行中）→ 詳細計畫 `docs/b3-mobile-ui-plan.md`：**
- [x] 階段 0-①②③：StorageAdapter 接上呼叫端／事件來源抽象／DataSource 抽象
- [x] 階段 1：UI 骨架（ViewStack／Sheet／Toast／Dialog／9 種主題／返回鍵）
- [x] 階段 2a-2d：聊天主線／圖片附件／隨機工具／角色列與訊息編修
- [x] 開發工具：假 mobileServer → `scripts/README-mobile-stub.md`
- [x] 階段 3：角色庫 ＋ 角色卡編輯
- [x] 階段 4：設定 UI（API Key／供應商／模型／記憶／模組開關／提醒 CRUD）
- [x] 階段 5：情境／Persona／World 預設組新增、編輯、刪除
- [x] 實機回報修正 → 計畫書 §4.16。⚠️ **選檔的 `accept` 只給 `image/*` 這種大類，
  不要列具體格式或副檔名**（Android 相簿會一張圖都不顯示）；格式把關留給選完之後
- [ ] **下一步：階段 6**（個人新聞報）→ 7 取代 `mobile.html` ＋ APK 正式打包
  → 8 對話清單與切換、9 用語解說內容編輯（2026-08-05 owner 加入排程，尚未開工，見計畫書該兩節）

**規劃中：**
- [ ] 手機獨立版與平台擴充 → `docs/multi-device-platform-roadmap.md`
  **動手機版／跨平台／散布方式之前必讀 §2（四大目標）／§8（已否決方案）**

**提案中、尚未實作：**
- 角色對使用者／角色的印象（自動記憶）→ `docs/future-character-impression.md`。
  排程 **B8（B3 之後）**，owner 決議完全延後

**第一版排除：** TTS、Live2D、SillyTavern 對話記錄匯入

詳細開發階段見規格書 §11；完整歷史記錄與踩坑細節見 `docs/progress-log.md`。
