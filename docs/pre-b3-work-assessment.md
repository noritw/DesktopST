# B3 開工前的工作盤點與測試策略

> 狀態：**評估完成；owner 已決議（§8）；prompt 全等比對已執行完畢，48/48 相同（§6.3）**
> 日期：2026-08-03｜基準：`feat/mobile-standalone` @ `a87829c`（B1／B2 皆已完成）
>
> 起因：owner 詢問「B2 算完成了嗎？剛追加的 lorebook 與角色印象適合現在做嗎？
> 除此之外還有什麼工作要做？」
>
> 相關文件：`multi-device-platform-roadmap.md`（§2 四大目標、§4.4b B1／B2 成果、§10 順序）、
> `future-lorebook.md`、`future-character-impression.md`

---

## 0. 一句話

B2 程式面完成但**尚未驗證**；另外發現規劃缺了一塊（`fileStore` 沒抽，B3 會撞牆）。
Lorebook 建議現在做，角色印象建議排在 B3 之後。

---

## 1. B1／B2 現況

### 1.1 已完成（`feat/mobile-standalone`，13 個 commit，**已合併回 `main`**）

`core/` 目前已含：`types`、prompt 組裝、群組接龍、`stCardMapper`、`pngCard`、base64、
新聞 `types`／`keywordGroups`／`filter`／`topicState`／`trigger`、
`llm/` 全部（主流程 ＋ 四家 provider ＋ 記憶摘要）、`reminder/nextFire`、
五個 adapter 介面。桌面實作在 `src/main/adapters/`，renderer 已直接吃 core。

`typecheck` ＋ `electron-vite build` 全程通過，renderer bundle hash 未變。

### 1.2 兩個未結的尾巴（**這是「未完成」的部分**）

| 尾巴 | 現況 | 風險 |
|---|---|---|
| ~~實機從未驗證~~ | ✅ **已解（2026-08-03）**：owner 在分支上實測**四家 LLM 全部**、傳圖、API Key 重開後仍在，皆正常；另有 prompt 全等比對 48 情境零差異（§6.3）。**已合併回 `main`** | — |
| **Capacitor 從未執行** | 刻意沒做 `cap add android`、沒產 APK | 手機殼一行都沒跑過。若殼本身有問題，會在寫完數週 UI 後才知道。**仍待處理**，見 §5 |

> **合併決定的理由**：roadmap §11.1 原訂 B2 起留在獨立分支，但這 13 個 commit
> 實際上 90% 是純重構與桌面版零行為改變的 adapter 實作，Capacitor 只有一個設定檔
> 與 README、不會被執行。繼續掛分支反而正是該規則要防的「長命分支與 `main` 分歧」。
> **B3 真正開始寫手機 UI 時再開新分支。**

---

## 2. 新發現的缺口：`fileStore` 沒抽，B3 會撞牆（**本次盤點最重要的一項**）

### 2.1 事實

實查 `feat/mobile-standalone` @ `a87829c`：

```
src/main/fileStore.ts          989 行，128 處直接呼叫 fs / path
StorageAdapter 的呼叫端        0 個
SecretAdapter 的呼叫端         0 個
SchedulerAdapter 的呼叫端      0 個
NotifierAdapter 的呼叫端       0 個
HttpAdapter 的呼叫端           2 個（llm/index.ts、llm/summarizer.ts）
```

五個介面裡**只有 HTTP 真的被接上**，其餘四個目前是「定義好但沒人用」。

### 2.2 為什麼這是問題

`fileStore` 不只是讀寫檔案，它裡面混著**真正的業務邏輯**：

- 舊設定遷移（`migrateLegacySettings`：舊 `persona` / `worldSetting` 欄位轉 preset）
- 欄位正規化與預設值合併（`DEFAULT_SETTINGS` 的深層 merge）
- 模型 id 改名對照（`renameModelId`）
- API Key 的加解密與明文舊金鑰的自動 migration
- 對話 debug prompt 剪枝（`pruneConversationDebugPrompts`）

手機版要能存角色、對話、Persona／World／Scene、設定，就需要這些邏輯。

**但 roadmap 的 B 階段沒有任何一項寫著「把資料存取層抽出來」**——
B3 是「手機 UI」、B4 是「模組移植」。

→ 照現行規劃走，B3 寫手機 UI 寫到一半會發現沒有東西可以存，
於是在手機端重寫一份 `fileStore`。**那正是 §4.1 要防的 drift，而且發生在最核心的那份資料上**
（設定遷移寫歪 → 使用者升級後設定跑掉，且不會有錯誤訊息）。

### 2.3 建議：新增 B2.7

| 項目 | 內容 | 估時 |
|---|---|---|
| **B2.7** | `fileStore` 的邏輯抽進 `core/`，I/O 走 `StorageAdapter`；`secureStore` 走 `SecretAdapter` | **1–2 週** |

切法比照 B1 的既有慣例：

- **純的先走**：`migrateLegacySettings`、`DEFAULT_SETTINGS` 合併、`renameModelId`、
  `pruneConversationDebugPrompts` 都是純函式，可直接進 `core/store/`
- **I/O 收斂到 adapter**：`loadX` / `saveX` 改為收 `StorageAdapter` 參數
- **同步 vs 非同步是這一刀的主要難題**：現行 `fileStore` 全同步，
  而手機 Filesystem 只有非同步 API。B2 已預留 `SyncStorageAdapter` 給桌面沿用，
  但 core 的新邏輯要寫成非同步版 —— 這是 B2.7 要當場定案的形狀
- 桌面照舊走同步路徑，**行為不變**

**優先度高於 lorebook**，因為它是 B3 的真前提。

---

## 3. Lorebook：**建議現在做**

規格見 `future-lorebook.md`（已定案，無待決事項）。本節只記評估結論。

### 3.1 支持的理由

- 需求是**用語解說**（角色聽得懂專有名詞），不是完整世界觀資料庫。規格只實作 ST 子集，切得對
- 基礎設施全部現成：注入點（`buildSystemPrompt` 的 CONTEXT 區塊）、
  動態通道（`extraSystemContext`）、情境覆蓋（`moduleOverrides`）都不用新造
- 掃描是純函式，可直接寫 `core/lore/`，完整吃到 B1／B2 紅利
- 過 §2 四大目標：純本地、零成本、不外傳、預設不存在（不影響新手）

### 3.2 一處要修正的說法

`future-lorebook.md` §3.2 稱排在 B3 之前「成本 ≈ 0 額外」——**這講得太滿**。

桌面 UI 與手機 UI 本來就是兩份（roadmap §4.2 明載），
所以任何功能永遠要寫兩次 UI，不因排在 B3 前而免除。

正確的說法是：**在 B3 那一趟裡順手加，比 B3 結束後專程回頭補便宜**
（省的是回頭補的 context-switch，不是整份 UI）。是「順路」，不是「免費」。

這個修正不改變結論，但避免日後有人拿「免費」當理由塞更多東西進來。

### 3.3 拆法

| 階段 | 內容 | 估時 | 是否擋 B3 |
|---|---|---|---|
| **B2.5** | Lorebook core（型別、掃描、排序、預算裁切、ST 格式對映） | 3–5 天 | ✅ **擋**，手機 UI 要有東西可接 |
| **B2.6** | 桌面 UI ＋ ST 匯入匯出 ＋ 情境綁定 ＋ 角色卡自動生成條目 | 4–7 天 | ❌ 不擋，可延後 |

想壓縮時程就先做 B2.5、把 B2.6 挪到 B3 之後。

---

## 4. 角色印象：**建議排在 B3 之後**

規格見 `future-character-impression.md`（含 §3.4 角色對角色，已定案）。

### 4.1 它與 lorebook 性質不同，不該綁在一起排

| | Lorebook | 角色印象 |
|---|---|---|
| 資料來源 | 使用者自己打字 | **LLM 自動寫入** |
| 結果可預測性 | 完全可預測 | 要實際跑一段時間才知道抽得準不準 |
| 持續成本 | 無 | **持續花 token**；owner 常態同時跟多角色聊，成本是現行自動摘要的數倍 |
| 做完會結束嗎 | 會 | 大概會有數輪調參 |
| 驗收標準 | 條目有沒有注入（可測） | **「感覺對不對」（不可自動測）** |

Lorebook 是「加一個功能」；印象是「開一條需要持續觀察的戰線」。

**在 B3（4–8 週）開工前同時點火兩件事不明智**，尤其其中一件的驗收要靠手感。

### 4.2 它也不能切一半

`future-character-impression.md` §3.4.6 已載明：角色對角色的印象**不能單獨插隊**，
它需要的 `impressions.json`、全域開關、可看可編可刪 UI 全是主功能的地基。
所以這是一整包，沒有「只做一半先上」的選項。

### 4.3 結論

排在 **B3 之後**，接受 UI 要補兩次的成本（約兩三天）。
用那兩三天換掉「在最忙的階段引入一個要調參的自動機制」，划算。

**折衷選項**（若 owner 很想要）：現在只把 `UserImpression` / `CharacterImpression`
兩個型別定進 `core/types.ts`（半天），讓 B3 的手機 UI 在資料結構上不會撞到，
實作本身照樣延後。

---

## 5. B3 開工前的其他工作

| 項目 | 時機 | 說明 |
|---|---|---|
| ~~驗證並合併 B1／B2 分支~~ | ✅ **已完成 2026-08-03** | 四家 LLM 實測 ＋ 48 情境全等比對，已合併回 `main` |
| **Hello World APK 試打** | B3 前，1–2 天 | 證明殼跑得起來；順便驗 Gemini 那個「靠 Capacitor 全域 fetch patch 繞 CORS」到底成不成立（B1 收尾發現的已知限制）。不做等於閉著眼睛寫 4–8 週 UI |
| **`mobile.html` 功能對照清單** | B3 前，半天 | roadmap §3.0 是**硬性基準**：手機獨立版必須具備現行行動網頁版全部功能。3,290 行靠記憶對不完，要先列成可勾選的清單 |
| **`sources.ts` 的手機方案** | **B3 前**（新聞已確定納入手機 MVP，見 §8） | 用了 `crypto.createHash`（Node 專屬）與 `rss-parser`（需確認 WebView 可跑）。建議在 APK 試打時一併驗證 |
| **Android keystore** | 第一次發佈前 | **不擋 B3**。§10.5 仍待 owner 決定；弄丟等於所有使用者無法升級，AI 不應自行產生 |

---

## 6. 測試策略：哪些能自動、哪些只能靠人

> Owner 反映「很難用使用者角度驗收」。這一節就是要把**必須由人做的部分縮到最小**。

### 6.1 判準

一件事能不能自動測，取決於**它有沒有標準答案**：

- 「這段 prompt 應該長這樣」→ 有標準答案 → **可自動**
- 「角色這樣回話有沒有走味」→ 沒有標準答案 → **只能靠人**

B1 抽 core 的結果剛好把大量邏輯變成純函式（不碰網路、檔案、視窗），
**這些全部落在「可自動」那一側**。

### 6.2 可以自動測的（建議導入 vitest）

| # | 測什麼 | 為什麼有價值 |
|---|---|---|
| 1 | **prompt 組裝黃金測試**（`buildSystemPrompt` / `buildTriggerMessage` / `annotateTimeGaps` / `expandReactionAnnotations` / `contextMessages`） | **這是最有價值的一項。** 固定輸入 → 固定字串，任何人改壞 prompt 會立刻紅燈 |
| 2 | **群組接龍**（`isAddressed` / `pickPrimaryResponderId` / `sortRespondersByKeywordMatch` / `normalizeCharacterDialogue` / `stripOtherCharacterSpeakerLines`） | 「誰該回話」的判斷邏輯，錯了很難察覺 |
| 3 | **新聞篩選與加權抽選**（`filterAndPick`） | `rng` 是注入的 → **完全可決定性**，能精確測六層篩選與權重 |
| 4 | **新聞指令組裝**（六個 builder） | 快照測試；角色口吻的措辭不該被誰順手改掉 |
| 5 | **角色卡對映**（`stCardMapper` 匯入／匯出往返） | ST 相容性是對外承諾，回歸代價高 |
| 6 | **PNG 角色卡**（`pngCard` 嵌入／取出／重複嵌入取代） | 已臨時驗過，應固化成常設測試 |
| 7 | **base64** | 已與 Node `Buffer` 逐位元組比對過，固化 |
| 8 | **提醒時刻計算**（`nextFire`） | 已用 20000 隨機時刻比對過，固化 |
| 9 | **記憶摘要的訊息挑選**（`listSummarizableMessages` / `countUncoveredMessages`） | 純函式；「哪些訊息該進摘要」錯了會靜默掉資料 |
| 10 | **圖片參照解析**（`imageRef`）、**關鍵字組 helper** | 小而純 |

估時 **2–3 天**，之後每次改動自動跑。

### 6.3 針對「這次重構有沒有改壞」的特別做法

還有一招能大幅減少 owner 的手動負擔：

> **拿同一組固定輸入，分別在 `main`（重構前）與 `feat/mobile-standalone`（重構後）
> 產生 prompt 字串，然後 diff。**

prompt 組裝是純函式、不需要 API Key、不花錢、不連網。
**若兩邊輸出逐字相同，就等於證明了「送給模型的東西完全沒變」**——
而那正是這次重構最擔心的回歸。

這比人工聊幾句可靠得多（人工只能抽樣，這個是全等比對）。

### ✅ 已完成（2026-08-03），結果：**48/48 完全相同**

工具在 `scripts/prompt-equivalence-harness.ts`，用法見 `scripts/README-prompt-equivalence.md`。
48 情境 = 4 家 provider × 12 種情境（一般聊天／帶圖／群組／新聞 directive／記憶摘要／
提醒／關閉時間注入／minimal／splitEmotion／無 persona／空對話／多張圖）。

`main`（重構前）vs `feat/mobile-standalone`（B1 收尾後）逐字比對：**零差異**。

比對的不是某個函式的回傳值，而是**各家 SDK 實際組好、準備送出的 HTTP 請求本體**
（用假的 `fetch` 攔下來）。也就是說，驗證的是「真正要送給模型的那串位元組」。

**三個踩到才知道的細節**（已寫進工具的註解，日後不必重踩）：

1. 攔截器必須**第一個 import** —— `main/adapters/httpAdapter.ts` 在模組載入當下就
   `globalThis.fetch.bind(globalThis)`，晚裝就攔不到，請求會真的送出去（實測收到 401）
2. **`node-fetch` 也要一起換掉** —— `openai` 與 `@anthropic-ai/sdk` 在 Node 下走
   `node-fetch`、不走全域 `fetch`（見兩者的 `_shims/node-runtime.js`）。
   不處理的話重構前後會用**不同的攔截機制**，比對結果就不可信
3. **時間必須凍結** —— prompt 會注入「現在時間」。
   ⚠️ **第一次比對得到「48/48 相同」，其實是因為兩次執行剛好在同一分鐘內完成 —— 那是運氣。**
   凍結 `Date` 後重跑才是真的可重現。這個假陰性差點被當成結論

**反向驗證**：故意把 `core/llm/claude.ts` 的 `maxResponseTokens * 3` 改成 `* 4`，
比對精準抓出**且僅抓出** 12 個 `claude/` 情境 → 證明它敏感且不誤報。

基準快照存於 `scripts/__golden__/prompt-requests.json`，日後可直接對照。

### 6.4 只能靠 owner 手動測的（**清單刻意壓到最短**）

做完 §6.3 之後，真正需要人的只剩這些——它們的共同點是
**跨程序、要真金鑰、或牽涉視窗行為**：

| # | 項目 | 怎麼測 | 為什麼機器測不了 |
|---|---|---|---|
| 1 | **實際發一則訊息拿到回覆** | 隨便跟角色說一句話 | 要真的 API Key 與網路。這一項通了，代表 HTTP adapter 注入 SDK 成功 |
| 2 | **傳一張圖給角色** | 拖一張圖進輸入框送出 | 驗證圖片路徑改走 data URI 沒壞。**這是這次改動風險最高的一處** |
| 3 | **設定 → 測試連線／測試訊息** | 各按一次；再把 API Key 清空按一次 | 清空那次應顯示「尚未填寫 API Key」——驗證錯誤代碼翻譯回中文正確 |
| 4 | **記憶摘要** | Log 視窗按「立即摘要」 | 跨 IPC ＋ 真實模型呼叫 |
| 5 | **提醒準時跳出** | 排一個 3 分鐘後的提醒 | 牽涉真實時間流逝與跨視窗喚起，自動測只能測算式（已測） |
| 6 | **角色卡 PNG 匯出後再匯入** | 匯出一隻再匯入 | 檔案系統 ＋ 對話框 |
| 7 | **API Key 重開程式後還在** | 關掉程式再開，看金鑰還在不在 | 要真的 Windows DPAPI |

**其餘一律不需要 owner 測**——桌寵視窗、拖曳、點擊穿透、泡泡定位這些這次完全沒動。

> 📌 §6.4 的 1–3 項若都正常，LLM 那條線基本就是好的；4–7 是保險。

---

## 7. 建議順序

```
0. 驗證 + 合併 feat/mobile-standalone        ← 擋住所有後續
   ├─ 6.3 prompt 全等比對（半天，AI 做）
   ├─ 6.2 自動測試導入（2–3 天，AI 做）
   └─ 6.4 手動七項（owner，約 15 分鐘）

1. Hello World APK 試打                       1–2 天
2. mobile.html 功能對照清單                   半天
3. B2.7 fileStore 抽 core（**新增項目**）      1–2 週   ← B3 真前提
4. B2.5 Lorebook core                         3–5 天   ← 擋 B3
5. B2.6 Lorebook 桌面 UI（可延後至 B3 後）     4–7 天
6. B3 手機 UI                                 4–8 週
7. 角色印象（含角色對角色）                    B3 之後
```

**與現行 roadmap §10 的差異**：新增 B2.7（本文件 §2 的發現）、
B2.5／B2.6（lorebook），並把角色印象明確排在 B3 之後。

---

## 8. Owner 決議（2026-08-03）

| # | 議題 | 決議 |
|---|---|---|
| 1 | B2.6（Lorebook 桌面 UI）現在做還是 B3 後 | **現在做**。理由：不想在 B3 之後補兩套 UI |
| 2 | 角色印象是否先定型別 | **不先定，完全延後**（owner 授權由 AI 判斷）。理由見下 |
| 3 | Android keystore | **待辦**：owner 需先了解用法，說明見 §9。**AI 不會自行產生** |
| 4 | 新聞是否納入手機 MVP | **納入**。owner：「一般使用者不見得重要，但我自己要用」 |

### 議題 2 的理由（為什麼連型別都不先定）

先定型別的唯一好處是「B3 的手機 UI 不會撞到資料結構」。
但**印象功能若不在 B3 的 UI 範圍內，就不存在可撞的東西** —— 手機 UI 不會有印象的畫面，
自然不需要它的型別。

而 `core/` 現在已經抽乾淨，**日後補型別只要改一個地方**（B1／B2 的成果就是這個）。
先定反而是替一個還沒實作、規格可能再變的功能預留欄位，屬於推測性設計。

→ 完全延後，列為 roadmap 的 **B8**。

### 議題 4 的連帶影響

新聞納入手機 MVP → `modules/news/sources.ts` 的手機方案**從「B4 再說」升級為 B3 前應決定**。

兩個待解項目：

| 依賴 | 問題 | 可能方向 |
|---|---|---|
| `crypto.createHash` | Node 專屬，手機端沒有 | 換成純 JS hash（新聞 id 只需穩定去重，不需密碼學強度）→ 可進 `core/` |
| `rss-parser` | 需確認能否在 WebView 跑（它依賴 `xml2js`） | 若不行，改用瀏覽器內建 `DOMParser` 解析 RSS，或走 §3.3 的 news provider 介面 |

**建議在 Hello World APK 試打時順便驗 `rss-parser`** —— 那是唯一能確定答案的方式，
且該次試打本來就要做。

---

## 9. Android keystore 是什麼、怎麼用

> 這節是寫給 owner 的操作說明。**AI 不會、也不應該替你產生這把金鑰。**

### 9.1 它是什麼

一個檔案（`.jks`）加兩組密碼，用來證明「這個 APK 是同一個作者發的」。

Android 的規則：**只有用同一把 keystore 簽出來的新版，才能覆蓋安裝舊版。**

> ⚠️ **弄丟 ＝ 所有使用者都無法升級**，只能請他們解除安裝再重裝，
> **而解除安裝會清掉全部資料**（角色、對話、設定）。無法補救、無法申訴、沒有客服。

Windows 的 `.exe` 沒有這個限制（未簽章也能跑，只是跳 SmartScreen 警告），
所以這是桌面版沒有的概念。

### 9.2 一般使用者要做什麼

**什麼都不用做。** 使用者只會在安裝時看到「允許安裝未知來源」的系統警告
（因為不是從 Play 商店下載），那跟 keystore 無關。簽章驗證 Android 自動完成。

### 9.3 怎麼產生（一次性，之後幾十年都用同一把）

需要 JDK（裝 Android Studio 會一併安裝）。在**你自己**的機器上執行：

```
keytool -genkeypair -v -keystore dest-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias dest
```

它會問你幾個問題：

| 問題 | 怎麼填 |
|---|---|
| keystore 密碼（兩次） | 自己設一組強密碼，**記進密碼管理器** |
| 姓名／組織／城市／國家 | 隨意填，不會顯示給使用者。國家填 `TW` |
| key 密碼 | 可以跟 keystore 密碼相同（按 Enter 沿用） |

`-validity 10000` 是約 27 年，避免中途過期。

### 9.4 保管規則（**這節才是重點**）

1. **離線備份至少兩份** —— 例如加密隨身碟 ＋ 密碼管理器的附件功能。
   兩份要放在不同物理位置（家裡失竊／硬碟壞掉不會同時損失）
2. **絕對不可 commit 進 repo**，即使是私有 repo
3. **密碼與 `.jks` 分開存** —— 只有檔案沒有密碼一樣不能用
4. GitHub Actions 自動建置時，`.jks` 轉成 base64 存進 Secrets、密碼另存 Secret。
   ⚠️ **Secrets 只是 CI 用的副本，不是備份** —— 原始檔必須你自己另外保管

### 9.5 什麼時候需要

**不擋 B3、不擋任何開發。** 只有要**發布第一個公開 APK** 時才需要。
在那之前，開發測試用的 debug 版本 Android 會自動簽，不需要你做任何事。

→ 所以這件事可以等，但**發第一版前務必先弄好並備份**，
因為第一版一旦發出去，那把金鑰就定終身了。
