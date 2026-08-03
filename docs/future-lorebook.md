# Lorebook / 用語解說 —— 評估與提案

> 狀態：**規格已定案，尚未實作**（設計決議見 §10，無待決事項）
> **owner 2026-08-03 決議：要做，且含桌面 UI（B2.5 ＋ B2.6），排在 B3 之前。**
> 討論日期：2026-08-03｜最後更新：2026-08-03
> 基準：`main`（B1／B2 已完成並合併，B3 未開工）
>
> ⚠️ **§3.2 稱排在 B3 前「成本 ≈ 0 額外」講得太滿。** 桌面 UI 與手機 UI 本來就是兩份
> （roadmap §4.2），任何功能都要寫兩次 UI。正確說法是「在 B3 那一趟裡順路加，
> 比 B3 結束後專程回頭補便宜」。見 `pre-b3-work-assessment.md` §3.2。
>
> ⚠️ **順序提醒**：B2.7（`fileStore` 抽 core）優先度**高於**本提案 ——
> 它是 B3 的真前提，見 `pre-b3-work-assessment.md` §2。
>
> 相關文件：`docs/multi-device-platform-roadmap.md`（§4.1 drift、§10 順序）、
> `docs/news-future-keyword-groups.md`（關鍵字組的取代式切換心智模型）

---

## 0. 一句話

讓角色知道使用者世界觀裡的**專有名詞**：一組「關鍵字 → 解說」，
聊天時掃描近期訊息，命中才注入 prompt。
資料格式吃 SillyTavern 的 `character_book`，但**引擎只實作子集**。

---

## 1. 起點：owner 的實際需求

> 「有些專有名詞我還是希望角色可以知道」

### 1.1 實際用例（owner 2026-08-03 澄清）

**場景是日常閒聊，不是寫故事。** Owner 自述不是「愛寫一堆世界觀設定」的類型，
所以完整 lorebook 那套動態世界觀機制**確定用不到**。

真正要解的是兩類詞：

1. **同一件事的多種叫法** —— 例：`DeST` / `DesktopST` / `桌友` / `我的桌面小程式`
   全部指同一個專案。直接講角色才知道在講什麼
2. **進行中的其他專案**，以及**對話中會提到的人名**

→ 這決定了幾件事：

- **一條目多 keys 是核心用法**，不是進階功能。`keys` 陣列直接承載「多種叫法」
- **多數條目應設 `constant: true`**（常駐）。十幾條專案名詞常駐成本約兩三百 token，
  換掉「聊到一半角色不知道在講什麼」很划算，也直接繞開 §6.2 的掃描深度限制
- **`secondary_keys`（一詞多義消歧）在此用例幾乎用不到** → 支持 §5.1 的「實作但不給 UI」

範例條目：

```
keys: ["DeST", "DesktopST", "桌友", "我的桌面小程式", "桌寵程式"]
content: DeST（DesktopST）是使用者本人開發的 Windows 桌面 AI 角色程式，
         使用者暱稱它「桌友」。Electron + React，個人專案。
constant: true
```

### 1.2 為什麼人名也得放進來

**程式不會去查角色卡。** 2026-08-03 實查 prompt 組裝所有路徑
（`ipcHandlers.ts:3170`、`promptUtils.ts:487`）：

| 情況 | 角色實際收到 |
|---|---|
| 提到**桌面上**其他角色的名字 | **只有名字**（`Group Members: 甲, 乙`），無任何設定內容 |
| 提到**角色庫裡但不在桌面**的角色 | **完全沒有**，該名字對模型是陌生詞 |
| 提到現實人物 / 其他專案的人 | 無 |

→ **人名要角色知道，必須自己建 lore 條目。**
（「自動從角色卡生成條目」把手建變成按按鈕再微調，見 §8）

### 1.3 定位

這是**用語解說**的需求，不是完整 ST World Info 的需求。
兩者常被混為一談，先切開：

| | 用語解說 | 完整 ST Lorebook |
|---|---|---|
| 目的 | 角色看得懂術語 | 動態世界觀資料庫 |
| 條目數 | 十幾～幾十 | 數百 |
| 需要遞迴觸發 | ❌ | ✅ |
| 需要插入對話特定深度 | ❌ | ✅ |
| 需要 token 預算精算 | ❌（字元近似即可） | ✅ |

**本提案做的是用語解說，但用 ST 的資料格式承載**，
使「日後要補完整 lorebook」不是重做，而是把已經存著的欄位接上 UI。

---

## 2. 現況盤點（2026-08-03 實查）

- **完全沒有任何 lorebook 相關程式碼。**
- ST 角色卡的 `character_book` 在匯入時被**靜默丟棄**——
  `src/core/card/stCardMapper.ts` 只取 `description` / `personality` /
  `scenario` / `mes_example` / `creator_notes`。
- 注入點現成：`src/core/prompt/promptUtils.ts` `buildSystemPrompt()` 的
  `[2] CONTEXT` 區塊（`[World]` / `[Scene]` / `[User]` / `[Author Notes]` 都在這層）。
- 動態注入通道現成：`extraSystemContext`（提醒、便利貼、新聞、天氣、日曆都走這條）。
- 掃描要吃的訊息現成：`ChatLLMParams.messages`。
- 情境覆蓋機制現成：`ScenePreset.moduleOverrides` ＋
  `isModuleEffectivelyEnabled()` / `applySceneModuleOverrides()`（`ipcHandlers.ts` 1482–1514）。

**結論：沒有任何一塊需要新基礎設施。**

---

## 3. 時機評估（為什麼是現在）

### 3.1 B2 已完成，這是關鍵前提

`a87829c` 起 roadmap §10.5 已改指向 **B3（手機 UI，4–8 週）**。
`src/core/adapters/` 五個介面（storage / secrets / http / scheduler / notifier）定完，
`chatWithLLM`、四家 provider、`summarizer`、`pngCard` 全數進 core。

→ Lorebook 是**第一個能全額享受 B1／B2 紅利的新功能**：
掃描邏輯直接寫 `src/core/lore/`，載入存檔走 `StorageAdapter`，
不必再走「先寫在 `main/`、日後再搬」的老路。

### 3.2 真正的死線是 B3，不是 B2

**B3 就是「手機 UI 只寫一份」的那一份。**

| Lorebook 排在 | 後果 |
|---|---|
| B3 **之前** | B3 待實作清單多一項，成本 ≈ 0 額外 |
| B3 **之後** | 桌面 UI ＋ 手機 UI 兩份都要補寫，且違反 roadmap §4.1／§4.5 |

→ **現在提出不但不晚，反而是最後一個免費的時機。**

### 3.3 對四大目標（roadmap §2）的檢查

| 目標 | 結果 |
|---|---|
| 單機可完整運作 | ✅ 純本地資料，無外部服務 |
| 不需付費給作者 | ✅ 無成本 |
| 敏感資料不放第三方 | ✅ 不外傳；但見 §7 匯出隱私 |
| 新手三步上手 | ⚠️ 需守住「預設不存在、不設定完全不影響」——見 §6.1 |

---

## 4. 資料模型

### 4.1 條目型別（欄位名沿用 ST V2）

```ts
// src/core/lore/types.ts
export interface LoreEntry {
  id: string
  /** 觸發關鍵字；任一命中即觸發 */
  keys: string[]
  /** 注入 prompt 的內容 */
  content: string
  enabled: boolean
  /** true = 常駐注入，不需關鍵字命中 */
  constant: boolean
  case_sensitive?: boolean
  /** 排序用；小的在前 */
  insertion_order: number
  /** 超出預算時先砍低優先 */
  priority?: number
  /** 與 selective 搭配：keys 命中後還要 secondary_keys 也命中 */
  secondary_keys?: string[]
  selective?: boolean
  /** 使用者備註，不進 prompt */
  comment?: string
  /** 未實作欄位原樣保存，匯出時吐回（見 §5.2） */
  _passthrough?: Record<string, unknown>
}

export interface Lorebook {
  id: string
  name: string
  entries: LoreEntry[]
  /** 掃描最近幾則訊息；預設 5 */
  scan_depth: number
  /** 注入上限，以**字元數**近似，非真 token；預設 2000 */
  token_budget: number
  createdAt: number
  updatedAt: number
}
```

### 4.2 存放位置

- 檔案：`lorebooks/<id>.json`（storage adapter 的相對 key，比照 `personas/` `worlds/`）
- 掛載方式**兩條並存**：
  1. **世界觀綁定** —— `WorldPreset.lorebookIds?: string[]`
  2. **角色卡內嵌** —— `Character.lorebookIds?: string[]`（ST 卡匯入時，
     `character_book` 轉成一本獨立 lorebook 並掛到該角色）

兩邊都注入，**角色卡的排前面**（角色自己的設定優先於世界背景）。

> 這是**疊加式**，比照 `newsKeywords`；與 §4.4 的情境綁定（取代式）是不同機制，
> 兩者的分工刻意對齊 `docs/news-future-keyword-groups.md` 的既有心智模型，
> 不引入第三種語意。

---

## 5. 引擎：實作哪些、不實作哪些

### 5.1 ST 機制對照

| ST 機制 | 決定 | 說明 |
|---|---|---|
| `keys` 關鍵字掃描 | ✅ 實作 | 字串 includes |
| `constant` 常駐 | ✅ 實作 | 重要術語必用；見 §6.2 |
| `enabled` / `case_sensitive` | ✅ 實作 | |
| `insertion_order` / `priority` | ✅ 實作 | 排序 ＋ 超預算裁切 |
| `secondary_keys` + `selective` | ✅ 實作，**但不給 UI** | 一個 AND 條件，寫了不用不花錢；ST 匯入的卡片照樣正確運作。見 §7.1 |
| `token_budget` | 🔶 **字元數近似** | **不引 tokenizer**（多一個相依、手機端更痛） |
| `scan_depth` | ✅ 實作 | 但受 §6.3 限制 |
| `extensions.position` / `depth` | ❌ 不做 | 一律注入 system prompt |
| `recursive_scanning` | ❌ 不做 | 遞迴觸發，用語解說用不到 |

### 5.2 未實作欄位一律原樣保存

匯入時把不認識的欄位收進 `_passthrough`，匯出時原樣吐回。

**理由**：ST → DeST → ST 來回不掉資料；日後要補完整實作時不必改格式、不必再遷移一次。
成本只是一個 spread。

### 5.3 純函式簽名

```ts
// src/core/lore/scan.ts —— 零 I/O、可單元測試
export function selectLoreEntries(
  books: Lorebook[],
  scanText: string,       // 由呼叫端組好的掃描文字（見 §6.3）
  opts?: { budgetChars?: number }
): LoreEntry[]

// src/core/lore/format.ts
export function formatLoreBlock(entries: LoreEntry[]): string  // → "[Glossary]\n..."
```

注入內容接到 `extraSystemContext`，或在 `buildSystemPrompt()` 的 CONTEXT 區塊
`[World]` 之後、`[Scene]` 之前 push 一段 `[Glossary]`。
**建議走 CONTEXT 區塊**，因為它是靜態世界觀的一部分，
而 `extraSystemContext` 語意上是「這一次呼叫的臨時上下文」。

### 5.4 注入標籤：`[Glossary]`（已定案）

標籤是給 LLM 的語意提示，實際內容一字不變，差別只在模型如何理解這段的用途：

| 標籤 | 模型的理解 | 行為傾向 |
|---|---|---|
| `[Glossary]` | 字典，看不懂時查 | **被動**：使用者提到才用，不主動提起 |
| `[Lore]` | 世界觀設定（同 `[World]` 一類） | **主動**：容易編進敘述、主動科普 |

**採用 `[Glossary]`。** 依 §1.1，需求是「角色聽得懂」而非「角色主動介紹使用者自己的設定」——
後者在日常閒聊會很煩。

代價：日後若擴成裝劇情設定的完整 lorebook，這個名字會顯得太窄。
但那時改一個字串常數即可，不是資料遷移。

---

## 6. 必須先想清楚的交互作用

### 6.1 新手三步上手（roadmap §2 目標 4）

**預設完全不存在**：沒有任何內建 lorebook、設定頁不預先展開、
沒建立任何一本時 prompt 完全不受影響（連空的 `[Glossary]` 標籤都不出現）。

這條是硬要求。Lorebook 是進階功能，不能讓新手在第一次設定時撞見。

### 6.2 與記憶摘要的衝突（**最重要的一條**）

上下文只送 `keepRecentN`（預設 20）則，且 `contextMessages()`
（`ipcHandlers.ts:1815`）會先濾掉 `excludeFromContext` 的訊息。

- **掃描範圍必須用同一個 `contextMessages()` 結果**，
  否則會出現「已被摘要吃掉的舊訊息還在觸發 lore」——
  角色手上沒有那段對話，卻收到對應的術語解說，會語意錯亂。
- **已知限制**：專有名詞若出現在 30 則前，就不會再觸發。
  這正是 `constant: true` 存在的理由 —— **核心術語應設常駐**，
  設定 UI 要把這件事講清楚（見 §7）。
- 摘要文字（`conv.summary`）**要不要納入掃描**？
  → 建議**納入**。摘要是舊對話的濃縮，術語很可能只留在摘要裡。
  成本是掃描字串多接一段，零風險。

### 6.3 掃描文字怎麼組

```
scanText = conv.summary
         + contextMessages(messages, keepRecentN).slice(-scan_depth) 的 content
         + 使用者這一句
```

`scan_depth` 是在 `keepRecentN` **之內**再取後 N 則，不會超出上下文範圍。

### 6.4 情境切換（owner 明確要求，**一定要**）

**兩個機制並存，各管一件事：**

| 機制 | 語意 | 實作 |
|---|---|---|
| `moduleOverrides['desktopst.lorebook']` | **總開關**（強制開／強制關／跟隨全域） | 比照 `desktopst.systemTime`，在 `applySceneModuleOverrides()` 加一行 |
| `ScenePreset.lorebookIds?: string[]` | **取代式切換**（這個情境用哪幾本） | 比照 `ScenePreset.newsKeywordGroupId`；未設＝用世界觀／角色卡的疊加結果 |

**為什麼不能只用 `moduleOverrides`**：
TRPG 情境要的通常不是「關掉」而是「換一本」。
`moduleOverrides` 只能開關，做不到取代式切換。

**`scene:capture` 覆寫時要保留這兩個欄位**（比照 `newsKeywordGroupId` /
`moduleOverrides` 的既有處理，它們不是桌面快照的一部分）。

### 6.5 生效範圍

比照日曆模組：**一般聊天、說點什麼（`forceSpeakDirect`）、群組聊天、提醒**。
新聞發話與摘要**不注入**（前者是外部話題、後者是壓縮任務，都不需要世界觀術語）。

### 6.6 失敗處理

檔案損壞／讀取失敗一律**靜默略過該本**，聊天流程不中斷。比照日曆模組的既有慣例。

---

## 7. UI

### 7.1 條目編輯只暴露四個欄位（已定案）

`priority` / `insertion_order` / `secondary_keys` **存在於資料與引擎，但不出現在 UI**。

兩者常被搞混，順帶記錄差別：

| 欄位 | 管什麼 |
|---|---|
| `insertion_order` | 注入時條目的**先後順序** |
| `priority` | 空間不夠時**先砍誰** |

依 §1.1 的用例（十幾條專案名詞），**永遠不會撞到預算上限** → `priority` 實務上是死的。
`secondary_keys` 的一詞多義消歧也用不到。

三個欄位仍照 §5.2 原樣保存與吐回，ST 匯入的卡片行為完全正確。
日後條目量真的爆炸，再開「進階」摺疊區接上即可 —— 資料早就在了。

### 7.2 版面

極簡，比照新聞關鍵字標籤的密度：

- **入口**：設定 → 世界觀分頁底下「用語解說」區塊（不另開分頁）
- **列表**：一本 lorebook = 一張卡，內含條目列表
- **條目編輯**：關鍵字（chip 輸入）／內容（textarea）／常駐 checkbox ／啟用 checkbox
  - **只暴露這四個**。`priority` / `secondary_keys` / `insertion_order`
    存在但不出現在預設 UI（進階摺疊區，或第一版直接不給）
- **關鍵字欄位要有說明文字**：「同一件事的不同叫法都填進來，任一個被提到就生效。」
  （§1.1 的核心用法，不能讓使用者以為一條只能一個詞）
- **常駐要有說明文字**：「勾選後永遠注入，不需在對話中提到。核心術語建議勾選。」
  （§6.2 的已知限制必須在 UI 上講明，否則使用者會以為壞掉）
- **情境卡片**：既有的「模組開關」摺疊區多一列 lorebook；另加「使用哪幾本」多選
- **匯入**：ST lorebook `.json` ／ 角色卡 `character_book`（匯入角色時自動）
- **匯出**：ST 相容 `.json`

### 7.3 DST Pack 匯出（已定案）

**匯出對話框給一個「包含用語解說」勾選框，預設不勾。**

理由：依 §1.1，lorebook 內容多為個人專案名稱、進行中的工作、真實人名 ——
**預設是私人資料**，不該隨手分享角色包時一起外流。
但世界觀綁的 lorebook 也可能是刻意創作、想一起分享的內容，故保留選項。

比照 API Key「預設不外流」的既有原則，只是 API Key 是硬性排除、
lorebook 是預設關閉但可開。

---

## 8. 從角色卡自動生成條目（**採納**，owner 2026-08-03）

> 本節推翻本文件初版的否決結論。
> **初版反對的是「聊天時即時查角色卡」**（每次都要摘要 → 有成本、會出錯、要快取）。
> Owner 提的是**匯入時生成一次、之後就是普通可編輯條目**——一次性、可改、可刪。
> 那三個反對理由一個都不適用。

### 8.1 先拆成兩件事（**這是本節最重要的一段**）

Owner 同時提到兩個構想，它們**結構不同、不能合併**：

| | (a) 角色簡介條目 | (b) A 角色對 B 角色的印象 |
|---|---|---|
| 內容性質 | **客觀**：他是誰 | **主觀**：我怎麼看他 |
| 例 | 「OOO 是某公司的企劃同事，個性穩重」 | 「OOO 老是打斷我說話，有點煩」 |
| 資料鍵 | **一個角色一份，全體共用** | **角色 × 角色，每對一份** |
| 誰讀得到 | 所有角色 | 只有 A |
| 屬於 | **本文件（lorebook）** | `docs/future-character-impression.md` |

**判準很單純：lorebook 是「大家共用的字典」，印象是「誰對誰的私人看法」。**
(b) 放進 lorebook 會讓所有角色都讀到甲對乙的私人評價 —— 語意直接壞掉。

→ **(a) 納入本提案；(b) 移交印象文件**，見 §8.5。

### 8.2 (a) 的規格

**觸發時機（兩條，皆為使用者主動）**

1. **匯入角色卡時詢問** —— 對話框勾選「順便生成用語解說條目」，**預設不勾**
   （會花 token，不可靜默執行）
2. **事後手動** —— 角色編輯畫面一顆「生成用語條目」按鈕，任何角色隨時可生成

**生成方式**

- 走**輔助模型**（`applyUtilitySettings`），比照 `core/llm/summarizer.ts`
- **LLM 只產生 `content` 一句話**；`keys` 由**程式**填入（角色 `name` ＋ `nicknames`）
  → 出錯面縮到最小。LLM 不決定觸發條件，只決定描述文字
- 指令英文、輸出繁中（比照摘要與新聞的既有慣例）
- 輸入：角色的 `description` / `personality` / `scenario`
- 要求：**一句話、40 字以內、客觀事實優先**（誰、什麼身分、關係、一個性格關鍵詞）

**生成後的性質**

- 就是**一個普通的 `LoreEntry`**，可編輯、可刪除、可改 keys、可勾常駐
- **一次性快照，不與角色卡連動**。角色卡日後改了，條目不會自動更新
  → 這條要明確定死，否則得處理「卡片改了要不要覆蓋使用者手動修改」的同步地獄
- 可重新生成（覆蓋前必須確認，避免蓋掉手動修改）

**預設值**

- `constant: false` —— 人名是偶爾提到，靠關鍵字觸發即可，不必常駐吃 token
  （與 §1.1 的專案名詞相反，那些該常駐）
- `enabled: true`

**失敗處理**

生成失敗（無 API Key／逾時／回傳空）→ **靜默略過，不擋匯入流程**，
使用者仍可事後手動按按鈕。比照日曆模組的既有慣例。

**隱私**

生成的條目同樣受 §7.3 管轄（DST Pack 匯出預設不勾）。
角色簡介可能含真實人物資訊，這點不因為是自動生成而改變。

### 8.3 這解掉了什麼

§1.2 指出「程式完全不查角色卡，人名要角色知道就得手建條目」。
自動生成把「手建」變成「按一顆按鈕再微調」，
對 owner 提到的「其他進行中專案的人」這類批量情形特別有感。

### 8.4 工作量

**＋1–2 天**，疊在 §9.1 的 B2.6 上（需要輔助模型呼叫 ＋ 匯入對話框一個勾選框 ＋
角色編輯畫面一顆按鈕）。無新基礎設施。

### 8.5 (b) 角色對角色的印象 —— 移交，不在本提案

**不做進 lorebook**，理由見 §8.1。

移交給 `docs/future-character-impression.md`，因為那份文件的核心設計正好是這個問題：
它已經定義了「記錄鍵是**角色 × Persona 兩個一起**」的模型。
角色對角色的印象是**同一個模型換一把鍵**（角色 × 角色），
資料檔（`impressions.json`）、全域開關、可看可編可刪的 UI 全部可以共用。

**✅ 已於 2026-08-03 移交完成 → `docs/future-character-impression.md` §3.4。**
本文件不重複規格，以下僅記錄結論摘要：

- owner 追加三個限制條件（**手動觸發／只生成勾選的角色／生成後可編輯**），
  把原本擔心的三個難題（何時總結、誰觀察誰、N² 爆量）全部消解 → **判定可行、已定案**
- 結構上與本文件 §8(a) **同型**：手動觸發的一次性生成器 ＋ 產出可編輯
- 鍵是**觀察者 × 被觀察者 × Persona** 三個，沿用印象文件 §3.2 那把鍵；
  Persona 那一維負責把 TRPG 的角色關係與日常隔開
- 估時 **＋2–3 天**，但**疊在印象主功能上，不能單獨插隊**——
  它需要的 `impressions.json`、全域開關、編輯 UI 全是主功能的地基

> 📌 因此**不影響本提案 §9 的估時**。B2.5／B2.6 與印象功能是兩件獨立的事。

---

## 9. 工作量與插入順序

### 8.1 拆解

| 階段 | 內容 | 估時 |
|---|---|---|
| **B2.5 Lorebook core** | `src/core/lore/`：型別、掃描、排序、預算裁切、ST 格式對映。純函式、可測、零 UI | 3–5 天 |
| **B2.6 桌面 UI ＋ 匯入匯出** | 世界觀分頁編輯器、情境綁定與覆蓋、ST `.json` ／ `character_book` 匯入匯出、**角色卡自動生成條目（§8）** | 4–7 天 |
| **（B3 內）** | 手機 UI 清單多一項 lorebook 編輯器（同一份 React） | 含在 B3 estimate 內 |

合計約**一週多**，相對 B3 的 4–8 週是小數點。

### 8.2 可壓縮的部分

若想再縮，**B2.6 的匯入匯出可以往後挪**（自建條目先能用）。

但 **B2.5 的型別必須在 B3 開工前定案** —— 否則手機 UI 沒有東西可以接，
就會退回「B3 之後補寫兩份 UI」的最差情形（§3.2）。

### 8.3 建議寫進 roadmap §10 的兩列

```
| B2.5 | Lorebook core（`src/core/lore/`，純函式，ST 格式子集）— 見 docs/future-lorebook.md | 3–5 天 |
| B2.6 | Lorebook 桌面 UI ＋ ST 匯入匯出 ＋ 情境綁定 | 3–5 天 |
```

插在現行 B2 與 B3 之間。**§10.5「下一個 AI 從這裡開始」也要同步改指向 B2.5。**

---

## 9. 明確不做

| 項目 | 理由 |
|---|---|
| 遞迴觸發（`recursive_scanning`） | 用語解說用不到；會讓注入量不可預測 |
| 插入對話特定深度（`position` / `depth`） | 需改動 messages 組裝，牽動群組聊天與 reaction 標註等既有注入 |
| 真 tokenizer 預算 | 多一個相依，手機端更痛。字元近似足夠 |
| 向量／語意檢索 | 需 embedding API，違反 §2 目標 2、3 |
| 自動從對話學新術語 | 與 `docs/future-character-impression.md` 的自動記憶功能重疊，該由那邊處理 |
| **聊天時即時查角色卡並摘要** | 每則訊息都要 LLM 呼叫 → 有成本、會出錯、需快取。**改為匯入時生成一次，見 §8** |
| **A 角色對 B 角色的印象** | 不屬於 lorebook（共用字典 vs 私人看法），移交印象文件。見 §8.5 |

---

## 10. 決議紀錄（owner 2026-08-03 已拍板）

| # | 議題 | 決議 |
|---|---|---|
| 1 | DST Pack 匯出是否含 lorebook | **給勾選框，預設不勾**（§7.3） |
| 2 | 是否暴露 `priority` / `secondary_keys` | **不暴露**，資料與引擎保留（§7.1） |
| 3 | 注入標籤 | **`[Glossary]`**（§5.4） |
| 4 | 情境切換 | **必須有**，兩機制並存：總開關 ＋ 取代式綁定（§6.4） |
| 5 | 從角色卡自動生成條目 | **納入**（推翻初版否決）：匯入時詢問／事後手動、輔助模型、一次性快照、可編輯（§8） |
| 6 | A 角色對 B 角色的印象 | **不做進 lorebook**，移交 `docs/future-character-impression.md`（§8.5） |

無待決事項。**規格可據此開工。**
