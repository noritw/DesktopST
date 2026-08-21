# Claude Code 交接 prompt

> 用法：開一個新對話，把下面 **A** 整段貼進去（含程式碼框裡的全部內容）。
> B、C 是備用的小 prompt，需要時才用。

---

## A｜主任務：對話同步（真正的 S2 M4）

這是目前唯一「想錯了自動測試也不會紅」的任務——跨 `core/`／`mobile/runtime/`／
`main/mobileServer.ts` 三層、要新開端點、要設計衝突呈現。前一次同類任務（M3）
方向想錯，結果是電腦端資料愈同步愈多份，最後靠一次性腳本清理才收拾掉。
所以這份 prompt 刻意要求**先確認範圍再動手**。

```
先讀 CLAUDE.md，不要整份掃其他長文件。分支是 feat/mobile-standalone，開工前先 git pull。

## 任務

實作「對話同步」——手機與電腦之間的對話訊息雙向合併。這是 S2 同步的最後一塊。

## 先搞清楚一件事：M4 這個代號被用過兩次，意思不一樣

- docs/mobile-mode-switch-sync.md §8 的原始規劃裡，「M4」指的是**對話同步**（也就是這次要做的）
- 但實際開發時，「M4」被拿去命名「逐項比對」、「M5」命名「設定同步」，
  兩者都已經做完了（見 CLAUDE.md §4 的 S2 M4／M5 兩列）

所以：**對話同步從來沒有被實作過**，不管代號怎麼叫。
你在程式碼裡搜 `sync-conversation-merge` 會是零筆——那個端點還沒開。
`src/core/sync/diff.ts` 雖然算得出對話的差異數量，但 `pair.ts`／`syncApply.ts`／
`SyncComparePicker.tsx` 完全不處理對話，推不動也不顯示。

## 要讀的東西（只讀這些章節，不要整份讀）

1. docs/mobile-mode-switch-sync.md
   - §3.1／§3.2 —— 什麼同步、什麼明確不同步（每條都有理由，不要「順手加上去」）
   - §6.2 ② —— `POST /api/sync-conversation-merge` 的形狀已經定義好了
   - §7.3 —— 兩邊都改了同一筆時怎麼處理
   - ⚠️ §3.1 的表格裡對話那一列寫「見 §6.4」，但**那一節不存在**（斷掉的交叉參照）。
     聯集合併的規則實際只寫在 §3.1 那一格本身跟 §6.2 ②。順手把這個壞連結修掉
2. docs/mobile-sync-m4-compare.md —— 整份。這是「逐項比對」的落地筆記，
   裡面記錄了 M3 為什麼失敗，那個教訓直接決定這次的做法（見下）
3. src/core/sync/pair.ts 的檔頭註解 —— 同一個教訓的程式碼版本

## 必須沿用的既有教訓（不要重蹈）

M3 的失敗根因是**押寶在基準表（sync-baseline.json）上判斷「兩邊是不是同一個東西」**，
而那張表整份是假的：推送時記的是手機自己的 id，但電腦端收到後會丟掉送來的 id
自己發一顆新的 uuid，手機從沒讀過回應。於是每推一次就多一份重複，
而且**沒有任何自我修復路徑**，只會愈錯愈多。

M4（逐項比對）的修法是：**每次切換當場配對，不依賴任何歷史記錄**。
對話同步要沿用同一個原則。另外兩條也一起沿用：

- **判斷內容是否相同要看 contentHash，不能看 updatedAt**——
  推送會把接收端的時間設成現在，用 updatedAt 判斷永遠對不齊
- **雙邊的欄位子集定義只能有一份**，放在 core/ 讓兩端 import。
  M4 踩過「兩邊各自手打物件字面量、漂移一個欄位雜湊就永遠對不起來、
  而且不會有任何錯誤訊息」這個坑

## 這一版明確不要做

- 刪除同步（只標「僅在手機／僅在電腦」，不動另一邊）
- 欄位級合併（衝突就是衝突，讓使用者選邊，不做「各留一半」）
- 提醒（Reminder）—— §3.2 已列為明確不同步
- 新聞模組狀態、lastTriggeredAt 這類執行期狀態
- API Key —— S2 任何情況都不碰

## 一個一定會踩到的技術限制

訊息會帶圖片 data URI。整批送會在 CapacitorHttp 的 base64 bridge 上爆掉——
mobileServer.ts 已經為了同樣的理由，把訊息圖片的「讀取」做成一張圖一支請求、
不隨快照走（搜 `/api/message-image`，那段註解寫明了原因）。
**推送同樣要分批**：建議一次一則對話，單則內再依訊息數切塊。

## 有另一路在同時進行（重要）

我同時讓一個本機小模型在做雜項清理，兩路共用 feat/mobile-standalone 這個分支。
分工是：**本機那路擁有 docs/ 底下全部（除了 mobile-mode-switch-sync.md）
與 tests/ui/appStoreAttach.test.ts；你擁有 src/ 全部與其餘 tests/。**

具體約束兩條：

1. **src/mobile/runtime/syncPush.ts 裡有一支死碼 pushSettings()，本機那路會刪掉它。**
   你動這個檔案之前先 git pull。如果拉下來還在，就當它不存在、不要參考它
   （那是 S2 M3 的舊架構，M5 已經用 syncSettingsApply.ts 整個取代掉）。
2. **docs/progress-log.md 本機那路會補三筆 08-14／08-15 的條目。**
   你完工要寫 progress-log 時，先 git pull，確認那三筆在了，再把你這筆**追加在最後**。
   如果拉下來還沒有，先跟我說一聲，不要自己補那三筆。

每次 commit 前都 git pull --rebase。

## 硬規則

- 業務邏輯寫在 src/core/，src/mobile/ 與 mobileServer.ts 只做薄轉呼叫
- src/core/ 禁止 import electron／fs／path
- 改完資料要 events.push({ kind: 'state-invalidated', reason: ... })
- 每做完一個子功能就跑 npm test 與 npm run typecheck，不要累積到最後
  （tests/prompt/promptUtils.test.ts 有 2 個時區 snapshot 在這台機器上本來就會失敗，
   跟你的改動無關的話不算）
- 不做規格外功能

## 怎麼開始（重要）

**先不要寫程式。** 這塊改動範圍大，先給我：

1. 你打算怎麼切階段、每階段的驗收點是什麼
2. 衝突要怎麼呈現給使用者——現在的 SyncComparePicker 是「一列一個實體，
   左手機右電腦」，對話是訊息層的聯集合併，同一列裡可能兩邊都有對方沒有的訊息，
   這個 UI 形狀要怎麼處理？你的建議是什麼
3. 你判斷有哪些地方是「測試不會紅但可能想錯」的，打算怎麼降低風險

我確認過範圍再開工。涉及真機驗證的部分，做完提醒我開 USB 偵錯。
完工後要同步更新 CLAUDE.md §4 的現況表與 docs/progress-log.md，不要留給我自己記得。
```

---

## B｜備用：review 本機模型交回來的產出

本機模型（Gemma／Qwen）做完 `docs/handoff/local-llm-tasks.md` 裡的任務後，
如果 owner 對某一份產出沒把握，用這個。

```
先讀 CLAUDE.md。分支 feat/mobile-standalone。

我讓一個本機小模型（Continue + Qwen3:8B / Gemma4:12B）做了 docs/handoff/local-llm-tasks.md
裡的任務 T<編號>，它的改動已經在工作區（還沒 commit）。

請幫我 review，重點看：
1. 有沒有改到任務範圍以外的檔案
2. 有沒有把既有的中文註解刪掉或改寫——這個專案的註解記錄的是決策與踩過的坑，
   不是複述程式在做什麼，一律要原樣保留
3. 有沒有違反 CLAUDE.md §3 的硬規則（core/ 不碰 electron/fs/path、
   業務邏輯不要寫進 mobile/ 或 mobileServer.ts）
4. 如果是測試：那些 expect 是在釘住規格，還是只是複述目前的實作行為？
   後者沒有價值，要指出來
5. npm run typecheck 與 npm test 過不過

有問題直接改掉，改完告訴我你動了什麼。沒問題就說沒問題，不要為了有產出而硬找。
```

---

## C｜備用：本機模型卡住時接手

```
先讀 CLAUDE.md。分支 feat/mobile-standalone。

docs/handoff/local-llm-tasks.md 裡的任務 T<編號>，我交給本機小模型做但它做不出來
（狀況：<描述>）。請你直接接手完成。

任務的完整規格在那份文件的對應章節，包含背景、要改的檔案、驗收條件。
照那個規格做就好，不要擴大範圍。
```
