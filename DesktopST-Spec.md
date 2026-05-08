# 桌面 AI 角色扮演寵物 — 製作規格書

> 本文件為獨立規格書，不依賴對話脈絡。任何工程師或 AI 助手讀完此文件後應能直接開始實作。

---

## 0. 專案目標

製作一款 **Windows 桌面寵物程式**，結合 LLM 即時對話與角色扮演，類似 SillyTavern 的功能但介面更簡單直覺。

### 核心特色
- 桌面上可放置多個可拖曳的 AI 角色
- 每個角色有完整角色卡（人格、外觀、情緒圖片）
- 支援多角色群組對話（角色之間可互相對話）
- 對話介面極簡：平常只看到角色與最新一句對話，需要時才叫出輸入框與記錄
- 相容 SillyTavern 角色卡格式（可匯入）

### 設計原則
- **介面比 SillyTavern 簡單**：避免大量設定面板，多用浮動式 UI
- **桌面寵物為主、聊天介面為輔**：與傳統聊天機器人介面區別
- **可擴充**：保留 Lorebook 等進階功能的擴充空間，但第一版不實作

---

## 1. 技術棧

| 項目 | 選用 | 備註 |
|---|---|---|
| 桌面框架 | **Electron** | Node.js + Chromium，跨平台（先做 Windows）|
| 前端框架 | **React + TypeScript** | 元件化、型別安全 |
| 樣式 | **Tailwind CSS** | 快速開發 |
| 狀態管理 | **Zustand** | 輕量級 |
| 資料儲存 | 本地 JSON 檔 | 存 AppData，不用資料庫 |
| Key 加密 | **electron-store + safeStorage** | 用作業系統 keychain |
| 截圖 | Electron `desktopCapturer` + 自製框選層 | 也可呼叫 Windows Snipping Tool |
| 打包 | **electron-builder** | 產出 .exe 安裝檔 |

### 開發指令
```bash
npm install          # 安裝相依套件
npm run dev          # 開發模式（熱重載）
npm run build        # 打包成安裝檔
npm run typecheck    # 型別檢查
npm run lint         # 程式碼檢查
```

### 平台
- **第一版**：Windows 10/11 only
- **後續**：保留跨平台可能性（macOS、Linux）

---

## 2. 系統架構

### 主程序 / 渲染程序分工

```
┌─────────────────────────────────────────────────────┐
│  Main Process（Node.js 主程序，永遠運行）            │
│  - 視窗管理（多視窗開關、定位）                       │
│  - LLM API 呼叫（避開瀏覽器 CORS 限制）              │
│  - 檔案 I/O（角色卡、對話記錄、設定）                 │
│  - 截圖工具                                         │
│  - 群組對話協調器（決定誰說話、輪次控制）             │
│  - API Key 加解密                                   │
└─────────────────────────────────────────────────────┘
              ↕ IPC（Electron 內建訊息系統）
┌─────────────────────────────────────────────────────┐
│  Renderer Processes（多個獨立網頁視窗）              │
│  ├── 角色視窗 × N（每個桌面角色一個，透明背景）       │
│  ├── 輸入視窗（可拖曳的小視窗）                      │
│  ├── 設定視窗（角色卡編輯、全域設定、LLM 設定）       │
│  ├── 角色庫視窗（管理所有角色卡）                    │
│  ├── 對話記錄視窗（Log，文字冒險遊戲式介面）         │
│  └── 截圖框選層（截圖時的全螢幕半透明覆蓋層）         │
└─────────────────────────────────────────────────────┘
```

### 視窗特性
- **角色視窗**：透明背景、無邊框、可置頂、可點擊穿透（除角色本體外）
- **輸入視窗**：無邊框、可拖曳、不置頂
- **其他視窗**：標準視窗，依需求決定置頂

---

## 3. 資料結構

### 3.1 角色卡 `Character`
```typescript
interface Character {
  id: string;                    // UUID
  name: string;                  // 角色名稱
  avatar: string;                // 預設頭像路徑（fallback）
  description: string;           // 簡短簡介（顯示用）
  personality: string;           // 詳細人格設定（送 LLM）
  firstMessage: string;          // 招呼語（新對話時自動發）
  exampleDialogue: string;       // 對話範例（教 LLM 說話風格）

  // 情緒對應圖片（key 為情緒名稱，value 為圖片路徑）
  // 沒設定的情緒 fallback 到 avatar
  emotions: Record<string, string>;

  // SillyTavern 相容欄位
  scenario?: string;             // ST scenario
  systemPromptOverride?: string; // 覆蓋全域 system prompt
  creatorNotes?: string;         // 作者備註

  // 擴充用（第一版不實作）
  lorebook?: null;

  createdAt: number;
  updatedAt: number;
}
```

### 3.2 對話 Session `Conversation`
```typescript
interface Conversation {
  id: string;
  title: string;                 // 對話標題（使用者可改）
  participantIds: string[];      // 參與此對話的角色 ID
  messages: Message[];
  summary: string;               // 自動摘要（context 壓縮用）
  createdAt: number;
  updatedAt: number;
}

interface Message {
  id: string;
  role: 'user' | 'character' | 'system';
  characterId?: string;          // role=character 時必填
  content: string;               // 訊息內容
  emotion?: string;              // 角色當下情緒（影響圖片切換）
  images?: string[];             // 附加圖片路徑（使用者上傳/截圖）
  timestamp: number;
}
```

### 3.3 全域設定 `AppSettings`
```typescript
interface AppSettings {
  // 世界觀
  worldSetting: string;          // 全域世界觀
  interactionExample: string;    // 角色互動範例
  injectSystemTime: boolean;     // 對話中自動帶入當下系統時間

  // LLM 設定
  llm: {
    provider: 'openai' | 'claude' | 'gemini' | 'grok';
    apiKey: string;              // 加密儲存
    model: string;               // e.g. "gpt-4o", "claude-sonnet-4-5"
    endpoint?: string;           // 自訂端點（OpenAI 相容服務用）
    maxResponseTokens: number;   // 預設 360
    maxGroupRounds: number;      // 群組對話最大輪次，預設 3
    maxImagesPerMessage: number; // 預設 4
    temperature: number;         // 預設 0.8
  };

  // 對話記憶
  memory: {
    keepRecentN: number;         // 保留最近 N 則對話，預設 20
    autoSummarizeAfter: number;  // 超過 N 則時觸發自動摘要，預設 50
  };

  // 自動發話（待決定，先預留欄位）
  autoSpeak?: {
    enabled: boolean;
    minIntervalMinutes: number;  // 最小間隔
    maxIntervalMinutes: number;  // 最大間隔
    quietHours?: { start: string; end: string }; // 安靜時段
  };

  // 使用者 Persona
  persona: {
    displayName: string;    // 使用者名字
    nickname: string;       // 角色稱呼使用者的方式（可同 displayName）
    description: string;    // 使用者自我介紹（選填）
  };

  // UI
  ui: {
    desktopCharacters: DesktopCharacterState[]; // 桌面上的角色狀態
    inputWindowPosition: { x: number; y: number };
    theme: 'light' | 'dark' | 'auto';
  };
}

interface DesktopCharacterState {
  characterId: string;
  position: { x: number; y: number };
  size: number;                  // 縮放比例
  muted: boolean;                // 是否禁言（群組用）
  zIndex: number;
}
```

---

## 4. UI 規格

### 4.1 桌面（平常狀態）

桌面上只有角色圖片，**沒有任何控制 UI**。

- 透明背景，只看到角色本體
- 角色頭上方顯示**最新一句對話**（淡入淡出），無對話時隱藏
- 對話框會自動消失（預設 8 秒），新訊息會替換舊的

### 4.2 角色懸停 UI

**滑鼠移到角色身上時**，角色周圍浮現環狀按鈕（icon 按鈕）：

| 按鈕 | 功能 | 顯示條件 |
|---|---|---|
| 💬 強制發話 | 此角色立刻根據當前對話記錄發一句話 | 常顯示 |
| 🔇 禁言 / 🔊 取消禁言 | 群組對話時是否參與（toggle）| 常顯示 |
| ➕ 追加角色 | 開啟角色庫，選一個召喚到桌面 | 常顯示 |
| ❌ 移除 | 從桌面移除（不刪角色卡）| **桌面有 2 個以上角色時才顯示** |
| ⚙️ 角色設定 | 開啟此角色的設定視窗 | 常顯示 |

> **規則**：桌面上至少要保留一個角色。當桌面只剩一個角色時，移除按鈕隱藏，防止使用者誤刪到桌面空無一人。

**互動細節**：
- 滑鼠離開角色後 0.5 秒內，按鈕淡出
- 環狀排列：依角色圖片邊界自動定位
- 點擊按鈕不會觸發角色點擊事件（事件分離）

### 4.3 角色點擊行為

**點擊角色身體**（非按鈕區域）→ 切換輸入視窗顯示。

### 4.4 輸入視窗

```
┌────────────────────────────────────┐
│ [🖼️] [🖼️] [🖼️]              📋 Log │ ← 圖片預覽 + 右上 Log 按鈕
│ ┌──────────────────────────────┐   │
│ │ 在這裡輸入訊息...              │   │
│ └──────────────────────────────┘   │
│ [📸] [🖼️]              [➤ 送出]   │ ← 截圖、上傳、送出
└────────────────────────────────────┘
```

**功能**：
- 整個視窗可拖曳（拖曳區為空白區域，避開按鈕與輸入框）
- **截圖按鈕**：
  - 點擊 → 隱藏整個程式（所有視窗）→ 進入框選模式（半透明覆蓋層）
  - 框選後將截圖加入訊息附件
  - 也提供「全螢幕」按鈕一鍵截全螢幕
  - 注意：第一版只支援 Windows
- **上傳按鈕**：開檔案對話框選擇圖片，可多選
- **圖片預覽**：縮圖顯示在輸入框上方，可點擊 ❌ 移除
- **送出按鈕**：送出訊息（也可按 Ctrl+Enter）
- **Log 按鈕**：toggle 開關對話記錄視窗
- 圖片數量上限：依 LLM 設定的 `maxImagesPerMessage`

### 4.5 對話記錄視窗（Log）

**設計風格參考文字冒險遊戲**，全螢幕或大型視窗：

```
┌──────────────────────────────────────────┐
│ 對話記錄：和小明的第一次對話          ✕ │
├──────────────────────────────────────────┤
│ [小明]：你好！很高興認識你！               │
│                                          │
│ [我]：你今天過得如何？                    │
│  └ 附圖：[縮圖]                          │
│                                          │
│ [小明]：今天天氣很好，我去公園散步了。     │
│                                          │
│ ...（可向上捲動看歷史）                   │
└──────────────────────────────────────────┘
```

- 點 Log 按鈕開啟，再點關閉（toggle）
- 可向上捲動看完整歷史
- 顯示訊息時間戳記（hover 顯示完整時間）
- 可點擊角色名稱跳到角色設定
- 可點擊單則訊息進行：刪除、重新生成、編輯

### 4.6 角色設定視窗

分頁式介面：

#### 分頁 1：基本資訊
- 名字（input）
- 頭像（圖片上傳）
- 簡介（textarea，短）
- 個性（textarea，長）
- 招呼語（textarea）
- 對話範例（textarea）

#### 分頁 2：情緒圖片
**設計**：固定 27 種預設情緒（參考 SillyTavern 的 expression sprites）

預設情緒清單：
```
admiration, amusement, anger, annoyance, approval,
caring, confusion, curiosity, desire, disappointment,
disapproval, disgust, embarrassment, excitement, fear,
gratitude, grief, joy, love, nervousness,
optimism, pride, realization, relief, remorse,
sadness, surprise, neutral
```

每個情緒：上傳圖片或留空（留空 fallback 到頭像）。

> **後續擴充**：開放使用者自訂情緒名稱（會需要動態調整 LLM prompt 以告知可選情緒）

#### 分頁 3：進階
- Scenario（textarea）
- System Prompt 覆蓋（textarea，留空則用全域）
- 作者備註（textarea）

#### 分頁 4：匯入 / 匯出
- 匯出為 JSON
- 匯出為 PNG 角色卡（內嵌 JSON，相容 ST）
- 匯入 ST 角色卡（JSON 或 PNG）

### 4.7 全域設定視窗

分頁式：

#### 分頁 1：世界與行為
- 世界觀（textarea）
- 角色互動範例（textarea）
- ☑ 對話中自動帶入當下系統時間
- 自動發話設定（待決定，預留 UI）

#### 分頁 2：LLM
- 服務商：OpenAI / Claude / Gemini / Grok（下拉）
- 模型名稱（下拉，依服務商提供建議清單）
- API Key（密碼欄位，加密儲存）
- 自訂端點（選填，OpenAI 相容服務用）
- 字數上限：預設 360
- 群組對話次數上限：預設 3
- 單訊息圖片上限：預設 4
- Temperature：預設 0.8

#### 分頁 3：記憶
- 保留最近 N 則對話（預設 20）
- 自動摘要閾值（預設 50）
- 「清除所有對話記錄」按鈕（需確認）

#### 分頁 4：使用者 Persona
讓 LLM 知道「使用者是誰」，影響角色如何稱呼和對待使用者。欄位精簡：

- **顯示名稱**：使用者的名字（LLM 在對話中使用）
- **暱稱**：角色稱呼使用者的方式（例如「主人」、「大人」，可留空同顯示名稱）
- **自我介紹**：使用者的描述（textarea，選填）

這些欄位會注入 system prompt：
```
【使用者資料】
名稱：{displayName}（稱呼：{nickname}）
{description}
```

#### 分頁 5：資料
- 顯示資料儲存路徑
- 「開啟資料夾」按鈕 → 用 Windows 檔案總管打開
- 「備份」按鈕（匯出整包資料）
- 「還原」按鈕

### 4.8 角色庫視窗

```
┌────────────────────────────────────────┐
│ 角色庫     [+ 新增] [📥 匯入 ST 角色卡] │
├────────────────────────────────────────┤
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │
│  │ 👤  │ │ 👤  │ │ 👤  │ │ 👤  │      │
│  │小明 │ │小華 │ │小美 │ │小強 │      │
│  └─────┘ └─────┘ └─────┘ └─────┘      │
│   ↑ 拖曳到桌面以召喚                     │
└────────────────────────────────────────┘
```

**互動**：
- 卡片可拖曳到桌面以召喚
- 點選卡片：彈出選單（編輯 / 刪除 / 匯出 / 召喚到桌面）
- 右鍵：快捷選單

### 4.9 對話 Session 管理

存取方式：在 Log 視窗或主選單提供。

```
┌──────────────────────────────┐
│ 對話記錄                ✕    │
├──────────────────────────────┤
│ [+ 新對話]                    │
│ ─ 和小明的第一次對話（活躍）   │
│ ─ 群組：小明、小華             │
│ ─ 深夜聊天                    │
└──────────────────────────────┘
```

- 可新增、切換、重新命名、刪除對話
- 切換對話 = 桌面角色與記憶都會跟著切換
- 對話以 JSON 檔形式儲存，使用者可手動管理

---

## 5. 群組對話邏輯

### 5.1 觸發
1. 使用者送出訊息
2. 系統取得「桌面上未被禁言」的角色清單
3. 依「自然順序」決定發話順序

### 5.2 自然順序判定
參考 SillyTavern 的策略：
- **被點名優先**：訊息中有 @角色名 或直接稱呼，該角色優先
- **依加入順序**：其他情況依角色加入桌面的順序輪流
- 每位角色在其輪次時看到「使用者訊息 + 之前角色已說的話」後再回應

### 5.3 群組輪次控制
- 一次使用者訊息觸發**最多 N 輪**（預設 3）
- 一輪 = 所有未禁言角色各說一次（或選擇不說）
- 角色可在 prompt 中表達「此次不發言」（系統解析後跳過）

### 5.4 強制發話
- 使用者點擊角色「強制發話」按鈕
- 該角色立刻發一句話（基於當前對話歷史）
- 不觸發其他角色連鎖回應

### 5.5 自動發話（待決定）
**目前狀態：保留欄位但不實作**

候選方案：
- 使用者設定每日活躍時段
- 角色之間隨機間隔互動（min/max 分鐘）
- 安靜時段（夜間不發話）
- 鬧鐘模式（指定時間角色提醒使用者）

需要進一步設計後再實作。

---

## 6. 對話記憶策略

### 6.1 流程
```
新訊息加入 conversation.messages
  ↓
檢查 messages 數量
  ↓
若 > (keepRecentN + autoSummarizeAfter)
  ↓
取出「最舊的那批訊息」（超過 keepRecentN 的部分）
  ↓
呼叫 LLM 摘要 → 更新 conversation.summary
  ↓
從 messages 移除已摘要的訊息
```

### 6.2 送給 LLM 的 prompt 結構
```
[System]
{worldSetting}
{characterPersonality}
{scenario}

【使用者資料】（若 persona.displayName 有設定）
名稱：{displayName}（稱呼：{nickname}）
{persona.description}

【先前對話摘要】
{conversation.summary}

【目前時間】（若 injectSystemTime = true）
2026-05-08 03:14（凌晨）

【對話範例】
{exampleDialogue}

[User] / [Assistant] 對話歷史
（最近 keepRecentN 則）
```

### 6.3 系統時間注入格式
若 `injectSystemTime = true`，每次送 LLM 時動態加入當下時間，格式建議：
```
【目前時間】2026-05-08 03:14 星期四（凌晨）
```
時段標籤：凌晨（0-5）、清晨（5-8）、上午（8-12）、中午（12-13）、下午（13-18）、傍晚（18-19）、晚上（19-23）、深夜（23-24）。

### 6.4 使用者手動管理
- 在 Log 視窗可刪除單則訊息
- 可手動編輯 summary
- 可開新對話（清空當前記憶，舊對話保留為獨立 session）

---

## 7. LLM 整合

### 7.1 Adapter 介面
```typescript
interface LLMAdapter {
  name: string;
  chat(params: ChatParams): Promise<ChatResponse>;
  countTokens(text: string): number;
  supportsImages(): boolean;
  maxImagesPerRequest(): number;
}

interface ChatParams {
  systemPrompt: string;
  messages: Message[];
  images?: string[];           // base64 或 URL
  maxTokens: number;
  temperature: number;
}

interface ChatResponse {
  content: string;             // LLM 回傳文字
  emotion?: string;            // 解析出的情緒
  usage: { input: number; output: number };
}
```

### 7.2 各服務 Adapter
| Provider | API | Image Support | 備註 |
|---|---|---|---|
| OpenAI | `/v1/chat/completions` | ✅ | 也支援自訂 endpoint |
| Anthropic Claude | `/v1/messages` | ✅ | 注意 message 格式不同 |
| Google Gemini | `generativelanguage.googleapis.com` | ✅ | |
| xAI Grok | OpenAI 相容 | ✅ | |

### 7.3 情緒標記格式
要求 LLM 在回應**第一行**用方括號標記情緒：

```
[joy] 今天天氣真好！我們去散步吧！
```

解析規則：
1. 取第一行 `[xxx]` 中的內容作為情緒
2. 移除標記後其餘為 `content`
3. 若無標記，emotion = `neutral`
4. 情緒名稱不在預設清單中，fallback `neutral`

System prompt 中包含說明：
```
你的回應必須以 [情緒] 標記開頭，從以下清單選一個：
admiration, amusement, anger, ..., neutral
範例：[joy] 今天天氣真好！
```

### 7.4 字數控制
- 軟性限制：在 system prompt 中告知「請控制每則回應在 360 字內」
- 硬性限制：API 的 `max_tokens` 參數（注意 token 不等於字數，中文約 1 字 = 2 tokens）

---

## 8. SillyTavern 相容性

### 8.1 角色卡匯入
支援格式：
- **JSON**：標準 ST 角色卡 JSON 格式
- **PNG 角色卡**：PNG 檔的 tEXt chunk 中嵌入 base64 編碼 JSON

### 8.2 欄位對應
| ST 欄位 | 本程式欄位 |
|---|---|
| `name` | `name` |
| `description` | `personality` |
| `personality` | `personality`（合併）|
| `first_mes` | `firstMessage` |
| `mes_example` | `exampleDialogue` |
| `scenario` | `scenario` |
| `creator_notes` | `creatorNotes` |
| `system_prompt` | `systemPromptOverride` |
| `character_book` | `lorebook`（保留，不實作）|

### 8.3 不支援項目（第一版）
- Character Book / Lorebook
- World Info
- Author's Note
- Regex scripts
- Quick Replies

---

## 9. 檔案系統

### 9.1 路徑
```
%APPDATA%\DesktopFamiliar\
├── settings.json              # 全域設定（API Key 加密）
├── characters\
│   ├── {char_id}\
│   │   ├── card.json          # 角色卡資料
│   │   ├── avatar.png         # 預設頭像
│   │   └── emotions\
│   │       ├── happy.png
│   │       ├── sad.png
│   │       └── ...
├── conversations\
│   ├── {conv_id}.json         # 各 session 的對話記錄
└── attachments\
    └── {timestamp}_{name}.png # 使用者上傳圖片快取
```

### 9.2 程式內按鈕
全域設定 → 資料分頁 → 「開啟資料夾」按鈕，呼叫 `shell.openPath()` 開啟檔案總管。

---

## 10. 安全性

### 10.1 API Key
- 不可儲存為純文字
- 使用 Electron `safeStorage` API（底層為 Windows DPAPI）加密
- 顯示在設定畫面時遮蔽（顯示 `sk-***...***xxx`）

### 10.2 使用者資料
- 所有資料只存本機
- 不上傳任何資料到外部伺服器（除了使用者設定的 LLM 服務）
- 解除安裝程式不應自動刪除使用者資料

---

## 11. 開發階段

### 階段 1：MVP（2-3 週）
- [ ] Electron + React + TypeScript 專案骨架
- [ ] 透明角色視窗 + 拖曳
- [ ] 點擊角色開輸入視窗
- [ ] OpenAI API 整合（單服務商）
- [ ] 對話框顯示最新訊息
- [ ] Log 視窗顯示歷史
- [ ] 基本角色卡編輯
- [ ] 設定儲存（不含加密，先純文字）

**驗收**：能用 OpenAI API 與單一角色對話，介面可運作。

### 階段 2：多角色與群組（1-2 週）
- [ ] 角色庫管理
- [ ] 桌面同時多角色
- [ ] 群組對話協調器
- [ ] 強制發話 / 禁言
- [ ] 全域世界觀設定

**驗收**：兩個角色能在桌面互相對話。

### 階段 3：完整 LLM 與素材（1-2 週）
- [ ] Claude / Gemini / Grok adapter
- [ ] 27 種情緒圖片切換
- [ ] 截圖（自製框選 + 全螢幕）
- [ ] 多圖上傳
- [ ] SillyTavern 角色卡匯入（JSON + PNG）
- [ ] 系統時間注入

**驗收**：能匯入 ST 角色卡，所有 LLM 都能用，截圖可附加。

### 階段 4：拋光（1 週）
- [ ] 對話記憶摘要
- [ ] 對話 session 管理
- [ ] API Key 加密
- [ ] 開啟資料夾按鈕
- [ ] 應用程式打包成 .exe 安裝檔

**驗收**：可分發給其他使用者安裝使用。

### 階段 5：未來擴充（不在第一版）
- [ ] 自動發話（鬧鐘式）
- [ ] 使用者自訂情緒名稱
- [ ] Lorebook
- [ ] TTS 語音
- [ ] Live2D 動態角色
- [ ] 跨平台（macOS、Linux）

---

## 12. 待決定 / 開放討論

### 12.1 自動發話機制
未確定設計。需要進一步思考：
- 觸發頻率如何控制不擾民？
- 是否做成「鬧鐘式」由使用者排程？
- 要不要根據桌面活動偵測（使用者忙碌時不打擾）？

### 12.2 自訂情緒
第一版採用固定 27 種，但後續可能開放自訂。需要解決：
- 動態 system prompt 告知 LLM 可選情緒
- UI 怎麼讓使用者新增情緒
- 跨角色情緒一致性

### 12.3 跨對話的「世界一致性」
若使用者在多個 conversation 中都用同一個世界觀，是否要有「世界記憶」共享？目前設計是各 conversation 獨立。

### 12.4 對話記錄的 ST 相容性
**第一版不實作，保留擴充空間。**
設計對話記錄格式時避免與 ST 格式產生根本衝突，未來可加入轉換器。
方向：優先做「ST → 本程式」單向匯入，雙向相容視社群需求再決定。

---

## 13. 視覺設計規格

### 13.1 如何傳達視覺設計給實作 AI

**最有效的方法（優先序）**：

1. **提供 PS 截圖**：做一張靜態主視窗截圖，直接丟給 AI 說「照這個做」。比任何文字描述都準確。即使只是粗略的方塊排版也有效。

2. **填寫下方視覺風格表**：至少把顏色、圓角、整體調性填清楚。

3. **參考圖連結**：提供任何你喜歡的 UI 截圖或風格範例（遊戲介面、其他軟體、網站）。

### 13.2 視覺風格填表（請填入）

| 項目 | 決定 |
|---|---|
| 整體調性 | 可愛、扁平化、圓潤、春夏清爽 |
| 底色系 | 明亮（接近白色的極淡粉彩底）|
| 圓角程度 | 盡可能多用圓角，面板 16–24px，按鈕/圖示 50%（圓形）|
| 設計風格 | 扁平化（flat design），無厚重陰影 |
| 字型風格 | 圓體字 |
| 對話框風格 | 圓角氣泡 |
| 按鈕風格 | 圓形扁平 icon |
| 預設角色 | Q 版圖 |

### 13.3 色票

#### 主色盤（優先使用，清爽綠藍系）
| 名稱 | Hex | 用途 |
|---|---|---|
| Mint Green | `#CBFBC4` | 主要強調色、active 狀態 |
| Soft Teal | `#AAEEDD` | 次要強調、hover 狀態 |
| Sky Blue | `#AAEEFF` | 連結、info 狀態 |

#### 輔色盤（點綴用）
| 名稱 | Hex | 用途 |
|---|---|---|
| Butter Yellow | `#FFE8AA` | 警告、highlight |
| Blush Pink | `#FFBBBB` | 錯誤、刪除確認 |
| Lavender | `#F0BBFF` | 特殊狀態、標記 |

#### 中性色
| 名稱 | Hex | 用途 |
|---|---|---|
| Background | `#F7FFFC` | 視窗底色（帶薄荷白感）|
| Surface | `#FFFFFF` | 卡片、輸入框底色 |
| Border | `#D8F5EC` | 邊框、分隔線 |
| Text Primary | `#3D5A52` | 主要文字（深綠灰，非純黑）|
| Text Secondary | `#7BA898` | 次要文字、placeholder |

### 13.4 字型建議

| 用途 | 推薦字型 | 備註 |
|---|---|---|
| 英文 UI | **Nunito** 或 **Comfortaa** | 圓體感強，Google Fonts 免費 |
| 中文 UI | **M PLUS Rounded 1c** 或 **Noto Sans TC** | 前者更圓潤，後者更易讀 |
| 程式 fallback | `system-ui` | 沒載入時的備用 |

### 13.5 陰影與邊框
- **陰影**：只用極淡的 `box-shadow: 0 2px 8px rgba(170,238,221,0.3)`，不用深色陰影
- **邊框**：優先用色票中的 Border 色，寬度 1px
- **毛玻璃**：不使用（保持扁平感）

### 13.6 視覺修改指南

要改視覺時，修改以下幾個地方即可，邏輯程式碼不受影響：

```
src/styles/theme.css      ← 色票 CSS 變數（改這裡最有效）
tailwind.config.ts        ← Tailwind 顏色、圓角、字型設定
src/styles/global.css     ← 全域字型載入
```

給 AI 的改色 prompt 範例：
> 「幫我把 theme.css 的主色系從綠藍改成橘粉系，保持同樣的亮度和飽和度風格」

### 13.7 如何在實作後修改視覺

視覺風格集中在幾個地方，可以隨時要求 AI 修改，**不影響程式邏輯**：

- `tailwind.config.ts`：全域顏色、字型、圓角定義
- `src/styles/theme.css`：CSS 變數（主色、背景色、透明度等）
- 各元件的 `className`：Tailwind class 組合

**改視覺的 prompt 範例**：
> 「幫我把整個 UI 改成暗色系，主色改成 #7C5CBF，對話框加上毛玻璃效果」
> 「幫我把這個截圖的風格套用到程式」（附上截圖）

---

## 14. 給實作者的建議

### 14.1 開發順序建議
1. 先把 Electron 多視窗 + 透明背景跑起來（最容易卡住的部分）
2. 接著做最簡單的 LLM 對話流程（單角色、單服務商）
3. UI 再慢慢迭代

### 14.2 容易踩坑的地方
- **Electron 透明視窗**：需要 `transparent: true` + `frame: false` + `backgroundColor: '#00000000'`
- **角色拖曳**：要設定 CSS `-webkit-app-region: drag` 但拖曳區會擋住點擊事件，需要精細處理
- **多視窗 IPC**：用 `ipcMain.handle` + `ipcRenderer.invoke` 而非 `send/on`，較不易亂
- **API Key 加密**：`safeStorage` 在 Windows 需先確保 `app` 已 ready
- **截圖隱藏視窗**：先 hide 所有視窗 → 等 100ms → 截圖 → 再 show

### 14.3 推薦套件
- `uuid` — 產 ID
- `electron-store` — 設定檔
- `react-rnd` — 拖曳/縮放
- `@anthropic-ai/sdk` / `openai` / `@google/generative-ai` — LLM SDK
- `sharp` — 圖片處理（角色卡 PNG）
- `png-chunks-extract` / `png-chunks-encode` — ST 角色卡 PNG 讀寫

---

## 附錄 A：部署與執行說明

### 本機執行（無需 Server）
本程式為 **Electron 桌面應用**，完全在本機執行，不需要架設任何伺服器。
打包後的 `.exe` 安裝檔點兩下即可使用，對外網路連線只有呼叫 LLM API 的部分。

SillyTavern 需要 Server 的原因是它是網頁應用；本程式將 Node.js 環境打包進執行檔，因此行為與一般 Windows 桌面程式相同。

---

## 附錄 B：開源策略

### 授權（License）
採用 **MIT License**：
- 任何人可以自由使用、修改、分發（包含商業用途）
- 衍生作品**必須保留原作者版權聲明**
- 作者不需對使用後果負責

### GitHub Fork 模型
```
原始 repo（作者維護）
└── 任何人可以 Fork → 產生獨立的個人複製
    ├── Fork 的修改完全不影響原始 repo
    ├── Fork 者可自行發布他的版本
    └── 優秀功能可透過 Pull Request 回饋原始 repo（作者決定是否合併）
```

### 建議的 repo 結構
```
README.md           # 功能介紹、使用說明、截圖
LICENSE             # MIT License
CONTRIBUTING.md     # 貢獻指南（歡迎 PR 的規範）
CHANGELOG.md        # 版本更新記錄
.github/
  ISSUE_TEMPLATE/   # Bug 回報、功能建議範本
```

### 作者保護自身版本的方式
- 不需要特殊機制：原始 repo 只有作者有 push 權限
- 別人的 Fork 是獨立的，無法直接修改原始 repo
- 作者可選擇性接受 Pull Request，完全自主

---

## 附錄 C：使用者操作流程（Onboarding）

### 第一次啟動
1. 顯示歡迎畫面
2. 引導設定 LLM 服務（必填）
3. 提供「下載範例角色卡」按鈕（或內建一個預設角色）
4. 引導使用者把角色拖到桌面

### 平常使用
1. 程式啟動 → 桌面上顯示上次的角色配置
2. 點擊角色 → 輸入訊息 → 角色回應
3. 滑鼠移到角色 → 顯示控制按鈕
4. Log 按鈕看完整歷史
5. 系統匣 icon 提供：開啟設定、結束程式

---

## 附錄 D：詞彙表

| 詞 | 意義 |
|---|---|
| 角色卡 | 一個角色的完整定義（資料）|
| Conversation / Session | 一次對話的記錄（含參與角色與所有訊息）|
| 桌面角色 | 目前正在桌面上顯示的角色實例 |
| 群組對話 | 多個角色 + 使用者的多方對話 |
| 情緒 | 角色當下狀態，影響顯示哪張圖片 |
| Adapter | 統一不同 LLM 服務的轉接層 |
| ST | SillyTavern 的縮寫 |

---

**文件版本**：v1.3
**最後更新**：2026-05-09
