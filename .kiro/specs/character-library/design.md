# Design Document: 角色庫管理介面（character-library）

## Overview

本設計文件描述 DesktopST 角色庫管理介面的技術實作方案。此功能新增一個獨立的 Electron 視窗（`CharacterLibraryWindow`），提供卡片式 Grid 瀏覽、分頁式角色編輯器（`CharacterEditor`）、主圖與情緒圖片管理，以及 SillyTavern 角色卡的匯入／匯出。

### 設計目標

- 與現有 Electron 多視窗架構無縫整合，遵循 `windowManager.ts` 的視窗管理模式
- 情緒圖片以「圖片為單位」管理，允許多情緒共用同一張圖，解決現有 `emotions: Record<string, string>` 結構的 UI 操作問題
- ST 角色卡 PNG 匯入／匯出使用 `png-chunks-extract` / `png-chunks-encode` 套件，在 Main Process 處理，避免 Renderer 直接操作二進位資料
- 所有圖片 I/O 透過 IPC 在 Main Process 執行，Renderer 只傳遞 `ArrayBuffer`

### 研究摘要

**PNG tEXt chunk 處理**：SillyTavern 將角色 JSON 以 UTF-8 → base64 編碼後，嵌入 PNG 的 tEXt chunk，鍵名為 `chara`。使用 `png-chunks-extract` 解析 PNG buffer 取得所有 chunk，再找 `tEXt` 類型且 keyword 為 `chara` 的 chunk；匯出時用 `png-chunks-encode` 將新 chunk 插入原始 PNG。`png-chunk-text` 套件可協助解析 tEXt chunk 的 keyword/text 結構。

**情緒圖片資料模型**：現有 `Character.emotions: Record<string, string>` 以情緒名稱為 key、圖片路徑為 value。UI 需要「以圖片為單位」的反向視圖（`Map<imagePath, emotionName[]>`），在 Renderer 端動態計算，不改變儲存格式。

**圖片尺寸讀取**：Renderer 端可透過 `new Image()` 載入本機圖片（使用 `local://` 協定）後讀取 `naturalWidth` / `naturalHeight`，不需要 Main Process 介入。

**local:// 協定**：現有程式碼已使用 `local://${encodeURIComponent(path)}` 格式顯示本機圖片，新功能沿用此模式。

---

## Architecture

### 視窗架構

```
Main Process
├── windowManager.ts          ← 新增 createCharacterLibraryWindow()
├── ipcHandlers.ts            ← 新增 character-library:open、character:import-png、
│                                character:export-json、character:export-png、
│                                character:save-avatar、character:save-emotion-sprite
└── pngUtils.ts（新增）       ← PNG tEXt chunk 讀寫工具函數

Renderer Process（w=library）
└── windows/CharacterLibraryWindow.tsx
    ├── components/CharacterCard.tsx        ← 角色卡片元件
    ├── components/CharacterEditor.tsx      ← 分頁式編輯器
    │   ├── tabs/BasicInfoTab.tsx           ← 基本資訊分頁
    │   ├── tabs/EmotionSpritesTab.tsx      ← 情緒圖片分頁
    │   ├── tabs/AdvancedTab.tsx            ← 進階分頁
    │   └── tabs/ImportExportTab.tsx        ← 匯入匯出分頁
    └── stores/useCharacterLibraryStore.ts  ← 角色庫專用 Zustand store
```

### 資料流

```
使用者操作（Renderer）
    ↓ window.api.invoke(channel, payload)
IPC Handler（Main Process）
    ↓ fileStore / pngUtils
檔案系統（%APPDATA%\DesktopST\）
    ↓ broadcastToAll('characters:updated', characters)
所有 Renderer（含角色庫視窗）
    ↓ useAppStore 更新 characters[]
UI 重新渲染
```

### 視窗開啟流程

```
HoverMenu「角色庫」按鈕 / SettingsWindow 入口
    ↓ window.api.invoke('character-library:open')
Main Process: createCharacterLibraryWindow()
    ↓ 若已存在則 win.focus()，否則建立新視窗
CharacterLibraryWindow（w=library）
```

---

## Components and Interfaces

### 新增 IPC Channels

| Channel | 方向 | Payload | 回傳 |
|---|---|---|---|
| `character-library:open` | Renderer → Main | — | `true` |
| `character:import-png` | Renderer → Main | `{ buffer: ArrayBuffer }` | `Character \| { error: string }` |
| `character:export-json` | Renderer → Main | `Character` | `{ json: string } \| { error: string }` |
| `character:export-png` | Renderer → Main | `Character` | `{ buffer: ArrayBuffer } \| { error: string }` |
| `character:save-avatar` | Renderer → Main | `{ id: string; buffer: ArrayBuffer; ext: string }` | `{ path: string } \| { error: string }` |
| `character:save-emotion-sprite` | Renderer → Main | `{ id: string; filename: string; buffer: ArrayBuffer; ext: string }` | `{ path: string } \| { error: string }` |

> 注意：`character:import-json` 已存在，沿用現有實作並補強欄位對應邏輯。

### CharacterLibraryWindow

```typescript
// 視窗入口元件，管理角色庫的頂層狀態
interface CharacterLibraryWindowState {
  editingCharacterId: string | null   // null = 顯示 Grid，非 null = 顯示 Editor
  contextMenuCharId: string | null    // 右鍵/點擊選單的目標角色
  contextMenuPos: { x: number; y: number } | null
}
```

**佈局**：
```
┌─────────────────────────────────────────────────────┐
│ [drag-region] 角色庫          [＋ 新增] [匯入] [✕] │
├─────────────────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐               │
│  │ 頭像 │ │ 頭像 │ │ 頭像 │ │ 頭像 │               │
│  │ 名稱 │ │ 名稱 │ │ 名稱 │ │ 名稱 │               │
│  │[桌面]│ │      │ │      │ │      │               │
│  └──────┘ └──────┘ └──────┘ └──────┘               │
│  （空白時顯示引導提示）                               │
└─────────────────────────────────────────────────────┘
```

### CharacterCard

```typescript
interface CharacterCardProps {
  character: Character
  isOnDesktop: boolean
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}
```

卡片尺寸：最小寬度 120px，固定高度約 160px。顯示：頭像（圓角正方形）、名稱、「桌面中」badge（若在桌面上）。

### ContextMenu

```typescript
interface ContextMenuProps {
  characterId: string
  isOnDesktop: boolean
  position: { x: number; y: number }
  onClose: () => void
  onEdit: () => void
  onDelete: () => void
  onExport: () => void
  onSummon: () => void
}
```

選項：「編輯」、「刪除」、「匯出」、「召喚到桌面」（若已在桌面則停用）。

### CharacterEditor

```typescript
type EditorTab = 'basic' | 'emotions' | 'advanced' | 'importexport'

interface CharacterEditorProps {
  characterId: string
  onClose: () => void
}

interface CharacterEditorState {
  draft: Character           // 編輯中的草稿，未儲存前不影響 store
  activeTab: EditorTab
  isSaving: boolean
  saveError: string | null
  saveSuccess: boolean
}
```

**儲存策略**：使用者點擊「儲存」時，將 `draft` 透過 `character:save` IPC 儲存。分頁切換不自動儲存（避免儲存不完整資料）。

### EmotionSpritesTab

情緒圖片分頁的核心資料結構：

```typescript
// 從 character.emotions 計算出的「以圖片為單位」視圖
interface SpriteEntry {
  imagePath: string          // 本機絕對路徑
  filename: string           // 顯示用檔名
  dimensions: { w: number; h: number } | null  // 圖片尺寸，載入後填入
  assignedEmotions: string[] // 此圖片對應的情緒名稱清單（英文）
}

// 從 character.emotions 建立 SpriteEntry[]
function buildSpriteEntries(emotions: Record<string, string>): SpriteEntry[]
```

**情緒清單**（28 種，傳 LLM 時只用英文 key）：

```typescript
const EMOTION_OPTIONS: Array<{ en: string; zh: string }> = [
  { en: 'admiration',     zh: '欽佩' },
  { en: 'amusement',      zh: '愉悅' },
  { en: 'anger',          zh: '憤怒' },
  { en: 'annoyance',      zh: '煩躁' },
  { en: 'approval',       zh: '認同' },
  { en: 'caring',         zh: '關懷' },
  { en: 'confusion',      zh: '困惑' },
  { en: 'curiosity',      zh: '好奇' },
  { en: 'desire',         zh: '渴望' },
  { en: 'disappointment', zh: '失望' },
  { en: 'disapproval',    zh: '不認同' },
  { en: 'disgust',        zh: '厭惡' },
  { en: 'embarrassment',  zh: '尷尬' },
  { en: 'excitement',     zh: '興奮' },
  { en: 'fear',           zh: '恐懼' },
  { en: 'gratitude',      zh: '感激' },
  { en: 'grief',          zh: '悲痛' },
  { en: 'joy',            zh: '喜悅' },
  { en: 'love',           zh: '愛意' },
  { en: 'nervousness',    zh: '緊張' },
  { en: 'optimism',       zh: '樂觀' },
  { en: 'pride',          zh: '自豪' },
  { en: 'realization',    zh: '恍然大悟' },
  { en: 'relief',         zh: '如釋重負' },
  { en: 'remorse',        zh: '懊悔' },
  { en: 'sadness',        zh: '悲傷' },
  { en: 'surprise',       zh: '驚訝' },
  { en: 'neutral',        zh: '預設' },
]
```

顯示格式：`admiration（欽佩）`。

### pngUtils.ts（新增 Main Process 工具）

```typescript
// 從 PNG buffer 提取 chara tEXt chunk 並解碼為 JSON 字串
export function extractCharaJson(buffer: Buffer): string

// 將角色 JSON 字串嵌入 PNG buffer 的 tEXt chunk（鍵名 chara）
export function embedCharaJson(pngBuffer: Buffer, jsonStr: string): Buffer
```

依賴套件：`png-chunks-extract`、`png-chunks-encode`、`png-chunk-text`。

### useCharacterLibraryStore

角色庫視窗的本地 UI 狀態，不與 `useAppStore` 重疊：

```typescript
interface CharacterLibraryStore {
  editingCharacterId: string | null
  contextMenu: { characterId: string; x: number; y: number } | null
  exportMenuCharId: string | null   // 匯出子選單的目標

  openEditor: (id: string) => void
  closeEditor: () => void
  openContextMenu: (id: string, x: number, y: number) => void
  closeContextMenu: () => void
  openExportMenu: (id: string) => void
  closeExportMenu: () => void
}
```

角色資料本身繼續使用 `useAppStore`（`characters`、`desktopCharacters`），避免資料重複。

---

## Data Models

### Character 型別擴充

現有 `Character` 介面不需修改。情緒圖片以「圖片為單位」的 UI 視圖在 Renderer 端動態計算，儲存格式維持 `emotions: Record<string, string>`。

### ST JSON 欄位對應表

**匯入（ST JSON → Character）**：

| ST 欄位 | Character 欄位 | 備註 |
|---|---|---|
| `name` | `name` | 空字串時使用 `"Unknown"` |
| `description` + `\n` + `personality` | `personality` | description 在前，以 `\n` 連接 |
| `first_mes` | `firstMessage` | |
| `mes_example` | `exampleDialogue` | |
| `scenario` | `scenario` | |
| `creator_notes` | `creatorNotes` | |
| `system_prompt` | `systemPromptOverride` | |
| —（不對應）| `description` | 留空字串 |

> 注意：現有 `character:import-json` handler 的對應邏輯需更新，`description` 欄位目前被錯誤地對應到 `Character.description`，應改為合併至 `personality`。

**匯出（Character → ST JSON）**：

| Character 欄位 | ST 欄位 | 備註 |
|---|---|---|
| `name` | `name` | |
| `personality` | `description` | |
| `""` | `personality` | 固定空字串 |
| `firstMessage` | `first_mes` | |
| `exampleDialogue` | `mes_example` | |
| `scenario` | `scenario` | |
| `creatorNotes` | `creator_notes` | |
| `systemPromptOverride` | `system_prompt` | |

ST JSON 外層結構：
```json
{
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": { ...欄位... }
}
```

### 檔案系統路徑

```
%APPDATA%\DesktopST\
└── characters\
    └── {char_id}\
        ├── card.json
        ├── avatar.{ext}          ← character:save-avatar 儲存位置
        └── emotions\
            └── {filename}.{ext}  ← character:save-emotion-sprite 儲存位置
```

情緒圖片的 filename 使用原始檔名（去除路徑），若有衝突則加上時間戳記前綴。

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Grid 完整性

*For any* 非空的角色清單，角色庫 Grid 中渲染的卡片數量應等於角色清單的長度，且每個角色 ID 恰好對應一張卡片。

**Validates: Requirements 1.2**

---

### Property 2: 桌面標記一致性

*For any* 角色集合與桌面狀態，若某角色的 `id` 存在於 `desktopCharacters[].characterId` 中，則該角色的卡片應顯示「桌面中」標記，且操作選單中的「召喚到桌面」選項應為停用狀態；反之則不顯示標記且選項可用。

**Validates: Requirements 1.8**

---

### Property 3: 新角色初始狀態不變量

*For any* 透過「＋ 新增」建立的角色，其 `emotions` 欄位必須為空物件 `{}`，`createdAt` 與 `updatedAt` 必須為正整數 Unix 毫秒時間戳記，且 `createdAt <= updatedAt`。

**Validates: Requirements 2.4**

---

### Property 4: 刪除角色同步移除桌面狀態

*For any* 目前在桌面上的角色，執行刪除操作後，`desktopCharacters` 陣列中不應再包含該角色的 `characterId`。

**Validates: Requirements 3.4**

---

### Property 5: 圖片副檔名驗證

*For any* 副檔名不在 `['.png', '.jpg', '.jpeg', '.gif', '.webp']` 集合中的檔案，嘗試上傳（主圖或情緒圖片）時應被拒絕，且 `character.avatar` / `character.emotions` 不應被修改。

**Validates: Requirements 5.5, 6.9**

---

### Property 6: 情緒對應更新正確性

*For any* 圖片路徑與任意情緒名稱集合，當使用者在情緒下拉選單中選擇這些情緒後，`character.emotions` 中每個被選中的情緒名稱都應對應到該圖片路徑；未被選中的情緒名稱不應指向該路徑。

**Validates: Requirements 6.4, 6.5**

---

### Property 7: 刪除情緒圖片清除所有對應

*For any* 圖片路徑，從情緒圖片清單中刪除該記錄後，`character.emotions` 中不應有任何值等於該路徑。

**Validates: Requirements 6.6**

---

### Property 8: 情緒 Fallback 不變量

*For any* `character.emotions[e]` 為空字串、`undefined`，或對應路徑不存在的情緒 `e`，`CharacterSprite` 元件應渲染 `character.avatar` 所指向的圖片（若 `avatar` 也為空則顯示預設佔位圖示）。

**Validates: Requirements 6.7**

---

### Property 9: ST JSON 匯入欄位對應正確性

*For any* 有效的 ST JSON 物件（包含 `name`、`description`、`personality`、`first_mes`、`mes_example`、`scenario`、`creator_notes`、`system_prompt` 欄位），匯入後的 `Character` 應滿足：
- `character.name` = ST `name`（若為空則為 `"Unknown"`）
- `character.personality` = ST `description` + `"\n"` + ST `personality`（去除首尾空白後連接）
- `character.firstMessage` = ST `first_mes`
- `character.exampleDialogue` = ST `mes_example`

**Validates: Requirements 7.2, 7.5**

---

### Property 10: PNG 匯入與 JSON 匯入欄位一致性

*For any* 角色資料，將相同的角色 JSON 分別透過 JSON 匯入和 PNG 匯入（PNG 的 tEXt chunk 嵌入相同 JSON），所得 `Character` 在以下欄位的字串值應完全相同：`name`、`personality`、`firstMessage`、`exampleDialogue`、`scenario`、`creatorNotes`、`systemPromptOverride`。

**Validates: Requirements 8.7**

---

### Property 11: JSON 匯出欄位對應正確性

*For any* `Character`，匯出的 ST JSON 應滿足：
- ST `name` = `character.name`
- ST `description` = `character.personality`
- ST `first_mes` = `character.firstMessage`
- ST `mes_example` = `character.exampleDialogue`

**Validates: Requirements 9.2**

---

### Property 12: JSON 匯出再匯入 Round-Trip

*For any* `Character`，將其匯出為 ST JSON 後再匯入，所得 `Character` 在以下欄位的字串值應與原始資料相同：`name`、`personality`、`firstMessage`、`exampleDialogue`、`scenario`、`systemPromptOverride`、`creatorNotes`。

**Validates: Requirements 9.7**

---

### Property 13: PNG tEXt Chunk Round-Trip

*For any* 角色 JSON 字串，將其嵌入 PNG tEXt chunk 後再提取，所得字串應與原始字串完全相同（`extractCharaJson(embedCharaJson(png, json)) === json`）。

**Validates: Requirements 8.1, 10.2, 10.4**

---

### Property 14: IPC 例外安全性

*For any* 新增的 IPC handler（`character:import-png`、`character:export-json`、`character:export-png`、`character:save-avatar`、`character:save-emotion-sprite`），當 handler 內部拋出任何例外時，回傳值應為包含 `error` 字串欄位的物件，而非讓例外傳播至 Electron 的未捕獲例外處理器。

**Validates: Requirements 10.7**

---

## Error Handling

### 錯誤分類與處理策略

| 錯誤類型 | 發生位置 | 處理方式 |
|---|---|---|
| IPC 呼叫失敗（回傳 `{ error }` 物件）| Renderer | 顯示 toast 錯誤提示，不改變 UI 狀態 |
| 圖片副檔名不合法 | Renderer（檔案選擇後驗證）| 顯示 inline 錯誤提示，不觸發 IPC |
| PNG 不含 chara chunk | Main Process | 回傳 `{ error: '此 PNG 不包含 ST 角色卡資料' }` |
| PNG tEXt chunk 無法解碼 | Main Process | 回傳 `{ error: '內容無法解析為有效角色卡資料' }` |
| 磁碟空間不足 / 檔案寫入失敗 | Main Process | 捕獲 `fs` 例外，回傳 `{ error: e.message }` |
| 角色 ID 不存在（save-avatar / save-emotion-sprite）| Main Process | 回傳 `{ error: 'Character not found' }` |
| 刪除確認取消 | Renderer | 不執行任何操作，關閉確認對話框 |

### 錯誤提示 UI

使用輕量的 toast 元件（`ErrorToast`），顯示於視窗右下角，3 秒後自動消失。不使用 `alert()`。

### 確認對話框

刪除操作使用 inline 確認對話框（非 `window.confirm()`），顯示於卡片上方或視窗中央，包含「確認刪除」（紅色）與「取消」按鈕。

---

## Testing Strategy

### 單元測試

針對純函數邏輯，使用 Vitest：

**`pngUtils.test.ts`**（Main Process）：
- Property 13：PNG tEXt chunk round-trip（使用 fast-check 生成隨機 JSON 字串）
- 邊界條件：空 JSON 字串、含特殊字元的 JSON、超大 JSON（接近 10 MB 限制）

**`stCardMapper.test.ts`**（共用工具）：
- Property 9：ST JSON 匯入欄位對應（使用 fast-check 生成隨機 ST JSON 物件）
- Property 11：ST JSON 匯出欄位對應
- Property 12：JSON 匯出再匯入 round-trip
- 邊界條件：`name` 為空字串、`description` 或 `personality` 為 undefined

**`emotionUtils.test.ts`**（Renderer 工具）：
- Property 6：情緒對應更新正確性（使用 fast-check 生成隨機圖片路徑與情緒集合）
- Property 7：刪除情緒圖片清除所有對應
- `buildSpriteEntries` 函數的 round-trip 測試

**`fileValidation.test.ts`**：
- Property 5：圖片副檔名驗證（使用 fast-check 生成隨機副檔名字串）

### 元件測試

使用 Vitest + React Testing Library：

**`CharacterLibraryWindow.test.tsx`**：
- Property 1：Grid 完整性（使用 fast-check 生成隨機角色清單）
- Property 2：桌面標記一致性（使用 fast-check 生成隨機角色集合與桌面狀態）
- Property 3：新角色初始狀態不變量
- 空清單時顯示引導提示（edge case）

**`CharacterSprite.test.tsx`**：
- Property 8：情緒 Fallback 不變量

### 整合測試

使用 Vitest（不啟動完整 Electron，Mock IPC）：

**`ipcHandlers.integration.test.ts`**：
- `character:save-avatar`：儲存圖片至正確路徑（1-2 個範例）
- `character:save-emotion-sprite`：儲存情緒圖片至正確路徑（1-2 個範例）
- Property 4：刪除角色同步移除桌面狀態
- Property 14：IPC 例外安全性（Mock fs 拋出例外，驗證回傳 `{ error }` 物件）

### Property-Based Testing 設定

使用 **fast-check**（TypeScript 原生支援，與 Vitest 整合良好）。

每個 property test 最少執行 **100 次**迭代。

Tag 格式：
```typescript
// Feature: character-library, Property 1: Grid 完整性
it.prop([fc.array(arbitraryCharacter(), { minLength: 1 })])(
  'Grid 完整性：角色卡數量等於角色清單長度',
  (characters) => { ... }
)
```

### 測試覆蓋範圍說明

- **Property tests**：覆蓋資料轉換邏輯（ST 欄位對應、PNG chunk 讀寫、情緒對應更新）
- **Unit tests**：覆蓋邊界條件（空字串、undefined、不合法副檔名）
- **Integration tests**：覆蓋 IPC handler 的 I/O 行為與例外安全性
- **不測試**：UI 視覺外觀、動畫效果、Electron 視窗建立（需完整 Electron 環境）
