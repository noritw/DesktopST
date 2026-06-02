# 新聞陪聊模組設計

本文件規劃 DeST 的新聞陪聊模組。共用 module host 規格請見 `docs/module-system-roadmap.md`。

---

## 1. 功能定位

新聞模組不是新聞 App，也不是 RSS 摘要器。它的定位是：

> 讓角色用自己的語氣，幫使用者跟外面的世界保持一點連線。

核心判斷標準不是「使用者喜歡看什麼新聞」，而是：

> 這件事會不會對使用者、使用者周遭的人、所在地社會環境、使用的服務、關心的產業、未來決策產生影響。

這可以稱為「影響半徑」。

---

## 2. 角色語氣與事實分層

新聞模組不應硬寫角色語氣，因為 DeST 的角色卡由使用者自訂。建議分兩層。

### 判斷層：新聞模組

新聞模組負責：

- 抓取來源。
- 去重與事件聚合。
- 分類與影響評估。
- 來源紀錄。
- 不確定性標示。
- 產出結構化事件。

範例：

```json
{
  "eventId": "2026-06-01-example",
  "title": "某項政策即將調整",
  "summary": "政策預計在下個月開始影響特定服務費率。",
  "region": ["TW"],
  "topics": ["policy", "consumer", "internet-service"],
  "impactLevel": "medium",
  "urgency": "watch",
  "confidence": "developing",
  "whyUserMightCare": "使用者位於台灣，且設定中關心網路平台與日常支出。",
  "recommendedDepth": "brief",
  "avoidFraming": ["煽動", "政黨口水", "八卦化"],
  "sources": []
}
```

### 表達層：角色系統

角色系統根據目前說話角色的角色卡輸出。角色卡的 `description`、`personality`、`exampleDialogue`、`scenario`、`systemPromptOverride` 都應繼續有效。

新聞模組只提供素材與約束：

- 用角色平常的語氣。
- 不誇大新聞影響。
- 明確標示不確定性。
- 不把來源內容說成角色親眼見聞。
- 低重要性事件用低壓力語氣提起。

---

## 3. 個人化設定

### 輕量設定

初次啟用只問低負擔問題：

- 所在地。
- 生活身份，例如工作者、學生、租屋族、照護者、開發者、創作者。
- 想關心的面向，例如生活政策、交通、物價、科技、AI、醫療、資安、平台服務、天災。
- 明確不想看的類型，例如影劇八卦、犯罪獵奇、政黨口水、災難細節、金融炒作。
- 主動提醒頻率：每日、每週、只在重要時、手動詢問才整理。
- 破圈比例：保守、適中、積極。

### 進階設定

- 信任來源與排除來源。
- 來源語言與地區。
- 主題權重。
- 政治新聞容忍度。
- 犯罪、災害、戰爭、醫療議題敏感度。
- 每次最多事件數。
- 每則新聞預設深度。
- 是否追蹤長期議題。
- 是否允許角色主動提起新聞。
- 是否保留「你可能不喜歡但重要」區塊。
- 是否需要多來源交叉確認才可提及。

### 對話式調整

使用者可以用自然語言回饋：

- 「這類以後少講。」
- 「這跟我有關，以後多注意。」
- 「這種只要大事再講。」
- 「這個來源我不信。」
- 「這種雖然煩，但你還是要提醒我。」
- 「這件事我只想知道結果，不想追細節。」

這些回饋應寫入新聞模組 profile，不一定污染角色長期記憶。

---

## 4. 新聞來源

第一階段支援：

- RSS / Atom feed。
- 使用者自訂新聞頁。
- Google News RSS 搜尋或主題來源。
- 固定媒體 RSS。

第二階段新增來源群組：

- 台灣一般社會。
- 國際大事。
- 科技與 AI。
- 資安與平台服務。
- 生活政策。
- 天氣與災害。

第三階段再做跨來源聚合：

- 標題相似度。
- URL canonicalization。
- 時間接近。
- 實體名稱重疊。
- LLM 輔助判斷是否為同一事件。

---

## 5. Token 成本控制

不可直接把大量新聞全文丟給 LLM。建議流程：

```text
來源抓取
  -> 標題/摘要/metadata 規則過濾
  -> 去重與來源分群
  -> 便宜模型或規則做初步影響評分
  -> 只把候選事件交給較強模型判斷
  -> 只對入選事件做角色化表達
```

具體策略：

- 預設只抓標題、摘要、發布時間、來源、URL。
- 全文只在使用者要求深入或摘要不足時抓取。
- 先用規則排除明顯無關類型。
- 每輪最多送入候選 20 到 50 則，輸出 3 到 8 則。
- 對已看過事件保存 hash 與摘要。
- 對同一事件保存 `eventId`，更新時只處理新增資訊。
- 使用 utility model 做分類，主聊天模型只做最後角色輸出。
- 對固定來源建立 6 到 24 小時 cache。

---

## 6. 資料結構

```ts
interface NewsModuleSettings {
  enabled: boolean
  proactiveMode: 'off' | 'important-only' | 'daily' | 'weekly'
  locale: string
  regions: string[]
  impactProfile: NewsImpactProfile
  sources: NewsSource[]
  excludedTopics: string[]
  trustedDomains: string[]
  blockedDomains: string[]
  bridgeRatio: 'low' | 'medium' | 'high'
  maxItemsPerDigest: number
  defaultDepth: 'headline' | 'brief' | 'context'
}

interface NewsImpactProfile {
  location?: string
  lifeRoles: string[]
  interests: string[]
  services: string[]
  industries: string[]
  peopleAroundMe: string[]
  sensitivity: {
    politics: 'avoid' | 'major-only' | 'normal'
    crime: 'avoid' | 'major-only' | 'normal'
    disaster: 'avoid-details' | 'major-only' | 'normal'
  }
}

interface NewsSource {
  id: string
  type: 'rss' | 'atom' | 'html-page' | 'google-news-rss'
  name: string
  url: string
  enabled: boolean
  tags: string[]
}
```

新聞事件：

```ts
interface NewsEvent {
  id: string
  title: string
  normalizedTitle: string
  summary: string
  firstSeenAt: number
  lastSeenAt: number
  publishedAt?: number
  sourceItems: NewsSourceItem[]
  topics: string[]
  regions: string[]
  impactLevel: 'none' | 'low' | 'medium' | 'high'
  urgency: 'ignore' | 'later' | 'watch' | 'now'
  confidence: 'single-source' | 'multi-source' | 'developing' | 'confirmed'
  whyUserMightCare: string
  userFeedback?: 'relevant' | 'irrelevant' | 'too-much' | 'follow' | 'block-topic'
}
```

---

## 7. 與排程和聊天的關係

新聞模組可以使用 module scheduler，但不應把新聞設定塞進 reminder 本體。

- 新聞模組決定何時產出 digest。
- digest 交給角色系統生成角色訊息。
- 每日或每週模式才註冊排程。
- important-only 模式由新聞模組判斷是否觸發。

角色訊息建議結構：

- 開場：角色自然提起。
- 事件：一句話講發生什麼。
- 關聯：為什麼可能跟使用者有關。
- 狀態：已確認、發展中、單一來源。
- 選項：深入、換角度、略過、以後少講。

---

## 8. 風險與限制

- 必須引用來源。
- 必須保留不確定性。
- 必須避免過度個人化造成同溫層。
- 必須避免煽動式摘要。
- 政治、醫療、金融、災害等議題應更保守。
- 使用者要求「最新」時必須即時抓取，不可用模型記憶代替。

---

## 9. MVP

第一版建議：

1. 新增新聞模組設定頁。
2. 支援 RSS / Atom 與自訂來源 URL。
3. 建立 `NewsImpactProfile`。
4. 每次手動整理最多抓 50 則 feed item。
5. 規則先排除封鎖主題。
6. utility model 選出 3 到 5 則候選。
7. 角色模型用角色卡語氣輸出 digest。
8. 每則提供快速回饋：有關、沒興趣、太吵、追蹤、封鎖來源。
