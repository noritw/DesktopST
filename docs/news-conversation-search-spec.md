# 對話新聞搜尋 — 功能設計文件

> **狀態**：已完成（桌面＋手機，2026-08-22。手機真機驗證見 `TODO.md` §3 對應條目）
> **分類**：新聞陪聊模組的子功能，位於新聞設定面板 → 進階

---

## 1. 功能定位

### 現有新聞陪聊（維持不變）

定時抓取 RSS / keyword / JSON 來源，角色主動在「說點什麼」或提醒時發起話題。
屬於**主動推播**，不依賴使用者問了什麼。

### 本功能：對話新聞搜尋

偵測使用者訊息中「可能在問時事」的意圖，**在回應前**即時搜尋 Google News RSS，
將搜到的新聞注入 prompt，讓角色能給出有憑有據的回應，而非憑空推測。
屬於**被動式、對話觸發**的即時查詢。

| | 新聞陪聊 | 對話新聞搜尋（本功能）|
|---|---|---|
| 觸發 | 自動定時 / 說點什麼 | 使用者訊息含時事意圖 |
| 搜尋時機 | 主動抓取 + 快取 | 對話發送當下即時搜尋 |
| 來源 | 使用者設定的 RSS / keyword / JSON | Google News RSS（依萃取到的查詢詞）|
| 需要額外設定 | RSS 來源 | 無（複用現有 LLM 設定）|

---

## 2. 觸發流程

```
使用者發送訊息
  ↓
【第一關】前置過濾：訊息是否含有「觸發詞」？
  ↓ 否 → 跳過，不影響對話
  ↓ 是
【第二關】LLM 意圖萃取：
  送輔助模型（沒設定則送主要模型）一個輕量 prompt，
  判斷「這句話需要搜新聞嗎？需要的話給我搜尋詞」
  ↓ 回傳 null → 跳過
  ↓ 回傳搜尋詞
【第三關】Google News RSS 搜尋
  取前 2–3 則（標題 + 摘要 + 來源）
  ↓ 搜不到 → 跳過（角色可自然說不確定）
  ↓ 搜到
注入 context → 主要 LLM 生成回應
```

---

## 3. 第一關：前置過濾

### 目的

避免每則訊息都觸發 LLM call。「你好可愛」「謝謝你」等日常對話直接跳過。

### 觸發詞清單（預設值，使用者可在設定中維護）

```
最近、今天、昨天、前天、這幾天、剛剛、剛才
聽說、看到、看見、有沒有、你知道、有看到、知道、聽到
新聞、事件、事情、消息、報導、資訊
發布、發表、公告、發佈、發售、上市
活動、展覽、展出、場次、大會
訊息、熱門、討論、話題、八卦、傳說、傳言
怎麼了、出事、發生什麼、不會吧、發生、什麼事
```

### 比對邏輯

- 訊息包含任一觸發詞即通過（字串 `includes`，不需要斷詞）
- 僅前置過濾，不決定搜尋詞（搜尋詞由 LLM 萃取）
- 清單為空時視為停用前置過濾（每則訊息都送 LLM 判斷）

---

## 4. 第二關：LLM 意圖萃取

### 使用模型

- 優先：輔助模型（`llm.utilityEnabled` 且有設定）
- Fallback：主要模型

### Prompt 設計

```
（system）
你是一個助手，判斷使用者訊息是否在問一件現實世界的時事或新聞。
若是，給出適合 Google 搜尋的繁體中文查詢詞：最多 3 個關鍵詞、以空格分隔、每詞 2–5 字，只取核心概念。
若訊息不涉及可搜尋的時事，回覆「null」。只輸出查詢詞或 null，不要其他說明。

（user）
{使用者訊息原文}
```

**範例**

| 使用者說 | LLM 回傳 |
|---|---|
| 欸你知道最近記憶體漲價嗎 | `記憶體 漲價` |
| 聽說台北車站有什麼事件 | `台北車站 事件` |
| 今天那個網紅出事了你知道嗎 | `null`（無具體人名，無法有效搜尋）|
| 謝謝你今天陪我聊 | `null` |

### 回傳格式

| 回傳內容 | 處理方式 |
|---|---|
| `null` 或空字串 | 跳過，不搜尋 |
| 1–3 個關鍵詞（空格分隔）| 直接用於 Google News RSS 搜尋 |
| 超過 3 個詞 | 取前 3 詞使用（防止 prompt 失控）|

### Token 預算

- 此 prompt 約 80–120 input token，回傳 1–10 token
- 沒有搜尋到新聞時仍會消耗此成本；前置過濾是主要節流點

---

## 5. 第三關：Google News RSS 搜尋

### 搜尋 URL

```
https://news.google.com/rss/search
  ?q={搜尋詞}
  &hl=zh-TW
  &gl=TW
  &ceid=TW:zh-Hant
```

### 解析方式

複用現有 `sources.ts` 的 RSS 解析邏輯（`parseRssFeed`），不另寫 parser。

### 取用規則

- 最多取前 **3 則**
- 每則取：`title`、`summary`（描述）、`source`（媒體名）、`publishedAt`
- 過濾 48 小時以上的文章（可選，預設開啟）

### 注入格式

```
[對話搜尋：{搜尋詞}]
1. 標題一（媒體 A，2 小時前）
   摘要一的前 60 字…
2. 標題二（媒體 B，5 小時前）
   摘要二的前 60 字…
3. 標題三（媒體 C，昨天）
   摘要三的前 60 字…
（此資訊供角色參考，若不確定請如實告知使用者）
```

### 搜不到時

不注入任何內容，角色自然以「我搜了一下但找不到相關消息，你是在哪看到的？」回應。
（不強制這句話，由角色人設決定措辭。）

---

## 6. 設定 UI 設計

位於：新聞設定面板 → 進階區塊（可摺疊，預設收起）

```
────────────────────────────────
▼ 對話新聞搜尋（進階）
────────────────────────────────

[✓] 啟用對話新聞搜尋
    使用者提到時事時，自動搜尋 Google 新聞並提供角色參考。
    每次搜尋會額外呼叫一次 LLM 判斷意圖。

觸發詞（含任一詞才送 LLM 判斷）
[最近 × ][今天 × ][聽說 × ][新聞 × ] ＋ 新增
← 標籤式輸入，與興趣關鍵字 UI 相同

[✓] 過濾 48 小時以上的舊文章
```

---

## 7. 資料結構

### 新增至 `NewsModuleSettings`

```typescript
interface NewsModuleSettings {
  // 現有欄位（不變）...

  // 新增
  conversationSearch?: {
    enabled: boolean
    /** 前置過濾觸發詞，使用者可維護；空陣列 = 不過濾（每則都送 LLM） */
    triggerWords: string[]
    /** 是否過濾 48 小時以上的舊文章 */
    filterOldArticles: boolean
  }
}
```

### 預設值（加入 `defaultNewsModuleSettings()`）

```typescript
conversationSearch: {
  enabled: false,
  triggerWords: [
    '最近', '今天', '昨天', '前天', '這幾天', '剛剛', '剛才',
    '聽說', '看到', '看見', '有沒有', '你知道', '有看到',
    '新聞', '事件', '事情', '消息', '報導',
    '怎麼了', '出事', '發生什麼'
  ],
  filterOldArticles: true
}
```

---

## 8. 實作計畫

### 新增檔案

- `src/main/modules/news/conversationSearch.ts`
  - `shouldTriggerSearch(message, triggerWords)` — 前置過濾
  - `extractSearchQuery(message, settings)` — LLM 意圖萃取
  - `searchGoogleNewsRss(query, filterOld)` — RSS 搜尋
  - `buildConversationSearchInjection(query, items)` — 組注入字串

### 修改檔案

| 檔案 | 修改內容 |
|---|---|
| `src/main/modules/news/types.ts` | `NewsModuleSettings.conversationSearch` 欄位 |
| `src/main/modules/news/settings.ts` | `defaultNewsModuleSettings` 加預設值；`normalizeNewsModuleSettings` 加正規化 |
| `src/main/ipcHandlers.ts` | `chat:send-message` 流程加入對話搜尋步驟（與即時氣象查詢並列）|
| `src/renderer/src/modules/news/SettingsPanel.tsx` | 新聞設定面板加入進階區塊 UI（觸發詞標籤輸入、toggle）|
| `src/renderer/src/modules/news/types.ts` | 前端型別同步 |

### 訊息流程（修改 `ipcHandlers.ts`）

```typescript
// chat:send-message 收到使用者訊息後（與 realtimeQueryContext 並列）
const newsSearchContext = await getConversationSearchContext(payload.content, settings, newsSettings)
const extraContextParts = [weatherContext, spotifyContext, realtimeQueryContext, newsSearchContext].filter(Boolean)
```

### LLM 呼叫方式

複用現有 `chatWithLLM`（輔助模型路由），傳入專用的單輪 messages，
不加入任何角色人設或對話歷史，只萃取搜尋詞。

---

## 9. 邊界條件

| 情境 | 處理方式 |
|---|---|
| 輔助模型未設定 | Fallback 至主要模型 |
| LLM 萃取逾時（> 5 秒）| 靜默跳過 |
| LLM 回傳 null | 不搜尋，正常對話 |
| Google News RSS 搜不到 | 不注入，角色自然應對 |
| RSS 請求逾時（> 5 秒）| 靜默跳過 |
| 新聞陪聊模組未啟用 | 本功能仍可獨立啟用（不依賴陪聊功能）|
| 前置觸發詞清單清空 | 每則訊息都送 LLM 判斷（成本提高，但合法）|

---

## 10. 不在本次範圍內

- 非 Google News 的搜尋引擎（Bing、DuckDuckGo）
- 使用者指定「搜這個」的明確指令模式
- 搜尋結果的去重（與現有 seenIds 隔離，不互相影響）
- 搜尋結果的回饋學習（不影響現有 feedback.adjustments）
