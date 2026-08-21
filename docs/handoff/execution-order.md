# 兩路並行的執行順序（2026-08-15）

> 前提：本機模型一次只能跑一個（Mac Mini M4 / 16GB），所以實際是**兩路**——
> 一路本機模型、一路 Claude Code。這份講「誰先誰後、哪裡會撞車」。
> 任務內容本身在 `local-llm-tasks.md` 與 `claude-code-prompt.md`。

---

## 1. 結論：可以並行，但有兩條硬約束

| # | 約束 | 為什麼 |
|---|---|---|
| **C1** | **T5 必須在 Claude 開始寫 T1 的程式之前完成** | 兩者都改 `src/mobile/runtime/syncPush.ts`（該檔第 141 行有 `conversations: {}`，對話同步一定會動到它）。而且留著死碼會讓 Claude 誤以為設定推送有兩條路 |
| **C2** | **T6 必須在 Claude 寫 progress-log 之前完成** | 兩者都寫 `docs/progress-log.md`。T6 補的是 08-14／08-15 三筆，Claude 完工後要再追加一筆。順序反了會變成日期亂序 |

除這兩條之外**沒有其他重疊**——其餘任務不是新檔案，就是各自獨立的檔案。

### 檔案歸屬（照這個分，就不會撞）

| 誰 | 擁有哪些檔案 |
|---|---|
| 本機模型 | `docs/` 底下全部（除了 `mobile-mode-switch-sync.md`）、`tests/ui/appStoreAttach.test.ts`、T5 那一次的 `syncPush.ts` |
| Claude Code | `src/` 全部、`tests/` 除上面那一支、`docs/mobile-mode-switch-sync.md`、最後一筆 progress-log 與 `CLAUDE.md` §4 |

**兩邊都要：commit 前先 `git pull --rebase`。**

---

## 2. 時間軸

```
        本機模型這一路                      Claude Code 這一路
─────────────────────────────────────────────────────────────────
階段 1  Qwen3:8B                            T1 的「先講方案」階段
        ├ T5 清死碼 pushSettings            （只討論，不碰任何檔案）
        └ T9 補 appStore 單元測試            ← 這段時間 Claude 零檔案異動，
                                               本機那路愛改什麼都行
─────────────────────────────────────────────────────────────────
        ★ C1 在這裡滿足：T5 已 push
─────────────────────────────────────────────────────────────────
階段 2  Gemma4:12B                          T1 開始實作
        ├ T6 progress-log 補三筆            （src/core/sync、src/mobile/runtime、
        │   （拆三次跑，見 §3）               mobileServer、SyncComparePicker、tests）
        └ T8 模組子設定盤點（新檔）
─────────────────────────────────────────────────────────────────
        ★ C2 在這裡滿足：T6 已 push
─────────────────────────────────────────────────────────────────
階段 3  Gemma4:E4B                          T1 繼續實作 → 完工
        ├ T7 gap-inventory 校正              收尾時追加 progress-log 一筆
        └ T2 真機 checklist（新檔）           ＋ 更新 CLAUDE.md §4
─────────────────────────────────────────────────────────────────
階段 4  （本機這路已清空）                   T1 完工，等 owner 真機驗證
        owner 拿 T2 產出的 checklist 上手機測
```

**為什麼照模型分組而不是照優先序**：換模型要重新載入權重，16GB 上 Gemma 12B
（Q4 約 7–8GB）跟 VS Code 搶記憶體，一來一回好幾分鐘。同一個模型的任務做完再換。

---

## 3. 16GB 的實務注意

- **Gemma4:12B 是這台機器的上限**，載進去之後 VS Code + Continue 已經吃掉不少。
  跑 T6／T8 時**不要一次附一堆長檔案**。
- **T6 建議拆成三次跑**，一次只做一筆條目、只附那一筆的素材：

  | 跑第幾次 | 寫哪一筆 | 只附這些 |
  |---|---|---|
  | 1 | 2026-08-14 S2 M4/M5 | `mobile-sync-m4-compare.md`（310 行）＋ progress-log 最後一筆當範本 |
  | 2 | 2026-08-15 本機 LLM | `local-llm-provider-plan.md` **只附 §9**（不是整份 402 行）＋ 同一份範本 |
  | 3 | 2026-08-15 兩個 bug | `git show 9b14840` 存成暫存檔 ＋ 同一份範本 |

  三次各自 commit 也可以，反正都只動同一個檔案的結尾。

- 如果 12B 明顯開始吃 swap（回應變得極慢），**T6／T8 改用 Qwen3:8B 也可以**，
  品質差一點但這兩個任務容錯高（純文件，改壞不影響程式）。

---

## 4. 每完成一個任務的收尾動作

不論哪一路，固定四步：

```bash
npm run typecheck        # 必過
npm test                 # 必過（時區那 2 個 snapshot 既有失敗不算）
git pull --rebase
git commit && git push
```

本機模型**不會**幫你跑前兩個，也不要相信它說「已通過」。自己跑。

---

## 5. 卡住時

- 本機模型做不出來 → `claude-code-prompt.md` 的 **prompt C**（讓 Claude 接手該任務）
- 本機模型產出沒把握 → `claude-code-prompt.md` 的 **prompt B**（讓 Claude review）
- 兩路真的撞在同一個檔案 → 以 Claude 那一路為準，本機那路重做（本機的任務都比較小）
