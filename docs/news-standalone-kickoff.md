# 個人新聞報 —— 獨立版落地開工指令（缺口 #6）

> **建立時間**：2026-08-11（提醒 ②a／②b 收尾之後）
> **狀態**：待開工。這份是給接手 AI 的完整指令，**照著這份就能開工，不必先讀長文**。
> **前置**：`CLAUDE.md`（必讀）。其餘只在下面指名的段落才讀。

---

## 0. 一句話

桌面版新聞報**已經完整可用**，行動版 UI（`NewsView` / `NewsSettingsView` / 關鍵字面板）
**也已經做好了**，遙控模式下正常運作。這次要做的是把邏輯從 `src/main/modules/news/`
抽到 `src/core/news/`（注入 `HttpAdapter`），再讓 `LocalDataSource` 那 15 支 pending 接上去。

**不要重寫 UI，不要重新設計新聞規格。** 這是「補接線」，不是新功能。

---

## 1. 現況盤點（已查證，2026-08-11）

### 已經可以共用的（純 TS，兩邊已在用）

```
src/core/news/     1304 行
  types.ts         NewsItem／NewsSource／NewsKeywordGroup…
  filter.ts        435 行，篩選與語言判定
  reader.ts        330 行，新聞報的排版／配額計算
  trigger.ts       141 行，什麼時候該讓角色聊新聞
  enrich.ts         93 行
  keywordGroups.ts  63 行
  stableId.ts       11 行（純 JS SHA-1，兩邊算出同一個 id）
  topicState.ts     33 行
```

### 還卡在 Electron 主行程的（這次要抽）

| 檔案 | 行數 | 卡住的原因 |
|---|---|---|
| `sources.ts` | 360 | `import Parser from 'rss-parser'` ＋ 全域 fetch |
| `readerFetch.ts` | 158 | 純編排，但依賴上面三支 |
| `settings.ts` | 262 | 走 `../moduleSettings`（Electron `fs` ＋ `app.getPath`） |
| `readerState.ts` | 78 | 同上（釘選／不看了） |
| `enrich.ts` | 406 | 抓原文全文 ＋ 呼叫輔助模型 |
| `scheduler.ts` | 47 | 在 `reminders.json` 裡維護一條特殊 Reminder |
| `readerPack.ts` | 139 | 搬家包（**這次不用做**） |
| `conversationSearch.ts` | 196 | 對話新聞搜尋（**這次不用做**） |
| `ipc.ts` / `mobileRoutes.ts` | 362／321 | 桌面與遙控的入口，**不要動** |

### 缺口本體

`src/mobile/data/localDataSource.ts:300-314`，`news.*` 共 **15 支** `pending(…, 6)`。
介面形狀見 `src/core/data/types.ts` 的 `NewsApi`（第 585 行起）。

---

## 2. 這次的範圍

### 要做

1. 把 `sources` / `readerFetch` / `settings` / `readerState` 抽到 `core/news/`，改注入 adapter。
2. `LocalDataSource.news.*` 15 支接上（薄轉呼叫）。
3. `enrichForChat`：抓原文 ＋ 輔助模型摘要，獨立版也要能用。
4. 獨立版聊天要能帶新聞素材進 prompt（比照 Lorebook 那次的教訓，見 §5）。
5. `ReminderEditor` 的「抓一則新聞當話題」解除灰掉。

### 不要做

- **搬家包 `readerPack`、對話新聞搜尋 `conversationSearch`** —— 這輪不碰。
- **背景定時抓新聞**。前景開 App 時抓就好。背景抓要動原生層，
  而提醒那條路已經證明成本很高；等 owner 明確要了再說。
- 動桌面版的行為。桌面現在是對的，抽 core 之後要**逐字等價**。
- 重新設計 UI 或新聞規格。

---

## 3. 三個必須先決定的技術點

### 3.1 RSS 解析：`rss-parser` 能不能進 core？

`sources.ts` 用 `rss-parser@3`，它底層是 `xml2js`，**依賴 Node 的 stream/timers**。
core 必須在瀏覽器 tsconfig 下編得過（roadmap §4.4b）。

**建議**：在 core 定義 `RssParseAdapter`（或直接吃「已解析好的 feed 物件」），
桌面注入 `rss-parser`、手機注入 `DOMParser` 版本。
**開工前先花 10 分鐘實測** `rss-parser` 在 vite 瀏覽器 build 能不能過；
能過就直接用（少一層抽象），不能過再走 adapter。**不要憑感覺選**。

### 3.2 模組設定的儲存

桌面走 `src/main/modules/moduleSettings.ts`（`fs` ＋ `app.getPath('userData')`）。
手機那側 `core/store/keys.ts` 已經有 `MODULES_DIR`。

**做法**：在 core 寫一支吃 `StorageAdapter` 的模組設定讀寫
（key 形如 `modules/desktopst.news/settings.json`），桌面端把
`moduleSettings.ts` 改成薄殼呼叫它。**檔案佈局兩邊必須一致**——
不一致的話同一份資料在兩個平台叫不同名字，日後 S2 同步與搬家包會全部對不起來。

### 3.3 HTTP 一律走 `HttpAdapter`

- **不要用全域 `fetch`**（CLAUDE.md 硬規則）。手機那邊要 CapacitorHttp patch 過才繞得過 CORS。
- **逾時一定要走 `signal`**：`CapacitorHttp` 忽略 `init.signal`，
  `mobile/adapters/httpAdapter.ts` 已用 `Promise.race` 把 signal 翻成 reject。
  **不要自己 `setTimeout`**。
- headless（提醒）那條路徑有自己的 http 實作，
  剛踩過「**回應標頭沒帶回去，SDK 就不 parse JSON**」的坑
  （`src/mobile/headless/bridgeAdapters.ts`）。抓 RSS 也要注意 content-type。

---

## 4. 建議順序（每步都可獨立驗證）

| 步驟 | 內容 | 驗證方式 |
|---|---|---|
| ① | 模組設定讀寫抽到 core（§3.2），桌面改薄殼 | `npm test`；開桌面版確認新聞設定還在 |
| ② | `sources` ＋ `filter` 抽 core，注入 http／parser（§3.1） | 針對 `fetchSource` 寫 core 測試（餵固定 RSS 字串） |
| ③ | `readerState`（釘選／不看了）→ `LocalDataSource` 4 支 | 手機 UI 釘一則、重開 App 還在 |
| ④ | `readerFetch` → `getReaderState`／`fetchBatch`／`fetchSection`／`setQuota`／`setSourceOrder` | 手機獨立模式真的抓到新聞 |
| ⑤ | `settings`／`getSchedule`／`setSchedule` 3 支 | 設定改了、重開還在 |
| ⑥ | `enrichForChat`／`updatePromptContext`／`markOpened` | 「聊這個」能帶原文進 prompt |
| ⑦ | 聊天注入（§5）＋ 解除 `ReminderEditor` 的灰掉 | 角色真的講到新聞 |

每一步做完就 `npm test` ＋ `npm run typecheck`；動到手機 UI 就用
`MobileST.bat [3]`（或 `preview_start` ＋ `?mode=standalone`）看一眼。

---

## 5. 一定會踩、先寫在這裡的坑

1. **只接 CRUD 不接聊天管線 ＝ 白做。**
   Lorebook 那次就是這樣：編輯 UI 全接好了，但 `chat.ts` 根本沒有注入 `[Glossary]`，
   使用者編了半天對話完全沒變化（`mobile-standalone-gap-inventory.md` §5）。
   新聞同理——`src/mobile/runtime/chat.ts` 目前**只認得 `newsLink` 欄位**，
   沒有任何「挑一則新聞當話題」的邏輯。桌面那段在 `ipcHandlers.ts`，要一起搬。

2. **改完資料一定要 `events.push({ kind: 'state-invalidated', reason: 'desktop' })`**，
   否則畫面停在舊資料，看起來像沒生效。

3. **`tests/data/dataSource.test.ts` 有「這些方法必須 reject」的斷言**，
   接完一支就要改一支，不然測試會綠著騙人。

4. **`scripts/mobile-stub-server.mjs` 已經有假新聞資料**（`newsSources`／`newsKeywordGroups`，
   拒絕條件照抄自 `readerFetch`/`mobileRoutes`）。改端點形狀時要同步改它，
   否則遙控模式的瀏覽器煙測會壞掉。

5. **`news.enrichForChat` 會呼叫輔助模型**。獨立版的輔助模型設定已經做好了
   （`llm.utilityEnabled`／`utilityProvider`／`utilityModel`），直接沿用，
   **不要另外開一套**。

6. **抓 RSS 的量很大**。手機是弱網環境，逾時與失敗要各別處理：
   一個來源掛掉不能讓整批 fetch 失敗（桌面 `fetchAllSources` 已經是這個語意，照抄）。

7. **提醒那條剛做完的路徑會受影響**：`scheduler.ts` 是在 `reminders.json` 裡塞一條特殊
   Reminder。獨立版現在有自己的排程器與原生鬧鐘（`docs/mobile-standalone-reminder-plan.md`），
   要接新聞排程前**先讀那份 §2.1**，別在手機端又造一套排程。

---

## 6. 完工判準

- [ ] 手機獨立模式打開「個人新聞報」，抓得到新聞、分欄正確
- [ ] 釘選／不看了／配額／欄位排序，重開 App 後都還在
- [ ] 「聊這個」能把原文摘要帶進 prompt，角色講得出內容
- [ ] 新聞設定與關鍵字組在獨立模式可編輯並持久化
- [ ] `ReminderEditor` 的「抓一則新聞當話題」不再灰掉，而且真的會注入
- [ ] `npm test` 全過、`npm run typecheck` 過
- [ ] `localDataSource.ts` 不再有 `pending('news.*')`
- [ ] 桌面版行為**完全沒變**（抽 core 是等價重構）
- [ ] `docs/mobile-standalone-gap-inventory.md` 缺口 #6 標成完成、`progress-log.md` 補條目

---

## 7. 依任務選讀（不要整份開）

| 你要做的事 | 讀這些 |
|---|---|
| 端點形狀（獨立版要對齊的契約） | `src/main/modules/news/mobileRoutes.ts`（321 行，整份可讀） |
| 介面定義 | `src/core/data/types.ts` 的 `NewsApi`（第 585 行起） |
| 行動版 UI 已經做到哪 | `docs/b3-mobile-ui-plan.md` **§4.21**（React 版落地） |
| 新聞的產品規格／UX | `docs/news-reader-mobile-plan.md` |
| 斷章／摘要進 prompt 的設計 | `docs/news-article-context-design.md` |
| 假伺服器怎麼驗 | `scripts/README-mobile-stub.md` |

**不要讀**：所有 `news-future-*`（那是還沒定案的構想）、整份 roadmap、整份 b3 計畫。
