# Implementation Plan: 角色庫管理介面（character-library）

## Overview

依照 design.md 的架構，分六個階段實作：
1. 安裝套件與建立 Main Process 工具層（pngUtils、IPC handlers、windowManager 擴充）
2. Renderer 基礎層（useCharacterLibraryStore、CharacterLibraryWindow 骨架、App.tsx 路由）
3. CharacterCard 與 ContextMenu
4. CharacterEditor 四個分頁
5. CharacterSprite 情緒圖片切換修復
6. HoverMenu 角色庫入口按鈕
7. 測試（property-based tests + unit tests）

---

## Tasks

- [ ] 1. 安裝套件並建立 PNG 工具層
  - [ ] 1.1 安裝 `png-chunks-extract`、`png-chunks-encode`、`png-chunk-text`、`fast-check` 套件
    - 執行 `npm install png-chunks-extract png-chunks-encode png-chunk-text`
    - 執行 `npm install --save-dev fast-check @types/png-chunks-extract @types/png-chunk-text`
    - 確認 `package.json` 已更新
    - _Requirements: 8.1, 10.2_

  - [ ] 1.2 建立 `src/main/pngUtils.ts`
    - 實作 `extractCharaJson(buffer: Buffer): string`：使用 `png-chunks-extract` 取得所有 chunk，找 type=`tEXt` 且 keyword=`chara` 的 chunk，以 `png-chunk-text` 解析後 base64 decode 為 UTF-8 字串；若找不到則拋出 `Error('此 PNG 不包含 ST 角色卡資料')`
    - 實作 `embedCharaJson(pngBuffer: Buffer, jsonStr: string): Buffer`：將 jsonStr 以 UTF-8 → base64 編碼，用 `png-chunk-text` 建立 keyword=`chara` 的 tEXt chunk，以 `png-chunks-encode` 插入原始 PNG 的 IDAT chunk 之前
    - 兩個函數都加上 try/catch，讓呼叫端決定如何處理錯誤
    - _Requirements: 8.1, 8.2, 10.2, 10.4_

  - [ ]* 1.3 撰寫 property test：PNG tEXt chunk round-trip（Property 13）
    - 建立 `src/main/__tests__/pngUtils.test.ts`
    - 使用 fast-check `fc.string()` 生成隨機 JSON 字串，驗證 `extractCharaJson(embedCharaJson(minimalPng, json)) === json`
    - 準備一個最小合法 PNG buffer（1×1 透明 PNG）作為測試基底
    - 至少執行 100 次迭代
    - **Property 13: PNG tEXt Chunk Round-Trip**
    - **Validates: Requirements 8.1, 10.2, 10.4**

- [ ] 2. 建立 ST 欄位對應工具與測試
  - [ ] 2.1 建立 `src/main/stCardMapper.ts`
    - 實作 `importStJson(raw: unknown): Character`：依 design.md 欄位對應表解析 ST JSON，`description` + `\n` + `personality` → `character.personality`，`name` 空字串時使用 `"Unknown"`，`emotions` 初始化為 `{}`，`createdAt`/`updatedAt` 設為 `Date.now()`
    - 實作 `exportToStJson(char: Character): string`：產生符合 ST `chara_card_v2` 格式的 JSON 字串，`personality` → `description`，`""` → `personality`
    - 更新 `ipcHandlers.ts` 的 `character:import-json` handler 改用 `importStJson`（修正現有欄位對應錯誤）
    - _Requirements: 7.2, 7.5, 9.2_

  - [ ]* 2.2 撰寫 property tests：ST 欄位對應（Properties 9、11、12）
    - 建立 `src/main/__tests__/stCardMapper.test.ts`
    - **Property 9: ST JSON 匯入欄位對應正確性** — 使用 fast-check 生成隨機 ST JSON 物件，驗證 `name`、`personality`（description+personality 合併）、`firstMessage`、`exampleDialogue` 對應正確
    - **Property 11: JSON 匯出欄位對應正確性** — 驗證 `exportToStJson` 的 `name`、`description`、`first_mes`、`mes_example` 欄位
    - **Property 12: JSON 匯出再匯入 Round-Trip** — 驗證 `importStJson(JSON.parse(exportToStJson(char)))` 在 7 個欄位上與原始資料相同
    - **Validates: Requirements 7.2, 7.5, 9.2, 9.7**

- [ ] 3. 新增 Main Process IPC handlers 與 windowManager 擴充
  - [ ] 3.1 在 `windowManager.ts` 新增 `createCharacterLibraryWindow()`
    - 建立 `w=library` 的 BrowserWindow，尺寸 800×600，`frame: false`，`backgroundColor: '#F7FFFC'`，`alwaysOnTop: true`，`skipTaskbar: false`
    - 若視窗已存在且未銷毀則呼叫 `win.focus()` 並回傳現有視窗
    - 匯出 `getCharacterLibraryWindow()` 供 IPC handler 使用
    - 將新視窗加入 `broadcastToAll` 的廣播清單（加入 `getAuxWindows()` 或獨立追蹤）
    - _Requirements: 1.1, 10.1_

  - [ ] 3.2 在 `ipcHandlers.ts` 新增角色庫相關 IPC handlers
    - `character-library:open`：呼叫 `createCharacterLibraryWindow()`，回傳 `true`
    - `character:import-png`：接收 `{ buffer: ArrayBuffer }`，呼叫 `pngUtils.extractCharaJson`，再呼叫 `importStJson` 建立角色，儲存至 fileStore，廣播 `characters:updated`；失敗時回傳 `{ error: string }`
    - `character:export-json`：接收 `Character`，呼叫 `exportToStJson`，回傳 `{ json: string }`；失敗時回傳 `{ error: string }`
    - `character:export-png`：接收 `Character`，讀取 `character.avatar` 圖片（若無則使用內建 1×1 佔位 PNG），呼叫 `embedCharaJson`，回傳 `{ buffer: ArrayBuffer }`；失敗時回傳 `{ error: string }`
    - `character:save-avatar`：接收 `{ id, buffer: ArrayBuffer, ext }`，驗證 ext 在允許清單，寫入 `characters/{id}/avatar.{ext}`，回傳 `{ path: string }`；id 不存在或寫入失敗時回傳 `{ error: string }`
    - `character:save-emotion-sprite`：接收 `{ id, filename, buffer: ArrayBuffer, ext }`，驗證 ext，寫入 `characters/{id}/emotions/{filename}.{ext}`（衝突時加時間戳記前綴），回傳 `{ path: string }`；失敗時回傳 `{ error: string }`
    - 所有 handler 以 try/catch 包覆，確保例外不傳播（Property 14）
    - _Requirements: 10.1–10.7_

  - [ ]* 3.3 撰寫整合測試：IPC handler 例外安全性（Property 14）
    - 建立 `src/main/__tests__/ipcHandlers.integration.test.ts`
    - Mock `fs` 模組使其拋出例外，驗證各 handler 回傳 `{ error: string }` 而非拋出
    - 驗證 `character:save-avatar` 與 `character:save-emotion-sprite` 儲存至正確路徑（1-2 個範例）
    - **Property 14: IPC 例外安全性**
    - **Validates: Requirements 10.7**

- [ ] 4. Checkpoint — 確認 Main Process 層可編譯
  - 執行 `npm run typecheck`，確認 `pngUtils.ts`、`stCardMapper.ts`、`ipcHandlers.ts`、`windowManager.ts` 無型別錯誤
  - 確認所有新增 IPC channel 已在 `registerIpcHandlers()` 中呼叫
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. 建立 Renderer 基礎層
  - [ ] 5.1 建立 `src/renderer/src/stores/useCharacterLibraryStore.ts`
    - 使用 Zustand 建立 `CharacterLibraryStore`，包含：`editingCharacterId: string | null`、`contextMenu: { characterId: string; x: number; y: number } | null`、`exportMenuCharId: string | null`
    - 實作 actions：`openEditor`、`closeEditor`、`openContextMenu`、`closeContextMenu`、`openExportMenu`、`closeExportMenu`
    - _Requirements: 1.4, 1.5_

  - [ ] 5.2 在 `App.tsx` 新增 `w=library` 路由
    - import `CharacterLibraryWindow`（路徑 `./windows/CharacterLibraryWindow`）
    - 在 window type 判斷中加入 `if (w === 'library') return <ErrorBoundary><CharacterLibraryWindow /></ErrorBoundary>`
    - _Requirements: 1.1_

  - [ ] 5.3 建立 `src/renderer/src/windows/CharacterLibraryWindow.tsx` 骨架
    - 實作標題列（drag-region）：顯示「角色庫」、「＋ 新增」按鈕、「匯入 ST 角色卡」按鈕（觸發 JSON/PNG 選擇）、關閉按鈕（呼叫 `window:close-self`）
    - 實作 Grid 容器（`grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))]`），從 `useAppStore` 取得 `characters` 渲染 `CharacterCard`
    - 空清單時顯示引導提示文字
    - 點擊「＋ 新增」時建立新角色（`character:save` IPC）並呼叫 `openEditor`
    - 點擊「匯入 ST 角色卡」時開啟 `<input type="file" accept=".json,.png">` 並依副檔名呼叫對應 IPC
    - 在視窗 `mousedown`/`focus` 事件呼叫 `ui:aux-activated`
    - _Requirements: 1.1–1.6, 2.1–2.5_

- [ ] 6. 建立 CharacterCard 與 ContextMenu 元件
  - [ ] 6.1 建立 `src/renderer/src/components/CharacterCard.tsx`
    - Props：`character: Character`、`isOnDesktop: boolean`、`onClick`、`onContextMenu`
    - 顯示：頭像（`local://` 協定，圓角正方形 80×80，無頭像時顯示 MonoIcon user）、角色名稱、「桌面中」badge（`isOnDesktop` 為 true 時顯示）
    - 卡片最小寬度 120px，固定高度約 160px，hover 時輕微縮放效果
    - _Requirements: 1.2, 1.8_

  - [ ]* 6.2 撰寫 property tests：Grid 完整性與桌面標記一致性（Properties 1、2）
    - 建立 `src/renderer/src/__tests__/CharacterLibraryWindow.test.tsx`
    - **Property 1: Grid 完整性** — 使用 fast-check 生成隨機角色清單（minLength: 1），驗證渲染的 CharacterCard 數量等於清單長度
    - **Property 2: 桌面標記一致性** — 使用 fast-check 生成隨機角色集合與桌面狀態，驗證「桌面中」badge 顯示與 `desktopCharacters` 一致
    - **Validates: Requirements 1.2, 1.8**

  - [ ] 6.3 建立 `src/renderer/src/components/ContextMenu.tsx`
    - Props：`characterId`、`isOnDesktop`、`position`、`onClose`、`onEdit`、`onDelete`、`onExport`、`onSummon`
    - 選項：「編輯」、「刪除」（紅色）、「匯出」（展開子選單：JSON / PNG）、「召喚到桌面」（`isOnDesktop` 時 disabled）
    - 點擊選單外部時呼叫 `onClose`（useEffect + document click listener）
    - 刪除選項點擊後顯示 inline 確認對話框（非 `window.confirm()`），確認後呼叫 `character:delete` IPC
    - _Requirements: 1.4, 1.5, 3.1–3.6, 9.1_

  - [ ] 6.4 將 CharacterCard 與 ContextMenu 接入 CharacterLibraryWindow
    - 在 CharacterLibraryWindow 中使用 `useCharacterLibraryStore` 管理 `contextMenu` 狀態
    - CharacterCard 的 `onClick`/`onContextMenu` 呼叫 `openContextMenu`
    - 渲染 ContextMenu 並傳入對應 callbacks（`onEdit` → `openEditor`、`onSummon` → `desktop:add-character` IPC、`onExport` → `character:export-json` / `character:export-png` IPC）
    - 匯出 PNG/JSON 後使用 Electron `dialog.showSaveDialog` 讓使用者選擇儲存位置（透過新增 `file:save-dialog` IPC handler）
    - _Requirements: 1.4, 1.7, 1.8, 9.1–9.6_

- [ ] 7. 建立 CharacterEditor 四個分頁
  - [ ] 7.1 建立 `src/renderer/src/components/CharacterEditor.tsx` 骨架與分頁切換
    - Props：`characterId: string`、`onClose: () => void`
    - 從 `useAppStore` 取得角色資料，建立本地 `draft` state（`useState<Character | null>`）
    - 實作四個分頁 tab bar：「基本資訊」、「情緒圖片」、「進階」、「匯入／匯出」
    - 底部「儲存」按鈕：呼叫 `character:save` IPC，成功後顯示「已儲存」提示 2 秒
    - 實作 `ErrorToast` 元件（右下角，3 秒自動消失）供各分頁使用
    - _Requirements: 4.1, 4.7, 4.8_

  - [ ] 7.2 實作 `BasicInfoTab.tsx`
    - 欄位：名稱（input，maxLength=100）、主圖上傳區（點擊開啟 file picker，accept=`.png,.jpg,.jpeg,.gif,.webp`）、簡介（textarea）、個性（textarea）、招呼語（textarea）、對話範例（textarea）
    - 主圖上傳：驗證副檔名 → 呼叫 `character:save-avatar` IPC → 更新 `draft.avatar` → 顯示預覽（`local://` 協定）與尺寸（透過 `new Image()` 讀取 `naturalWidth`/`naturalHeight`）
    - 說明文字：「此圖片為角色站在桌面上顯示的主圖」
    - _Requirements: 4.3, 5.1–5.6_

  - [ ]* 7.3 撰寫 property test：圖片副檔名驗證（Property 5）
    - 建立 `src/renderer/src/__tests__/fileValidation.test.ts`
    - 實作 `isAllowedImageExt(ext: string): boolean` 工具函數（放在 `src/renderer/src/utils/fileValidation.ts`）
    - **Property 5: 圖片副檔名驗證** — 使用 fast-check `fc.string()` 生成隨機副檔名，驗證不在允許清單的副檔名回傳 false，允許清單內的回傳 true
    - **Validates: Requirements 5.5, 6.9**

  - [ ] 7.4 實作 `EmotionSpritesTab.tsx` 與情緒工具函數
    - 建立 `src/renderer/src/utils/emotionUtils.ts`：實作 `buildSpriteEntries(emotions: Record<string, string>): SpriteEntry[]`（反向計算圖片→情緒清單的視圖）、`updateEmotionAssignment(emotions, imagePath, selectedEmotions): Record<string, string>`、`removeEmotionSprite(emotions, imagePath): Record<string, string>`
    - 在 `EmotionSpritesTab` 中：顯示已上傳圖片清單（縮圖 + 檔名 + 尺寸 hint + 情緒多選下拉）、「新增情緒圖片」按鈕（呼叫 `character:save-emotion-sprite` IPC）、每筆記錄的刪除按鈕
    - 情緒下拉選單顯示 28 種情緒（`admiration（欽佩）` 格式），支援多選
    - 情緒選擇變更時即時更新 `draft.emotions`（不需點儲存才生效於 draft）
    - _Requirements: 4.5, 6.1–6.9_

  - [ ]* 7.5 撰寫 property tests：情緒對應更新（Properties 6、7）
    - 建立 `src/renderer/src/__tests__/emotionUtils.test.ts`
    - **Property 6: 情緒對應更新正確性** — 使用 fast-check 生成隨機圖片路徑與情緒名稱集合，驗證 `updateEmotionAssignment` 後被選中的情緒指向該路徑，未選中的不指向
    - **Property 7: 刪除情緒圖片清除所有對應** — 驗證 `removeEmotionSprite` 後 `emotions` 中無任何值等於被刪除的路徑
    - **Validates: Requirements 6.4, 6.5, 6.6**

  - [ ] 7.6 實作 `AdvancedTab.tsx`
    - 欄位：Scenario（textarea）、System Prompt 覆蓋（textarea，placeholder 說明留空使用全域設定）、作者備註（textarea）
    - 所有欄位雙向綁定至 `draft`
    - _Requirements: 4.4_

  - [ ] 7.7 實作 `ImportExportTab.tsx`
    - 「匯出為 JSON」按鈕：呼叫 `character:export-json` IPC → 透過 `file:save-dialog` IPC 讓使用者選擇儲存位置 → 寫入檔案
    - 「匯出為 PNG 角色卡」按鈕：呼叫 `character:export-png` IPC → 儲存對話框
    - 「匯入 ST 角色卡」按鈕：開啟 file picker（accept=`.json,.png`）→ 依副檔名呼叫 `character:import-json` 或 `character:import-png` IPC → 成功後關閉 editor 並重新開啟新角色的 editor
    - 失敗時顯示 ErrorToast
    - _Requirements: 4.6, 7.1–7.5, 8.1–8.7, 9.1–9.7_

  - [ ] 7.8 將 CharacterEditor 接入 CharacterLibraryWindow
    - 在 CharacterLibraryWindow 中，當 `editingCharacterId` 非 null 時，以 overlay 或側邊欄方式渲染 `CharacterEditor`
    - `CharacterEditor` 的 `onClose` 呼叫 `closeEditor`
    - _Requirements: 4.1–4.8_

- [ ] 8. Checkpoint — 確認角色庫視窗可正常開啟與操作
  - 執行 `npm run typecheck`，確認 Renderer 端無型別錯誤
  - 確認 `w=library` 路由可正常渲染
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. 修復 CharacterSprite 情緒圖片切換
  - [ ] 9.1 修改 `CharacterSprite.tsx` 接收 `emotion` prop 並切換圖片
    - 新增 Props：`emotion?: string`、`emotions?: Record<string, string>`（從 `CharacterWindow` 傳入）
    - 計算實際顯示路徑：`const displaySrc = (emotion && emotions?.[emotion]) ? emotions[emotion] : src`（`src` 為 `character.avatar`）
    - 若 `emotions[emotion]` 為空字串或 undefined，fallback 至 `src`（avatar）
    - 將 `displaySrc` 傳入 `<img>` 的 `src`（使用 `local://` 協定）
    - _Requirements: 6.7_

  - [ ] 9.2 更新 `CharacterWindow.tsx` 傳遞 emotion 與 emotions 給 CharacterSprite
    - 從 `useAppStore` 的 `selectCharacterLastMessage` 取得最新訊息的 `emotion` 欄位
    - 從 `useAppStore` 的 `selectCharacter` 取得 `character.emotions`
    - 將 `emotion` 與 `emotions` 傳入 `CharacterSprite`
    - _Requirements: 6.7_

  - [ ]* 9.3 撰寫 property test：情緒 Fallback 不變量（Property 8）
    - 建立 `src/renderer/src/__tests__/CharacterSprite.test.tsx`
    - **Property 8: 情緒 Fallback 不變量** — 使用 fast-check 生成隨機 emotion 字串與 emotions 物件，驗證當 `emotions[emotion]` 為空字串或 undefined 時，元件渲染 `character.avatar` 的 src
    - **Validates: Requirements 6.7**

- [ ] 10. 在 HoverMenu 新增角色庫入口按鈕
  - [ ] 10.1 在 `HoverMenu.tsx` 新增「角色庫」按鈕
    - 在 `buttons` 陣列中，於「設定」按鈕之前插入「角色庫」按鈕
    - 按鈕 icon：使用書本或資料夾形狀的 SVG（與現有 Icon 元件風格一致，inline SVG）
    - `title`：`'開啟角色庫'`
    - `onClick`：`() => window.api.invoke('character-library:open')`
    - _Requirements: 1.1_

- [ ] 11. 新增 `file:save-dialog` IPC handler
  - [ ] 11.1 在 `ipcHandlers.ts` 新增 `file:save-dialog` handler
    - 接收 `{ defaultPath: string; filters: Array<{ name: string; extensions: string[] }> }`
    - 呼叫 Electron `dialog.showSaveDialog`，回傳 `{ filePath: string | undefined }`
    - 若使用者取消則回傳 `{ filePath: undefined }`，不視為錯誤
    - 在 `ipcHandlers.ts` 頂部 import `dialog` from `electron`
    - _Requirements: 9.2, 9.3, 9.5_

- [ ] 12. 撰寫新角色初始狀態不變量測試（Property 3）
  - [ ]* 12.1 在 `CharacterLibraryWindow.test.tsx` 補充 Property 3 測試
    - **Property 3: 新角色初始狀態不變量** — 驗證「＋ 新增」建立的角色 `emotions === {}`、`createdAt` 與 `updatedAt` 為正整數且 `createdAt <= updatedAt`
    - **Validates: Requirements 2.4**

- [ ] 13. 撰寫刪除角色同步移除桌面狀態測試（Property 4）
  - [ ]* 13.1 在 `ipcHandlers.integration.test.ts` 補充 Property 4 測試
    - **Property 4: 刪除角色同步移除桌面狀態** — 驗證 `character:delete` 後 `settings.ui.desktopCharacters` 不再包含該 `characterId`
    - **Validates: Requirements 3.4**

- [ ] 14. Final Checkpoint — 完整驗收
  - 執行 `npm run typecheck`，確認全專案無型別錯誤
  - 執行 `npm run lint`，確認無 lint 錯誤
  - 確認所有測試通過
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- 標記 `*` 的子任務為選填，可跳過以加速 MVP 開發
- 每個任務都引用了對應的需求條款，確保可追溯性
- Checkpoint 任務確保每個階段的增量驗證
- Property tests 使用 fast-check，每個 property 至少執行 100 次迭代
- Unit tests 驗證邊界條件（空字串、undefined、不合法副檔名）
- `pngUtils.ts` 與 `stCardMapper.ts` 放在 Main Process（`src/main/`），因為需要 Node.js `fs` 與 `Buffer`
- `emotionUtils.ts` 與 `fileValidation.ts` 放在 Renderer（`src/renderer/src/utils/`），為純函數，可在 Renderer 端直接呼叫
- `CharacterEditor` 以 overlay 方式覆蓋在 Grid 上，不需要另開視窗
- 情緒圖片的 `local://` 協定已在現有程式碼中使用，新功能沿用相同模式
- `file:save-dialog` IPC 讓 Renderer 觸發系統儲存對話框，符合 Electron 安全模型

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "5.1", "5.2"] },
    { "id": 4, "tasks": ["3.3", "5.3", "11.1"] },
    { "id": 5, "tasks": ["6.1", "7.1", "9.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "7.2", "7.4", "7.6", "9.2"] },
    { "id": 7, "tasks": ["6.4", "7.3", "7.5", "7.7", "9.3", "10.1"] },
    { "id": 8, "tasks": ["7.8", "12.1", "13.1"] }
  ]
}
```
