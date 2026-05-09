# 角色庫功能 — 開發接手說明

給之後接手實作的 AI 或人類：先看本檔，再讀同資料夾的 `requirements.md`、`design.md`、`tasks.md`。

## Git worktree（平行開發）

| 路徑 | 分支 | 用途 |
|------|------|------|
| `E:\DesktopST` | `main` | 主線；可給 Claude Code 做其他功能（例如截圖按鈕） |
| **`E:\DesktopST-character-library`** | **`feat/character-library`** | **角色庫專用；請在本路徑開 Cursor 專案實作** |

**不要用同一個資料夾切分支跟主線搶工作目錄**；角色庫一律在 `DesktopST-character-library` 改程式。

建立 worktree 的指令（若需重建）：

```bash
cd E:\DesktopST
git worktree add E:/DesktopST-character-library feat/character-library
```

## 已決定的範圍

- 依 Kiro 三份規格實作「角色庫」UI + IPC + ST 匯入匯出等（見需求文件）。
- **測試**：以 `npm run typecheck` 與**手動驗收**為主；不需要先上 Vitest / fast-check property tests（除非之後要補）。
- **需求 4.2（分頁切換）**：若草稿有未儲存變更，切分頁時可先嘗試 `character:save`，失敗則阻止切換並提示（見先前計畫折衷說明）。

## 實作順序建議

對照 [`tasks.md`](./tasks.md) 的階段：Main（pngUtils、stCardMapper、ipcHandlers、windowManager）→ Renderer（路由、CharacterLibraryWindow、Editor 分頁）→ HoverMenu／設定入口 → CharacterSprite 情緒 fallback。

## 合併前檢查

- `npm run typecheck`
- 在 worktree 內提交；再對 `main` 發 PR 或以 `main` 為基底合併 `feat/character-library`（解衝突時留意 `HoverMenu`、`ipcHandlers` 等共用檔）。

## 相關程式錨點（實作時 grep）

- `character:save`、`character:delete`、`character:import-json`、`desktop:add-character`：`src/main/ipcHandlers.ts`
- 角色目錄：`src/main/fileStore.ts`（`characters/{id}/card.json`）
- 視窗路由：`src/renderer/src/App.tsx`（將新增 `w=library`）

---

*本檔與 worktree 路徑由 2026-05 建立，若分支或路徑有變請更新此表。*
