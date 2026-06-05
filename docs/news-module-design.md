# 新聞陪聊模組設計（統一定案版）

> 本文件是新聞模組的**唯一詳細設計來源**。
> 已整合：原 Codex 版（module host + 影響半徑）、規格書 §15、`docs/news-feed-spec.md`、`docs/news-module-impl-kickoff.md`。
> 共用 module host 規格見 `docs/module-system-roadmap.md`；JSON 來源契約見 `docs/news-feed-spec.md`。
>
> **定案日期：2026-06-03。** 以本文件與規格 §15 為準；舊版「每日簡報 / 影響半徑問卷」設計已廢棄（見 §10）。

---

## 1. 功能定位

> 讓角色用自己的語氣，像朋友一樣偶爾跟你聊聊外面發生的事。

- **不是**新聞 App、不是 RSS 摘要器、**不是每日簡報**。角色不是部下，不需要定時跟使用者報告。
- 要認真讀新聞，使用者自己會去新聞站；本模組要的是「朋友隨口聊」的陪伴感。
- **可選模組**：不是每個人都想要新聞功能，整個模組可停用，停用時對其他功能零影響。
- **不做使用者畫像**：只收集使用者**手動設定的興趣關鍵字**，不問也不存身份 / 年齡 / 職業 / 產業 / 生活角色等人口屬性。這是刻意的隱私設計（社群演算法已在做這種側寫，本模組不跟進）。

---

## 2. 判斷層 / 表達層分工（沿用 Codex 觀念）

- **判斷層（新聞模組）**：抓取來源、去重、依使用者設定篩選、加權隨機挑一則、附上輕量約束。
- **表達層（角色系統）**：用目前說話角色的角色卡（`description` / `personality` / `exampleDialogue` / `scenario` / `systemPromptOverride`）輸出。
- 新聞模組只提供素材 + 約束，**不硬寫角色語氣**：
  - 用角色平常的語氣，當朋友聊天、不照念。
  - 不誇大新聞影響。
  - **不把來源內容說成角色親眼見聞**。
  - 不確定的消息**保留不確定性**（例如「好像有看到…還沒確定啦」）。
  - 低重要性事件用低壓力語氣提起。

---

## 3. 架構：掛在共用 Module Host 下

新聞是 **module host 下的中風險可選模組**（會連外抓資料、影響使用者接收到的資訊）。

- 程式位置：`src/main/modules/news/`、前端 `src/renderer/src/modules/news/`。
- 設定位置：`%APPDATA%\DesktopST\modules\desktopst.news\settings.json`（短期過渡可暫放 `settings.modules['desktopst.news']`）。
- 透過 `ModuleContext` 註冊，宣告 capability：
  - `network.fetch`（抓 RSS / JSON）
  - `scheduler.jobs`（選配的提醒觸發）
  - `llm.utility`（用輔助模型整理新聞）
  - `llm.characterOutput`（透過核心讓角色說話，不繞過聊天流程）
- 角色輸出走核心接口（`ctx.llm.requestCharacterMessage({ intent: 'news.chat', facts, constraints })`），角色卡語氣 / 世界觀 / 上下文仍由核心掌握。

> module host 本身的拆解順序見 `module-system-roadmap.md` §6。新聞模組可在 host 最小可用後接入。

---

## 4. 新聞來源

使用者可自由新增 / 刪除，三種 `type`：

| type | 說明 | 對應 Codex 類型 |
|---|---|---|
| `keyword` | 使用者輸入興趣關鍵字 → 自動組 Google News RSS | google-news-rss |
| `rss` | 使用者貼任意 RSS / Atom 網址 | rss / atom |
| `json` | 自架聚合站的 JSON 契約（見 `news-feed-spec.md`） | （新增；html-page 的結構化版） |

- `keyword` 組成：`https://news.google.com/rss/search?q={關鍵字}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant`
- `json` 範例：`https://news.nori.idv.tw/news.json`（作者站，**屬可選來源、非核心**；一般使用者預設可不啟用，避免把流量綁在作者伺服器）。它已預先聚合 + 摘要 + 打標籤，等於替模組省下抓取/摘要成本。
- **熱門來源**：**Google Trends 台灣每日熱搜 RSS**（公開、免登入），供破圈功能（§7）使用。
- **不做**：X / Threads / 噗浪 / Reddit / PTT（API 鎖死、無公開熱門 feed、或來源脆弱）。

---

## 5. 興趣標籤 UI（極簡，流程越短越好）

新聞模組設定面板主體：

```
🗞️ 想聊哪方面的消息？
┌──────────────────────────────┐
│ 獨立遊戲  AI  貓咪  ＋        │   打字 → Enter/逗號 → 變一顆標籤
└──────────────────────────────┘
🚫 不想看到（黑名單）
┌──────────────────────────────┐
│ 政治  選舉  ＋                │
└──────────────────────────────┘
```

- 每顆興趣標籤 = 一條 `keyword` 來源，背後自動組 RSS，使用者**不需知道** RSS / 來源類型 / 地區。
- **聰明預設不問人**：語言地區讀系統語系（台灣→`zh-TW`/`TW`）、type 一律 keyword、用關鍵字當來源名。
- **不做 onboarding 問卷、不做推薦標籤清單**（清單裡多半是使用者沒興趣的，反而是雜訊）。
- **進階區（預設收合）**：貼 RSS 網址、訂閱 json 來源、整類 / 來源排除勾選、頻率設定。
- **批次匯入**：多行輸入框，一行一個興趣 → 一次建立多條來源（可把 Google News 關注主題名稱貼過來；**無法**直接同步 Google 個人化版面，那綁帳號且無公開 API）。

### 權重（常聊 / 普通 / 偶爾）

- 每顆標籤點一下循環三段：**常聊 / 普通 / 偶爾**（≈ `3 / 2 / 1`），挑新聞時加權隨機。預設全「普通」。**不用百分比數字**。

---

## 6. 篩選層（抓回來後，由先到後）

便宜手段先過濾，**不把全文丟 LLM**（沿用 Codex token 控制觀念）：

1. **來源排除**：(a) 已知 `source` 勾選清單排除；(b) 黑名單比對範圍含 `source`，讓「中天」「中國」這類即使透過 Google News 混入也能擋。
2. **黑名單關鍵字**：比對 `title` + `summary` + `tags` + `category` + `source` 的**子字串（不分大小寫）**，**黑名單優先**，命中即丟。
3. **整類排除**：`category` 列成可勾選清單。
4. **語言處理（三選一開關）**：
   - **只要繁中**（硬過濾）：非繁中直接丟。
   - **外語也收、角色翻成繁中再講（推薦預設）**：保留外語 / 簡中，注入時加註「請用繁體中文（台灣用語）轉述重點，別貼原文」。利用角色本來就強制繁中、不照念的特性，翻譯由**輔助 LLM** 順手完成。
   - 原文照收。
   - 語言用輕量字元判斷（假名 / 簡繁差異字），不引入完整語言偵測庫。
5. **正向比對**興趣關鍵字 / 分類 → 留符合的。
6. **加權隨機抽「一則」** → 交角色表達。用 `seenIds`（靠穩定 id / hash）去重，不重複聊同一則。

> **無影響半徑評分、無多則 digest。** 每次就抽一則，輕量、低成本。

---

## 7. 破圈話題（可選，防同溫層）

純興趣 + 黑名單會讓接收面越來越窄（Codex §8 列為風險）。破圈功能用來偶爾跳出同溫層。

- **可選**：獨立開關「💡 偶爾也丟我沒設過的熱門話題」，**預設關**。
- **可設頻率**：跟興趣標籤一樣用**常聊 / 普通 / 偶爾**權重，決定它在加權隨機池裡的比重。
- **來源**：從 **Google Trends 台灣每日熱搜** 抽，不受使用者興趣關鍵字限制（但**仍受黑名單 / 來源排除過濾**，避免丟出使用者明確封鎖的東西）。
- 效果：大多數時候聊你設定的興趣，偶爾角色會「欸我看到一個最近很多人在討論的…」帶一則圈外話題。

---

## 8. 觸發方式

| 路徑 | 優先序 | 行為 |
|---|---|---|
| **按「說點什麼」按鈕** | ⭐ **主力** | 抽一則來聊；沒興趣 → 點掉（記弱負向）→ 再按一次抽下一則 |
| **提醒排程** | 🔶 選配，**預設關** | 沿用 reminderScheduler，定時抽一則。預設關閉，因為提醒可能干擾工作 |

- 「說點什麼」按鈕在 `CharacterWindow` hover menu（`forceSpeak` → `forceSpeakDirect`）。新聞素材與天氣 / Spotify 一樣注入 `ctxParts`（`ipcHandlers.ts` 既有位置）。
- 「說點什麼」抓新聞的設定（三選一）：**關 / 偶爾（隨機混入，推薦）/ 每次**。「偶爾」最貼「想聊就按，有時閒聊有時提則新聞」的手感。
- **新聞不綁提醒**：排程器與手動觸發是兩條獨立路徑，不設任何提醒也能用按鈕隨手抽。

---

## 9. 回饋機制（隱性、不對稱）

社群直覺：**會回應就代表有興趣，不想看就直接按掉。** 正向不用按鈕，只給負向按鈕。

| 訊號 | 來源 | 效果 |
|---|---|---|
| 正向 | 使用者回應了該新聞話題 | 該則的關鍵字 / 分類 / 來源權重微微 **+** |
| 弱負向 | 泡泡沒理它就點掉 / 飄走 | 微微 **−** |
| 強負向 | 「🙅 不想聽這個」按鈕 | 明確 **−** |

- **「不想聽這個」互動**（**不做長按，不直覺**）：點下去彈小選單，含兩個**預設不勾**的核取方塊：
  `☑ 封鎖關鍵字（顯示該則關鍵字）` / `☑ 封鎖來源（顯示該則來源）`。直接確認 = 只略過該則；勾了才加進黑名單。
- 回饋寫入**新聞模組 profile，不污染角色長期記憶**。
- 手設權重為基準，學習只在基準上**微調**，且**可一鍵重置**（避免黑箱）。

---

## 10. 地方新聞（沿用天氣定位，支援多地點）

- 沿用 `WeatherSettings` 既有定位 / 縣市（不重複要權限、不重新定位）；縣市名當查詢字串自動組 Google News RSS。
- 開關「📍 也聊地方新聞」**預設關**（隱私）。
- **多縣市清單**：首開帶入偵測到的縣市（標 `fromDetection`）；可再新增多個（如桃園 + 台北 + 新北同生活圈、偶爾台南），**每個縣市各自有常聊 / 普通 / 偶爾權重**、各自可刪。
- **允許覆寫地點**，不強制綁定位。
- 小工：經緯度轉縣市名，天氣模組（規格 §14.4 V）已有 `geocodeCity` / `detectLocationByIP`，直接借用。

---

## 11. LLM 使用（可選主要 / 輔助，預設主要）

> **更新（2026-06-05，實作後修正）：** 原設計「一律走輔助模型」已調整。實測發現輔助模型常把角色口吻壓平成通用 AI，違反「聊新聞要保留角色個性」原則，故改為**使用者可選**。

- 新聞模組設定 `replyModel`（`NewsReplyModel`，見 `src/main/modules/news/types.ts`）：**主要 / 輔助，預設「主要」**（口吻優先）。舊設定遷移為主要。
  - **主要**：用扮演模型輸出，角色個性最完整（預設、推薦）。
  - **輔助**：用 `AppSettings.llm.utilityModel` 省成本，適合不在意口吻、只要轉述的人；未啟用模型分流（`utilityEnabled: false`）時自動沿用主模型。
- 語言轉述（translate 模式）由所選模型順手完成,不另外呼叫。
- **無額外評分呼叫**：整個流程只有「角色把抽中的那則講出來」這一次 LLM 呼叫；篩選 / 挑選全用規則完成。
- Token 控制：預設只抓標題 / 摘要 / 時間 / 來源 / URL；對固定來源建 6–24h cache；`json` 來源已是結構化資料，再省。

---

## 12. 資料結構（草案）

```ts
type NewsWeight = 'often' | 'normal' | 'rarely';   // 常聊 / 普通 / 偶爾
type LangMode = 'zh-only' | 'translate' | 'raw';   // 只要繁中 / 翻成繁中 / 原文
type SpeakMode = 'off' | 'sometimes' | 'always';   // 「說點什麼」抓新聞：關 / 偶爾 / 每次

interface NewsSource {
  id: string;
  type: 'keyword' | 'rss' | 'json';
  label: string;            // keyword 時 = 關鍵字本身
  url?: string;             // rss / json；keyword 自動組成不存
  weight: NewsWeight;       // 預設 'normal'
  enabled: boolean;
  origin?: 'user' | 'location' | 'builtin';
}

// 模組設定（存模組設定信封 ModuleSettingsEnvelope.data）
interface NewsModuleSettings {
  sources: NewsSource[];
  blacklist: string[];          // 黑名單關鍵字（比對 title/summary/tags/category/source）
  excludedCategories: string[];
  excludedSources: string[];
  langMode: LangMode;           // 預設 'translate'
  speakButton: SpeakMode;       // 「說點什麼」抓新聞，預設 'sometimes'
  reminder: {                   // 選配的提醒觸發
    enabled: boolean;           // 預設 false
    schedule?: ReminderSchedule;
  };
  breakout: {                   // 破圈話題
    enabled: boolean;           // 預設 false
    weight: NewsWeight;         // 在加權池中的比重
  };
  localNews: {
    enabled: boolean;           // 預設 false
    locations: { name: string; weight: NewsWeight; fromDetection?: boolean }[];
  };
  feedback: {                   // 學習到的微調，可一鍵重置
    adjustments: Record<string, number>;  // key = sourceId / 關鍵字 / 分類
  };
  seenIds: string[];            // 已聊過的新聞 id（去重）
}
```

> 不再使用舊 Codex 版的 `NewsImpactProfile` / `NewsEvent`（impactLevel/urgency/confidence/whyUserMightCare）/ `proactiveMode` digest 欄位。

---

## 13. 從舊 Codex 版「保留 / 廢棄」對照

| 保留 ✅ | 廢棄 ❌（本次定案移除） |
|---|---|
| module host 架構、模組可選 / 停用 | 每日 / 每週 digest 簡報 |
| 判斷層 / 表達層分工 | `NewsImpactProfile`（身份 / 產業 / 服務問卷） |
| 抓回先層層便宜過濾、不丟全文 | impactLevel / urgency / confidence / whyUserMightCare 評分 |
| 穩定 id 去重、來源 cache、token 控制 | 影響半徑強模型選候選流程 |
| 「不講成親眼見、保留不確定性」約束 | onboarding 問卷 |
| 回饋寫 profile 不污染角色記憶 | proactiveMode daily / weekly |
| 破圈（防同溫層）概念 → 改成可選 + 可設頻率 | 破圈綁在影響評分內 |

---

## 14. 程式檔案（已實作）

```text
src/main/modules/news/
  index.ts        # 模組定義、接入 module host
  ipc.ts          # news:* IPC handler 註冊
  settings.ts     # NewsModuleSettings 讀寫
  sources.ts      # keyword/rss/json 抓取（rss-parser）
  filter.ts       # 六層篩選 + 加權隨機挑選 + seenIds 去重
  topicState.ts   # 後續聊天主題 / 展開小卡狀態
  trigger.ts      # 說點什麼 / 提醒 觸發接線（builder 指令英文化）
  types.ts        # 含 NewsReplyModel（主要/輔助）

src/renderer/src/modules/news/
  index.ts
  types.ts
  SettingsPanel.tsx   # 興趣標籤 / 黑名單 / 進階 / 地方 / 破圈 / replyModel
  # 「不想聽這個」按鈕加在既有 BubbleWindow.tsx
```

- 套件：`rss-parser`
- 修改：`reminderScheduler.ts`（`news` 觸發類型，選配）、`forceSpeakDirect`（注入新聞素材）、module host registry。

---

## 15. MVP 範圍

1. 接入 module host（最小可用），新聞模組可啟用 / 停用。
2. 興趣標籤 + 黑名單 UI（極簡）。
3. 三種來源（keyword / rss / json）抓取，接 `news.nori.idv.tw/news.json` 為 json 來源驗證。
4. 六層篩選 + 加權隨機抽一則 + seenIds 去重。
5. 「說點什麼」抓新聞（關 / 偶爾 / 每次），輔助模型角色化輸出。
6. 「不想聽這個」按鈕 + 隱性回饋 + 一鍵重置。
7. 地方新聞（多縣市）。
8. 破圈（可選 + 可設頻率，從 Google Trends 台灣熱搜抽）。
9. 提醒觸發（選配，預設關）。

---

## 16. 範圍限制

- 無法同步 Google News 個人化版面（綁帳號、無公開 API）→ 用「批次貼關鍵字」折衷。
- 社群熱門僅 Google Trends 台灣熱搜；X / Threads / 噗浪 / Reddit / PTT 不做。
- 語言偵測用輕量字元判斷，不引入完整語言庫。
- 不蒐集任何人口屬性 / 身份 profile。
