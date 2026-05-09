# DesktopST 交接手冊（給下一個 AI）

> 最後更新：2026-05-09 19:30 (UTC+8)

---

## 目前狀態總覽

- 專案可啟動，核心視窗（角色 / 輸入 / 記錄 / 設定）可運作
- OpenAI 已改用 Responses API，並處理 `gpt-5*` / `o*` 的 temperature 參數限制
- 多角色回覆邏輯：主回覆者優先，其他角色視情況插話，含近似重複抑制
- 對話記錄支援：列出舊對話、載入、改名、刪除整份當前對話並切換下一份
- 獨立 Bubble 視窗（`BubbleWindow`）作為對話泡泡，與角色視窗脫鉤
- **本輪修正**：HoverMenu 佈局改為 flex row，修復按鈕無法 hover 的根本問題

---

## 已知問題狀態

### 1) HoverMenu 按鈕不出現 — **已修正（待實機驗證）**

**根因**：原本按鈕用 `translate-x-full` 推到父容器 `interactiveRef` 邊界外，滑鼠移向按鈕時 `onMouseLeave` 先觸發 → `hovered=false` → 按鈕消失。

**修法**（本輪已套用）：
- `CharacterWindow.tsx`：互動區改為 `flex items-start`，精靈與按鈕為同一容器的 flex 兄弟元素
- `HoverMenu.tsx`：移除 `absolute inset-0` 外層，按鈕改為 `flex flex-col`，不可見時 `width:0; overflow:hidden`
- 現在 `mouseleave` 只在滑鼠完全離開「精靈＋按鈕」整體時才觸發

**待做**：啟動後實測確認（`npm run dev`，滑鼠移到角色看按鈕是否出現）

### 2) Bubble 長文裁切 — **待實機驗證**

- 已從 `getBoundingClientRect()` 改 `scrollHeight`，高度上限放寬為工作區 75%
- 驗證方法：LogWindow → 點任一角色訊息 → `bubble:debug-show` 注入超長段落

### 3) `desktop:update-position` 大量 console log

- `ipcHandlers.ts` 裡有兩行 `console.log('[update-position]...')`，上線前記得移除

---

## 規格實作對照（vs DesktopST-Spec.md）

### 階段 1 MVP ✅ 大致完成

| 功能 | 狀態 |
|---|---|
| Electron + React + TS 骨架 | ✅ |
| 透明角色視窗 + 拖曳 | ✅ |
| 點擊角色開/關輸入視窗 | ✅ |
| OpenAI API 整合 | ✅ |
| 對話泡泡顯示最新訊息 | ⚠️ 已實作，穩定性待驗 |
| Log 視窗歷史 | ✅ 含 model badge、訊息刪除 |
| 基本角色卡編輯 | ✅ |
| 設定儲存 | ✅（尚未加密） |

### 階段 2 多角色與群組 ⚠️ 幾乎完成，差一項

| 功能 | 狀態 |
|---|---|
| 桌面同時多角色 | ✅ |
| 群組對話協調器 | ✅ 主回覆者 + 插話 + 重複抑制 |
| 強制發話 / 禁言 | ✅ |
| 全域世界觀設定（worldSetting / persona）| ✅ 已接 LLM |
| **角色庫視窗**（§4.8 卡片式 grid）| ❌ **未實作** — 目前只能在 SettingsWindow 管理角色 |

### 階段 3 完整 LLM 與素材 ⚠️ 部分完成

| 功能 | 狀態 |
|---|---|
| Claude / Gemini / Grok adapter | ❌ **未實作** — 只有 `openaiAdapter.ts`，UI 有下拉但非 OpenAI provider 會出錯 |
| 情緒圖片切換 | ⚠️ **半完成** — 資料結構和 LLM 解析情緒標記都有，但 `CharacterSprite` 不會換圖 |
| 截圖（框選 + 全螢幕）| ❌ **未實作** |
| 多圖上傳 | ⚠️ **半完成** — `Message.images[]` 欄位存在，InputWindow UI 狀況未確認 |
| ST 角色卡匯入 JSON | ✅ `character:import-json` 已處理 ST 欄位對應 |
| ST 角色卡匯入 PNG（tEXt chunk）| ❌ **未實作** |
| 系統時間注入 | ✅ |

### 階段 4 拋光 ❌ 幾乎全缺

| 功能 | 狀態 |
|---|---|
| 對話記憶自動摘要 | ❌ **未實作** — 欄位存在，邏輯未寫 |
| 對話 Session 管理 | ✅ 列出/載入/改名/刪除 |
| API Key 加密（safeStorage）| ❌ **未實作** — 目前純文字存 settings.json |
| 開啟資料夾按鈕 | ✅ |
| 打包成 .exe | ❌ 尚未確認 electron-builder 能成功 build |

### 其他小落差

| 項目 | 狀態 |
|---|---|
| 角色懸停按鈕「0.5 秒後淡出」| ⚠️ 目前滑鼠離開即淡出，規格要 0.5s 緩衝 |
| 首次啟動 Onboarding 流程 | ❌ 未實作 |

---

## 建議優先處理順序

1. **驗證本輪 hover 修復**（`npm run dev` 實測）
2. **驗證 Bubble 長文**（`bubble:debug-show` 注入超長段落）
3. **Claude / Gemini adapter**（影響可用性最大，改動範圍明確）
4. **情緒圖片切換**（`CharacterSprite` 接收 `emotion` prop → 切換圖片路徑）
5. **角色庫視窗**（規格 §4.8，獨立視窗實作）
6. **API Key 加密**（`safeStorage` 加解密，存/讀改一處即可）
7. 移除 `desktop:update-position` 的 console.log

---

## 關鍵檔案索引

| 用途 | 路徑 |
|---|---|
| Electron 主程序 | `src/main/index.ts` |
| IPC 處理器 | `src/main/ipcHandlers.ts` |
| 視窗管理 | `src/main/windowManager.ts` |
| LLM 介接 | `src/main/llm/openaiAdapter.ts` |
| 資料存取 | `src/main/fileStore.ts` |
| 角色視窗 | `src/renderer/src/windows/CharacterWindow.tsx` |
| 懸停選單 | `src/renderer/src/components/HoverMenu.tsx` |
| 泡泡視窗 | `src/renderer/src/windows/BubbleWindow.tsx` |
| 輸入視窗 | `src/renderer/src/windows/InputWindow.tsx` |
| 記錄視窗 | `src/renderer/src/windows/LogWindow.tsx` |
| 設定視窗 | `src/renderer/src/windows/SettingsWindow.tsx` |
| 全域 Store | `src/renderer/src/stores/useAppStore.ts` |
| 資料型別 | `src/main/types.ts` |

---

## 開發備註

- `src/main/*` 有改就需重啟 `npm run dev`（renderer 端熱重載，main 端不會）
- 使用者資料路徑：`%APPDATA%\DesktopST\`
- 目前狀態：可用但未穩定，優先目標是互動穩定性（hover / bubble）後再補功能
