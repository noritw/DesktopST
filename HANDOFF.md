# DesktopST — AI 交接文件

> 這份文件讓接手的 AI 能直接開始工作，不需要看對話記錄。
> 完整功能規格請讀 `DesktopST-Spec.md`，視覺設計規格在規格書 §13。

---

## 專案簡介

Windows 桌面 AI 寵物程式。角色圖片透明地站在桌面上，使用者點擊角色叫出輸入框與 LLM 即時對話。類似 SillyTavern，但介面極簡、以桌面寵物為主體而非聊天視窗。

**目標用戶**：owner 個人使用，未來開源給社群 Fork 客製。

---

## 技術棧

| 項目 | 版本 |
|---|---|
| Electron | ^34 |
| electron-vite | ^2（建置工具） |
| React + TypeScript | 18 + 5 |
| Tailwind CSS | ^3（用 JS config） |
| Zustand | ^5（狀態管理） |
| Node.js | v25（本機環境） |

---

## 啟動方式

```bash
cd C:\Users\nori9\Dropbox\DesktopST
npm install        # 若 node_modules 不存在
npm run dev        # 開發模式（熱重載，直接跳出 Electron 視窗）
npm run build      # 打包成 .exe（electron-builder）
npm run typecheck  # TypeScript 型別檢查
```

---

## 目錄結構

```
DesktopST\
├── CLAUDE.md                  ← 給 AI 的專案規則（必讀）
├── DesktopST-Spec.md          ← 完整功能規格書 v1.3
├── HANDOFF.md                 ← 本文件
├── package.json
├── tailwind.config.js         ← Tailwind 設定（必須是 .js，不能是 .ts）
├── postcss.config.cjs         ← PostCSS 設定
├── electron.vite.config.ts    ← 建置設定
├── tsconfig.json              ← Renderer 型別設定
├── tsconfig.node.json         ← Main/Preload 型別設定
├── assets\
│   ├── KT_default.png         ← 紀天行預設圖片
│   ├── YT_default.png         ← 汪逸彤預設圖片
│   ├── 紀天行_文本版.json      ← ST chara_card_v3 格式角色卡
│   └── 汪逸彤_文本版.json      ← ST chara_card_v3 格式角色卡
├── src\
│   ├── main\                  ← Electron 主程序（Node.js）
│   │   ├── index.ts           ← 入口：app ready、protocol、tray
│   │   ├── windowManager.ts   ← 所有 BrowserWindow 的建立與管理
│   │   ├── ipcHandlers.ts     ← 所有 IPC 通訊處理（in-memory state）
│   │   ├── fileStore.ts       ← JSON 檔案 I/O（角色卡、設定、對話）
│   │   ├── types.ts           ← 主程序側型別定義
│   │   └── llm\
│   │       └── openaiAdapter.ts ← OpenAI API 呼叫 + 情緒解析
│   ├── preload\
│   │   └── index.ts           ← contextBridge：暴露 api.invoke/send/on
│   └── renderer\
│       ├── index.html
│       └── src\
│           ├── main.tsx
│           ├── App.tsx        ← 依 URL ?w= 路由到各視窗
│           ├── types\index.ts ← Renderer 型別（含 window.api 宣告）
│           ├── stores\
│           │   └── useAppStore.ts  ← Zustand store，所有 IPC 呼叫從這裡發
│           ├── styles\
│           │   ├── theme.css  ← CSS 變數色票（改視覺改這裡）
│           │   └── global.css ← Tailwind + 全域樣式
│           ├── windows\
│           │   ├── CharacterWindow.tsx  ← 透明桌面角色視窗
│           │   ├── InputWindow.tsx      ← 輸入框視窗
│           │   ├── LogWindow.tsx        ← 對話記錄視窗
│           │   └── SettingsWindow.tsx   ← 設定視窗（5 分頁）
│           └── components\
│               ├── CharacterSprite.tsx  ← 角色圖片元件
│               ├── SpeechBubble.tsx     ← 對話泡泡（8 秒後消失）
│               └── HoverMenu.tsx        ← 懸停選單（💬🔇⚙️❌）
└── out\                       ← 建置輸出（git ignored）
    ├── main\index.js
    ├── preload\index.js
    └── renderer\index.html + assets\
```

---

## 架構重點

### 多視窗路由
所有視窗共用同一個 renderer bundle，用 URL query param 區分：
```
?w=character&id={characterId}  → CharacterWindow
?w=input                       → InputWindow
?w=settings                    → SettingsWindow
?w=log                         → LogWindow
```

### IPC 通訊模式
- Renderer → Main：`window.api.invoke(channel, ...args)` → `ipcMain.handle(channel)`
- Main → Renderer（廣播）：`broadcastToAll(channel, data)` → `window.api.on(channel, cb)`
- 單向（mouse hit-test）：`window.api.send('mouse:set-ignore', bool)` → `ipcMain.on`

### 資料流
```
Main Process（source of truth）
  ├── fileStore.ts → JSON 讀寫（AppData）
  ├── ipcHandlers.ts → in-memory state（settings, characters, conversations）
  └── broadcastToAll() → 推送更新到所有 renderer
        ↓
Renderer（useAppStore.ts）
  ├── loadAll() 初始化
  ├── subscribeToEvents() 接收推送
  └── 各 window/component 讀 store
```

### 角色圖片服務
本機圖片用 `local://` 自訂協定：
```typescript
// 主程序註冊（src/main/index.ts）
protocol.registerFileProtocol('local', (request, callback) => {
  const raw = request.url.slice('local://'.length)
  callback({ path: decodeURIComponent(raw) })
})

// Renderer 使用（CharacterWindow.tsx）
const avatarSrc = character.avatar
  ? `local://${encodeURIComponent(character.avatar)}`  // Windows 路徑含反斜線需 encode
  : ''
```

### 資料儲存位置
```
%APPDATA%\DesktopFamiliar\
├── settings.json
├── characters\{uuid}\
│   ├── card.json
│   └── avatar.png
└── conversations\{uuid}.json
```

---

## 目前完成度（2026-05-09）

### ✅ 完成
- Electron 多視窗骨架（透明角色視窗 + 輸入視窗 + 記錄 + 設定）
- 角色拖曳、點擊開關輸入視窗
- 懸停選單（強制發話、禁言、設定、移除）
- 首次啟動自動匯入兩個預設角色（紀天行、汪逸彤）
- OpenAI API 呼叫流程（含情緒解析）
- 對話記錄（顯示、刪除訊息、開新對話）
- 設定視窗（LLM 設定、世界觀、使用者 Persona、記憶、資料路徑）
- TypeScript 型別檢查：0 錯誤
- electron-vite build：成功產出 `out/`

### ⚠️ 已建但待驗證
- **實際 API 對話**：流程寫好了，但還沒真正用 API Key 跑過一次
- **角色圖片顯示**：`local://` 協定邏輯正確，但 Windows 路徑 encode/decode 需實機確認
- **點擊穿透（click-through）**：`setIgnoreMouseEvents` + mousemove 的邏輯已寫，需測試

### ❌ 未做（規格書有，程式碼無）
- **角色庫視窗**（Stage 2）：管理所有角色卡、召喚到桌面
- **多角色群組對話協調器**（Stage 2）：被點名優先、輪次控制
- **Claude / Gemini / Grok adapter**（Stage 3）
- **情緒圖片切換**（Stage 3）：27 種情緒對應不同圖片
- **截圖功能**（Stage 3）
- **ST 角色卡匯入 PNG 格式**（Stage 3）：tEXt chunk 解析
- **對話記憶摘要**（Stage 4）：超過閾值自動摘要
- **API Key safeStorage 加密**（Stage 4）：目前明文存 JSON
- **系統匣完整功能**（Stage 4）
- **electron-builder .exe 打包測試**（Stage 4）

---

## 已知問題 / 技術債

1. **`tailwind.config.ts` 殘留**：可以刪除，已改用 `tailwind.config.js`（PostCSS 無法 require TS 設定檔）
2. **production 環境 assets 路徑**：`initDefaultCharacters()` 用 `app.getAppPath()` 找 `assets/`，production 環境要改成 `process.resourcesPath`
3. **API Key 明文儲存**：Stage 4 要改用 `electron.safeStorage` 加密
4. **群組對話 Stage 1 簡化**：目前所有未禁言角色依序回應（非規格書的自然順序判定），Stage 2 再實作完整邏輯

---

## 視覺設計規則（不可隨意改動邏輯程式碼）

改視覺只改這幾個地方：
- `src/renderer/src/styles/theme.css` — CSS 變數（最有效）
- `tailwind.config.js` — 顏色、圓角、字型
- `src/renderer/src/styles/global.css` — 全域字型、scrollbar

主色系：薄荷綠 `#CBFBC4`、薄荷 `#AAEEDD`、天藍 `#AAEEFF`
背景：`#F7FFFC`、文字：`#3D5A52`
禁止：厚重陰影、毛玻璃、純黑文字、尖角設計

---

## 下一步建議順序

1. **驗收 Stage 1**：
   - `npm run dev` 啟動
   - ⚙️ 設定填入 OpenAI API Key（provider: openai, model: gpt-4o）
   - 點角色 → 輸入框 → 送出 → 確認角色有回應
   - 確認對話泡泡出現在角色頭上
   - 確認圖片正常顯示

2. **修 bug**（預期會有）：
   - 若角色圖片沒顯示 → 檢查 `local://` protocol handler，可在 DevTools Network 看 request URL
   - 若 API 錯誤 → 看 Log 視窗的系統訊息，或開 DevTools（main process）看 console

3. **開始 Stage 2**：
   - 角色庫視窗（`src/renderer/src/windows/CharacterLibraryWindow.tsx`）
   - 在 `windowManager.ts` 新增 `openCharacterLibraryWindow()`
   - HoverMenu 的 ➕ 按鈕連接到角色庫

---

## 給下一個 AI 的提示

- 改功能前先讀 `DesktopST-Spec.md` 對應章節
- 改視覺前先讀規格書 §13 和 `CLAUDE.md` 視覺設計原則
- IPC channel 名稱列表在 `src/main/ipcHandlers.ts`，新增功能要同步更新 preload 和 store
- 型別定義在兩個地方：`src/main/types.ts`（主程序）和 `src/renderer/src/types/index.ts`（renderer），要同步維護
- 規格書範圍外的功能先討論再實作，不要自行添加
