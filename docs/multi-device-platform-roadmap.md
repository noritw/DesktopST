# DeST 多裝置與平台擴充 — 評估與規劃

> **選讀。新對話不要整份讀。** 預設只讀 [`CLAUDE.md`](../CLAUDE.md)（已含 §2／§8 濃縮）。
>
> 需要提案或改架構時再讀：
> - **§2 四大目標**、**§8 已否決**（必過這兩節）
> - 手機資料來源／同步：§4.5–§4.7
> - 其餘章節（B1 切法、舊順序、NAS…）多半是歷史，用 Grep 查即可
>
> 狀態：**A／B1／B2／B2.5／B2.6／B2.7 完成；B3 手機 UI 進行中**
> （階段 0–5、8、9 ＋ 資訊架構／雙入口完成；**下一步階段 6 個人新聞報** → 7）
> 基準版本：v0.3.11｜討論日期：2026-08-02｜最後更新：**2026-08-06**
> 索引：[`docs/README.md`](README.md)
>
> **進度一覽**
> - ✅ **A1 Google Calendar 模組** —— 已完成並實機驗證（見 §6.1、`CLAUDE.md`）
> - ✅ **B1 抽出 `core/`** —— **四刀全數完成**（2026-08-03，見 §4.4b）。
>   `llm/` 全部、`summarizer`、`news/trigger`、`reminder/nextFire`、`pngCard`、base64 皆已進 core
> - ✅ **B2 Capacitor 骨架 ＋ 五個 adapter 介面** —— 已完成（2026-08-03，見 §4.4b）
> - ✅ ~~renderer 重複一份 news types~~ —— **已解**（改為轉出檔指向 `@core/news/`）
> - ✅ **已實機驗證並合併回 `main`**（2026-08-03）：owner 實測四家 LLM、傳圖、
>   API Key 持久化皆正常；另有 prompt 全等比對 48 情境逐字相同（`scripts/README-prompt-equivalence.md`）
> - ✅ **B2.7／B2.5／B2.6** —— `fileStore` 抽 core、Lorebook core、Lorebook 桌面 UI（2026-08-03～04）
> - 🚧 **B3 手機 UI** —— 詳見 `docs/b3-mobile-ui-plan.md`；對照清單 `docs/mobile-html-feature-inventory.md`
>
> ### 👉 現在的下一步是 **B3 階段 6（個人新聞報）**，不是重做 B2.x
>
> 設計約束（§2 四大目標、§8 已否決方案）仍然有效；動手機連線／散布方式前
> 必讀 b3 計畫 §4.20（relay 三條硬約束）。
>
> 相關：`docs/module-system-roadmap.md`、`docs/news-reader-mobile-plan.md`、
> `docs/remote-control-plan.md`、`docs/future-lorebook.md`、`docs/future-character-impression.md`

本文件記錄「手機獨立版 / 跨平台 / 多電腦 / 開源散布」的完整評估結論。
**若換對話或換 AI 接手，先讀完這份再動工**，尤其是：

- **§2 公開版四大目標** —— 所有提案都要先過這四把尺
- **§8 已否決的方案** —— 每一條都討論過並排除，不要重新提案

---

## 1. 產品定位（2026-08-02 重大修正）

### 1.1 Owner 的使用者旅程 ＝ 目標客群的旅程

```
手機 App「卿卿我我」  →  功能與收費不符需求
        ↓
   SillyTavern      →  也不完全符合需求
        ↓
        DeST         →  自己做一個
```

**起點在手機，不在電腦。** 一般使用者不見得有電腦，更不可能有一台 24 小時開著的電腦。

### 1.2 定位修正

DeST 從「桌面寵物程式」擴張為 **「AI 角色聊天平台，有桌寵版與手機版」**：

| 版本 | 目標客群 | 是否需要電腦 |
|---|---|---|
| **手機獨立版** | **一般使用者（主要客群）** | ❌ 不需要 |
| 桌寵版（現有） | 想要角色站在桌面上的使用者 | ✅ |
| 手機遙控版（現有） | 兩者都有的進階使用者 | ✅ |

> **這推翻了 2026-08-02 稍早的判斷。**
> 當時假設「Mac Mini 常開 → 手機不必獨立運作」，那是 owner 個人情境的最佳解，
> **但那是進階需求，不是主線**。手機獨立版重新成為第一優先。

### 1.3 使用者要做的事（設計目標）

> 下載安裝 → 申請 API Key 填進去 → 開始聊

就這三步。任何讓這三步變複雜的設計都是做錯了（見 §2 目標 4）。

---

## 2. 公開版四大目標（**設計約束，所有提案先過這四把尺**）

### 目標 1：誰都可以用自己的裝置和自己設計的角色聊天

- 手機獨立版必須能單機完整運作
- host/client 的預設值＝「這台裝置」，單機使用者**完全感覺不到該功能存在**

### 目標 2：不需要額外付費給作者

費用只有使用者自選的 LLM API（或自架）。

**推論**：任何需要持續營運的後端都不可採用——那必然導向收費。
這是否決「雲端同步後端」的根本理由（§8）。

### 目標 3：敏感資料不放第三方服務商

- ✅ 資料存本機、API Key 本機加密、無雲端後端
- ⚠️ **例外：`relay.nori.tw` 是 owner 營運的 Cloudflare Worker，對使用者而言 owner 就是第三方**

**必須提供並明確揭露兩條路**：

| 連線方式 | 適合 |
|---|---|
| 內建 relay（預設） | 方便、零設定 |
| 自架 Cloudflare Tunnel（`cloudflaredManager.ts` 已支援） | 流量完全不經過作者 |

README 與教學要寫清楚 relay 轉發什麼、不留什麼。**這條目前只達成一半。**

### 目標 4：一般使用者照教學就能快速上手

**這是整份規劃風險最高的一條。** 功能越多，新手越容易被嚇跑。

**分層規則（硬性）**：

| 層 | 內容 |
|---|---|
| **第一層** | 裝好、填 API Key、匯入／建立角色、開始聊。**零額外設定，不出現任何進階名詞** |
| 第二層 | 手機↔電腦連線（掃 QR） |
| 第三層 | 多電腦 host/client、NAS、日曆、自架 Tunnel、WoL、遙控 |

**預設值必須讓第一層成立。任何新功能若讓第一層變複雜，就是做錯了。**

---

## 3. 手機獨立版功能範圍

### 3.0 功能基準線（**硬性**）

> **手機獨立版必須具備現行「行動網頁版」(`assets/mobile.html`, 3,290 行) 的全部功能**，
> 扣除遙控專屬項目。§3.1 的清單是**補充**，不是上限。

現行行動網頁版功能盤點（依 `mobile.html` 元素 id）：

| 功能 | 元素前綴 | 獨立版 |
|---|---|---|
| 聊天、輸入、思考中狀態 | `msg-`, `chat`, `thinking-bar` | ✅ 必要 |
| 圖片附件、預覽、燈箱 | `attach-`, `lightbox` | ✅ 必要 |
| 訊息編輯／刪除／選單 | `edit-`, `msg-menu-` | ✅ 必要 |
| 角色清單、頭像、桌面角色管理 | `char-`, `manage-btn` | ✅ 必要 |
| **隨機工具（御神籤／擲筊／硬幣／骰子含自訂面數・顆數・修正值）** | `random-`, `dice-custom`, `custom-faces/count/mod` | ✅ **必要（owner 常用）** |
| 不呼叫 LLM 直接發言（skipLlm） | `skip-llm-` | ✅ 必要 |
| 個人新聞報 | `reader-` | ✅ 必要 |
| 選單、裝置名稱 | `menu-`, `device-` | ✅ 必要 |
| 螢幕鏡像、滑鼠鍵盤遙控 | `ss-` | ❌ 遙控專屬 |
| 電腦控制、程式清單、系統電源 | `pc-`, `prog-`, `sys-` | ❌ 遙控專屬 |

**隨機工具現況** —— ✅ **已全數進 core（2026-08-04）**：
`core/random/dice.ts`（擲出邏輯）＋ `core/prompt/randomTokens.ts`（內嵌 token）
＋ `core/prompt/randomResult.ts`（prompt 格式化，B1 第一刀時已搬）。
原本三份實作且**機率互不相同**，對照表與分界線見
`docs/mobile-html-feature-inventory.md` §4。
⚠️ `assets/mobile.html` 那份蓄意保留（純 vanilla 不能 import TS），改 core 要同步過去。

### 3.1 必做（MVP）

| 功能 | 來源 | 移植難度 |
|---|---|---|
| **自訂角色** | 卿卿我我有 | 低（純邏輯＋儲存） |
| **與角色聊天（單張主圖，不需表情差分）** | 卿卿我我有 | 低（比桌面版更簡單） |
| **傳圖給角色聊** | 卿卿我我有 | 低（vision API 已支援） |
| **自動總結對話** | 卿卿我我有 | 低（`summarizer.ts` 92 行，純邏輯） |
| **群組聊天** | SillyTavern 有，owner 認為必要 | 中（接龍邏輯在 `ipcHandlers.ts`，純邏輯） |
| **新聞模組** | DeST 已實作 | 中高（模組較重，但可移植） |
| **天氣模組** | DeST 已實作 | 低（單一 HTTP API） |
| **角色主動提醒 ＋ Google Calendar** | 尚未實作 | 中（見 §6.1） |

### 3.2 手機版不做

桌寵視窗（透明置頂／點擊穿透／hover menu／泡泡 z-order）、遙控模組、螢幕截圖、
便利貼（意義不同）、角色縮放／翻轉。

### 3.3 在地化：**台灣取向為主，保留擴充空間但先不做**（owner 決議）

DeST 無營利、主要自用、開放讓別人也能用，因此**不追求國際化**。

- 天氣沿用 CWA（台灣中央氣象署）、新聞來源維持台灣導向
- UI 文案維持繁中，**不導入 i18n 框架**

**但要保留擴充空間（低成本、現在就該遵守的兩條）**：

1. **天氣／新聞來源走 provider 介面**，不要把 CWA 端點與回應格式寫死在呼叫端。
   未來要加別的地區，是新增一個 provider，不是改呼叫端。
2. **`core/` 層不得寫死中文 UI 文案**，只回傳結構化資料（代碼、數值、時間），
   文案一律留在 UI 層。這樣未來要多語系時 `core/` 完全不用動。

   > **例外：送進 LLM prompt 的中文字串可以留在 `core/`**（owner 2026-08-02 拍板）。
   >
   > 那些不是介面語言，是**模型輸入的內容**；本專案輸出強制繁中，介面日後就算多語系，
   > prompt 語言也不會跟著變。若硬要抽離，`core/` 只能回傳結構化資料、
   > 再由桌面與手機**各組一次字串** —— 同一份 prompt 語意實作兩次，
   > 正是 §4.1 要防的 drift。為守規則而製造它要防的問題，不划算。
   >
   > **落地約束**：這類字串集中在 `core/prompt/` 底下，檔頭註明
   > 「本檔含刻意寫死的中文 prompt 字串，非 UI 文案」。日後真要多語系只換這幾檔。
   > 目前適用：`core/prompt/systemTime.ts`、`core/prompt/randomResult.ts`。
   >
   > **UI 文案不適用此例外，一律不得進 `core/`。**

README 應明確標示「台灣向」，避免國際使用者誤裝後失望。

### 3.4 獨立版帶來的簡化

**手機能自己跑 LLM 之後，`預產快取` 整套機制就不需要了**——
半夜要說什麼直接現場生成。睡覺提醒因此大幅簡化（見 §6.2）。

---

## 4. 架構決議：抽出 `core/`（**已從「重構議題」升級為關鍵路徑**）

### 4.1 為什麼非做不可

現況所有業務邏輯綁死在 Electron main：`ipcHandlers.ts`(4,551 行)、`fileStore.ts`(989 行)、
`promptUtils.ts`(577 行)、`llm/`、`modules/`，依賴 `fs` / `ipcMain` / `BrowserWindow`。

> 📌 **上段是 2026-08-02 的現況描述，保留原文。**
> B1 完成後（2026-08-03）：`promptUtils` 與 `llm/` 已全數進 `core/`、
> `ipcHandlers.ts` 為 4,514 行；**`fileStore.ts` 仍是 989 行、尚未抽（＝ B2.7）**。

若不抽而直接在手機重寫一份，會產生 **drift**：
> 同一份邏輯在兩地各自實作，隨時間慢慢長歪。
> 例：桌面改了新聞篩選權重，手機忘了同步 → 同一則新聞桌面抽得到、手機抽不到。
> **沒有錯誤訊息、測試不會紅**，只有使用者覺得「怪怪的」。
> 在同一個 repo 裡，比 fork 更難察覺。

### 4.2 目標形狀

```
src/core/        ← 純 TypeScript，零 Node / Electron 依賴
                   prompt 組裝、記憶摘要、新聞篩選、角色卡解析、
                   群組接龍、時間標註、reaction 展開…
                   儲存與網路走 adapter 介面

src/main/        ← Electron adapter（fs、safeStorage、IPC）
src/mobile/      ← Capacitor adapter（Filesystem、Keystore、原生 HTTP）
```

UI 仍是兩份（桌寵 UI 與手機 UI 資訊架構本就不同），這是預期內且合理的。

### 4.3 技術選型：Capacitor（不是 React Native）

- renderer 已是 React + TS + Tailwind，元件與樣式可複用
- 原生 HTTP 外掛能繞過 CORS → RSS 抓取、四家 LLM API 都能直接打
- React Native 等於 UI 全部重寫

**已知細節**：Capacitor 原生 HTTP 對 fetch streaming 支援不佳，
串流輸出可能要退回非串流或改走其他機制。

### 4.4 具體切法（**2026-08-02 的盤點，內容已全數執行完畢**）

> ✅ **本節是歷史紀錄，不是待辦清單。** 下列項目 **B1 四刀已全部搬完**，
> 實際結果、與計畫的偏離、以及六個設計決定見 **§4.4b**。
> 接手時看 §4.4b 與 §10.5，本節僅供對照當初怎麼判斷。

#### 可直接搬進 `core/`（純邏輯，無 Node/Electron 依賴）— ✅ 全數完成

| 來源 | 內容 |
|---|---|
| `llm/promptUtils.ts`(577) | prompt 組裝、`annotateTimeGaps()`、`expandReactionAnnotations()`、`contextMessages()` |
| `llm/summarizer.ts`(92) | 記憶摘要 |
| `llm/index.ts`(368) | `chatWithLLM` 主流程（adapter 已分離，四家 provider 各自獨立檔） |
| `llm/{openai,claude,gemini}Adapter.ts` | 改用注入的 HTTP client 即可跨平台 |
| **`ipcHandlers.ts` 第 279–488 行** | **幾乎整段都是純邏輯**：`characterAliases`、`isAddressed`、`sortRespondersByKeywordMatch`、`pickPrimaryResponderId`、`normalizeCharacterDialogue`、`stripOtherCharacterSpeakerLines`、`formatRandomResultForPrompt`、`safeJsonParse`、`escapeRegExp`、`shuffleIds` ⋯⋯ **群組聊天邏輯的核心在這裡** |
| `modules/news/`(2,537) 之 `filter.ts`、`trigger.ts`、`groupNewsItems`、`topicState.ts` | 篩選、加權隨機、回饋、分組 |
| `stCardMapper.ts`、`pngUtils.ts` | 角色卡解析（`pngUtils` 需確認 Buffer 用法可否改 Uint8Array） |

#### 需要 adapter 介面（平台各自實作）

| 介面 | Electron | Capacitor |
|---|---|---|
| 儲存（讀寫 JSON、二進位） | `fs` | Filesystem plugin |
| 金鑰保管 | `safeStorage`（DPAPI／Keychain） | Keystore／Keychain |
| HTTP／串流 | Node fetch | 原生 HTTP plugin（**串流支援不佳，見 §4.3**） |
| 排程 | `reminderScheduler.ts` (`setTimeout`) | AlarmManager + 自訂 plugin |
| 通知 | Electron Notification | Local Notifications |

#### 留在 `main/`，不進 core

`ipcHandlers.ts` 第 84–262 行（視窗定位、`spreadDesktopCharacters`、
`repairDesktopCharacterLayout`、泡泡寬度估算、便利貼尺寸遷移）、
`windowManager.ts`、`modules/remote-control/`（Windows only）、
`cloudflaredManager.ts`、`mobileServer.ts`、`dstPack.ts`（可後續再議）。

#### 建議的第一刀 —— ✅ **已完成（2026-08-02）**

從 **`ipcHandlers.ts` 279–488 行**開始——它最純、最獨立、沒有 IPC 糾纏，
而且正好是群組聊天（§3.1 必做項）的核心。
搬完立刻能驗證：桌面版行為不變 ＝ 切得對。

**實作結果**（六個小 commit，`a971fbd`..`d1edce0`，直接在 `main` 上，依 §11.1）：

```
src/core/
  types.ts                     ← 原 src/main/types.ts（逐字相同）
  character.ts                 ← characterAliases
  prompt/promptUtils.ts        ← 原 src/main/llm/promptUtils.ts（逐字相同）
  prompt/dialogue.ts           ← 對白正規化三件套
  prompt/randomResult.ts       ← 隨機工具 prompt 格式化 ⚠️含中文 prompt 字串
  prompt/systemTime.ts         ← 時段標籤 ⚠️含中文 prompt 字串
  group/responders.ts          ← isAddressed / shuffleIds / pickPrimaryResponderId
                                 / sortRespondersByKeywordMatch
  group/dialogueCleanup.ts     ← stripOtherCharacterSpeakerLines
  util/text.ts  util/json.ts
```

**兩處刻意的偏離**（避免 `core/` 內部依賴繞圈）：
`characterAliases` 放 `core/character.ts` 而非 `group/`（`prompt/dialogue.ts` 也要用它，
放 group 底下會變成 prompt 反向依賴 group）；`stripOtherCharacterSpeakerLines` 獨立成檔。

**改過簽名的只有兩個**（原本偷讀模組層變數，這是它們唯一的不純處）：

```ts
sortRespondersByKeywordMatch(ids, message, getCharacter)   // 第三參數收 lookup function
stripOtherCharacterSpeakerLines(text, selfCharId, characters)  // 第三參數收 Character[]
```

**相容作法**：`src/main/types.ts` 與 `src/main/llm/promptUtils.ts` 改為 re-export 轉出檔，
**所有既有 import 路徑一字未改** → diff 極小、零行為風險。
新增檔案時請直接 import `core/`，不要再走轉出檔；等哪天沒人用了再刪。

`tsconfig.node.json` 的 `include` 已加入 `src/core`。

**驗收結果**：`npm run typecheck` ＋ `electron-vite build` 通過；
owner 實機驗過聊天 / 群聊 / 新聞 / 抽籤 / 骰子，行為無異常。

#### 第二刀 —— ✅ **已完成（2026-08-03）**

原「下一刀怎麼切」列的三塊已全數搬完，五個小 commit（`4781e6f`..`641932f`，
直接在 `main` 上，依 §11.1）：

```
src/core/
  card/stCardMapper.ts    ← 原 src/main/stCardMapper.ts（逐字相同）
  news/types.ts           ← 原 modules/news/types.ts（逐字相同，全為型別）
  news/keywordGroups.ts   ← settings.ts 的 5 個純項目（逐字相同）
  news/filter.ts          ← 原 modules/news/filter.ts（逐字相同）
  news/topicState.ts      ← 原 modules/news/topicState.ts（僅加註解）
```

**全部逐字相同，一個函式簽名都沒改**（與第一刀不同，這批本來就沒有偷讀模組層變數）。
五個原路徑一律改為 re-export 轉出檔，**既有 import 一行未改**。

幾個實作決定：

- `stCardMapper` 放 `core/card/` 而非 `core/character/` —— `core/character.ts`
  第一刀已定案，改成資料夾會動到既有路徑；且卡片格式對映與角色語意是兩件事
- `settings.ts` 只搬走 5 個純項目（`DEFAULT_KEYWORD_GROUP_ID` / `effectiveGroupId` /
  `keywordSourceInGroup` / `keywordSourceInReaderGroups` / `weightToValue`）。
  **load/save/normalize 走 `moduleSettings` 檔案存取，留在 `main/`**；
  `VALID_WEIGHTS` 等常數只服務 normalize，一併留下（那 5 個純項目沒用到它們）
- `topicState.ts` **設計零改動**，仍是 process 級可變單例。
  Owner 2026-08-03 確認前提成立：**同一 process 內不應有多個 DeST 實例共存**。
  檔頭已註明此前提與日後若不成立時的方向。轉出檔不會產生第二份狀態
  （所有 import 最終解析到同一個 core 模組）

**驗收結果**：每刀各跑一次 `npm run typecheck` ＋ `electron-vite build`，全數通過；
`src/core/` 經 grep 確認無 `electron` / `fs` / `path` / `node:` / 反向 import `main/`。

#### ~~⚠️ 已知的重複實作，尚未處理~~ —— ✅ **已解決（2026-08-03，B2）**

採**解法 2**：`src/renderer/src/modules/news/types.ts` 改為薄轉出檔指向 `@core/news/`，
既有 import 路徑一行未改。前端專屬的東西留在原檔：`NewsPreviewItem` /
`NewsPreviewResult`（IPC 形狀）與 `WEIGHT_LABELS` / `WEIGHT_CYCLE` / `nextWeight`
（UI 文案，依 §3.3 不得進 core）。

配套設定（**「前端怎麼吃 core」這題已經解掉，手機 UI 走同一套，不必再解一次**）：

- `tsconfig.json`：`include` 加 `src/core`、`paths` 加 `@core/*`
- `electron.vite.config.ts`：renderer `alias` 加 `@core`

順帶驗證：`core/` 在 web tsconfig（`ES2020` + `DOM`、**無 `@types/node`**）底下也編得過
→ 這是比 grep 更硬的「零 Node 依賴」證明。
改動後 renderer bundle hash 未變（`index-DG837fMj.js`），輸出位元組相同。

以下保留原始記錄：

`src/renderer/src/modules/news/types.ts` 檔頭自己寫著
「與 `src/main/modules/news/types.ts` 對應（**兩邊手動同步**）」，
而且它**另外複製了一份 `DEFAULT_KEYWORD_GROUP_ID` 與 `effectiveGroupId`**
（被 `components/newsReader/groupNewsItems.ts` 使用）。

**這正是 §4.1 要防的 drift**，而且已經是「同一段邏輯寫兩次」的實例。
本次沒動它，因為讓 renderer 直接吃 `core/` 牽涉 `tsconfig.web` 的 `include`
與 Vite 的路徑解析，超出「純位移」範圍，混進來會讓 diff 不再只是「刪掉本體」。

**可能的解法（擇一，未定案）**：

1. **讓 renderer 直接 import `core/`** —— 最乾淨，一份邏輯。
   需確認 `core/` 完全不含 Node 依賴（目前成立）並設好 web 端的 include／alias
2. renderer 那份改為薄轉出檔，指向 `core/news/`（同 1，只是保留現有路徑）
3. 維持兩份但加自動檢查（不建議：治標，且違反「同樣的程式碼不要寫兩次」）

傾向 1 或 2。**建議在 B3（手機 UI）開工前處理**——手機 UI 是 React，
屆時一定要解決「renderer 端怎麼吃 core」這件事，兩者是同一個問題。

#### 原「下一刀怎麼切」盤點（保留供對照，內容已全數完成）

> ⚠️ **本節曾一度寫成「剩下的都卡在 adapter，先去做 B2」，那個判斷是錯的。**
> 實際逐檔查過 import 之後，**還有三塊完全不需要任何 adapter**。先把它們搬完再進 B2。

**現在就能搬（零 adapter 需求）**

| 目標 | 行數 | 現況 | 性質 |
|---|---|---|---|
| `stCardMapper.ts` | 189 | **只 import 型別**，無 `fs` / `path` / `Buffer` | 純位移 |
| `modules/news/filter.ts` | 435 | 無 `fs` / `path` / `Buffer`，但 import 了 `./settings` 的 4 個 helper | 要先拆 `settings.ts` |
| `modules/news/topicState.ts` | 27 | **零 import** | 純位移，但是可變單例（見下） |

`filter.ts` 依賴的 `effectiveGroupId` / `keywordSourceInGroup` /
`keywordSourceInReaderGroups` / `weightToValue` **四個都是純函式**（已逐一確認），
只是住在會讀寫檔案的 `settings.ts` 裡 → 把純的抽出來進 core，
**`settings.ts` 的 load/save 留在 `main/` 不要動**。
順序上要先搬 `modules/news/types.ts`（它只 import 一個 `ReminderSchedule`）。

這一刀是新聞篩選與加權隨機，屬 §3.1 手機版必做項，**邏輯收益最大**。

`topicState.ts` 是模組層可變單例（`activeTopic`）。桌面與手機各自一個 process
所以沒問題，但若日後 core 要在同一 process 內多實例共用會踩到。
**B1 是純重構，不要順手改成 class 或注入式 —— 若判斷是隱患，先問 owner。**

**確定卡住，要等 B2 定義 adapter 介面**

`llm/index.ts` 與四家 provider adapter（HTTP client）、
`llm/summarizer.ts`（依賴 `chatWithLLM`）、
`modules/news/trigger.ts`（依賴 `sources` 網路 ＋ `settings` 檔案）、
`pngUtils.ts`（`fs` ＋ `Buffer`，還要確認能否改 `Uint8Array`）。

> **更新（B2 後）**：`pngUtils.ts` **已搬完**（`core/card/pngCard.ts`），
> `Uint8Array` 確認可行。其餘四塊介面已就緒，可以動工——見 §4.4b。

### 4.4b B2 成果：五個 adapter 介面（2026-08-03）

分支 `feat/mobile-standalone`。**產出是介面，不是跑起來的手機 app**。

```
src/core/adapters/     介面定義（純型別、零實作）
  storage.ts  secrets.ts  http.ts  scheduler.ts  notifier.ts  index.ts
src/main/adapters/     桌面實作（包裝既有能力，沒有重寫任何邏輯）
```

`main/adapters/` 目前**沒有任何呼叫端**——它是並行路徑，桌面版行為完全沒動。
之後把 `llm/` 等搬進 core 時，才由 `main/` 把 `electronAdapters` 傳進去。

#### 六個設計決定（**照著走，不要重新發明**）

| 決定 | 理由 |
|---|---|
| 儲存 key 是**平台無關的相對路徑字串**（`'personas/abc.json'`），core 不認識絕對路徑 | 桌面解析到資料夾、手機解析到沙箱；core 不該知道 `%APPDATA%` 存在 |
| 二進位一律 `Uint8Array`，**不用 `Buffer`** | `Buffer` 是 Node 專屬；它是 `Uint8Array` 子類別，所以桌面端可以直接傳入，不需轉換 |
| 儲存另留一個 `SyncStorageAdapter`，**手機端不實作** | 現行 `fileStore` 全同步，強改非同步會擴散到 `ipcHandlers` 幾乎每支 handler。新 core 邏輯一律用非同步版 |
| 金鑰介面維持**同步** | 同上；`secureStore` 被存檔鏈直接呼叫。Android Keystore 也能做成同步（解封一次後快取） |
| **HTTP 介面做成 `fetch` 同形** | 四家 LLM 走的是各自官方 SDK（`openai` / `@anthropic-ai/sdk` / `@google/generative-ai`），**不是**自己打 HTTP。三家 SDK 都能注入自訂 fetch → 跨平台不必重寫四家的請求對映。日後真要拿掉 SDK，介面一行不用改 |
| HTTP 帶 `supportsStreaming` 旗標 | 容納 §4.3 的限制。**串流是加分項不是前提**：呼叫端先問旗標，false 走非串流路徑，不可退化成錯誤 |

> ⚠️ **§4.4 原本寫「四家 provider 改用注入的 HTTP client 即可跨平台」，那句話預設是自己打 HTTP。**
> 實際上是官方 SDK。上表最後兩列就是為此而定的。

#### 用 `pngUtils` 當試金石（已搬完）

純紙上介面容易定歪，所以挑最小最獨立的一塊真的搬過去驗證：

- `core/card/pngCard.ts`（`Uint8Array`）＋ `core/util/base64.ts`（自寫）
- `main/pngUtils.ts` 留 `fs` 讀佔位圖，並把 core 的錯誤代碼翻回原本的中文訊息

**base64 為什麼自己寫**：`Buffer` 是 Node 專屬；`atob`/`btoa` 兩端 runtime 都有，
但型別不在 `lib: ES2022` 裡，而 `core/` 要同時被桌面與前端兩套 tsconfig 編譯。
兩邊都成立的只剩自己寫，約 30 行。已與 Node `Buffer` 逐位元組比對驗過
（長度 0–300 隨機資料、CJK／emoji／代理對、含換行的 base64）。

**搬完學到的一件事**：這塊**不需要 `StorageAdapter`**——
檔案讀寫留在呼叫端比塞進 core 更乾淨。`llm/` 那幾塊搬的時候照同一個形狀走：
core 收「已經讀好的資料」，不要讓 core 去讀檔。

#### B1 收尾（2026-08-03，同分支）

介面定完後把剩下四塊搬完，`core/` 至此收乾淨：

| 進 core | 內容 | 改動 |
|---|---|---|
| `core/llm/{index,openai,claude,gemini}.ts` | 主流程 ＋ 四家 provider | 加 `deps` 參數、SDK 注入 fetch、圖片本機路徑移出、錯誤代碼化。**其餘逐字沿用**（已逐檔 diff 核對） |
| `core/llm/summarizer.ts` | 記憶摘要 | 只多一個 `deps`（diff 三行） |
| `core/news/trigger.ts` | 新聞發話的**全部措辭** | prompt 字串逐字相同；`markNewsSeen` 改純函式（不存檔） |
| `core/reminder/nextFire.ts` | 下次觸發時刻計算 | 從 `reminderScheduler` 抽出，可注入 `now` |

`src/main/llm/index.ts` 從 368 行縮成 68 行的外殼。**所有呼叫端一行未改。**

**兩個搬移中才發現的問題**（紙上設計不會發現的那種）：

1. **`HttpAdapter.fetch` 原本收窄成 `(input: string, ...)`，是錯的。**
   SDK 內部會傳 `Request` 物件進來，收窄就不能指派給 SDK 的 `fetch` 選項，
   等於這個介面失去存在意義。已改為 `typeof globalThis.fetch`，實作端負責正規化。
2. **`@google/generative-ai` v0.21 沒有 fetch 選項**，直接呼叫全域 `fetch`。
   Gemini 在手機端得靠 **Capacitor 的全域 fetch patch** 繞過 CORS，不是靠注入。
   簽名仍收 `deps` 以維持四家一致。已記在 `core/llm/deps.ts` 與 `src/mobile/README.md`。

**圖片：`fs` 怎麼離開 `llm/`。** provider 原本各自 `fs.readFileSync` 把本機圖檔轉 base64。
改成**平台層在呼叫前先轉成 data URI**（`main/llm/imageResolver.ts`），
core 只認得 `data:` 與 `http(s):`。實務上使用者的圖一律已是 data URI
（輸入視窗走 `FileReader.readAsDataURL`、截圖走 `dataUrl`、手機端亦然），
所以那支通常一個檔案都不會讀。手機端 Filesystem 是非同步的，也只有先轉才可行。

> ⚠️ `resolveLocalImages` 必須**複製**而非就地修改：`params.messages` 是記憶體裡的
> 對話物件，就地改會把整段 base64 寫進對話記錄。

#### 中文文案的處理方式（新增的落地慣例）

`extractCharaJson` 原本會拋中文訊息給 UI 顯示。搬進 core 後改成
**core 拋錯誤代碼、平台層翻成文案**：

```ts
// core：throw new PngCardError('no-chara-chunk', 'PNG contains no ... chunk')
// main：code === 'no-chara-chunk' → new Error('此 PNG 不包含 ST 角色卡資料')
```

對外訊息一字未變。**之後遇到 core 要回報使用者看得見的錯誤，一律照這個形狀。**

### 4.5 手機 UI：**一份程式碼，兩種資料來源，三種散布**（關鍵決議）

**問題**：若手機獨立版另做一套 UI，`mobile.html`(3,290 行) 就成為第三套 UI，
維護面積爆炸，且兩邊功能會 drift。

**決議**：手機 UI **只寫一份**（React + TS），資料來源可抽換。

```
        ┌─────────── 手機 UI（一份 React 程式碼）───────────┐
        │                                                  │
   資料來源 A：本機 core/          資料來源 B：遠端 relay API
   （獨立模式，LLM 在手機）        （遙控模式，LLM 在電腦）
        │                                                  │
   散布①：APK（內含 UI + core）    散布②：mobileServer 提供的網頁
                                   散布③：未來 iOS
```

#### ⚠️ 「取代 `mobile.html`」的正確意思

**被取代的是那 3,290 行 vanilla HTML 的「實作」，不是「掃 QR 用網頁連線」這個「使用方式」。**

> **掃 QR → 開網頁 → 連電腦** 這條路 **永久保留，不得移除**（owner 明確要求）。
> 它是唯一不挑裝置的入口：iOS、平板、別人的手機、公司電腦都能用，不需要安裝任何東西。

改動只是：那個網頁的內容從「手寫 vanilla HTML」換成「手機 UI 的 web build」。
使用者的操作**一模一樣**，只是功能變多、與 APK 永遠一致。

**三個效果**：

1. **功能自動同步**——網頁版與 APK 是**同一份原始碼**，不是兩份需要人工對齊的實作。
   新增功能兩邊同時有，修 bug 兩邊同時好。**drift 在結構上不可能發生**
2. **不裝 APK 的使用者完全不受影響**——照舊掃 QR 開網頁，功能只多不少
3. UI 維護份數從 3 降回 2（桌寵 UI ＋ 手機 UI）

> 取代是**漸進的**：手機 UI 完成前，舊的 vanilla HTML 繼續服役，不要提早刪除。
> 切換後應保留舊檔一個版本週期以便回退。

#### 網頁版的固有限制（**不是規劃缺陷，是物理限制**）

| | APK | 網頁版（掃 QR） |
|---|---|---|
| 遙控模式 | ✅ | ✅ **功能完全相同** |
| **獨立模式** | ✅ | ❌ **不可能** |
| 主動通知 / 背景常駐 | ✅ | ❌ |
| 適用裝置 | Android | **任何裝置**（iOS、平板、別人的手機⋯⋯） |

網頁是**由電腦提供**的——電腦沒開就連不上，自然無法「不依賴電腦」。
這是拓樸決定的，不是取捨。

**不做「網頁版也能獨立運作」**（PWA 離線快取 ＋ 瀏覽器內跑 LLM）：
需要把 API Key 存進瀏覽器儲存（安全性低於 Keystore）、多一種資料來源變體要維護，
且 iOS Safari 的儲存配額會被系統回收。**要獨立運作就裝 APK。**

> 📌 **由此產生的已知缺口**：iOS 使用者只能用網頁版 → **必須有電腦**。
> 沒有電腦的 iOS 使用者目前無解，除非日後走 §7.2 的付費途徑。

### 4.6 手機獨立版 ＝ Owner 之後的唯一入口

Owner 明確表示：獨立版完成後**全面轉移過去**，不管獨立聊天或連電腦都走這個 app。

**推論（重要）**：

1. **遙控功能必須存在於獨立版 APK 中**，不能因為「一般使用者用不到」就砍掉
2. 但它**是可選模組、預設關閉**，收在第三層（§2 目標 4）。
   遙控本來就已經是模組（`modules/remote-control/`），沿用既有模組開關即可
3. `mobile.html` 被取代後（§4.5），遙控 UI 隨手機 UI 一起搬過去

**獨立版要解掉的現行痛點**（owner 實際遭遇）：

| 痛點 | 獨立版如何解 |
|---|---|
| 人在外面，家裡電腦沒成功開機／斷線 → **完全連不上** | 獨立模式照常聊天，不依賴電腦 |
| **網址弄丟就進不去** | APK 保存配對資訊，不靠網址（順帶：token 不再進瀏覽器歷史） |

### 4.7 模式與資料同步

#### 模式

| 模式 | LLM 在哪 | 讀寫哪份資料 | 需要電腦 |
|---|---|---|---|
| **獨立模式** | 手機 | 手機本機 | ❌ |
| **遙控模式** | 電腦 | 電腦（手機不落地） | ✅ |

UI 上必須是**明確的模式切換**，不是自動判斷——使用者要隨時知道自己在跟哪份資料說話。

#### 同步：**點對點，不是雲端**（修正先前決議）

> ⚠️ **§8 否決的是「雲端同步後端」（需營運、資料經第三方、必然導向收費）。**
> **手機 ↔ 使用者自己的電腦**的點對點同步是另一件事：不需要後端、資料不出自己的裝置，
> **不牴觸 §2 任何一條目標**。先前把兩者混為一談，此處修正。

分三層實作，**依序推進**：

| 層 | 內容 | 估時 | 狀態 |
|---|---|---|---|
| **S1 初始化匯入** | 掃 QR → 從電腦拉角色／Persona／World／Scene／模組設定／主題。**單向、一次性** | 3–5 天 | MVP 必做 |
| **S2 手動雙向同步** | 明確的「推送 / 拉取 / 合併」按鈕 ＋ **差異預覽**，使用者按下才動 | 2–3 週 | MVP 必做 |
| **S3 自動同步** | 連上電腦就背景合併 | — | **暫不做**，見下 |

**S2 的合併規則**（資料特性決定難易）：

| 資料 | 規則 | 風險 |
|---|---|---|
| 對話訊息 | **append-only，以 message id 聯集合併** | 低——同一人輪流使用是「接力」，不是並發衝突 |
| 角色卡 / Persona / World / Scene | mtime 較新者勝，**衝突時列出差異讓使用者選** | 中 |
| `conv.summary` / `summaryCoversTs` | 隨所屬對話走，取較新者 | 中 |
| reaction / `excludeFromContext` | 以 message id 為鍵合併 | 低 |
| **API Key** | **永不同步**（見下） | — |
| 模組狀態（seenIds、readerState） | 聯集 | 低 |
| **飲食模組**（B9，`FoodItem`／`MealLog`／`BodyProfile`） | 見 `future-nutrition-module.md` §5.4；MVP 另有搬家包不依賴本表 | 中 |

**S3 暫不做的理由**：自動背景合併一旦出錯是**靜默的**——使用者不會收到錯誤訊息，
只會發現對話少了幾則。S2 的差異預覽讓錯誤在發生前就能被看見。
等 S2 穩定運行一段時間、合併規則被實戰驗證過，再考慮把它自動化。

#### API Key 與「怎麼知道是不是區網直連」

**使用者不需要判斷，也不應該被要求判斷（§2 目標 4）。程式自己知道，並且明白告訴他。**

**判定必須在電腦端做**（權威來源，不可信任手機端自稱）：

```
mobileServer 收到 /api/sync-init
  → 檢查 req.socket.remoteAddress
      私有位址（10.x / 172.16–31.x / 192.168.x / ::1）且與自身同網段
          → 回傳含 API Key 的完整設定
      其他（經 relay / cloudflared tunnel）
          → 回傳設定但**剝除 API Key**，並在回應中標記原因
```

**手機端 UI 直接顯示狀態，不提問**：

- 🟢 **「已透過家用網路直接連線 —— 設定與 API Key 都會帶過來」**
- 🟡 **「透過中繼伺服器連線 —— 為保護你的金鑰，API Key 不會傳輸，請稍後手動填入」**

**不提供「我知道風險仍要傳輸」的覆寫選項**——那等於要使用者做安全判斷。
金鑰只要填一次，回家再同步一次即可。

**API Key 在任何情況下都不參與 S2 雙向同步**，僅限 S1 初始化、且僅限區網直連。
此原則與現行 DST Pack 匯出排除 API Key 一致（CLAUDE.md 已記載）。

#### 多電腦情境：星狀拓樸，**不是**網狀（owner 決議）

Owner 同時使用多台電腦。手機可以**存多組配對**，但：

> **手機只綁定「一台」同步主機（sync host），其他配對僅供遙控。**

```
        手機 ──同步── [ 電腦 A（sync host）]
         │                    │
         │              共用資料路徑（§6.3 C1）
         └──遙控只讀── [ 電腦 B ] [ 電腦 C ]
```

- 電腦與電腦之間靠**共用資料路徑 ＋ lock file**（§6.3）保持一致
- 手機只跟其中一台談，避免變成三方合併的樞紐

**為什麼不讓手機跟多台都同步**：手機先與 A 同步、再與 B 同步，
會不知不覺把 A 的資料搬到 B，等於手機成了未經聲明的中繼站。
一旦某次合併判斷錯誤，會同時汙染多台，且極難追查。**星狀可預測，網狀不可預測。**

**UI**：配對清單中一台標記為「同步主機」（可更換），其餘顯示為「僅遙控」。
更換同步主機時要明確警告可能產生的差異。

### 4.8 手機端設定 UI（**先前低估的工作量**）

手機獨立版要能完成**全部**設定：API Key、模型選擇、endpoint、
Persona / World / Scene、記憶參數、模組開關、新聞關鍵字與黑名單、提醒 CRUD⋯⋯

參考量體：桌面 `SettingsWindow.tsx` **2,992 行**。
手機版不需全部照搬（無桌寵、無遙控），但這是 **B3 裡最大的單一項目**，
估時已含在 B3 的 4–8 週內，接手時勿再低估。

**依 §2 目標 4**：第一層只需要「填 API Key」，其餘全部收進進階區。

### 4.9 維護面積（**誠實盤點**）

| 層 | 份數 | 說明 |
|---|---|---|
| **業務邏輯** | **1** | `core/` —— 這就是抽 core 的全部意義 |
| UI | 2 | 桌寵 UI（Electron renderer）＋ 手機 UI（React，見 §4.5） |
| 平台殼 / adapter | 2（未來 3） | Electron ＋ Capacitor Android（＋ iOS） |
| 模組 | 1 | 走 core，兩邊共用 |

**若不抽 core**：邏輯 2 份、UI 3 份 → 這才是真正會拖垮維護的組合。

**仍會增加的實際負擔（無法消除）**：兩套 UI 的視覺／互動要各自維護、
Android 發版與回歸測試、省電策略類 issue（§7.1）。

- `ipcHandlers.ts` 4,551 行已到維護痛點，抽完可測試
- 未來若要做**純 Node、無 Electron 的 server**（記憶體 <50MB、可跑 ARM NAS），
  前置條件同樣是這件事

---

## 5. 已否決之後又復活的項目

| 項目 | 原否決理由 | 復活理由 |
|---|---|---|
| **手機直連 LLM** | 「Mac Mini 常開後不需要」 | 那是 owner 個人情境。**一般使用者沒有常開電腦**，這是主線功能 |
| **抽 `core/`** | 「降為純重構議題」 | 手機獨立版的關鍵路徑，且是防 drift 的唯一手段 |

**API Key 上手機的責任問題如何處理**：
使用者自己申請、自己填、存在 Android Keystore／iOS Keychain，**從不離開裝置**。
與桌面版 `safeStorage` 是同一個模型，不是新的妥協。

---

## 6. 尚未實作的功能

### 6.1 Google Calendar 模組 —— ✅ **已完成（2026-08-02）**

> **實作結論與規劃的唯一偏離：回呼方式。**
> Google 的「桌面應用程式」OAuth client **不接受自訂 URI scheme**
> （`desktopst://` 那套只發給 iOS／Android client），只允許 `http://127.0.0.1:<port>` 迴路位址。
> 因此 Calendar **沒有**沿用 Spotify 的 `desktopst://` 回呼，改為授權時起一個臨時 loopback
> HTTP server 收 code、收完立刻關閉。反而更單純：不必動 `setAsDefaultProtocolClient`，
> 也不必在 `second-instance` / 啟動 argv 分派 URL。**下一個 AI 不要試圖改回自訂 scheme，那條路 Google 不通。**
>
> **scope 從 `calendar.readonly` 擴為再加 `tasks.readonly`**（owner 2026-08-02 同意）：
> Google 日曆畫面上的「工作」屬於 Google Tasks，是另一套 API，只有 calendar scope 讀不到。
> 實測每天重複的待辦完全不會出現在 events 回應裡。兩者皆為唯讀。
>
> 另一個規劃時沒預期到的點：Google 桌面 client 的 token 交換**仍要求帶 `client_secret`**
> （即使用了 PKCE），所以設定 UI 是 Client ID ＋ 密鑰兩欄，不是一欄。
>
> 已落實 §3.3 的 provider 介面要求：`src/main/calendar/types.ts` 定義中性的
> `CalendarProvider` / `CalendarEvent`，Google 端點只存在於 `googleProvider.ts`。
> B4 移植手機版時只需新增一個 provider 實作，格式化與注入邏輯（`index.ts`）零改動。

原始評估（保留供對照）——基礎設施幾乎全到位，實作等於「照 `spotifyService.ts`(227 行) 再寫一份」：

| 需要的東西 | 現況 |
|---|---|
| OAuth PKCE + 自訂 URI scheme | `spotifyService.ts` 已跑通 `desktopst://` 回呼 |
| Token 加密存放 + 自動 refresh | 同上，`safeStorage` 照抄 |
| 注入 context 給 prompt | 天氣／Spotify 的 module 模式 |
| 情境覆蓋開關 | `moduleOverrides` 已支援，新模組自動吃到 |
| 定時觸發 | `reminderScheduler.ts`(154 行) 現成 |

- 虛擬 module id 比照：`desktopst.calendar`
- scope 用 read-only（`calendar.readonly`）
- **使用者自備 Client ID**（見 §7.3）
- 估 250 行左右

**價值**：角色能講的不只是「該睡了」，而是**「你明天早上 9 點有會，現在兩點了」**——
這是 Google 日曆制式通知給不出來的，也才配得上「角色」這個載體。

### 6.2 條件式主動提醒

Owner 明確指出：如果已經睡了卻被吵醒，本末倒置。

判定基準：**凌晨兩點手機螢幕還亮著 ＝ 還沒睡 ＝ 該提醒。**

```
AlarmManager 01:00 觸發
  → BroadcastReceiver 檢查 PowerManager.isInteractive()
      螢幕亮 → 發通知（獨立版可現場生成台詞）
      螢幕暗 → 安靜跳過
```

- `@capacitor/local-notifications` **做不到**條件化（排了就一定響）
  → 必須寫自訂 Capacitor plugin（Kotlin，約 100 行）
- 01:00 與 02:00 **各自獨立判定**，不可因 1 點沒發就取消 2 點
- **寧可漏報，不可誤報**：醒著但螢幕暗（看電視）不提醒，可接受
- 1 點發了沒理 → 2 點語氣可升級（記 flag，通知被點或 app 被開就清掉）
- **不可寫死 01:00 / 02:00** → 走現有 reminders CRUD，新增「條件式：螢幕亮著才發」選項
- `BOOT_COMPLETED` 監聽，重開機後排程不掉
- Android 12+ 需 `USE_EXACT_ALARM`（GitHub 散布不受審核影響）

### 6.3 host / client 多電腦模式（**第三層，進階**）

- 現況：`relayService.ts` 每台各自一組 device config，資料完全不共享，手機一次連一台
- 作法：資料儲存路徑指向共用位置（**已有「資料夾搬遷」功能，程式面幾乎不用改**）
- 加 **lock file**：啟動時寫入、關閉時刪除，偵測到別台在用就開唯讀模式。
  能擋掉九成衝突——一個人不會同時在兩台跟角色聊天
- 手機端支援**存多組配對並切換**（目前一次一組），估 1–2 天
- 附帶產出 **server 模式**：不顯示桌寵，只跑 server + 模組 + 手機介面
  （讓吃灰舊筆電變成 DeST 主機，對他人也有價值）
- 網路路徑要處理「開機時尚未掛載」的重試

### 6.4 遠端開機（WoL）

- **登入認證卡點有標準解法**：`netplwiz` 設自動登入 + 開機腳本立刻
  `rundll32.exe user32.dll,LockWorkStation`。session 已登入 → DeST 啟動；畫面鎖著 → 別人碰不到
- 網路面：
  - BIOS 開 Wake on LAN / PME
  - 網卡內容勾「允許此裝置喚醒電腦」
  - **關閉 Windows 快速啟動**（Fast Startup 會讓關機後 WoL 失效，最多人踩的雷）
  - 有線較可靠，Wi-Fi 的 WoWLAN 支援參差
  - 從外網喚醒需區網內有常開裝置發 magic packet
    → **owner 的 TS-231P 即可勝任（見 §9），跳板問題已解決**
- DeST 只負責「對指定 MAC 送 magic packet」，跳板是使用者自己的硬體，**與 NAS 無關**
- 現有 `/api/remote/wake` 是喚醒**螢幕**（`remote.monitor.power`），與開機是兩回事，但 UI 位置現成

### 6.5 macOS 支援

| 部分 | macOS |
|---|---|
| 角色、LLM、新聞、天氣、便利貼、提醒、記憶摘要 | ✅ 純 TS，直接跑 |
| `safeStorage` | ✅ Electron 自動改用 Keychain |
| cloudflared | ⚠️ `cloudflaredManager.ts` 路徑寫死 `.exe`，要加 darwin 分支 |
| 桌寵透明置頂視窗 | ⚠️ 能做，但點擊穿透、always-on-top 層級行為與 Windows 不同 |
| **遙控模組** | ❌ 全是 `user32.dll` + PowerShell，等於重寫（AppleScript／CGEvent），需「輔助使用」授權 |
| 螢幕截圖 | ⚠️ 可行，需螢幕錄製權限 |
| `mobileServer.ts` 視窗偵測 | ❌ PowerShell + user32.dll，Windows only |

**若 Mac 只當 server（不顯示桌寵）**，遙控模組本就不需要 → 移植約 1–2 週。

**風險**：主力轉到 mac 後 Windows 回歸測試會變少
→ README 明寫 **Windows 為主要支援平台、macOS 實驗性**，發版前保留一台 Windows 驗證。

---

## 7. 散布與商業模式

### 7.1 Android：GitHub Releases（**採用**）

不經 Google Play → `USE_EXACT_ALARM` 審核、UGC 審核**全部不適用**。
與自訂授權條款（禁售、免費再散布自由）完全相容。

- **keystore 要永久保管**。弄丟 = 使用者無法升級，只能解除安裝重裝（資料全沒）
- 沒有自動更新 → 重用 `updateChecker.ts`，改查 GitHub Releases
- 使用者要開「允許安裝未知來源」，Play Protect 會跳警告 → 寫進 README
- 省電策略：小米／華為／OPPO／vivo 會殺背景服務，需自行加白名單，
  **非 bug 且無法修**。這會是最大宗 issue 來源

**新手教學三張圖**：安裝 → 填 API Key → 省電白名單設定。

### 7.2 iOS：目前不做，但是**已知的長期缺口**

目標客群（卿卿我我使用者）有相當比例在 iOS，Android-only 觸及範圍受限。
技術上 Capacitor 同一份程式碼可出 iOS，**但無論走哪條路都必須有 macOS + Xcode 才能建置**
（等 Mac Mini）。

#### iOS 散布途徑比較（**結論：沒有等同 APK 的免費途徑**）

| 途徑 | 費用 | 可行性 | 說明 |
|---|---|---|---|
| **TestFlight** | **$99/年** | ⭐ **最接近 APK 模式** | 最多 10,000 位外部測試者，只需分享連結。仍要過 beta 審核（比正式寬鬆），**每個 build 90 天過期**需重新上傳 |
| 正式 App Store | $99/年 | 審核最嚴 | UGC 條款是主要風險（見下） |
| AltStore / SideStore | 免費 | ❌ 一般使用者不現實 | 免費 Apple ID 自簽，**7 天過期需重簽**，最多 3 個 app。SideStore 可無電腦續簽但設定繁瑣 |
| Ad Hoc 分發 | $99/年 | ❌ | 上限 100 台，且要逐一收集裝置 UDID |
| Apple Developer Enterprise | $299/年 | ❌ | 需公司資格，個人不適用，濫用會被撤銷 |
| 替代 App 市集（AltStore PAL） | — | ❌ | DMA 僅適用**歐盟**，台灣不在範圍 |

**若哪天要做 iOS，實際只有兩個選項**：付 $99 走 TestFlight（半公開、90 天輪替），
或付 $99 走正式上架。

#### 正式上架的額外門檻

**角色卡匯入 ＝ UGC**，Apple 指南 1.2 要求檢舉／封鎖／內容過濾機制，分級至少 17+，
角色扮演類 App 被打回是常態。

> ⚠️ **若未來可能走 App Store，UGC 機制必須提早設計進資料結構，不能等到上架前才補。**
> 但依 §2 目標 2（不營利），現階段**不為此付出任何設計成本**——
> 這裡只是留紀錄，避免日後誤以為是臨時起意的需求。

### 7.3 Google OAuth 的公開散布問題

Client ID 放進公開 repo / APK 等於公開（可反編譯提取），且 calendar 屬敏感 scope，
未驗證 App 會顯示警告畫面、上限 100 位使用者。

**解法（已有先例）**：照 Spotify 模式，**使用者自備 Client ID**。專案已建立此慣例。
Owner 自己用則設測試模式加自己為測試使用者即可。

### 7.4 付費模式（**不採用**，見 §2 目標 2）

Apple/Google 抽 15–30%；需隱私權政策；台灣個人開發者涉報稅；退款與客訴。
使用者自備 API Key 的模式，付費點本就尷尬。

---

## 8. 已否決的方案（**不要重新提案**）

| 方案 | 否決理由 |
|---|---|
| **雲端同步後端**（Supabase/Firebase 等） | 違反 §2 目標 2、3。1.5–3 個月 + 永久營運責任（帳號、GDPR 刪除請求、備份、事故）。**注意：這條否決的是「雲端後端」，不是同步本身——手機↔自己電腦的點對點同步已採納，見 §4.7** |
| **RTC 喚醒**（工作排程器半夜喚醒電腦發提醒） | 技術可行、零開發成本，但臥室裡風扇轉、指示燈亮，比提醒本身更吵 |
| **Relay 代排程**（Worker Cron + Web Push） | 違反目標 2、3。為一句「該睡了」營運存放使用者資料的服務不划算，Durable Objects 另有 $5/月起成本 |
| **React Native 重寫** | UI 全部重寫。Capacitor 可複用現有 React + TS + Tailwind |
| **把 HTML 打包進遙控版 APK** | 遙控版薄殼應從 relay 載入，UI 改動即時生效。（**獨立版不適用此條**，獨立版必須內含完整程式） |
| **在手機重寫一份 prompt 組裝邏輯** | drift（見 §4.1）。必須抽 `core/` 共用 |
| **NAS（TS-231P）當 DeST host** | armv7 無 Electron 建置（Electron 24 起停止提供）＋ 1GB RAM。見 §9 |
| **付費模式** | 見 §7.4 |
| **Spotify 自動選歌** | 已知不可行（CLAUDE.md 已記錄：audio-features 403、recommendations 404） |

---

## 9. NAS 的角色（owner：QNAP TS-231P）

規格：Annapurna Labs Alpine AL-212，雙核 ARM Cortex-A15，**1GB RAM，armv7（32 位元）**。

### ❌ 不能當 DeST host

兩個各自都足以否決：

1. **armv7 沒有 Electron 建置**。Electron 自 24 版起停止提供 linux/armv7l，專案用 34。
   不是「跑起來慢」，是**根本沒有可執行檔**
2. **1GB RAM**。Chromium 啟動就要 300–500MB，QTS 本身還要吃掉一部分

Container Station 在此機種只能跑 armv7 映像，救不了第 1 點。**此題已結案。**

### ✅ 兩個有效用途（**皆不需要新程式碼**）

| 用途 | DeST 要提供的能力 | 現況 |
|---|---|---|
| **共用資料儲存** | 「資料儲存路徑可以是任意路徑」 | ✅ 已有（資料夾搬遷） |
| **WoL 跳板** | 「對指定 MAC 送 magic packet」 | 見 §6.4，與 NAS 無關 |

### ⚠️ 這是「部署方式」，不是「功能」

程式提供的是通用能力：**「你的資料可以放在任何地方」**。
使用者放 NAS、放 OneDrive、放 Google Drive、或就放本機不共享——**同一個功能，多種用法。**

**程式碼裡不可出現 `QNAP` / `NAS` 等字樣。** NAS 只能出現在教學文件的範例段落。

WoL 跳板同理：可以是 NAS、路由器、樹莓派、另一台常開電腦。

---

## 10. 實作順序

### 階段 A — 不受手機獨立版影響，可立即開工

| # | 項目 | 估時 | 備註 |
|---|---|---|---|
| A1 | ~~**Google Calendar 模組**（桌面）~~ ✅ **已完成 2026-08-02** | 3–5 天 | 見 §6.1。已走 provider 介面，B4 可直接移植 |

### 階段 B — 手機獨立版（主線，最大工程）

| # | 項目 | 估時 |
|---|---|---|
| B1 | **抽出 `core/`**（純 TS，adapter 介面）— ✅ **完成（2026-08-03）**，四刀全數搬完，見 §4.4b。刻意留在 `main/` 的清單見 §10.5 | 3–5 週 |
| B2 | Capacitor 專案骨架 ＋ 五個 adapter 介面與桌面實作 — ✅ **完成（2026-08-03，見 §4.4b）**。**已實機驗證**：owner 實測四家 LLM ＋ 傳圖 ＋ 金鑰持久化，另有 APK 試打七項全過（`pre-b3-work-assessment.md` §5.1）| 1 週 |
| **B2.7** | **`fileStore` 抽 core** — ✅ **完成（2026-08-03）**。989 → 777 行、對外簽名一行未改。**採用的形狀：core 完全不碰 I/O**（資料進、資料出），因此同步／非同步的難題直接消失。⚠️ `StorageAdapter` 呼叫端仍是 0，要接上須先反轉 `storageAdapter → fileStore` 的依賴方向 → 留給 B3。見 `CLAUDE.md` 的 B2.7 條目 | 1–2 週 |
| B2.5 | Lorebook core（`src/core/lore/`，純函式，ST 格式子集）— ✅ **完成（2026-08-04）**。型別／掃描／排序／預算裁切／ST `character_book` 往返，57 項 vitest。見 `CLAUDE.md` 的 B2.5 條目 | 3–5 天 |
| B2.6 | Lorebook 桌面 UI ＋ ST 匯入匯出 ＋ 情境綁定 ＋ 角色卡自動生成條目 — **不擋 B3，可延後** | 4–7 天 |
| B3 | 手機 UI（含 §3.0 全部功能 ＋ §4.8 設定 UI，資料來源可抽換見 §4.5）。**範圍已由 `docs/mobile-html-feature-inventory.md` 定義完畢（49 項必做 ＋ 該文件 §6.1 的編輯功能）**；owner 2026-08-04 決議把預設組編輯與**角色庫／角色卡編輯**一併納入 → 估時上修。⚠️ 時間非限制條件，架構品質優先 | ~~4–8 週~~ **8–12 週** |
| B3.5 | S1 掃 QR 一鍵初始化匯入（見 §4.7） | 3–5 天 |
| B6 | 手機 UI 的 web build 接手 `mobile.html`（含遙控 UI 搬移）。**掃 QR 連線方式不變** | 1 週 |
| B7 | **S2 手動雙向同步**（推送／拉取／合併 ＋ 差異預覽） | 2–3 週 |
| B4 | 模組移植（新聞、天氣、Calendar） | 2–4 週 |
| B5 | 條件式主動提醒（含 Kotlin plugin） | 1–2 週 |
| B8 | **角色對使用者／角色對角色的印象** — 見 `future-character-impression.md`。**刻意排在 B3 之後**：它是 LLM 自動寫入、驗收靠手感、會持續花 token，不宜與 B3 同時點火（理由見 `pre-b3-work-assessment.md` §4） | 1–2 週 |
| B9 | **飲食熱量模組** — 見 `future-nutrition-module.md`。可選模組（熱量＋蛋白、食物庫、關鍵字免 LLM、快覽／Widget）；Health 選配；**MVP 含換機搬家包匯出／匯入**。B3 APK 穩定後開工；owner 自用可插隊但勿打斷 B3 | 約 3–6 週（分 B9a／b／c） |

**合計約 3–4 個月**（單人 + AI 協作）。

> ⚠️ **B3 開工前另有幾件不在上表的雜項**，以及一份**測試策略**
> （哪些能自動測、哪些只能靠 owner 手動測）—— 全部見 **`docs/pre-b3-work-assessment.md`**。
>
> - ✅ 驗證並合併 B1／B2 分支 —— **已完成 2026-08-03**
> - ✅ Hello World APK 試打 —— **已完成 2026-08-03**，實機 Pixel 10a 七項全過。
>   **Gemini 靠全域 fetch patch 繞 CORS 經實機證實可行**；`rss-parser` 需改用自帶的
>   `dist/rss-parser.min.js`（預設進入點 require 了 Node 內建模組）。
>   ⚠️ 另撞到「Android Studio 內建 JDK 太新，Gradle 不吃」，解法見
>   `pre-b3-work-assessment.md` §5.1
> - ✅ `mobile.html` 功能對照清單 —— **已完成 2026-08-03**，見
>   `docs/mobile-html-feature-inventory.md`。49 項獨立版必做、15 項遙控專屬；
>   **四個決策議題 owner 已於 2026-08-04 全數定案**（角色管理語意／截圖歸屬／
>   事件來源抽象／編輯功能進 B3）。⚠️ 該文件 §5.3 列了三件「不先做會付兩次錢」的事，
>   B3 階段 0 必做
> - ⬜ Android keystore：**不擋開發**，發第一版前要弄好並備份（操作說明見該文件 §9）

### 階段 C — 進階需求（owner 自用為主，第三層）

| # | 項目 | 估時 | 備註 |
|---|---|---|---|
| C1 | host / client 多電腦模式 | 1 週 | |
| C2 | macOS 支援 | 1–2 週 | 等 Mac Mini（長期缺貨，勿卡進度） |
| C3 | 遠端開機 WoL | 2–3 天 | 跳板用 TS-231P |
| C4 | 遙控版薄殼 APK | 4–7 天 | 若做了獨立版，此項可能被吸收 |

### 建議

~~**A1 先做**（獨立、3–5 天、立刻有用、抽 core 後可直接移植到手機）。
**接著直攻 B1**~~ —— A1／B1／B2／B2.7 與 APK 試打皆已完成（截至 2026-08-03）。

**目前位置**：B3 前的擋路項目已全部清空（B2.5 於 2026-08-04 完成）。
剩下的 B2.6 是桌面 UI，**不擋 B3**，可做可延。

階段 C 隨時可插隊，但不應阻擋 B。

---

## 10.5 下一個 AI：從這裡開始

**開工前必讀**：本文件 §2（四大目標）、§4.4（抽 core 切法）、§8（已否決清單）、§11（提醒）。

> ## 👉 現在的下一步是 **B3 階段 6（個人新聞報）→ 7（收尾／APK）**
>
> 更新於 2026-08-06。前置與 B3 前半已完成：
>
> | 順序 | 項目 | 狀態 |
> |---|---|---|
> | 0 | 驗證 ＋ 合併 `feat/mobile-standalone` | ✅ 完成 2026-08-03（四家 LLM 實測 ＋ 48 情境全等比對）|
> | 1 | Hello World APK 試打 | ✅ 完成 2026-08-03（實機七項全過，見 `pre-b3-work-assessment.md` §5.1）|
> | 2 | `mobile.html` 功能對照清單 | ✅ 完成 2026-08-03，**四個決策議題 owner 已於 2026-08-04 定案**。見 `docs/mobile-html-feature-inventory.md` |
> | 3 | B2.7 `fileStore` 抽 core | ✅ 完成 2026-08-03 |
> | 4 | B2.5 Lorebook core | ✅ 完成 2026-08-04 |
> | 5 | B2.6 Lorebook 桌面 UI | ✅ 完成 2026-08-04 |
> | 6 | **B3 手機 UI** | 🚧 **進行中**（`feat/mobile-ui`）。階段 0–5、8、9 ＋ IA／雙入口完成；**下一步階段 6 新聞報**。詳見 `docs/b3-mobile-ui-plan.md` |
>
> ⚠️ **不要重做 B2.x**，也不要在 B6 之前刪 `mobile.html`（遙控 H1–H11 只有舊版有）。
> 改手機連線相關必讀計畫書 §4.20（relay 三條硬約束）。
>
> **B3 開工前務必讀對照清單的 §3（四個決議）與 §5.3（三件不先做會付兩次錢的事）。**
> 工作分支：`feat/mobile-ui`。
>
> **不要重做已完成的部分**——`core/` 目前已含：
> `types`、prompt 組裝、群組接龍、`stCardMapper`、`pngCard`、base64、
> 新聞 `types`／`keywordGroups`／`filter`／`topicState`／`trigger`（指令組裝）、
> **`llm/` 全部（主流程 ＋ 四家 provider ＋ 記憶摘要）**、
> `reminder/nextFire`（下次觸發計算）、五個 adapter 介面、`store/`、`lore/`、`modelCatalog`。
> 桌面實作在 `src/main/adapters/`；renderer 已直接吃 core（`@core/*` alias）；
> 桌面與手機共用呈現元件在 `src/shared/`（目前 `MonoIcon`）。
>
> **開工前先讀 §4.4b**——六個已定案的設計決定與三個落地慣例。照著走，不要重新發明。
>
> ### B1 蓄意留在 `main/` 的東西（**不是漏做**）
>
> | 留下的 | 為什麼 |
> |---|---|
> | `modules/news/sources.ts` | 用了 `crypto.createHash` 與 `rss-parser`。手機端要純 JS hash、且要確認 `rss-parser` 能否在 WebView 跑，或改走 §3.3 的 news provider 介面。**這是 B4 的決定，不該在純重構階段順手決定** |
> | `modules/news/settings.ts` 的 load/save/normalize | 走檔案存取 |
> | `reminderScheduler` 的 `setTimeout`／存檔／`powerMonitor` | 平台生命週期 |
> | `llm/imageResolver.ts` | 用 `fs` 把本機圖片路徑先讀成 data URI（見 §4.4b） |
> | `fileStore`、`windowManager`、`ipcHandlers` 的視窗定位、遙控模組、`cloudflaredManager`、`mobileServer`、`dstPack` | 原本就規劃留在 `main/` |
>
> **A1 留下的可複用範例**：`src/main/calendar/` 是目前唯一「已經照 provider 介面切乾淨」的模組
> —— 純邏輯（格式化、注入判斷）在 `index.ts`，平台/服務商細節在 `googleProvider.ts`。
> 抽 core 時可以拿它當形狀參考，B4 移植時它也是最好搬的一個。

### ~~若接手 A1（Google Calendar 模組）~~ —— ✅ 已完成，以下保留為實作紀錄

1. 讀 `src/main/spotifyService.ts`(227) —— 這是**要照抄的範本**（OAuth PKCE、
   `desktopst://` 回呼、token 加密與自動 refresh）
2. 讀 `src/main/ipcHandlers.ts` 第 1657 行附近 —— 虛擬 module id 與
   `isModuleEffectivelyEnabled()` / `applySceneModuleOverrides()` 的接法
3. 讀 `src/main/weatherService.ts`(275) —— context provider 如何注入 prompt
4. 新增 `desktopst.calendar`，scope `calendar.readonly`，**使用者自備 Client ID**
5. 設定 UI 比照 `SpotifySettingsWindow.tsx`(139)

### 若接手 B1 剩餘部分（抽 `core/`）—— 第一刀已完成，見 §4.4

1. 第一刀（`ipcHandlers.ts` 279–488 行）**已完成**，不要重做。剩餘切法見 §4.4 末段
2. 驗收標準：**桌面版行為完全不變**（`npm run typecheck` 通過 ＋ 手動走一輪群組聊天）
3. 每搬一塊就驗一次，不要一次搬完再測
4. `core/` 不得 `import` 任何 `electron` / `fs` / `path`；用注入的 adapter
5. 純位移優先用 **re-export 轉出檔**保住既有 import 路徑，讓 diff 只剩「刪掉本體」
6. 中文字串規則見 §3.3 的例外條款（prompt 字串可留、UI 文案不可）

### Owner 已決定的事項（2026-08-02）

- [x] **開發分支**：手機獨立版在**獨立分支**進行（建議 `feat/mobile-standalone`），
      工程量大，不在 `main` 上做。包版流程一併更新（見 §11）
- [x] **角色卡格式完全相容**：手機版與桌面版沿用同一格式（SillyTavern PNG ＋ DST Pack），
      **且必須能互相匯出／匯入資料**
- [x] **UI 視覺沿用現行 mobile 網頁風格**，色彩主題同樣可自由挑選
      （`AppSettings.ui.colorTheme` 現有 9 組：mint / butter / peach / aqua / sky /
      blush / lavender / white / dark）
- [x] **API Key 僅區網直連時傳輸**，由電腦端判定，UI 顯示狀態不提問，不提供覆寫選項（§4.7）
- [x] **手機只綁定一台「同步主機」**，其他配對僅供遙控（見 §4.7 星狀拓樸）
- [x] **App 名稱**：`DeST`／`applicationId` = `tw.nori.dest`（見 §11.2）

### Owner 已決定的事項（2026-08-04，B3 範圍四題）

詳細理由與落地形狀見 `docs/mobile-html-feature-inventory.md` §3。

- [x] **手機的「角色管理」＝「這次對話誰在場」**（UI 用語），
      但同步時對應桌面角色清單；**桌面端缺位置資訊時自行產生**
      （`spreadDesktopCharacters` 已現成）。位置是桌面獨有的顯示狀態，不進同步
- [x] **截圖「加入對話」歸遙控模組**，獨立模式不做手機自身截圖
      （相簿選圖已涵蓋）→ 不需要截圖外掛與螢幕權限
- [x] **獨立／遙控兩種模式走同一個「事件來源」介面**，UI 不知道差別。
      **B3 階段 0 必做**，做到一半再抽等於重寫聊天元件
- [x] **編輯功能全部進 B3**：情境／Persona／World 預設組，**外加角色庫與角色卡編輯**。
      理由：手機版要能獨立運作，少任何一項則「不需要電腦」的前提不成立
- [x] **時間不是限制條件**（興趣專案）。取捨一律選「架構漂亮、好維護」，
      不選「快但留技術債」

### 仍待確認

- [ ] Android **keystore** 產生與保管方式（見 §11.3；一般使用者不會接觸，只有發布者需保管）

---

## 11. 分支、命名與建置

### 11.1 開發分支

手機獨立版工程量大（約 4 個月），**在獨立分支進行，不在 `main` 上做**。

- 建議分支名：`feat/mobile-standalone`
- **例外**：B1（抽 `core/`）是**純重構、桌面版行為不變**，
  建議**在 `main` 上分批合併**，避免長命分支與 `main` 大幅分歧。
  只有 B2 之後（Capacitor 專案、手機 UI）才進獨立分支
- A1（Google Calendar）走一般功能分支即可，與手機版無關

### 11.2 App 命名（**已決定**）

| 項目 | 值 | 說明 |
|---|---|---|
| 顯示名稱 | **DeST** | 與桌面版同品牌，不再強調 `Desktop` 字義 |
| `applicationId` | **`tw.nori.dest`** | owner 擁有 `nori.tw` 網域。**一旦發布不可更改** |

**為什麼不叫 DeST Mobile／隨身版之類**：品牌分裂沒有好處，兩邊是同一個產品的兩種形態，
靠平台區分即可。而 `DesktopST` 的原義（Desktop SillyTavern）在手機上本來就不成立，
索性讓 `DeST` 就是 `DeST`。

> ⚠️ `applicationId` 發布後不可更改——改了 Android 視為不同 app，
> 使用者會裝成兩個、資料不互通。**發第一版前務必確認。**

### 11.3 Android keystore（發布者專用，一般使用者不會接觸）

**是什麼**：一組數位簽章金鑰，用來證明「這個 APK 是同一個作者發的」。
產出物是一個 `.jks` 檔 ＋ 兩組密碼。

**為什麼重要**：Android 只允許用**同一把 keystore 簽出的新版**覆蓋安裝舊版。

> **弄丟 keystore ＝ 所有使用者都無法升級**，只能請他們解除安裝再重裝，
> **而解除安裝會清掉全部資料**（角色、對話、設定）。無法補救、無法申訴。

**一般使用者要做什麼**：**什麼都不用做。** 使用者只會在安裝時看到
「允許安裝未知來源」的系統警告（因為不是從 Play 商店下載），與 keystore 無關。
簽章驗證由 Android 自動完成。

**桌面版為何沒這個概念**：Windows 的 `.exe` 未簽章也能執行（只會跳 SmartScreen 警告），
Android 則強制要求簽章。

**產生**（一次性）：

```bash
keytool -genkeypair -v -keystore dest-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias dest
```

**保管規則**：

1. `.jks` 與密碼**離線備份至少兩份**（例如加密隨身碟 ＋ 密碼管理器）
2. **絕對不可 commit 進 repo**（即使是私有 repo）
3. GitHub Actions 走 Secrets：`.jks` 以 base64 存成 Secret，密碼另存
   —— **Secrets 只是 CI 用的副本，不是備份**，原始檔必須自己另存
4. `validity 10000`（約 27 年）避免中途過期

### 11.4 包版流程更新

現行：`npm run build` → `electron-vite build` ＋ `electron-builder`（Windows `.exe`）。

需新增：

| 產物 | 建置方式 | 平台需求 |
|---|---|---|
| 桌面版 `.exe` | 現行流程不變 | Windows |
| **手機 UI web build** | Vite build → 輸出給 `mobileServer` 提供（取代 `mobile.html`） | 任意 |
| **Android APK** | Capacitor sync → Gradle → 以 keystore 簽章 | 任意（Linux CI 可） |
| 未來 iOS | Capacitor sync → Xcode | **必須 macOS** |

- GitHub Actions：打 tag 時同時產出 `.exe` 與 `.apk`，一起附到同一個 Release
- **單一 repo、單一版本號**，桌面版與手機版版本號同步遞增
- 手機 UI 的 web build 必須**隨桌面版一起打包**（否則舊 `mobileServer` 提供不到新 UI）

---

## 12. 給接手 AI 的提醒

1. **所有提案先過 §2 四大目標**，尤其目標 4 的分層規則
2. **不要把 owner 的個人裝置寫進程式碼或設定名稱**：
   不可出現 `Mac Mini` / `QNAP` / `NAS`；要叫 host / client、server 模式、共用資料路徑
3. **不要走這些捷徑**（會做出只有 owner 能用的東西）：
   - ❌ 把 01:00 / 02:00 寫死 → ✅ 走現有 reminders CRUD，新增「條件式」選項
   - ❌ 把 owner 的 Client ID 塞進程式 → ✅ 使用者自填（同 Spotify）
   - ❌ 手機殼寫死 relay token → ✅ 照現有掃 QR 配對流程
   - ❌ 在手機重寫一份 prompt 組裝 → ✅ 呼叫 `core/`
4. 這些「照規矩做」的**邊際成本很低**，因為模式在專案裡都已存在
5. Owner 的私人東西只有 `local-modules/git-activity/`，本就在外部模組系統裡，天然隔離
6. **單一 repo、單一版本號**，APK 用 GitHub Actions 打 tag 時建置，keystore 放 Secrets
