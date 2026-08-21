# GitHub Copilot 的用法（副駕，不是工單）

> Copilot 的形狀跟另外兩類助手不一樣：它**沒有專案全局觀**，強項是「你已經打開
> 這個檔案、游標就在這一行」的當下補完。所以這份不派獨立任務——派了它也做不好，
> 而是列出 owner 自己動手時該讓它幫什麼。

---

## 1. 它適合什麼

### 1.1 寫測試時補齊 case（最有價值的用途）

`T9`（補 appStore 測試）交給 Qwen3:8B 之後，如果覺得覆蓋不夠，
在 `tests/ui/appStoreAttach.test.ts` 裡打出 `it('` 讓 Copilot 接——
它看得到同檔案上文的假物件與既有 case，補同類型的變化很準。

同樣適用於 `tests/core/sync/` 底下那幾支表格驅動的測試：
寫好第一組 `{ input, expected }`，其餘讓它列。

**要驗證的是它有沒有偷改 expected 去迎合現有行為**——測試的意義是釘住規格，
不是複述實作。看到「它算出來是這樣所以 expect 這樣」就退回。

### 1.2 真機除錯時的即席查詢

owner 拿著手機測 S2 M4／M5（`real-device-checklist.md`）時，
遇到「這個函式到底在幹嘛」，用 Copilot Chat 的 `/explain` 比翻文件快。

限制：它的回答**只反映它看到的那段程式**，不知道專案的歷史決策。
凡是「為什麼要這樣做」的問題，答案在 `docs/progress-log.md`（用 Grep 找關鍵字），
不要問 Copilot——它會編一個聽起來合理的理由。

### 1.3 機械性的重複編輯

例如替一批新欄位加上型別、把一組 `switch` 補齊所有 case、
照著上面三行的格式再寫五行。這類它做得又快又對。

### 1.4 交叉檢查「這個東西還有誰在用」

`T5`（刪 `pushSettings()`）動手前，用 Copilot Chat 問
「`@workspace` 有誰呼叫 `pushSettings`」可以當第二意見。
但**最終判斷以 `grep -rn "pushSettings" src/` 為準**——
Copilot 的 workspace 索引不保證即時。

---

## 2. 它不適合什麼

| 不要用它做 | 為什麼 |
|---|---|
| 對話同步（T1） | 跨三層架構＋要新開端點。它看不到全局，會給出「看起來能跑」但架構錯的東西 |
| 任何 `src/core/` 的新邏輯 | `core/` 有硬規則（禁止 import electron／fs／path），它不知道，補完時很容易帶進來 |
| 決定「要不要同步某個設定」（T8） | 那是產品決定，不是程式問題 |
| 寫 commit message | 它只看得到 diff，寫得出「改了什麼」但寫不出「為什麼」。這個專案的 commit 與 progress-log 都要求寫為什麼 |
| 補註解 | 這個專案的註解記錄的是決策與踩過的坑，Copilot 只會複述程式在做什麼——那種註解是雜訊 |

---

## 3. 一條硬規則

**Copilot 補出來的東西，`npm run typecheck` 與 `npm test` 沒過就是沒完成。**
它最常見的錯是「型別看起來對、其實少一個欄位」，這兩個指令會抓到。
