# DesktopST 開發狀況記錄

> 上次更新：Session「Fix blank window, add character tab, HoverMenu ➕」

---

## 已確認正常運作

- 角色可拖動
- 點角色可以開 / 關輸入視窗
- Hover 選單出現

---

## 本次 Session 套用的修改

| 檔案 | 改了什麼 |
|---|---|
| `src/renderer/src/components/ErrorBoundary.tsx` | 新增 React ErrorBoundary，捕捉 render 錯誤並顯示錯誤訊息（不再一片白）|
| `src/renderer/src/App.tsx` | 每個視窗都包上 ErrorBoundary；fallback 顯示 Unknown window type（診斷 w 值）|
| `src/main/windowManager.ts` | dev 模式下 Input / Settings 視窗也開 DevTools（可看 console 錯誤）|
| `src/renderer/src/components/HoverMenu.tsx` | 新增「➕ 追加角色」按鈕（加入第一個未上桌的角色）|
| `src/renderer/src/windows/SettingsWindow.tsx` | 新增「角色」分頁：列出角色、上/移出桌面、inline 編輯表單、匯入 JSON |

---

## 已知問題與狀況

### 輸入視窗 / 設定視窗空白

- **ErrorBoundary** 已加入：如果是 React 錯誤，現在會顯示錯誤訊息而非空白
- **DevTools** 已加入：Input/Settings 視窗開啟時也會自動打開 DevTools（可看 console）
- 若仍空白：請在 DevTools console 裡確認是否有錯誤

### 潛在原因（待確認）

1. `w` 參數讀取正確（有 ErrorBoundary fallback 顯示 w 值可確認）
2. React render 錯誤（ErrorBoundary 會顯示）
3. CSS/Tailwind 未套用（InputWindow 已改用 inline style，不依賴 Tailwind）

---

## 尚未實作（規格書有、程式碼沒有）

- 設定視窗「角色」分頁缺少：角色圖片更換、情緒設定
- HoverMenu「➕」目前只能加第一個可用角色，無多選 picker

---

## 技術棧提醒

- `src/main/` 改動 → 必須重開 `npm run dev`
- `src/renderer/` 改動 → HMR 自動套用，重新開關視窗即可
- 所有使用者資料在 `%APPDATA%\DesktopFamiliar\`（重開不會消失）
