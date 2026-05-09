# Requirements Document: 角色庫管理介面（character-library）

## Introduction

本功能為 DesktopST 桌面 AI 角色扮演寵物程式新增一個獨立的「角色庫視窗」，提供完整的角色生命週期管理。使用者可在此視窗新增、刪除、編輯角色，匯入／匯出 SillyTavern（ST）相容角色卡（JSON 與 PNG 格式），更換角色頭像，以及為 27 種預設情緒各自設定對應圖片。視窗採用卡片式 Grid 排版，風格遵循專案的春夏粉彩扁平化設計原則。

---

## Glossary

- **Character_Library**：角色庫視窗，管理所有角色卡的獨立 Electron 視窗。
- **Character_Card**：一個角色的完整資料物件，對應 `Character` 介面。
- **Character_Editor**：角色設定視窗，分頁式介面，用於編輯單一角色的所有欄位。
- **ST_Card**：SillyTavern 格式的角色卡，可為 JSON 檔或 PNG 檔（tEXt chunk 內嵌 base64 JSON）。
- **Emotion_Sprite**：情緒對應圖片，`emotions` 欄位中每個情緒名稱對應的圖片路徑。
- **Avatar**：角色預設頭像，當某情緒未設定 Emotion_Sprite 時作為 fallback 顯示。
- **IPC_Handler**：Electron 主程序的 IPC 訊息處理器，負責檔案 I/O 與視窗管理。
- **Desktop_Character**：目前在桌面上顯示的角色實例，對應 `DesktopCharacterState`。
- **PNG_tEXt_Chunk**：PNG 檔案格式中的文字資料區塊，ST 角色卡 PNG 將角色 JSON 以 base64 編碼嵌入此區塊。

---

## Requirements

### Requirement 1

**User Story:** 身為使用者，我希望有一個獨立的角色庫視窗，以便集中管理所有角色卡，不必在設定視窗中尋找角色管理功能。

#### 驗收標準

1. WHEN 使用者點擊懸停選單的「角色庫」按鈕或設定視窗標題列的「角色庫」入口，THE Character_Library SHALL 開啟一個 Electron 視窗，且該視窗標題顯示「角色庫」；若視窗已開啟，則將其聚焦至前景。
2. THE Character_Library SHALL 以卡片式 Grid 排版顯示所有已儲存的 Character_Card，每張卡片最小寬度為 120px，顯示角色頭像與名稱。
3. WHEN 角色清單為空，THE Character_Library SHALL 顯示引導提示文字，說明如何新增或匯入角色。
4. WHEN 使用者點擊角色卡片，THE Character_Library SHALL 彈出操作選單，選項包含「編輯」、「刪除」、「匯出」、「召喚到桌面」。
5. WHEN 使用者在角色卡片上按下右鍵，THE Character_Library SHALL 顯示與點擊相同的快捷選單。
6. THE Character_Library SHALL 在標題列提供「＋ 新增」按鈕與「匯入 ST 角色卡」按鈕。
7. WHEN 使用者點擊「召喚到桌面」，THE Character_Library SHALL 呼叫 `desktop:add-character` IPC；IF IPC 呼叫失敗，THEN THE Character_Library SHALL 顯示錯誤提示，且不改變桌面狀態。
8. IF 角色已在桌面上，THEN THE Character_Library SHALL 在該角色卡片上顯示「桌面中」標記，並將操作選單中的「召喚到桌面」選項設為停用（disabled）。

---

### Requirement 2

**User Story:** 身為使用者，我希望能快速建立一個空白角色，以便從頭設定新角色的資料。

#### 驗收標準

1. WHEN 使用者點擊「＋ 新增」按鈕，THE Character_Library SHALL 建立一個具有唯一 UUID `id`、預設名稱「新角色」、所有文字欄位為空字串的 Character_Card，並立即開啟 Character_Editor 進行編輯。
2. WHEN Character_Editor 首次開啟新角色，THE Character_Library SHALL 呼叫 `character:save` IPC 將新角色持久化儲存，確保即使使用者未點擊「儲存」也不會遺失角色 ID。
3. WHEN 新角色儲存成功，THE Character_Library SHALL 在 Grid 中顯示新角色卡片。
4. THE Character_Library SHALL 確保所有新建角色的 `emotions` 欄位初始化為空物件 `{}`，`createdAt` 與 `updatedAt` 均設為建立當下的 Unix 毫秒時間戳記。
5. IF `character:save` IPC 呼叫失敗，THEN THE Character_Library SHALL 顯示錯誤提示，且不在 Grid 中顯示該角色卡片。

---

### Requirement 3

**User Story:** 身為使用者，我希望能刪除不再需要的角色，以便保持角色庫整潔。

#### 驗收標準

1. WHEN 使用者從操作選單選擇「刪除」，THE Character_Library SHALL 顯示確認對話框，說明刪除後無法復原。
2. WHEN 使用者確認刪除，THE Character_Library SHALL 呼叫 `character:delete` IPC，從角色清單與檔案系統中移除該角色。
3. WHEN 角色刪除成功，THE Character_Library SHALL 從 Grid 中移除對應卡片。
4. IF 被刪除的角色正在桌面上，THEN THE Character_Library SHALL 同時從桌面移除該角色。
5. WHEN 使用者取消確認對話框，THE Character_Library SHALL 不執行任何刪除操作，角色保持不變。
6. IF `character:delete` IPC 呼叫失敗，THEN THE Character_Library SHALL 顯示錯誤提示，且不從 Grid 中移除該角色卡片。

---

### Requirement 4

**User Story:** 身為使用者，我希望有一個分頁式的角色設定視窗，以便完整編輯角色的所有屬性。

#### 驗收標準

1. THE Character_Editor SHALL 提供四個分頁：「基本資訊」、「情緒圖片」、「進階」、「匯入／匯出」。
2. WHEN 使用者切換分頁，THE Character_Editor SHALL 顯示對應分頁的內容；IF 目前分頁有未儲存的變更且自動儲存失敗，THEN THE Character_Editor SHALL 阻止分頁切換並顯示錯誤提示。
3. THE Character_Editor 的「基本資訊」分頁 SHALL 提供以下欄位：名稱（input，最多 100 字元）、主圖上傳（接受 PNG、JPG、JPEG、GIF、WEBP，此圖為角色在桌面上顯示的主體圖片）、簡介（textarea）、個性（textarea）、招呼語（textarea）、對話範例（textarea）。
4. THE Character_Editor 的「進階」分頁 SHALL 提供以下欄位：Scenario（textarea）、System Prompt 覆蓋（textarea，留空則使用全域設定）、作者備註（textarea）。
5. THE Character_Editor 的「情緒圖片」分頁 SHALL 以圖片為單位管理情緒對應，每張圖片可透過下拉選單同時對應多個情緒名稱（詳見需求 6）。
6. THE Character_Editor 的「匯入／匯出」分頁 SHALL 提供「匯出為 JSON」與「匯出為 PNG 角色卡」按鈕，以及「匯入 ST 角色卡」按鈕。
7. WHEN 使用者點擊「儲存」，THE Character_Editor SHALL 呼叫 `character:save` IPC，將所有分頁的修改一併儲存，更新 `updatedAt` 時間戳記，並在視窗中顯示儲存成功的提示；視窗保持開啟。
8. IF `character:save` IPC 呼叫失敗，THEN THE Character_Editor SHALL 顯示錯誤提示，且不關閉視窗。

---

### Requirement 5

**User Story:** 身為使用者，我希望能為角色上傳自訂主圖，以便讓角色在桌面上有獨特的外觀。

#### 驗收標準

1. THE Character_Editor 的「基本資訊」分頁 SHALL 說明此圖片為角色站在桌面上顯示的主圖（非聊天頭像），讓使用者清楚了解圖片用途。
2. WHEN 使用者在「基本資訊」分頁點擊主圖區域，THE Character_Editor SHALL 開啟系統檔案選擇對話框，篩選條件為 `.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`。
3. WHEN 使用者選擇圖片檔案且檔案大小不超過 10 MB，THE Character_Editor SHALL 呼叫 `character:save-avatar` IPC 將圖片儲存至角色資料夾，並更新 `character.avatar` 為新路徑。
4. WHEN 主圖更新成功，THE Character_Editor SHALL 在 1 秒內於預覽區顯示新圖片，並在圖片下方或透過 mouseover hint 顯示檔案名稱與圖片尺寸（寬 × 高，單位 px）。
5. IF 使用者選擇的檔案副檔名不在允許清單（`.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`）中，THEN THE Character_Editor SHALL 顯示錯誤提示，說明可接受的格式，且不更新主圖。
6. IF `character:save-avatar` IPC 呼叫失敗（例如磁碟空間不足），THEN THE Character_Editor SHALL 顯示錯誤提示，且不更新 `character.avatar`。

---

### Requirement 6

**User Story:** 身為使用者，我希望能透過下拉選單為角色的情緒指定對應圖片，並允許多個情緒共用同一張圖，以便靈活管理表情素材而不被迫一次設定所有情緒。

#### 驗收標準

1. THE Character_Editor 的「情緒圖片」分頁 SHALL 以「已上傳圖片清單」為主體，每筆記錄顯示圖片縮圖、檔案名稱、圖片尺寸（寬 × 高 px，透過 mouseover hint 或直接顯示），以及一個可多選的情緒下拉選單。
2. THE Character_Editor 的情緒下拉選單 SHALL 以「英文名稱（中文說明）」格式顯示以下 28 種預設情緒選項，供使用者辨識；傳送給 LLM 時僅使用英文名稱：admiration（欽佩）、amusement（愉悅）、anger（憤怒）、annoyance（煩躁）、approval（認同）、caring（關懷）、confusion（困惑）、curiosity（好奇）、desire（渴望）、disappointment（失望）、disapproval（不認同）、disgust（厭惡）、embarrassment（尷尬）、excitement（興奮）、fear（恐懼）、gratitude（感激）、grief（悲痛）、joy（喜悅）、love（愛意）、nervousness（緊張）、optimism（樂觀）、pride（自豪）、realization（恍然大悟）、relief（如釋重負）、remorse（懊悔）、sadness（悲傷）、surprise（驚訝）、neutral（平靜）。
3. WHEN 使用者點擊「新增情緒圖片」按鈕，THE Character_Editor SHALL 開啟系統檔案選擇對話框，篩選條件為 `.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`，並在選擇後將圖片加入清單，情緒對應預設為空（未指定）。
4. WHEN 使用者在某筆圖片記錄的情緒下拉選單中選擇一或多個情緒，THE Character_Editor SHALL 將 `character.emotions[emotionName]` 設為該圖片的本機絕對路徑；同一張圖片可同時對應多個情緒名稱。
5. WHEN 使用者從某筆圖片記錄的情緒下拉選單中取消勾選某情緒，THE Character_Editor SHALL 從 `character.emotions` 中移除該情緒的鍵值對。
6. WHEN 使用者點擊某筆圖片記錄的刪除按鈕，THE Character_Editor SHALL 從清單中移除該記錄，並同時從 `character.emotions` 中移除所有指向該圖片路徑的鍵值對。
7. IF `character.emotions[e]` 為空字串、undefined 或對應路徑不存在，THEN 桌面上的 CharacterSprite SHALL 顯示 `character.avatar`（主圖）作為 fallback。
8. WHEN 情緒圖片設定儲存成功，THE Character_Editor SHALL 確保 `character.emotions` 只包含值為本機絕對路徑且對應檔案存在的鍵值對。
9. IF 使用者選擇的檔案副檔名不在允許清單（`.png`、`.jpg`、`.jpeg`、`.gif`、`.webp`）中，THEN THE Character_Editor SHALL 顯示錯誤提示，且不將該檔案加入清單。

---

### Requirement 7

**User Story:** 身為使用者，我希望能匯入 SillyTavern JSON 格式的角色卡，以便直接使用 ST 社群的角色資源。

#### 驗收標準

1. WHEN 使用者點擊「匯入 ST 角色卡」並選擇 JSON 檔案，THE Character_Library SHALL 讀取檔案內容並呼叫 `character:import-json` IPC。
2. THE Character_Library SHALL 依照以下欄位對應規則解析 ST JSON：`name` → `name`；`description` 與 `personality` 以換行符號（`\n`）連接後 → `personality`（`description` 在前）；`first_mes` → `firstMessage`；`mes_example` → `exampleDialogue`；`scenario` → `scenario`；`creator_notes` → `creatorNotes`；`system_prompt` → `systemPromptOverride`；`description` 欄位不對應至 `Character.description`（該欄位留空字串）。
3. WHEN 匯入成功，THE Character_Library SHALL 在 Grid 中顯示新匯入的角色卡片，並自動開啟 Character_Editor 供使用者確認資料。
4. IF ST JSON 格式無效（非合法 JSON 字串）或解析失敗，THEN THE Character_Library SHALL 顯示錯誤提示，說明檔案格式不正確，且不建立任何角色。
5. THE Character_Library SHALL 確保解析後的 Character_Card 包含非空的 `name` 欄位；若 ST JSON 的 `name` 欄位為空字串或缺失，則使用預設值「Unknown」。

---

### Requirement 8

**User Story:** 身為使用者，我希望能匯入 SillyTavern PNG 格式的角色卡，以便使用嵌入角色資料的圖片檔案。

#### 驗收標準

1. WHEN 使用者點擊「匯入 ST 角色卡」並選擇 PNG 檔案，THE Character_Library SHALL 讀取 PNG 檔案的 tEXt chunk，提取 `chara` 鍵對應的 base64 編碼字串。
2. THE Character_Library SHALL 將提取的 base64 字串解碼為 UTF-8 JSON，再依需求 7 的欄位對應規則建立 Character_Card。
3. WHEN tEXt chunk 解碼成功，THE Character_Library SHALL 將 PNG 檔案本身複製為該角色的 Avatar。
4. IF PNG 檔案不包含 `chara` tEXt chunk，THEN THE Character_Library SHALL 顯示錯誤提示「此 PNG 不包含 ST 角色卡資料」，且不建立任何角色。
5. IF PNG 的 tEXt chunk 內容無法解碼為有效 JSON，THEN THE Character_Library SHALL 顯示錯誤提示，說明內容無法解析為有效角色卡資料，且不建立任何角色。
6. IF 使用者選擇的檔案不是有效的 PNG 格式，THEN THE Character_Library SHALL 顯示錯誤提示，且不建立任何角色。
7. THE Character_Library SHALL 確保 PNG 解碼後的 Character_Card 與直接匯入同一角色的 JSON 格式所得結果，在以下欄位上字串值完全相同：`name`、`personality`、`firstMessage`、`exampleDialogue`、`scenario`、`creatorNotes`、`systemPromptOverride`。

---

### Requirement 9

**User Story:** 身為使用者，我希望能將角色匯出為 ST 相容格式，以便在 SillyTavern 或其他工具中使用。

#### 驗收標準

1. WHEN 使用者從操作選單選擇「匯出」，THE Character_Library SHALL 提供「匯出為 JSON」與「匯出為 PNG 角色卡」兩個選項。
2. WHEN 使用者選擇「匯出為 JSON」，THE Character_Library SHALL 產生符合 ST 格式的 JSON 檔案，欄位對應如下：`name` → `name`；`personality` → `description`；空字串 → `personality`；`firstMessage` → `first_mes`；`exampleDialogue` → `mes_example`；`scenario` → `scenario`；`creatorNotes` → `creator_notes`；`systemPromptOverride` → `system_prompt`；並開啟系統儲存對話框讓使用者選擇儲存位置。
3. WHEN 使用者選擇「匯出為 PNG 角色卡」，THE Character_Library SHALL 將角色 JSON 以 UTF-8 編碼後 base64 編碼，嵌入 PNG 檔案的 tEXt chunk（鍵名為 `chara`），PNG 圖片內容使用 `character.avatar` 欄位所指向的頭像圖片，並開啟系統儲存對話框。
4. IF `character.avatar` 欄位為空或對應檔案不存在，THEN THE Character_Library SHALL 在匯出 PNG 時使用應用程式內建的預設佔位頭像圖片。
5. WHEN 使用者在系統儲存對話框中取消操作，THE Character_Library SHALL 不產生任何檔案，且不顯示錯誤提示。
6. IF 匯出過程中發生錯誤（例如磁碟空間不足或檔案寫入失敗），THEN THE Character_Library SHALL 顯示錯誤提示，說明匯出失敗的原因。
7. THE Character_Library SHALL 確保「匯出為 JSON 後再匯入」所得的 Character_Card，在以下欄位的字串值與原始資料相同：`name`、`personality`、`firstMessage`、`exampleDialogue`、`scenario`、`systemPromptOverride`、`creatorNotes`。

---

### Requirement 10

**User Story:** 身為開發者，我希望主程序提供完整的 IPC handler，以便渲染程序能安全地執行角色庫所需的所有操作。

#### 驗收標準

1. WHEN 渲染程序呼叫 `character-library:open`，THE IPC_Handler SHALL 開啟角色庫視窗或將已開啟的視窗聚焦至前景。
2. WHEN 渲染程序呼叫 `character:import-png` 並傳入不超過 10 MB 的 PNG ArrayBuffer，THE IPC_Handler SHALL 解析 tEXt chunk 並回傳建立的 Character_Card；IF 解析失敗，THEN THE IPC_Handler SHALL 回傳包含 `error` 欄位的物件。
3. WHEN 渲染程序呼叫 `character:export-json` 並傳入 Character_Card，THE IPC_Handler SHALL 回傳符合規格書 §8.2 欄位對應的 ST 格式 JSON 字串。
4. WHEN 渲染程序呼叫 `character:export-png` 並傳入 Character_Card，THE IPC_Handler SHALL 回傳嵌入角色資料的 PNG 檔案 Buffer；IF `id` 或 `name` 欄位缺失，THEN THE IPC_Handler SHALL 回傳包含 `error` 欄位的物件。
5. WHEN 渲染程序呼叫 `character:save-avatar` 並傳入角色 `id` 與不超過 10 MB 的圖片 ArrayBuffer，THE IPC_Handler SHALL 將圖片儲存至 `%APPDATA%\DesktopST\characters\{id}\avatar.{ext}` 並回傳新的絕對路徑；IF `id` 不對應任何已存在的角色資料夾，THEN THE IPC_Handler SHALL 回傳包含 `error` 欄位的物件。
6. WHEN 渲染程序呼叫 `character:save-emotion-sprite` 並傳入角色 `id`、情緒名稱與不超過 10 MB 的圖片 ArrayBuffer，THE IPC_Handler SHALL 將圖片儲存至 `%APPDATA%\DesktopST\characters\{id}\emotions\{emotionName}.{ext}` 並回傳新的絕對路徑；IF `id` 不對應任何已存在的角色資料夾，THEN THE IPC_Handler SHALL 回傳包含 `error` 欄位的物件。
7. IF 任何 IPC_Handler 操作發生未預期的例外，THEN THE IPC_Handler SHALL 回傳包含 `error` 欄位的物件，而非拋出未捕獲的例外。
