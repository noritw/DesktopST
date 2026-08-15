# 本機模型任務單（VS Code + Continue）

> 對象：Gemma4:E4B／Gemma4:12B／Qwen3:8B
> 分派理由與共同規則見同層 `README.md`——**開工前請 owner 先讀過那份 §4、§5**。

## 怎麼用這份文件

每個任務都是獨立的，彼此沒有相依，順序隨意。流程固定：

```
1. git pull（分支 feat/mobile-standalone）
2. 把「要附進上下文的檔案」逐一加進 Continue 的 context
3. 貼「可直接貼的 prompt」那一段
4. 模型改完 → owner 自己跑 npm run typecheck && npm test
5. 通過才 commit，一個任務一個 commit
```

**測試一律由 owner 跑，不採信模型「我已經測過了」的說法。**

---

# T5｜清掉死碼 `pushSettings()`

**指派：Qwen3:8B**（單檔、機械、typecheck 直接驗）

## 背景

S2 M3 當初寫了一支 `pushSettings()` 準備推送設定，但後來 M5 改用完全不同的
架構重做（`src/mobile/runtime/syncSettingsApply.ts`，逐欄位比對＋三選項），
M3 那支從頭到尾**沒有任何呼叫端**，是死碼。留著會讓下一個人以為設定推送有兩條路。

已確認：`grep -rn "pushSettings" src/` 只有定義那一行，沒有呼叫。

## 要附進上下文的檔案

- `src/mobile/runtime/syncPush.ts`

## 驗收

- `pushSettings()` 整支移除，連同**只被它用到**的 import／helper 一起清掉
  （沒有其他人用才可以刪，有人用就留著）
- `npm run typecheck` 過
- `npm test` 過（`tests/mobile/syncPush.test.ts` 若有針對 `pushSettings` 的測試，
  一併移除那幾個 case；其餘測試不准改）

## 可直接貼的 prompt

```
你在 DesktopST 這個專案（Electron + React + TypeScript）的 feat/mobile-standalone 分支上工作。

任務：移除 src/mobile/runtime/syncPush.ts 裡的死碼函式 pushSettings()。

背景：這支函式是 S2 M3 時期寫的設定推送邏輯，後來 S2 M5 改用另一套架構
（src/mobile/runtime/syncSettingsApply.ts）重做，pushSettings() 從此沒有任何呼叫端。

要做的事：
1. 刪掉 pushSettings() 整支函式。
2. 檢查它上面的 import 和它專用的 helper 函式——只有它在用的才一起刪，
   還有別人在用的一律保留。
3. 如果 tests/mobile/syncPush.test.ts 裡有測 pushSettings 的 case，刪掉那幾個 case。
   其他測試一個字都不要改。

不要做的事：
- 不要順手重構、重新命名、調整格式，或「清理」任何註解。
  這個專案的中文註解是刻意寫的，記錄了踩過的坑，一律原樣保留。
- 不要改 syncSettingsApply.ts 或任何其他檔案。

改完直接告訴我你刪了哪些東西，不要宣稱測試通過——測試我自己跑。
```

---

# T9｜補兩個 bug 修復的單元測試

**指派：Qwen3:8B**（有現成範本，`npm test` 直接驗）

## 背景

2026-08-15 修了兩個真機發現的 bug（commit `9b14840`），但**沒有補測試**：

1. **`isAttached()`**（`src/mobile/ui/stores/appStore.ts` 新增）——
   讓元件在 store 還沒 `attach()` 前能安全查詢，不會像 `getData()` 那樣 throw。
   載入中點右上角選單導致整個畫面變白，根因就是 render 途中 `getData()` 丟出
   未被攔截的例外，React 把整棵樹卸載。

2. **`send()` 的 `unreachable` 對帳分支**（同檔）——
   手機切到背景時系統會砍斷連線，讓送出中的請求失敗；但電腦端的 LLM 是獨立在跑的，
   不會因此停下。所以現在遇到 `unreachable` 會先 `refresh()` 對帳一次，
   如果樂觀訊息已經被伺服器版本取代，就不顯示錯誤泡泡（否則使用者會看到一則
   假的「連不上電腦」，然後真正的回覆過一下子才自己冒出來）。

## 要附進上下文的檔案

- `src/mobile/ui/stores/appStore.ts`（受測對象）
- `tests/ui/messageMerge.test.ts`（**風格範本**——同一支 store 的既有測試，照它的寫法）
- `src/core/data/types.ts`（`DataSource`／`DataError` 型別，寫假物件要用）
- `src/core/events/types.ts`（`EventSource` 型別，同上）

## 驗收

新檔 `tests/ui/appStoreAttach.test.ts`，至少涵蓋：

- `isAttached()` 在 `attach()` 之前回 `false`、之後回 `true`、`detach()` 之後回 `false`
- `send()` 遇到 `unreachable` 且對帳後樂觀訊息已被取代 → **不留下** `role: 'system'` 的錯誤訊息
- `send()` 遇到 `unreachable` 且對帳後樂觀訊息還在（電腦真的關機） → **要留下**錯誤泡泡
- `send()` 遇到其他錯誤碼（例如 `unauthorized`）→ 直接顯示錯誤，不做對帳

`npm test` 全過（時區那 2 個既有失敗不算）。

## 可直接貼的 prompt

```
你在 DesktopST 這個專案（Electron + React + TypeScript + Zustand + vitest）的
feat/mobile-standalone 分支上工作。

任務：為 src/mobile/ui/stores/appStore.ts 最近新增的兩處邏輯補單元測試，
新增檔案 tests/ui/appStoreAttach.test.ts。

受測目標一：isAttached()
  這支讓元件在 store 還沒 attach() 完成前能安全查詢連線狀態，不像 getData() 會 throw。
  要測：attach() 之前是 false、之後是 true、呼叫 attach() 回傳的 detach 函式之後回到 false。

受測目標二：send() 裡處理 DataError('unreachable') 的對帳分支
  行為規格：
  - sendMessage() 丟出 unreachable → 先呼叫一次 refresh() 對帳
    - 對帳後樂觀訊息（id 以 "optimistic:" 開頭那則）已經不在 messages 裡
      → 視為其實有送達，不要留下任何 role: 'system' 的錯誤訊息，sending 要回到 false
    - 對帳後樂觀訊息還在 → 照原本流程把它換成 role: 'system' 的錯誤泡泡
  - sendMessage() 丟出其他錯誤碼（例如 unauthorized）→ 不做對帳，直接顯示錯誤泡泡

寫法要求：
- 照 tests/ui/messageMerge.test.ts 的風格（同一支 store 的既有測試），
  describe/it 的敘述用繁體中文，跟既有測試一致。
- 用假的 DataSource 與 EventSource 物件注入 attach()，不要碰真的網路。
  refresh() 會呼叫 data.getState()，你可以讓假物件回傳你要的 messages 來模擬對帳結果。
- 每個 it() 開始前把 store 重設乾淨，避免測試互相污染。

不要改 src/ 底下任何程式，只新增這一個測試檔。
不要宣稱測試通過——測試我自己跑。
```

---

# T6｜progress-log 補三筆缺漏條目

**指派：Gemma4:12B**（改寫而非創作，素材齊全；純文件，改壞不影響程式）

## 背景

`docs/progress-log.md` 最後一筆是 `## 2026-08-13（續十）`，但後面又做了三批事情
沒有記錄。這份 log 是「以前為什麼這樣做／踩過什麼坑」的唯一索引，斷掉之後
下一個接手的人（含 AI）會重複踩同樣的坑。

缺的三筆：

| 日期 | 主題 | 素材在哪 |
|---|---|---|
| 2026-08-14 | S2 M4（逐項比對）＋ M5（設定同步） | `docs/mobile-sync-m4-compare.md`（整份，特別是 §8 與 §8.5b） |
| 2026-08-15 | 本機 LLM 供應商（`local`） | `docs/local-llm-provider-plan.md` §9 |
| 2026-08-15 | 兩個真機 bug：載入中點選單白畫面、背景等回應誤報網路錯誤 | commit `9b14840`（`git show 9b14840`） |

## 要附進上下文的檔案

- `docs/progress-log.md` 的**最後三筆條目**（不要整份 2355 行附進去，會塞爆上下文；
  用 `sed -n '2234,2355p' docs/progress-log.md` 取出來附上，當風格範本）
- `docs/mobile-sync-m4-compare.md`
- `docs/local-llm-provider-plan.md`
- `git show 9b14840` 的輸出（存成暫存檔附上）

## 驗收

- 三筆新條目追加在檔案**最後面**，日期順序正確
- 標題格式跟既有條目一致（`## YYYY-MM-DD｜主題` 或 `## YYYY-MM-DD（續N）｜主題`）
- 每筆都要寫到「**為什麼這樣做**」與「**踩到什麼坑**」，不能只寫「新增了 X 功能」——
  這份 log 的價值全在前者
- 繁體中文，語氣跟既有條目一致
- **只改 `docs/progress-log.md` 這一個檔案**

## 可直接貼的 prompt

```
你在 DesktopST 這個專案的 feat/mobile-standalone 分支上工作，這次只寫文件、不碰程式。

任務：docs/progress-log.md 的最後一筆是 2026-08-13（續十），但後面做的三批工作
沒有被記錄。請補上三筆新條目，追加在檔案最後面。

三筆分別是：
1. 2026-08-14｜S2 M4 逐項比對 ＋ M5 設定同步
   素材：docs/mobile-sync-m4-compare.md（重點在 §8 和 §8.5b）
2. 2026-08-15｜本機 LLM 供應商（local，Ollama / LM Studio 等 OpenAI 相容端點）
   素材：docs/local-llm-provider-plan.md §9
3. 2026-08-15｜兩個真機回報的 bug 修復（載入中點選單導致白畫面、
   切背景等本地模型回應後回來誤報網路錯誤）
   素材：我附上的 git show 9b14840 內容

寫作要求（這是最重要的部分）：
- 這份 log 的用途是讓未來的人查「以前為什麼這樣做、踩過什麼坑」。
  所以每一筆的重點是「為什麼這樣決定」與「踩到什麼坑」，
  不是「新增了什麼功能」的清單。只列功能等於白寫。
- 例如第 3 筆，重點應該是：白畫面的根因是 render 途中丟出未攔截的例外會讓
  React 把整棵樹卸載（不只是「加了個 disabled」）；網路錯誤的根因是
  「/api/send 是一個等 LLM 跑完才回應的長請求，手機切背景時系統會砍斷連線，
  但電腦端不會因此停下」。
- 格式、標題寫法、語氣完全照我附給你的既有條目（那是最後三筆，當範本用）。
- 繁體中文。不要用簡體字。

只改 docs/progress-log.md 這一個檔案，不要動任何其他檔案，不要碰 src/。
```

---

# T8｜模組子設定同步範圍盤點

**指派：Gemma4:12B**（讀多檔→產表格，不改程式，錯了也只是表格重做）

## 背景

S2 M5（設定同步）的比對範圍是逐欄位定義在 `src/core/sync/settingsSnapshot.ts`。
owner 2026-08-14 真機測時發現漏了 `weather.polish`——「天氣訊息要不要先過輔助模型潤飾」
這個子設定不在範圍裡，所以永遠不會被同步。補上之後留了一句話在
`mobile-sync-m4-compare.md` §8.5b：

> 模組除了 `enabled` 之外常常還帶自己的子設定（新聞的關鍵字組、提醒的喚醒模式……），
> 這些子設定要不要進同步範圍是逐個判斷的產品決定。**其餘模組的子設定尚未逐一檢查過**，
> 之後如果有人回報「這個模組的某個開關沒有一起帶過去」，大概率也是同一類遺漏。

這個任務就是把「尚未逐一檢查」補上——**只盤點、不實作**。要不要同步是 owner 的產品決定，
模型只負責把選項攤開讓 owner 勾。

## 要附進上下文的檔案

- `src/core/sync/settingsSnapshot.ts`（目前的同步範圍）
- `src/core/data/types.ts`（設定的型別定義）
- `src/mobile/data/localDataSource.ts`（`setWeather()` 一帶的合併寫法，是重要前例）
- `docs/mobile-sync-m4-compare.md` 的 §8.2 與 §8.5b

## 驗收

產出新檔 `docs/handoff/module-settings-audit.md`，內容是一張表：

| 模組 | 子設定欄位 | 型別 | 目前有沒有在同步範圍 | 建議 | 理由 |
|---|---|---|---|---|---|

規則：

- **「建議」欄只能填三種**：`建議同步`／`建議不同步`／`要 owner 決定`
- 已知的「明確不同步」不要建議同步，直接標理由（出自 `mobile-mode-switch-sync.md` §3.2）：
  - **API Key**——S2 任何情況都不碰
  - **天氣地點座標／地名／定位來源**——手機會移動且有 GPS，同步座標會讓你出門看到家裡的天氣
  - **桌寵座標／大小／翻面**——手機沒有桌面，推過去會洗掉電腦上排好的位置
  - **`lastTriggeredAt` 這類執行期狀態**——是狀態不是設定
- 最後補一段「**寫回時要注意的合併陷阱**」：參考 `localDataSource.ts` 的 `setWeather()`，
  子設定物件**不能整個覆蓋**，要跟預設值合併，否則會把沒送到的欄位清空

**不要改任何程式**，只產出這一份 markdown。

## 可直接貼的 prompt

```
你在 DesktopST 這個專案的 feat/mobile-standalone 分支上工作。
這是一個「盤點」任務：只讀程式、產出一份 markdown 表格，不要改任何程式碼。

背景：這個專案的手機版與電腦版之間有設定同步功能（S2 M5），同步範圍逐欄位
定義在 src/core/sync/settingsSnapshot.ts。最近發現漏了一個欄位 weather.polish
（天氣訊息要不要先過輔助模型潤飾），因為當初只比對了「模組開關 enabled」，
沒注意到模組底下還各自帶著自己的子設定。

任務：把所有模組的子設定逐一盤點出來，產出 docs/handoff/module-settings-audit.md，
內容是一張表，欄位如下：

| 模組 | 子設定欄位 | 型別 | 目前有沒有在同步範圍 | 建議 | 理由 |

「建議」欄只能填這三種其中之一：建議同步 / 建議不同步 / 要 owner 決定。
不確定的一律填「要 owner 決定」並寫清楚判斷卡在哪，不要自己猜。

以下幾類已經有明確結論，直接照抄理由、不要建議同步：
- API Key：設定同步任何情況都不碰金鑰
- 天氣的地點座標、地名、定位來源：手機會移動而且有 GPS，
  同步座標只會讓使用者出門在外看到家裡的天氣
- 桌寵的座標、大小、翻面：手機沒有桌面，推過去會把電腦上排好的位置洗掉
- lastTriggeredAt 這類執行期狀態：那是狀態不是設定

表格後面補一小段「寫回時的合併陷阱」：
說明子設定物件寫回時不能整個覆蓋、要跟預設值合併，
參考 src/mobile/data/localDataSource.ts 裡 setWeather() 的寫法，
並說明整個覆蓋會造成什麼後果。

繁體中文。只產出這一個 markdown 檔，不要修改任何 .ts / .tsx 檔案。
```

---

# T7｜gap-inventory 過期內容校正

**指派：Gemma4:E4B**（已把改法寫死，等同帶格式的取代）

## 背景

`docs/mobile-standalone-gap-inventory.md` 文首有兩處已經跟現況對不上：

1. **§0「額外發現：Persona 清單分頁切換 bug」**——這個 bug **早就修好了**
   （同一份文件的 §5 有記錄「2026-08-09 這一輪已完成：`open` 改寫回 `uiStore`
   堆疊 entry 的 `param`」），但 §0 還擺在文件最前面，讀的人會以為它還沒修。
2. **§1「一句話結論」**——寫「S2；M1 已完成，M2–M5 待做」，
   但 M2、M3、M4、M5 現在**全部都已實作完成**，真正還沒做的是**對話同步**。

## 要附進上下文的檔案

- `docs/mobile-standalone-gap-inventory.md`（整份，這份不長）

## 驗收

- §0 的標題改成明確標示已修復，並在內文開頭加一句指向 §5 的修復記錄。
  **不要刪掉根因與修法說明**——那段對未來排查同類問題仍然有用。
- §1 的表格更新成：M1–M5 已完成、**對話同步（訊息層聯集合併）尚未實作**。
- **只改這一個檔案**，其他一個字都不要動。

## 可直接貼的 prompt

```
你在 DesktopST 這個專案工作，這次只改一個 markdown 檔案，不碰任何程式碼。

檔案：docs/mobile-standalone-gap-inventory.md

要改兩個地方，其他地方一個字都不要動：

改動一：第 0 節「## 0. 額外發現：Persona 清單分頁切換 bug（非缺口，是既有 bug）」
這個 bug 其實已經在 2026-08-09 修好了（同一份文件的第 5 節有記錄修復內容），
但第 0 節還放在文件最前面，看起來像還沒修。
請把標題改成明確標示「已修復」，並在該節內文的最開頭加一句話，
說明已於 2026-08-09 修復、修復記錄見第 5 節。
重要：底下原本說明「現象」「根因」「修法方向」的段落全部原樣保留，不要刪，
那些內容對未來排查同類問題還有用。

改動二：第 1 節「一句話結論」的表格
現在寫的是 S2 同步「M1 已完成，M2–M5 待做」，這已經過期了。
實際現況是：M1、M2、M3、M4、M5 全部都已經實作完成，
真正還沒做的是「對話同步」（對話訊息層的聯集合併），那需要一個還沒開的新端點。
請照這個現況改寫該表格與周圍相關的敘述句。

繁體中文，用字風格跟文件其他部分一致。不要用簡體字。
只改 docs/mobile-standalone-gap-inventory.md 這一個檔案。
```

---

# T2｜真機驗證 checklist 整理

**指派：Gemma4:E4B**（純擷取重排）

## 背景

S2 M4／M5 各有 6 條待驗證項目，分散在設計文件的兩個章節裡，owner 拿著手機測的時候
要在文件裡翻來翻去。整理成一份可以直接勾的清單。

## 要附進上下文的檔案

- `docs/mobile-sync-m4-compare.md` 的 §7（M4 六條）與 §8.6（M5 六條）

## 驗收

產出新檔 `docs/handoff/real-device-checklist.md`：

- 12 條全部收錄，一條都不能漏，**原意不能改寫走樣**
- 每條開頭是 `- [ ] `，可直接勾
- 分成「S2 M4 比對畫面」與「S2 M5 設定同步」兩節
- 每條下面留一行 `　結果：` 讓 owner 手寫
- 開頭加一段前置條件：需要 Pixel 10a、電腦端 DeST 要開著、兩台在同一個 Wi-Fi

## 可直接貼的 prompt

```
你在 DesktopST 這個專案工作，這次只做文件整理，不碰程式碼。

任務：從 docs/mobile-sync-m4-compare.md 抽出兩組真機待驗證項目，
整理成一份可以直接勾選的清單，存成 docs/handoff/real-device-checklist.md。

來源：
- 該文件的 §7：S2 M4 比對畫面的 6 條待驗項目
- 該文件的 §8.6：S2 M5 設定同步的 6 條待驗項目

輸出格式：
- 分成「S2 M4 比對畫面」和「S2 M5 設定同步」兩個章節
- 每一條寫成 markdown 的可勾選項目，開頭是 - [ ]
- 每一條下面空一行寫「　結果：」，留給我測完手寫
- 文件最開頭加一小段「測試前準備」，說明需要：Pixel 10a 實機、
  電腦端 DeST 要開著、手機和電腦在同一個 Wi-Fi

最重要的要求：12 條一條都不能漏，而且每一條的意思要跟原文一致，
不要自己精簡或改寫成別的意思。看不懂的就照抄原文。

繁體中文。只產出這一個新檔案，不要修改任何既有檔案。
```
