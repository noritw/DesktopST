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
- 第一版不實作：Lorebook、自動發話、TTS、Live2D、ST 對話記錄匯入
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

- **程式碼授權**：MIT License（自由使用、修改、商用）
- **美術素材授權**：CC BY-NC 4.0（`assets/` 內的角色圖片、App Icon 等，禁止商用）
- 目標：開源給社群，owner 維護主 repo，其他人 Fork 自行客製
- 平台：Windows 10/11 優先，保留跨平台擴充空間

---

## 目前進度

- [x] 規格書完成（v1.3）
- [x] 專案骨架初始化
- [x] 階段 1 MVP 基礎架構（桌面角色視窗、輸入視窗、LLM 對話、角色設定）
- [x] 相關 UI 操作優化（hover menu、拖曳、點擊穿透、音效靜音）
- [x] 角色縮放功能
  - HoverMenu 新增縮放按鈕（scale icon），點擊進入縮放模式
  - CharacterWindow 新增縮放模式 UI（可即時預覽、輸入數值或拖曳 slider）
  - 縮放自動 clamp 至螢幕可見範圍（`clampCharacterScaleForDisplay`）
  - 視窗最小尺寸保護（280×220 px）
  - IPC：`desktop:update-size`（確認儲存）、`desktop:preview-size`（即時預覽不存檔）
- [x] 輔助視窗位置 / 大小記憶
  - Input window 改為可調整大小（resizable），拖移後自動記憶 bounds
  - Log window 同樣記憶 bounds
  - 新增 `AppSettings.ui.inputWindowBounds` / `logWindowBounds` 欄位
  - `configureAuxWindowPersistence()` 負責連接存檔邏輯（防抖 250ms）
- [x] Persona / World Preset 系統
  - 世界觀和使用者設定從單一值改為多組預設組（`PersonaPreset` / `WorldPreset`）
  - 設定視窗「世界觀」「使用者」分頁加入下拉選單切換、新增、重新命名、刪除
  - 預設組獨立存檔於 `%APPDATA%\DesktopST\personas\` 和 `worlds\`
  - `AppSettings` 改用 `activePersonaId` / `activeWorldId` 指向啟用的組
  - 內建泛用預設（`assets/default-persona.json`、`assets/default-world.json`），首次啟動自動複製
  - 舊 settings.json 自動遷移（偵測到舊 `persona` / `worldSetting` 欄位時轉為 preset）
  - LLM prompt 組裝改為接收 preset 參數
  - DST 搬家包匯入／匯出配合新結構
  - App Icon 規格已說明（1024px PNG → .ico），AI 生成參考圖已放置
- [x] 便利貼系統（Pinned Notes）
  - 桌面可建立多張便利貼（PinnedNote），每張支援標題、內文、顏色、字型大小
  - 便利貼可拖曳、可調整大小（resizable），位置與尺寸持久化
  - 支援顏色選擇器（獨立 popup 視窗）
  - 隱藏（移入管理員）/ 還原（顯示在桌面）/ 刪除功能
  - 便利貼管理員視窗（`pinned-notes-manager`）列出所有便利貼
  - Tray 加入「開啟便利貼管理」選項
  - 資料存於 `%APPDATA%\DesktopST\pinned-notes.json`
- [x] 色彩主題系統
  - 介面設定分頁加入色彩主題選擇器（9 種：mint / butter / peach / aqua / sky / blush / lavender / white / dark）
  - 儲存於 `AppSettings.ui.colorTheme`
- [x] Emoji 選擇器
  - 輸入視窗加入 Emoji 按鈕，點擊彈出獨立 EmojiPickerWindow
  - 選擇後自動插入輸入框，位置記憶於 `AppSettings.ui.emojiPickerOffset`
- [x] 圖片附件 / 截圖
  - 輸入視窗支援多張圖片附件（檔案選取 + 拖曳投放）
  - 上限由 `AppSettings.llm.maxImagesPerMessage` 控制
  - 截圖功能：`desktop:capture-screenshot`（隱藏輔助視窗）/ `desktop:capture-screenshot-with-characters`（含角色）
- [x] 角色翻轉（Mirror）
  - HoverMenu 加入翻轉按鈕，`desktop:update-flipped` 持久化
- [x] DST Pack 多角色包 & SillyTavern PNG 格式
  - 角色可匯出為嵌入卡片資料的 PNG（SillyTavern 格式相容）
  - DST Pack：多角色 + Persona/World Preset 打包匯出 / 匯入
  - `src/main/pngUtils.ts`、`src/main/stCardMapper.ts`、`src/main/dstPack.ts`
- [x] 對話記錄管理
  - 對話列表（載入、重命名、清除訊息、刪除整則對話）
  - 最後開啟的對話自動記憶（`AppSettings.ui.lastActiveConversationId`）
  - Log 視窗支援訊息刪除、編輯、情緒覆蓋、debug prompt 展開
- [x] LLM 多供應商 / 進階設定
  - 支援 4 個供應商：OpenAI、Claude（Anthropic）、Gemini（Google）、Grok（xAI）
  - 每個供應商獨立 API Key（`AppSettings.llm.apiKeys`）與模型（`AppSettings.llm.models`）
  - 支援自訂 endpoint（`AppSettings.llm.endpoint`）
  - 自動注入系統時間（`AppSettings.injectSystemTime`）
  - 對話自動摘要（`AppSettings.memory.autoSummarizeAfter`）
- [x] 資料夾搬遷
  - 設定視窗「資料」分頁可更改資料儲存路徑，自動搬移所有資料
  - `data:change-dir`、`data:get-relocate-summary` IPC
- [x] 系統托盤強化
  - 收起 / 重新開啟所有輔助視窗
  - 角色保持在最上層（always-on-top checkbox）

**尚未實作（第一版排除）：**
- Lorebook
- 提醒 / 定時發話（目前評估中，見下）
- TTS（文字轉語音）
- Live2D
- SillyTavern 對話記錄匯入
- API Key safeStorage 加密（目前存明文，待補）

詳細開發階段見規格書 §11。

---

## 提醒 / 定時發話功能評估

> 規格書原列「第一版不實作：自動發話」，此節評估是否可啟動實作。

### 所需元件

| 元件 | 現況 |
|---|---|
| 角色強制說話 (`character:force-speak`) | ✅ 已有 |
| LLM 呼叫流程 | ✅ 已有 |
| 主程序長駐排程器 | ❌ 需新增（Node.js `setTimeout` / `setInterval` 管理） |
| 提醒資料結構 (`Reminder`) | ❌ 需新增 |
| 設定 UI（新增/刪除提醒） | ❌ 需新增 |
| IPC（CRUD + 觸發通知） | ❌ 需新增 |

### UI 入口設計（已決定）

- **Tray Icon 選單** 加入「管理提醒」項目（主要入口）
- 獨立的**提醒管理視窗**（類似 pinned-notes-manager），不綁角色
- **右鍵角色 HoverMenu**：待試用後決定是否加入快速新增

### 建議資料結構

```typescript
interface Reminder {
  id: string
  characterId?: string       // 指定角色；未設定則觸發時隨機選桌面上一個角色
  label: string              // 使用者自訂名稱
  prompt: string             // 注入 LLM 的額外指令（可空白）
  schedule: ReminderSchedule
  enabled: boolean
  injectPinnedNotes?: boolean  // 觸發時把桌面上可見的便利貼（visible:true）標題+內文附入 prompt
  lastTriggeredAt?: number
  createdAt: number
}

type ReminderSchedule =
  | { type: 'startup' }                                       // 每次啟動（可開關）
  | { type: 'once';     at: number }                          // 一次性（timestamp）
  | { type: 'daily';    hour: number; minute: number }        // 每天固定時間
  | { type: 'interval'; intervalMs: number }                  // 每 N 分鐘
```

**觸發時的 prompt 上下文組裝：**
- 當前時間：`injectSystemTime` 已有，觸發時永遠注入
- 便利貼：`injectPinnedNotes: true` 時，抓 `visible: true` 的便利貼，格式化為：
  ```
  [桌面便利貼]
  - 《標題》內容...
  - 《標題》內容...
  ```
  附加在 reminder prompt 後面送給 LLM

### 實作工作量估計

約 4 個子任務：
1. 資料結構 + 持久化（`%APPDATA%\DesktopST\reminders.json`）
2. 主程序排程器（`reminderScheduler.ts`）+ IPC CRUD
3. 提醒管理視窗（`window type: reminders-manager`）
4. Tray 選單新增入口 + 觸發時呼叫 `character:force-speak` 並注入 prompt 上下文

**結論**：基礎設施齊全，可以開始實作。
