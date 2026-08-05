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

**`docs/multi-device-platform-roadmap.md`** — 手機獨立版與平台擴充。
動到手機版／跨平台／散布方式之前先讀 §2（四大目標）、§8（已否決方案）。
手機 UI 實作細節見 `docs/b3-mobile-ui-plan.md`（含 §4.20 relay 硬約束）。

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
├── AGENTS.md               ← 本文件（與 CLAUDE.md 同步；詳細進度以 CLAUDE.md 為準）
├── CLAUDE.md               ← AI 助手主說明（進度清單、踩坑警告）
├── DesktopST-Spec.md       ← 完整規格書
├── src\                    ← 程式碼（Electron + React）
│   ├── core\               ← 純 TS 邏輯，禁 import electron/fs/path
│   ├── shared\             ← 桌面與手機共用的純呈現元件（目前只有 MonoIcon）
│   ├── main\ renderer\     ← Electron 主行程／桌面 UI
│   └── mobile\             ← 手機 UI（B3）
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
- `src/shared/MonoIcon.tsx`（單色圖示，**桌面與手機共用同一份**——
  要加圖示改這裡，不要在任一邊另抄一份）

---

## 開發原則

- 不要做規格書範圍外的功能，有想法先提出討論
- 第一版不實作：自動發話、TTS、Live2D、ST 對話記錄匯入
  - ⚠️ **Lorebook 已於 2026-08-03 改為要做**（owner 決議），規格見 `docs/future-lorebook.md`。
    桌面 UI（B2.6）與手機內容編輯（B3 階段 9）皆已完成
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
```

---

## 開源資訊

- **授權**：採作者**自訂條款**（非 MIT／非標準 CC 單檔套用）；禁止將程式與官方素材以重新打包等方式作為商品販售；修改後若免費再發布無須事先徵詢，欲販售或為營利目的單獨發行須事先取得作者同意。公開全文：**https://nori.tw/DeST/license.html**（設定「關於」可開啟）；本 repo 亦含 `docs/license.html` 供離線／打包附帶。
- **素材**：`assets/` 等官方美術之使用範圍以網站／repo 內公告為準。
- 目標：程式碼可閱讀與社群貢獻，owner 維護主 repo；免費再散布原則上自由，販售或營利單獨發行依自訂條款須作者同意。
- 平台：Windows 10/11 優先，保留跨平台擴充空間

---

## 目前進度

> **完整進度清單與踩坑警告以 `CLAUDE.md` 為準**（本檔只保留摘要，避免兩份漂移）。
> 詳細歷史與落地筆記：`docs/progress-log.md`、`docs/b3-mobile-ui-plan.md`。

**桌面版：** MVP → 進階功能大致完成（新聞陪聊、情境模組覆蓋、reaction、記憶摘要、
時間感知、個人新聞報遠端、Google 日曆、Lorebook 桌面 UI 等）。

**core／手機地基：** B1／B2／B2.5／B2.6／B2.7 完成。

**B3 手機 UI（進行中，`feat/mobile-ui`）：**
- [x] 階段 0–5、8、9（聊天主線、角色庫、設定、預設組、對話清單、用語解說）
- [x] 資訊架構重整 ＋ 共用 `MonoIcon`／`modelCatalog`（計畫書 §4.19）
- [x] 雙入口 `/?ui=app` 新版 ＋ `/` 舊版；relay 三約束（§4.20）
- [ ] **下一步：階段 6**（個人新聞報）→ 7 ＋ APK。
  ⚠️ **`mobile.html` 不能在 B6 之前刪掉**——遙控面板（H1–H11）只有舊版有

**規劃中：** 手機獨立版與平台擴充 → `docs/multi-device-platform-roadmap.md`
（動之前必讀 §2／§8）

**尚未實作（第一版排除）：** TTS、Live2D、SillyTavern 對話記錄匯入

詳細開發階段見規格書 §11。
