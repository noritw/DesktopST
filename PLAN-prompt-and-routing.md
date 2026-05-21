# 系統指令重構 & 模型分流規劃

> 目的：把 `buildSystemPrompt` 的混雜結構整理成清晰分層；同時規劃模型分流設定，讓使用者可以用便宜模型處理輔助任務、把預算留給核心扮演。

---

## Part A — 系統指令重構

### A.1 現況問題

目前 `src/main/llm/promptUtils.ts:buildSystemPrompt` 產生的 prompt，段落順序如下：

```
1. Identity 宣告（"You are X" + "不要說 AI" 行為規則混在同一段）
2. [Character DNA]   ← personality + scenario + example dialogue
3. [Output Format]   ← emotion tag + 對話格式 + 語言要求
4. [World Context]
5. [User Profile]
6. [Interaction Hints]
7. extraSystemContext（便利貼 / 提醒附加 context）
8. [Group Conversation]   ← 群組行為規則
9. [Desktop Characters]   ← 列出桌面角色
10. [System Time]
```

**三類資訊互相混雜**：
- **角色資料**（角色卡內容）：1、2 一部分
- **世界與當下情境**：4、5、6、7、9、10
- **行為規則**（給模型的元指令）：1 一部分、8
- **輸出格式契約**（純技術要求）：3

問題：
- `[Output Format]` 是技術規格卻塞在角色卡和世界觀中間
- 群組行為規則距離 `[Output Format]` 太遠（位置 8 vs 3）
- `Identity` 把「身分宣告」和「不要說 AI」這種行為禁令揉在同一段
- `Scenario` 屬於「當下情境」但被歸在 `[Character DNA]`

### A.2 提議的四層結構

把 prompt 重組成語意明確的四個區塊：

```
═══════════════════════════════════════════════════
[1] 角色身分 (WHO)
═══════════════════════════════════════════════════
You are "{char.name}".

{systemPromptOverride}            ← 純角色卡內容
{personality}
{example_dialogue}                ← 風格示範

═══════════════════════════════════════════════════
[2] 世界與情境 (CONTEXT)
═══════════════════════════════════════════════════
[World]
{world.worldSetting}

[Scene]
{char.scenario}                   ← 從 Character DNA 移過來

[User]
name: {persona.displayName}
preferred_name: {persona.nickname}
notes: {persona.description}

[Interaction Hints]
{world.interactionExample}

Group Members: {char.name} (you), {other1}, {other2}   ← 只在 ≥2 角色時出現（一行解決）

[Current Time]
{systemTime}                      ← 只在 injectSystemTime 時出現

[Additional Context]
{extraSystemContext}              ← 便利貼 / 提醒附加內容

═══════════════════════════════════════════════════
[3] 扮演規則 (BEHAVIOR)
═══════════════════════════════════════════════════
- Stay in character at all times.
- Character consistency takes priority over generic helpful tone.
- Do not mention AI / model / system prompt.
- Never offer to help or adopt a service tone.
- If the user mentions a personal milestone, acknowledge it in character.

[Group Conversation Rules]        ← 只在群組時出現
- Read the full conversation and respond naturally.
- Don't always direct replies at the user.
- Don't repeat what other characters just said.

═══════════════════════════════════════════════════
[4] 輸出格式 (OUTPUT CONTRACT)
═══════════════════════════════════════════════════
※ 角色有設定自訂表情圖片時才出現 emotion 區塊：
- First line MUST be "[{emotion_id}]" where emotion_id is one of: ...
  Emotion guide:
    - happy: use for joy, excitement
    - ...

※ 一律出現：
- Spoken dialogue only. No narration, stage directions, or inner monologue.
- No environmental descriptions. No name prefix.
- Do not wrap reply in outer quotation marks.
- Multiple sentences: one per line.
- Keep replies short: 1–3 sentences max.
- Write entirely in Traditional Chinese (Taiwan).
```

### A.2.5 對話歷史的位置（補充）

**對話歷史不在 system prompt 裡**，而是以另一條軌道送進 LLM API：

```
   ┌─────────────────────────────────────────────┐
   │ system role (一次性，每則訊息都帶)            │
   │   ├─ [1] WHO 角色身分                       │
   │   ├─ [2] CONTEXT 世界與情境                 │
   │   ├─ [3] BEHAVIOR 扮演規則                  │
   │   └─ [4] OUTPUT 輸出格式                    │
   └─────────────────────────────────────────────┘
   ┌─────────────────────────────────────────────┐
   │ messages 陣列（對話歷史，user/assistant 交替）│
   │   ├─ user: "早安"                            │
   │   ├─ assistant: "[joy]早安啊！"              │
   │   ├─ user: "今天天氣很好"                    │
   │   └─ ...（最多 keepRecentN 條，預設 20）     │
   ├─────────────────────────────────────────────┤
   │ 當下訊息 / trigger line                      │
   │   └─ user: "我來找你玩"                      │
   └─────────────────────────────────────────────┘
```

- `keepRecentN`（預設 20）控制歷史條數
- Reminder / force-speak 模式：尾端額外加 `"Write the next in-character reply..."` trigger line（見 `buildTriggerMessage`）
- 重構 system prompt **完全不影響歷史傳遞邏輯**，messages 陣列原樣保留

**未來摘要實作後，摘要會塞在哪？** 建議放在 `[2] CONTEXT` 的 `[Additional Context]` 子區塊（當作背景知識給模型），不是塞進 messages 陣列。

### A.2.6 條件性區塊 / Token 節省策略

許多區塊**只在需要時注入**，避免空跑 token。重構後要嚴格遵守這個原則：

| 區塊 | 出現條件 | 不出現時行為 |
|---|---|---|
| `[1] WHO` 全部 | 一律出現 | — |
| `[2]` 內 `[World]` | `world.worldSetting` 非空 | 整段省略 |
| `[2]` 內 `[Scene]` | `char.scenario` 非空 | 整段省略 |
| `[2]` 內 `[User]` | persona 有 displayName / nickname / description | 整段省略 |
| `[2]` 內 `[Interaction Hints]` | `world.interactionExample` 非空 | 整段省略 |
| `[2]` 內 `Group Members:` 一行 | 桌面 ≥ 2 角色 | 整行省略 |
| `[2]` 內 `[Current Time]` | `injectSystemTime` 為 true | 整段省略 |
| `[2]` 內 `[Additional Context]` | 有便利貼 / 提醒附加 context | 整段省略 |
| `[3] BEHAVIOR` 群組規則 | 桌面 ≥ 2 角色 | 整段省略 |
| **`[4] OUTPUT` emotion 規則** | **角色有自訂表情圖片** | **整段省略，主回覆也不輸出 `[xxx]` tag** |

**重點**：「角色沒有自訂表情圖片」是常見情境（新使用者剛建角色、簡單角色卡、純對話需求）。這時：
- 主 prompt 完全不提表情
- 主模型輸出純對話
- 顯示時用預設 sprite（沒得切）
- B.6 表情拆分情境下，**也跳過表情分類 LLM 呼叫**（見 B.6 補充）

這是目前 `buildEmotionContract` 已實作的行為（`pathToEmotions.size === 0` → `descriptions: []` → `emotionLine = null`），重構時不能搞丟。

### A.3 設計原則

| 區塊 | 內容 | 來源 |
|---|---|---|
| **WHO** | 角色是誰 | 角色卡（personality / override / example） |
| **CONTEXT** | 世界、場景、使用者、當下狀態 | World preset / Persona preset / scenario / 注入 |
| **BEHAVIOR** | 怎麼扮演（給模型的指令） | 寫死的規則 + 群組規則 |
| **OUTPUT** | 怎麼回（純技術契約） | emotion tag、語言、句數 |

**為什麼這樣分**：
1. WHO 在最前面，角色定義最先進入模型的「人設」
2. CONTEXT 緊接著 WHO，模型有了人設後再吸收情境
3. BEHAVIOR 在第三，告訴模型怎麼演（前提是已經理解角色與情境）
4. OUTPUT 放最後，是最低層的技術契約，靠近輸出位置可以提升遵守率

### A.4 程式碼影響範圍

只動 `src/main/llm/promptUtils.ts` 的 `buildSystemPrompt`，其他檔案完全不需動：
- 函式簽名不變
- 回傳型別不變（仍是 `string`）
- 呼叫端（`ipcHandlers.ts` 多處）零修改

---

## Part B — 模型分流規劃

### B.1 現有 LLM 呼叫盤點

`src/main/ipcHandlers.ts` 內目前所有 `chatWithLLM` 呼叫：

| 位置 | 用途 | 使用者可見度 |
|---|---|---|
| ~line 707 | 特定 force-speak 入口（無歷史訊息） | 高（直接看到角色發言） |
| ~line 1667 | **主角色回覆**（玩家發訊息 → 主角色回應） | **最高（核心體驗）** |
| ~line 1757 | 群組對話次要角色回覆 | 中高 |
| ~line 1861 | 提醒觸發 force-speak | 高 |

**好消息**：情緒偵測（emotion）目前是**寄生在主回覆裡**（透過 `[emotion_id]` tag + `parseEmotion`），不是獨立 LLM 呼叫，不需要分流。

**潛在未來呼叫**（規格書暗示但目前未實作）：
- 對話自動摘要（`autoSummarizeAfter` 已有設定欄位但尚未實作呼叫）
- 對話標題自動生成
- 群組對話發言順序決策

### B.2 三個分流選項

#### 選項 A：嚴格分流（user-visible 全部走貴模型）

| 任務 | 模型 |
|---|---|
| 主角色回覆 | 扮演模型（貴） |
| 群組次要角色 | 扮演模型（貴） |
| Force-speak | 扮演模型（貴） |
| 摘要 / 標題 / 內部任務 | 輔助模型（便宜） |

**優點**：所有「角色發出的話」品質一致
**缺點**：群組對話成本爆炸（4 角色 = 4× 貴模型）

#### 選項 B：成本優先（只有玩家直接互動走貴模型）⭐ 推薦

| 任務 | 模型 |
|---|---|
| 主角色回覆 | 扮演模型（貴） |
| 群組次要角色 | 輔助模型（便宜） |
| Force-speak | 輔助模型（便宜） |
| 摘要 / 標題 / 內部 | 輔助模型（便宜） |

**優點**：成本最低，玩家最在乎的「我講話 → 角色回」維持高品質
**缺點**：次要角色 / 提醒發言品質下降（但本來就是配角戲份）

#### 選項 C：三層分流（給進階使用者）

| 任務 | 模型 |
|---|---|
| 主角色回覆 | 主扮演模型 |
| 群組次要、Force-speak | 次扮演模型 |
| 摘要 / 標題 / 內部 | 輔助模型 |

**優點**：最大彈性
**缺點**：UI 複雜、3 組 model 設定對非技術使用者壓力大

**推薦選項 B**，理由：兩層分流 UI 不複雜，又抓到 80% 的成本節省。三層留作未來「進階模式」再開放。

### B.3 設定資料結構變更

在 `AppSettings.llm` 加入輔助模型欄位：

```ts
llm: {
  provider: 'openai' | 'claude' | 'gemini' | 'grok'
  apiKeys: Record<string, string>
  models?: Record<string, string>

  // 新增 ↓
  /** 輔助任務使用的 provider；未設定時與主 provider 相同 */
  utilityProvider?: 'openai' | 'claude' | 'gemini' | 'grok'
  /** 輔助任務使用的模型；未設定時與主 model 相同（即不分流）*/
  utilityModels?: Record<string, string>
  /** 是否啟用模型分流（false 時所有任務都走主模型）*/
  utilityEnabled?: boolean

  endpoint?: string
  maxResponseTokens: number
  // ...
}
```

**Migration**：舊 settings 沒有這些欄位 → 預設 `utilityEnabled: false`，行為與現在完全一致。

### B.4 設定 UI 變更

設計原則：**預設「沿用」一組設定**，使用者明確取消勾選才出現第二組。降低新使用者壓力，進階使用者一目了然。

```
┌─ LLM 設定 ──────────────────────────────────────┐
│                                                  │
│  扮演模型                                        │
│  ─────────                                       │
│  玩家直接對話的角色用此模型，最影響扮演品質。    │
│  推薦使用各家最高品質的模型。                    │
│                                                  │
│  Provider: [OpenAI       ▼]                      │
│  Model:    [gpt-5-2026-xx-xx               ]    │
│  API Key:  [••••••••••••••              ]      │
│                                                  │
│  ────────────────────────────────────────        │
│                                                  │
│  ☑ 輔助任務沿用扮演模型（預設）                  │
│                                                  │
│  輔助任務包含：群組對話中的次要角色、提醒        │
│  自動發話、表情判斷、對話摘要等。建議拆出來      │
│  使用便宜模型，能大幅降低成本。                  │
│                                                  │
│  ↓ 取消勾選後出現以下設定 ↓                       │
│                                                  │
│  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄                  │
│                                                  │
│  輔助模型                                        │
│  ─────────                                       │
│  Provider: [OpenAI       ▼]                      │
│  Model:    [gpt-5-nano-2026-xx-xx          ]   │
│  API Key:  [••••••••••••••              ]      │
│  （與扮演模型同 provider 時自動沿用 API Key）    │
│                                                  │
└──────────────────────────────────────────────────┘
```

**UI 文案要點**：
- 「扮演模型」副標清楚說明「玩家直接對話 = 最影響品質」
- 「輔助模型」副標逐項列出哪些任務會走這條
- 「沿用」checkbox 預設打勾 → 舊使用者升級後完全無感
- 取消打勾時用 expand 動畫展開第二組，避免畫面跳動

### B.5 程式碼影響範圍

| 檔案 | 修改 |
|---|---|
| `src/main/types.ts` | 加 `utilityProvider` / `utilityModels` / `utilityEnabled` 三個欄位 |
| `src/main/llm/promptUtils.ts` | 加 `resolveUtilityModel(settings)` helper |
| `src/main/llm/index.ts` | `chatWithLLM` 加 `useUtility?: boolean` 參數（或新增 `chatWithUtilityLLM`）|
| `src/main/ipcHandlers.ts` | 3 處非主回覆的 `chatWithLLM` 加 `useUtility: true` |
| `src/renderer/src/windows/SettingsWindow.tsx` | LLM 分頁 UI |

新增 helper（建議放在 `promptUtils.ts`）：

```ts
export function resolveUtilityProvider(settings: AppSettings): string {
  if (!settings.llm.utilityEnabled) return settings.llm.provider
  return settings.llm.utilityProvider || settings.llm.provider
}

export function resolveUtilityModel(settings: AppSettings): string {
  if (!settings.llm.utilityEnabled) return resolveModel(settings)
  const provider = resolveUtilityProvider(settings)
  return settings.llm.utilityModels?.[provider] || resolveModel(settings)
}
```

`chatWithLLM` 內部根據 `useUtility` 切換要讀的 provider / model / apiKey。

### B.6 表情判斷拆出去（重要設計決策）

這是你提出的點，值得獨立一個小節討論。

**目前流程**（emotion 寄生在主回覆裡）：

```
User → [主模型 + 完整 prompt（含 emotion contract）]
     → "[joy]\n你好啊，今天天氣真好。"
     → parseEmotion() 拆出 "joy" 和對話
     → 顯示
```

主 prompt 因此塞了一整塊：
- 28 個 emotion ID 清單（或自訂 sprite ID 表）
- emotion tag 格式範例（`[joy]`、`[emotion: 微笑]`...）
- 「First line MUST be a bracket tag...」規則

這些**都是給模型的「報表填寫指示」**，跟扮演本身一點關係都沒有，但混在主 prompt 裡讓整體很雜。

**拆分後流程**（推薦）：

```
User → [主模型 + 乾淨 prompt（無 emotion 區塊）]
     → "你好啊，今天天氣真好。"   ← 對話品質專注
        ↓
     → [輔助模型 + 表情分類 prompt]
     → "joy"   ← 純分類任務
     → 顯示
```

**得到的好處**：
- ✅ 主 system prompt 移除整個 OUTPUT 區塊裡的 emotion 部分，剩下純對話格式規則
- ✅ 表情分類是輕量任務 → 適合便宜快速模型，幾乎不增加成本
- ✅ 主模型專心輸出對話，不用同時想表情，輸出更穩定
- ✅ 自訂 sprite ID 由分類器 prompt 動態組合，跟主 prompt 解耦

**重要前提**：呼應 A.2.6，**角色沒有自訂表情圖片時，表情分類 LLM 呼叫完全不發生**。流程：

```
角色設定表情？
  ├─ 否 → 主回覆顯示完即可，預設 sprite 不變    （0 次表情呼叫）
  └─ 是 → 觸發表情分類器                          （1 次便宜呼叫）
```

這個 short-circuit 在 ipcHandler 層判斷（`char.emotions` 是否有任何非空項），不會進到輔助模型那一輪。

**付出的代價**：
- ⚠ 每則訊息多一次 LLM 呼叫（網路往返 100–300ms）
- ⚠ 多一個失敗點（需要 fallback：分類失敗 → 預設 neutral）
- ⚠ 顯示策略要決定（見下方）

**顯示策略二選一**：

| 策略 | 行為 | 優點 | 缺點 |
|---|---|---|---|
| **同步** | 等表情分類回來，再一次顯示對話 + 表情 | 體驗一致 | 整體延遲 +100–300ms |
| **非同步** | 對話先用 neutral 顯示，表情回來後切換 sprite | 看起來更快 | 表情會「跳一下」 |

實作上同步較簡單，建議 v1 先做同步，未來再優化成非同步。

**分類器 prompt 範本**（短、便宜、好控制）：

```
You classify the emotion of a character's dialogue line.

Available emotion IDs (pick exactly one):
  - joy: 開心、興奮
  - sad: 難過、失落
  - ... (依角色 sprite 動態填入，沒自訂時用預設 28 種)

Character: {char.name}
Personality (for context): {char.personality 摘錄 200 字內}

Dialogue:
  {character_reply}

Output only the emotion ID. No explanation, no punctuation.
```

**與輔助模型 toggle 的關係**：

兩種設計可選：

- **方案 X**（綁定）：「輔助任務沿用扮演模型」打勾 → 不拆，emotion 寄生主回覆（現況）；取消打勾啟用輔助模型 → 自動拆出。UI 一個 checkbox 控制全部。
- **方案 Y**（獨立）：另加 `splitEmotionCall` 開關，可以「啟用輔助模型但仍不拆表情」（極低延遲控）或「不啟用輔助模型但拆表情走主模型」（不省錢但 prompt 乾淨）。UI 多一個 checkbox。

**建議方案 X**，理由是 UI 簡潔，且兩個開關本來就高度相關（拆表情的意義就是讓便宜模型分擔）。

---

## Part C — 實作建議順序

兩件事**互相獨立**，可以分開做也可以合併。建議順序：

### 第一步：Prompt 重構（風險低、效果立竿見影）
1. 改 `buildSystemPrompt` 為四層結構
2. 把現有對話跑一遍對照新舊 prompt（debug 視窗看得到）
3. 測試 emotion tag 偵測成功率不變
4. 測試群組對話行為不變

### 第二步：模型分流（資料結構變動較大）
1. 加 `AppSettings.llm` 新欄位 + migration
2. 改 `chatWithLLM` 支援 utility mode
3. 改 3 處非主回覆呼叫
4. 加 SettingsWindow UI
5. 測試 disabled / enabled 兩種狀態行為都正確

---

## Part D — 風險評估

### Prompt 重構風險
- ⚠ **emotion tag 偵測率可能變動**：tag 規則從第 3 段移到第 4 段（最後），理論上會更穩定，但需實測
- ⚠ **既有角色卡 prompt 行為改變**：例如某些角色卡靠特定段落順序產生效果。建議重構後拿 2-3 個常用角色實測對話 10+ 回合
- ✅ 系統 prompt 改變不影響存檔資料、IPC、UI

### 模型分流風險
- ⚠ **使用者誤用**：把扮演模型設成 nano-tier 反而體驗變差。需要在 UI 文案明確說明「貴的放這、便宜的放那」
- ⚠ **跨 provider 分流**：如果輔助模型用不同 provider，要確保該 provider 的 API Key 已填。需要 UI 警告
- ⚠ **token 計費差異**：不同 provider 的 token 計算方式不同，分流後總費用可能不如預期。文件需提醒這點
- ✅ Migration 安全：`utilityEnabled` 預設 false，舊使用者無感

---

## Part E — 原始指令檢視（Debug 視圖）

### E.1 現況

`chatWithLLM` 目前回傳 `debugPrompt: string`，LogWindow 的訊息可展開查看送出的 prompt。但**只有一個欄位**，分流後沒辦法看到輔助模型那邊發生什麼事。你提到要能參考調整每個模型的指令，所以這部分需要強化。

### E.2 提議資料結構

每次互動可能觸發 1–N 次 LLM 呼叫，每次都記錄成獨立區塊：

```ts
ChatLLMResult {
  content: string
  emotion: string
  // 改成陣列，照觸發順序排列
  debugPrompts: Array<{
    tier: 'roleplay' | 'utility'
    purpose:
      | 'main'              // 主角色回覆
      | 'group_secondary'   // 群組次要角色
      | 'force_speak'       // 提醒 / 主動發話
      | 'emotion'           // 表情判斷（拆分時才有）
      | 'summary'           // 對話摘要（未來）
    model: string           // 實際使用的模型
    systemPrompt: string    // 完整 system prompt
    messages: Array<{ role: string; content: string }>
    response: string        // LLM 回傳
    elapsedMs: number       // 耗時，方便評估延遲
  }>
}
```

### E.3 LogWindow 顯示

訊息「展開 debug」改成標籤頁或折疊清單：

```
┌─ 訊息：「你好啊，今天天氣真好。」 ──────────┐
│                                                │
│  ▼ [扮演] main → gpt-5-2026-xx-xx (820ms)    │
│     System Prompt:                             │
│       [完整四層 prompt 全文]                   │
│     Messages:                                  │
│       user: "早安"                             │
│       assistant: "早安！"                      │
│       user: "今天天氣很好"                     │
│     Response:                                  │
│       "你好啊，今天天氣真好。"                 │
│                                                │
│  ▼ [輔助] emotion → gpt-5-nano-xx (180ms)     │
│     System Prompt:                             │
│       [emotion classifier prompt]              │
│     Input:                                     │
│       "你好啊，今天天氣真好。"                 │
│     Response:                                  │
│       "joy"                                    │
│                                                │
└────────────────────────────────────────────────┘
```

群組對話一則訊息可能展開出主 + 多個次要角色 + 多個表情分類，全部分開呈現方便對照調整。

### E.4 未來延伸（不在 v1）

如果你之後想自己改 prompt 模板，可以加：
- 表情分類器 prompt 可編輯
- 摘要器 prompt 可編輯
- BEHAVIOR 規則可編輯（進階使用者）

v1 先把預設模板做穩，模板可編輯可以等實際用過再決定怎麼做。

---

## 待你決定的事項

### 1. Prompt 結構
- **A.2 的四層順序** WHO → CONTEXT → BEHAVIOR → OUTPUT，OK 嗎？還是想換順序？
- **B.6 表情拆分**：要做嗎？做的話採方案 X（綁定輔助模型）還是方案 Y（獨立 toggle）？
- **顯示策略**：表情拆分後採同步還是非同步？

### 2. 模型分流
- **B.2 採哪個方案**：A（嚴格）/ B（成本優先）/ C（三層）？推薦 B。
- **UI**：「沿用扮演模型」checkbox 預設打勾，這個方向 OK 嗎？

### 3. Debug
- **Part E 分流 debug 視圖**：v1 就做完整版（多區塊展開），還是先把舊欄位塞多段文字應付？

### 4. 實作節奏
- Prompt 重構 vs. 模型分流 vs. 表情拆分，要分 3 個 PR 還是一次到位？
- 推薦：先 Prompt 重構（風險低），確定 OK 後再做分流 + 表情拆分（綁在一起做最划算，因為 emotion 拆分需要輔助模型路徑已存在）。
