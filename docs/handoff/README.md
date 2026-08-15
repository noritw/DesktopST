# 多模型分工交接（2026-08-15）

> 建立背景：owner 手上有三種可用的 AI 助手——另一台電腦上的本機模型
> （VS Code + Continue：Gemma4:E4B／Gemma4:12B／Qwen3:8B）、VS Code 附贈的
> GitHub Copilot、以及 Claude Code（Opus 5／Sonnet 5）。這一份是分派表；
> 各自的作業指示在同層的三份文件裡。

| 文件 | 給誰 | 內容 |
|---|---|---|
| `local-llm-tasks.md` | 本機模型（Continue） | 5 個獨立任務，每個附可直接貼的 prompt |
| `copilot-tasks.md` | GitHub Copilot | 副駕型工作，不是獨立工單 |
| `claude-code-prompt.md` | Claude Code 新對話 | 對話同步（真正的 S2 M4）開工 prompt |

---

## 1. 為什麼這樣分

判準是**「錯了會不會被自動抓到」**，不是任務大小。

- 能被 `npm test` ／ `npm run typecheck` 當場否決的 → 本機模型可以做。
  它寫錯了，指令會紅，owner 直接退回重來，成本是幾分鐘。
- **改壞了要等真機才發現**、或**要同時想清楚三層架構**的 → 留給 Claude Code。
  這類錯誤在 M3 那次已經付過學費（基準表整份是假的，資料愈同步愈多份，
  最後靠一次性腳本清電腦資料才收拾掉，見 `mobile-sync-m4-compare.md`）。
- 只有**人**能做的（真機驗證、Electron UI 點擊、APK 簽章）沒有分派給任何模型，
  列在 §3 讓 owner 自己排。

---

## 2. 分派總表

| # | 任務 | 指派 | 理由 |
|---|---|---|---|
| T1 | **對話同步**（真正的 S2 M4：`POST /api/sync-conversation-merge`、訊息聯集、分批推送、衝突呈現） | **Claude Code（新對話）** | 跨 `core/`／`mobile/runtime/`／`main/mobileServer.ts` 三層＋要新開端點＋要設計衝突 UI。唯一一個「想錯了測試也不會紅」的任務 |
| T5 | 清掉死碼 `pushSettings()` | **Qwen3:8B** | 單檔、機械、`typecheck` 直接驗 |
| T9 | 補兩個 bug 修復的單元測試 | **Qwen3:8B** | 有現成範本（`tests/ui/messageMerge.test.ts`），`npm test` 直接驗 |
| T6 | progress-log 補三筆缺漏條目 | **Gemma4:12B** | 素材齊全（commit＋設計文件），是改寫不是創作；純文件，改壞不影響程式 |
| T8 | 模組子設定同步範圍盤點 | **Gemma4:12B** | 讀多檔→產表格，**不改程式**，錯了也只是表格要重做 |
| T7 | gap-inventory 過期內容校正 | **Gemma4:E4B** | 已把「哪一行改成什麼」寫死在任務裡，等同帶格式的取代 |
| T2 | 真機驗證 checklist 整理 | **Gemma4:E4B** | 從兩份設計文件抽 12 條重排成可勾選清單，純擷取 |
| — | Copilot | 副駕 | 見 `copilot-tasks.md`——不派工單，用在 owner 自己編輯時 |

---

## 3. 只有人能做的（不分派給模型）

| 項目 | 需要什麼 | 出處 |
|---|---|---|
| S2 M4 比對畫面真機驗證（6 條） | Pixel 10a ＋ 電腦端 DeST | `mobile-sync-m4-compare.md` §7 |
| S2 M5 設定同步真機驗證（6 條） | 同上 | 同上 §8.6 |
| 本機 LLM 桌面設定視窗實點 | 跑得起來的 Electron | `local-llm-provider-plan.md` §9.4 |
| 本機 LLM 手機真機驗證 | 重打 APK；**特別看 30 秒逾時改動的副作用**（那條影響所有手機請求，不只本機模型） | 同上 §9.2 第 2 點 |
| B3 階段 7 正式 APK／散布 | 簽章金鑰 | `CLAUDE.md` §4 |
| v0.4.0 真機煙測（配色／新聞泡泡／遙控） | 真機 | 同上 |

T2 那份 checklist 做出來之後，這一欄的前兩項會變成「照著勾」。

---

## 4. 所有模型都必須遵守（貼 prompt 時已內含，這裡是備查）

摘自 `CLAUDE.md` §3／§5，違反這幾條的產出一律退回：

1. **分支是 `feat/mobile-standalone`**，開工前先 `git pull`。不要開新分支、不要動 `main`。
2. **業務邏輯寫在 `src/core/`**，`src/mobile/` 與 `src/main/mobileServer.ts` 只做薄轉呼叫。
3. **改完資料一定要** `events.push({ kind: 'state-invalidated', reason: ... })`，
   否則畫面停在舊資料，看起來像沒生效。
4. **`src/core/` 禁止 import electron／fs／path。**
5. 收工前必跑 `npm run typecheck` 與 `npm test`，兩個都要過才算完成。
   > `tests/prompt/promptUtils.test.ts` 有 2 個時區相關的 snapshot 在部分機器上本來就會失敗，
   > 那 2 個不算（判準：跟你改的東西無關）。其餘全過。
6. **不做規格外功能**，有想法先問 owner。
7. **不要整份讀長文件**（`DesktopST-Spec.md`／`b3-mobile-ui-plan.md`／`progress-log.md`／
   `multi-device-platform-roadmap.md`），用 Grep 找關鍵字或只讀指定章節。
8. 一次一個任務、一個 commit，不要順手改別的東西。

### 已否決、不要重提

雲端同步後端、React Native 重寫、手機重寫一份 prompt 邏輯、NAS 當 host、
付費模式、Relay 代排程、RTC 半夜喚醒、把 HTML 打包進遙控 APK、Spotify 自動選歌。

---

## 5. 本機模型的實務注意事項

Continue 給模型的上下文有限，**模型看不到你沒附進去的檔案**，它會照著印象編。
所以每個任務都列了「要附進上下文的檔案」，照著附，不要只貼任務描述。

小模型（尤其 E4B）常見失敗模式，看到就直接退回：

- 把註解整段刪掉重寫。這個 repo 的註解密度是刻意的（記錄「為什麼」與踩過的坑），
  **不要讓它「清理」註解**。
- 順手改了沒要求改的檔案。
- 宣稱「測試已通過」但其實沒跑過——**測試由 owner 自己跑**，不採信模型的宣稱。
- 把繁體中文改成簡體，或把中文註解翻成英文。
