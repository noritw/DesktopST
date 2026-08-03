# DesktopST — 專案說明（給 AI 助手讀的）

這個資料夾是一個桌面 AI 角色扮演寵物程式的開發工作區。
**請先讀完這份文件再開始任何工作。**

---

## 這個專案是什麼

一款 Windows 桌面寵物程式，結合 LLM 即時對話與角色扮演。
類似 SillyTavern 的功能，但介面更簡單直覺，以「桌面寵物」為主體而非聊天視窗。

- 角色站在桌面上，點擊才叫出輸入框
- 支援多角色同時在桌面、群組互相對話
- 相容 SillyTavern 角色卡格式（匯入）
- 可自訂角色圖片、人格、情緒

---

## 必讀規格書

**`DesktopST-Spec.md`**（同資料夾）— 所有功能、UI、資料結構、LLM 整合的完整規格。
實作前務必讀完對應章節，不要憑空猜測規格。

**`docs/multi-device-platform-roadmap.md`** — 手機獨立版與平台擴充的評估與規劃。
**動到手機版／跨平台／多電腦／散布方式之前先讀完**，特別是：
§2「公開版四大目標」（所有提案要先過這四把尺）、§8「已否決的方案」（不要重新提案）。

---

## 技術棧

| 項目 | 選用 |
|---|---|
| 桌面框架 | Electron |
| 前端 | React + TypeScript |
| 樣式 | Tailwind CSS |
| 狀態管理 | Zustand |
| 資料儲存 | 本地 JSON（AppData）|
| 打包 | electron-builder |

程式碼放在 `src/` 資料夾（尚未建立時由 AI 初始化）。

---

## 資料夾結構

```
DesktopST\
├── CLAUDE.md               ← 本文件
├── DesktopST-Spec.md       ← 完整規格書
├── src\                    ← 程式碼（Electron + React）
├── assets\                 ← 設計素材（owner 製作的圖片）
└── dist\                   ← 打包輸出（不要 commit）
```

---

## 視覺設計原則（不可隨意變更）

- **風格**：扁平化、圓潤、春夏粉彩、可愛
- **主色系**：薄荷綠 `#CBFBC4` / 薄荷 `#AAEEDD` / 天藍 `#AAEEFF`（清爽綠藍優先）
- **輔色**：奶油黃 `#FFE8AA` / 粉紅 `#FFBBBB` / 薰衣草 `#F0BBFF`
- **背景**：`#F7FFFC`（薄荷白）、文字：`#3D5A52`（深綠灰）
- **圓角**：盡量多用，面板 16–24px，按鈕/圖示用圓形（50%）
- **禁止**：厚重陰影、毛玻璃、純黑色文字、尖角設計

色票與字型細節在規格書 §13。

**視覺修改只改這幾個檔案，不要動邏輯程式碼：**
- `src/styles/theme.css`
- `tailwind.config.ts`
- `src/styles/global.css`

---

## 開發原則

- 不要做規格書範圍外的功能，有想法先提出討論
- 第一版不實作：自動發話、TTS、Live2D、ST 對話記錄匯入
  - ⚠️ **Lorebook 已於 2026-08-03 改為要做**（owner 決議），規格見 `docs/future-lorebook.md`。
    做的是**用語解說**（角色聽得懂專有名詞）而非完整 ST World Info，
    但資料格式吃 ST `character_book` 子集。排程為 B2.5／B2.6，見 roadmap §10
- 桌面上至少保留一個角色，只剩一個時隱藏移除按鈕
- API Key 必須加密（`safeStorage`），不可存純文字
- 所有使用者資料存 `%APPDATA%\DesktopST\`，解除安裝不刪資料

---

## 開發指令

```bash
npm install       # 安裝套件（第一次）
npm run dev       # 開發模式（熱重載）
npm run build     # 打包成 .exe
npm run typecheck # 型別檢查
```

---

## 開源資訊

- **授權**：採作者**自訂條款**（非 MIT／非標準 CC 單檔套用）；禁止將程式與官方素材以重新打包等方式作為商品販售；修改後若免費再發布無須事先徵詢，欲販售或為營利目的單獨發行須事先取得作者同意。公開全文：**https://nori.tw/DeST/license.html**（設定「關於」可開啟）；本 repo 亦含 `docs/license.html` 供離線／打包附帶。
- **素材**：`assets/` 等官方美術之使用範圍以網站／repo 內公告為準。
- 目標：程式碼可閱讀與社群貢獻，owner 維護主 repo；免費再散布原則上自由，販售或營利單獨發行依自訂條款須作者同意。
- 平台：Windows 10/11 優先，保留跨平台擴充空間

---

## 目前進度

- [x] 規格書完成（v1.3）
- [x] 專案骨架初始化
- [x] 階段 1 MVP 基礎架構（桌面角色視窗、輸入視窗、LLM 對話、角色設定）
- [x] 相關 UI 操作優化（hover menu、拖曳、點擊穿透、音效靜音）
- [x] 角色縮放功能
  - HoverMenu 新增縮放按鈕（scale icon），點擊進入縮放模式
  - CharacterWindow 新增縮放模式 UI（可即時預覽、輸入數值或拖曳 slider）
  - 縮放自動 clamp 至螢幕可見範圍（`clampCharacterScaleForDisplay`）
  - 視窗最小尺寸保護（280×220 px）
  - IPC：`desktop:update-size`（確認儲存）、`desktop:preview-size`（即時預覽不存檔）
- [x] 輔助視窗位置 / 大小記憶
  - Input window 改為可調整大小（resizable），拖移後自動記憶 bounds
  - Log window 同樣記憶 bounds
  - 新增 `AppSettings.ui.inputWindowBounds` / `logWindowBounds` 欄位
  - `configureAuxWindowPersistence()` 負責連接存檔邏輯（防抖 250ms）
- [x] Persona / World Preset 系統
  - 世界觀和使用者設定從單一值改為多組預設組（`PersonaPreset` / `WorldPreset`）
  - 設定視窗「世界觀」「使用者」分頁加入下拉選單切換、新增、重新命名、刪除
  - 預設組獨立存檔於 `%APPDATA%\DesktopST\personas\` 和 `worlds\`
  - `AppSettings` 改用 `activePersonaId` / `activeWorldId` 指向啟用的組
  - 內建泛用預設（`assets/default-persona.json`、`assets/default-world.json`），首次啟動自動複製
  - 舊 settings.json 自動遷移（偵測到舊 `persona` / `worldSetting` 欄位時轉為 preset）
  - LLM prompt 組裝改為接收 preset 參數
  - DST 搬家包匯入／匯出配合新結構
  - App Icon 規格已說明（1024px PNG → .ico），AI 生成參考圖已放置
- [x] 便利貼系統（Pinned Notes）
  - 桌面可建立多張便利貼（PinnedNote），每張支援標題、內文、顏色、字型大小
  - 便利貼可拖曳、可調整大小（resizable），位置與尺寸持久化
  - 支援顏色選擇器（獨立 popup 視窗）
  - 隱藏（移入管理員）/ 還原（顯示在桌面）/ 刪除功能
  - 便利貼管理員視窗（`pinned-notes-manager`）列出所有便利貼
  - Tray 加入「開啟便利貼管理」選項
  - 資料存於 `%APPDATA%\DesktopST\pinned-notes.json`
- [x] 色彩主題系統
  - 介面設定分頁加入色彩主題選擇器（9 種：mint / butter / peach / aqua / sky / blush / lavender / white / dark）
  - 儲存於 `AppSettings.ui.colorTheme`
- [x] Emoji 選擇器
  - 輸入視窗加入 Emoji 按鈕，點擊彈出獨立 EmojiPickerWindow
  - 選擇後自動插入輸入框，位置記憶於 `AppSettings.ui.emojiPickerOffset`
- [x] 圖片附件 / 截圖
  - 輸入視窗支援多張圖片附件（檔案選取 + 拖曳投放）
  - 上限由 `AppSettings.llm.maxImagesPerMessage` 控制
  - 截圖功能：`desktop:capture-screenshot`（隱藏全部 DesktopST 視窗）/ `desktop:capture-screenshot-with-characters`（保留全部 DesktopST 視窗）
- [x] 角色翻轉（Mirror）
  - HoverMenu 加入翻轉按鈕，`desktop:update-flipped` 持久化
- [x] DST Pack 多角色包 & SillyTavern PNG 格式
  - 角色可匯出為嵌入卡片資料的 PNG（SillyTavern 格式相容）
  - DST Pack：多角色 + Persona/World Preset 打包匯出 / 匯入
  - `src/main/pngUtils.ts`、`src/main/stCardMapper.ts`、`src/main/dstPack.ts`
- [x] 對話記錄管理
  - 對話列表（載入、重命名、清除訊息、刪除整則對話）
  - 最後開啟的對話自動記憶（`AppSettings.ui.lastActiveConversationId`）
  - Log 視窗支援訊息刪除、編輯、情緒覆蓋、debug prompt 展開
- [x] LLM 多供應商 / 進階設定
  - 支援 4 個供應商：OpenAI、Claude（Anthropic）、Gemini（Google）、Grok（xAI）
  - 每個供應商獨立 API Key（`AppSettings.llm.apiKeys`）與模型（`AppSettings.llm.models`）
  - 支援自訂 endpoint（`AppSettings.llm.endpoint`）
  - 自動注入系統時間（`AppSettings.injectSystemTime`）
- [x] 資料夾搬遷
  - 設定視窗「資料」分頁可更改資料儲存路徑，自動搬移所有資料
  - `data:change-dir`、`data:get-relocate-summary` IPC
- [x] 系統托盤強化
  - 收起 / 重新開啟所有輔助視窗
  - 角色保持在最上層（always-on-top checkbox）
- [x] 提醒 / 定時發話
  - 主程序排程器 `src/main/reminderScheduler.ts`，管理 `setTimeout` 排程
  - 支援四種排程：`startup`（開機後 3 秒）/ `once`（一次性時間戳）/ `daily`（每天固定時間）/ `interval`（每 N 毫秒）
  - 觸發時呼叫 `character:force-speak`，可選擇指定角色或隨機桌面未靜音角色
  - `injectPinnedNotes` 開啟時，把 `visible: true` 便利貼標題+內文附入 prompt
  - 提醒管理視窗 `RemindersManagerWindow.tsx`（CRUD + 啟用/停用）
  - Tray 選單加入「管理提醒」入口
  - 資料存於 `%APPDATA%\DesktopST\reminders.json`
- [x] API Key safeStorage 加密
  - `src/main/secureStore.ts`：以 Electron `safeStorage`（Windows DPAPI）加解密
  - `fileStore.ts` 在讀取時解密、寫入時加密；前綴 `enc:v1:` 區分明文舊金鑰
  - 自動 migration：讀到未加密舊金鑰 → 加密並覆寫
  - `safeStorage` 不可用時 fallback 純文字並印警告
  - DST Pack 匯出排除 API Key，UI 提示換機需重新輸入
  - 設定視窗 API Key 欄位下方顯示本機加密說明
- [x] Spotify 音樂偵測
  - OAuth PKCE 授權流程（自訂 URI scheme `desktopst://spotify-callback`）
  - 使用者需自行申請 Spotify Developer App（Client ID）並授權個人帳號
  - 取得當前播放曲目、藝術家、發行年
  - 流派（genres）與曲風特徵（energy / valence）已移除：genres 兩次取樣皆回傳空陣列，
    audio-features 對本 app 已停用（實測一律 403）；連帶 `/v1/recommendations`、`/v1/browse/*`
    也已 404，故「角色自動選歌播放」不可行
  - 對話 system prompt 自動注入 `[Spotify: Now Playing] "曲名" — 藝術家` 格式字串
  - Token 自動刷新，Access Token / Refresh Token 以 `safeStorage` 加密存於 `spotify-auth.json`
  - Spotify 設定視窗（`spotify-settings`）：輸入 Client ID、OAuth 連線、斷線、顯示已連線帳號
  - 啟用開關位於全域設定 → 世界觀分頁
  - 相關欄位：`AppSettings.spotify`（`SpotifySettings` 介面）
  - 相關檔案：`src/main/spotifyService.ts`、`src/renderer/src/windows/SpotifySettingsWindow.tsx`
- [x] 多人桌面聊天與對話泡泡效能優化
  - 角色視窗不再接收完整 `conversation`；`store:get-all` 回傳 `characterContext` 精簡快照
  - `character:thinking` / `character:context-update` 改為單角色 IPC，不再 `broadcastToAll`
  - `broadcastConversationUpdate` 僅推送 log（完整）與 input（strip `debugPrompt` / 圖片 base64）
  - 思考中僅對當前回覆角色 `setCharacterThinking` + `setImmediate` 提升 Z-order
  - 對話泡泡視窗輕量初始化（`loadBubbleInit`，不載入 conversation / presets）
  - 泡泡同時顯示上限 = 桌上角色數；超過時 LRU 淘汰最舊泡泡 renderer，避免連點崩潰
  - 泡泡定位錨點 fallback、還原輔助視窗時重播 `bubble:show`、`bubble:hide` 狀態同步

- [x] 新聞陪聊模組（MVP 完成，分支 `feat/news-module`）
  - 掛在共用 **module host** 下的**可選模組**（中風險，可停用）；架構見 `docs/module-system-roadmap.md`
  - keyword / rss / json 三種來源；六層篩選；加權隨機抽一則；seenIds 去重；隱性回饋（+0.5 回話 / +0.2 釘主題 / +0.1 開原文 / −0.5 沒興趣）；一鍵重置
  - 興趣標籤 + 黑名單 UI（極簡）；地方新聞（多縣市）；破圈（Google Trends 台灣熱搜）；定時排程（選配，預設關）
  - 「說點什麼」注入；📌 後續聊天主題泡泡；↗新聞展開小卡；便利貼參考（survey 模式讓角色自選話題）；提醒 injectNews
  - 新聞陪聊模型可選（新聞設定 `replyModel`：主要 / 輔助，**預設主要**＝口吻優先，舊設定遷移為主要）；角色口吻保留個性，不壓平成通用 AI
  - 新聞發話指令（`trigger.ts` 各 builder）改英文以省 Token，輸出仍強制繁中；移除「滑手機」假設（改中性「剛得知一則消息」，相容無手機世界觀）
  - 完整 Prompt 檢視器（LogWindow）主要/輔助分頁各加路由凡例，標示哪些任務走哪個模型
  - 詳細 Prompt 只保留最近 N 則（`memory.keepDebugPromptN`，預設 5，記憶分頁可調）：`Message.hasDebugPrompt` 旗標決定是否顯示「查看完整 Prompt」；`fileStore.pruneConversationDebugPrompts` 在存檔/載入時剪枝，減輕 Log 載入
  - 進階構想（規格外，待討論）：角色卡關鍵字 / 關鍵字分組隨情境切換 → 見 `docs/news-future-keyword-groups.md`
  - 釘選主題只在「說點什麼」與「提醒」注入，**一般聊天不注入**（原始設計，非 bug）。
    owner 2026-08-03 認為一般聊天也該注入，否則失去釘選的意義 → 提案未實作，
    見 `docs/news-future-topic-in-chat.md`（注意：一般聊天要用**弱化的 directive**，
    照抄說點什麼那份會讓角色硬把話題扯回新聞）
  - ⚠️ 新聞設定最上方那排群組 chip 是**「編輯哪一組」**，不是「使用中的組」；
    聊天實際用哪組只看**情境**綁定（`activeScene.newsKeywordGroupId`），
    下方「個人新聞報要看哪些組」則只影響新聞報。三種語意擠在同一頁，
    owner 2026-08-03 實際誤判成 bug → UI 待調整（優先度中低），
    見 `docs/news-future-keyword-groups.md` §8
  - 標題主觀／情緒評分（規格外，已實作）：抽中新聞時用輔助模型輕量評分（0~5 分 + 簡短理由），只記錄到 LogWindow 新聞 debug 面板觀察、不參與篩選、不影響角色語氣；門檻值刻意不開放使用者調整 → 見 `docs/news-future-sensational-score.md`
- [x] 情境模組開關覆蓋（Scene Module Overrides）
  - `ScenePreset.moduleOverrides?: Record<string, 'on' | 'off'>`：每個情境對每個模組三態（強制開／強制關／無 key＝跟隨全域），例如 TRPG 情境關新聞天氣、留 Spotify 當 BGM
  - 覆蓋優先、不改寫全域設定：`isModuleEffectivelyEnabled()` / `applySceneModuleOverrides()`（`ipcHandlers.ts`），天氣 / Spotify / 系統時間用虛擬 id `desktopst.weather` / `desktopst.spotify` / `desktopst.systemTime`
  - 生效範圍：一般聊天、說點什麼（forceSpeakDirect）、提醒 injectNews / injectWeather、新聞定時發話、對話新聞搜尋、即時天氣查詢、外部模組 context provider（`collectModuleContext` 依模組 id 過濾，`activateModules` per-module 綁定 id）
  - 排除遠端遙控（基礎設施，不隨情境切換）；`scene:capture` 覆寫時保留 moduleOverrides（非桌面快照的一部分，比照 newsKeywordGroupId）
  - UI：情境卡片「模組開關」摺疊區（含外部模組，`modules:list` IPC）；擴充分頁與新聞分頁在被覆蓋時顯示「目前情境已覆蓋」提示
  - 舊情境檔零遷移（無欄位＝跟隨全域）
- [x] 訊息 emoji reaction
  - 對角色訊息可按 emoji（固定 6 顆：❤️ 👍 😂 🥺 😮 😒，單選、再按取消），存於 `Message.reaction`
  - 對話泡泡標題列（釘選旁）一顆笑臉按鈕，點開才展開表情列、選完自動收合；已按過的按鈕直接顯示該 emoji 當徽章（`bubble:show` payload 帶 `messageId` / `reaction`，還原重播與 `bubble:debug-show` 也支援）
  - Log 視窗：角色訊息 hover 出現笑臉按鈕展開 picker；已按的在泡泡右下角顯示小徽章（點徽章可更換／取消）
  - IPC `conversation:set-reaction`；下一輪 prompt 由 `expandReactionAnnotations()`（`chatWithLLM` 單一入口）插入英文標註讓角色接住，輸出照舊繁中
  - 😒 + 新聞訊息（`Message.newsLink`）＝主題沒興趣：prompt 措辭改「對這則新聞主題沒興趣」，並觸發新聞來源 −0.5 弱負向回饋（取消或換掉時 +0.5 補回）

- [x] 記憶摘要（自動＋手動）
  - 上下文只送最近 `memory.keepRecentN` 則（預設 20）；超出的舊訊息濃縮成 `conv.summary`，由 `chatWithLLM` 單一入口注入 `[Memory Summary]` 區塊（一般聊天、群組、說點什麼、提醒皆生效）
  - 自動摘要：未涵蓋訊息達 `memory.autoSummarizeAfter`（預設 50）時背景增量摘要（既有摘要＋新溢出訊息 → 新摘要，手動編輯內容會保留語意）；`memory.autoSummarizeEnabled` 可關（設定 → 記憶分頁）
  - 增量涵蓋點 `conv.summaryCoversTs`（timestamp 為準，訊息刪除不受影響）；訊息不會被移除，Log 保留全部
  - Log 視窗「記憶摘要」摺疊卡（對話名稱下方）：可編輯 textarea＋立即摘要／儲存／清除；訊息流在 keepRecentN 交界顯示「以上訊息已超出近期記憶」分隔線
  - 摘要走輔助模型（`applyUtilitySettings`），指令英文、輸出繁中；`src/main/llm/summarizer.ts`
  - IPC：`conversation:summarize-now` / `conversation:update-summary` / `conversation:clear-summary`
  - 訊息可「排除於記憶外」（`Message.excludeFromContext`）：Log 訊息 hover 眼睛按鈕切換，排除的訊息不進上下文（不佔 keepRecentN 名額，`contextMessages()` 共用 helper 統一過濾）、不被摘要收錄；UI 上半透明＋「已排除」徽章；IPC `conversation:set-message-excluded`；已被摘要涵蓋的內容需清除摘要重摘或手動編輯才會消失

- [x] 時間感知強化
  - `[Current time: YYYY-MM-DD HH:mm 時段]` 注入 trigger message（prompt 結尾、注意力最強處），修正深夜語境蓋過現在時間的問題；system prompt 的 `[System Time]` 僅提醒路徑保留（無 trigger），一般聊天不再重複注入（`omitSystemTime`）
  - 距最後一則訊息超過 1 小時，trigger 時間行附註 `(last message 14h ago)`
  - 歷史訊息相鄰間隔超過 1 小時，插入 `系統: (6h later)` 合成標註（`annotateTimeGaps()`，`chatWithLLM` 單一入口處理，比照 reaction 標註模式）
  - 全部走粗略取整（Nh / Nd），不逐則加時間戳以省 Token；trigger 時間行與斷層標註皆受 `injectSystemTime` 開關控制（關閉時 prompt 完全不含現實時間，TRPG／故事接龍場合適用）
  - 時間注入納入情境模組覆蓋（虛擬 id `desktopst.systemTime`）：情境可強制開／關，覆蓋經 `applySceneModuleOverrides()` 改寫 `injectSystemTime` 後傳入 `chatWithLLM`（一般聊天、群聊接龍、說點什麼、提醒皆生效）；世界觀分頁全域開關旁有被覆蓋提示

- [x] 手機版個人新聞報 ＋ 遠端同步修正
  - **同步修正**：手機 WS 重連後呼叫 `fetchState()` 對帳（鎖屏／切背景斷線期間的訊息不再漏掉）、
    `visibilitychange` 回前景重抓、`forceSpeakDirect` 補推 `thinking`（遠端按「說點什麼」原本完全沒回饋）、
    新增 `thinking-done` 推播 ＋ 90 秒逾時保險
  - **新聞報手機版**：header 📰 開圖層覆蓋；桌面的報紙分欄在手機改為分頁 chips（每欄一個分頁），
    支援換一批、單欄重抓、每欄則數、關鍵字組多選、欄位上下移（取代拖曳）、釘選、不看了、開原文
  - 「聊這個」在手機是插進**手機自己的輸入框**（桌面版是在桌機開發話視窗，兩邊語意相同但落點不同）
  - **釘選 / 不看了改為跨裝置共用**：從 renderer 的 localStorage 搬到主程序
    `modules/desktopst.news/reader-state.json`（`readerState.ts`），桌面與手機同一份；
    舊 localStorage 內容首次開窗自動搬移一次後清掉。
    顯示模式 / 目前分頁刻意**不**共用（UI 偏好，共用會讓桌機畫面被手機操作帶著跳）
  - 抓取邏輯抽到 `readerFetch.ts` 給 IPC 與 HTTP 共用；手機路由在 `mobileRoutes.ts`（`/api/news/reader/*`）
  - **順手修掉既有 bug**：`news:save-settings` 收到 partial 時會把其餘設定清成預設，
    導致在桌面新聞報拖欄位／改則數就清空關鍵字、黑名單、排程等；改為先讀現況再淺層合併
  - 詳見 `docs/news-reader-mobile-plan.md`

- [x] Google 日曆模組（唯讀）
  - 虛擬 module id `desktopst.calendar`，scope `calendar.readonly` ＋ `tasks.readonly`（皆唯讀）
  - **行程與「工作」是兩套 API**：日曆畫面上的工作（有「標示為完成」「○○的清單」）屬於
    Google Tasks，`calendar.readonly` 完全讀不到 → 必須另外啟用 Google Tasks API 並加 scope。
    Tasks 的 `due` 只保留日期（時間一律被截成當日 00:00Z），故待辦一律標成 `kind: 'task'`、
    不顯示時刻，注入格式為「今天 澆花（待辦）」；行程與待辦混排後依時間排序再套筆數上限。
    工作讀取失敗（未啟用 Tasks API 等）只是少一部分，不影響行程
  - **使用者自備 Client ID／密鑰**（同 Spotify 模式），程式碼內不含任何 ID
  - **回呼方式與 Spotify 不同**：Google 的「桌面應用程式」OAuth client 不接受自訂 URI scheme
    （`desktopst://` 只給 iOS／Android client），只允許 `http://127.0.0.1:<port>`。
    因此改為授權時臨時起一個 loopback HTTP server 收 code，收完立即關閉，
    **不動 `setAsDefaultProtocolClient` 與 `second-instance` 分派**。5 分鐘沒回呼自動收掉
  - Token（access／refresh）以 `safeStorage` 加密存於 `calendar-auth.json`；
    Client 密鑰以 `encrypt()` 加密後存在 settings，比照 CWA Key
  - **provider 介面**（`src/main/calendar/types.ts`）：`CalendarProvider` / `CalendarEvent` 皆與服務商無關，
    Google 端點與回應格式只存在於 `googleProvider.ts`；`index.ts` 的格式化與注入只吃 `CalendarEvent[]`
    → 手機版移植只需換一個 provider 實作
  - 注入格式 `[Calendar]` ＋「今天／明天／後天／M月D日 HH:mm–HH:mm 標題（地點）」；
    全天行程標「（整天）」；10 分鐘記憶體快取
  - 生效範圍：一般聊天、說點什麼、提醒（新增 `Reminder.injectCalendar`）
  - 情境模組覆蓋沿用既有機制（`applySceneModuleOverrides` 改寫 `calendar.enabled`）
  - **失敗一律靜默**：未啟用／未授權／token 換不到／離線／逾時皆回 `null`，聊天流程不中斷
  - 設定入口：設定 → 擴充 →「Google 日曆」，獨立視窗 `calendar-settings`
  - **日曆設定視窗內建「目前讀到的內容」區塊**（`calendar:peek` IPC）：略過快取直接查一次，
    顯示模組開關（含情境覆蓋提示）、往後時數、**實際會注入 prompt 的原文**。
    連結成功後自動查一次、改區間／筆數後自動重查 —— 設定完當場就能驗證，
    不必發訊息試探角色抓到什麼，也不花 token
  - 注入區塊開頭固定一句「這是使用者本人的行程與待辦，已確實取得，可以自然提起」：
    實測只給裸標籤 `[Calendar]` 時角色會把它當雜訊略過，被直接問還會否認讀得到
  - 教學：`docs/google-calendar-setup.html`（**只有 HTML 一份，刻意不留 .md 避免雙份維護**），
    設定視窗最上方「📖 開啟設定教學」
    一鍵開啟。走新增的 `shell:open-doc` IPC 讀**本機** `docs/`（`extraFiles` 已含），離線可看；
    檔名白名單、不接受路徑。**必須提醒使用者做「發布應用程式」**，否則測試中狀態的授權每 7 天失效
  - 相關檔案：`src/main/calendar/{types,googleProvider,index}.ts`、
    `src/renderer/src/windows/CalendarSettingsWindow.tsx`

- [x] **B1 抽出 `src/core/`（第一刀 ＋ 第二刀完成，其餘卡在 B2 的 adapter 介面）**
  - 純 TypeScript 層，**不得 import `electron` / `fs` / `path`，也不得反向 import `src/main/`**；
    儲存與網路一律走注入的 adapter。目的是防止桌面版與手機版邏輯 drift（roadmap §4.1）
  - 已搬：`types.ts`、`llm/promptUtils.ts`（皆逐字相同的檔案位移）＋
    `ipcHandlers.ts` 279–488 行那批群組聊天純函式
  - 檔案配置：`core/{types,character}.ts`、
    `core/prompt/{promptUtils,dialogue,randomResult,systemTime}.ts`、
    `core/group/{responders,dialogueCleanup}.ts`、`core/util/{text,json}.ts`
  - **改過簽名的只有兩個**（原本偷讀模組層變數）：
    `sortRespondersByKeywordMatch(ids, message, getCharacter)`、
    `stripOtherCharacterSpeakerLines(text, selfCharId, characters)`
  - **`src/main/types.ts` 與 `src/main/llm/promptUtils.ts` 現在是 re-export 轉出檔**，
    既有 import 路徑全部不變。**新增檔案請直接 import `core/`，不要再走轉出檔**
  - 中文字串規則：**送進 LLM prompt 的中文可留在 `core/prompt/`（檔頭有註明），
    UI 文案一律不得進 core**（roadmap §3.3 例外條款，owner 2026-08-02 拍板）
  - `tsconfig.node.json` 的 `include` 已加 `src/core`
  - **第二刀已完成（2026-08-03，`4781e6f`..`641932f`，五個小 commit）**，
    原列的三塊已全數進 core，**全部逐字相同、零簽名變更**：
    `core/card/stCardMapper.ts`、`core/news/types.ts`、`core/news/keywordGroups.ts`
    （`DEFAULT_KEYWORD_GROUP_ID` / `effectiveGroupId` / `keywordSourceInGroup` /
    `keywordSourceInReaderGroups` / `weightToValue`）、`core/news/filter.ts`、
    `core/news/topicState.ts`。五個原路徑一律 re-export 轉出檔，既有 import 一行未改
  - `modules/news/settings.ts` 的 **load/save/normalize 留在 `main/`**（走檔案存取），
    只搬走上述 5 個純項目；`topicState` **設計零改動**（process 級單例，
    前提是同一 process 內不會有多個 DeST 實例，owner 2026-08-03 確認）
  - ~~⚠️ 已知重複實作~~ ✅ **已解**（B2）：`src/renderer/src/modules/news/types.ts`
    改為薄轉出檔指向 `@core/news/`，既有 import 路徑一行未改；前端專屬的
    `NewsPreviewItem` / `NewsPreviewResult` 與 UI 文案 `WEIGHT_LABELS` 等留在原檔
  - ✅ **B1 收尾完成（2026-08-03）**，四塊全數搬完，所有呼叫端一行未改：
    - `core/llm/{index,openai,claude,gemini}.ts`：主流程 ＋ 四家 provider。
      改動只有加 `deps` 參數、SDK 注入 fetch、圖片本機路徑移出、錯誤代碼化，
      其餘逐字沿用（已逐檔 diff 核對）。`main/llm/index.ts` 從 368 行縮成 68 行外殼
    - `core/llm/summarizer.ts`：只多一個 `deps`（diff 三行）
    - `core/news/trigger.ts`：新聞發話的**全部措辭**，prompt 字串逐字相同；
      `markNewsSeen` 改純函式（算出新設定不存檔，存檔留 main）
    - `core/reminder/nextFire.ts`：下次觸發時刻計算（daily／weekly／interval），
      可注入 `now`。與搬移前在 20000 個隨機時刻上逐一比對，結果完全相同
  - **圖片：`fs` 怎麼離開 `llm/`** —— provider 原本各自 `fs.readFileSync`。
    改成平台層呼叫前先轉 data URI（`main/llm/imageResolver.ts`），
    core 只認得 `data:` 與 `http(s):`。實務上使用者的圖一律已是 data URI，
    那支通常一個檔案都不會讀。⚠️ 它必須**複製**而非就地修改 params，
    否則會把 base64 寫進記憶體裡的對話物件
  - **兩個搬移中才發現的問題**（紙上設計不會發現）：
    - `HttpAdapter.fetch` 原本收窄成 `(input: string, ...)` 是錯的，
      SDK 內部會傳 `Request` 進來 → 已改 `typeof globalThis.fetch`
    - `@google/generative-ai` v0.21 **沒有 fetch 選項**，直接用全域 `fetch`。
      Gemini 手機端要靠 Capacitor 全域 fetch patch 繞 CORS，不是靠注入
  - **蓄意留在 `main/`（不是漏做）**：`modules/news/sources.ts`
    （用了 `crypto.createHash` ＋ `rss-parser`，手機端替代方案是 **B4** 的決定）、
    `news/settings.ts` 的 load/save、`reminderScheduler` 的 setTimeout／存檔／
    `powerMonitor`、`llm/imageResolver.ts`

- [x] **B2 Capacitor 骨架 ＋ 五個 adapter 介面（分支 `feat/mobile-standalone`）**
  - **產出是介面，不是跑起來的手機 app**。`src/core/adapters/`（純型別）＋
    `src/main/adapters/`（桌面實作，包裝既有能力、沒重寫任何邏輯）。
    桌面實作**目前無呼叫端**，是並行路徑，桌面版行為零改動
  - 五個介面：`StorageAdapter`（＋手機不實作的 `SyncStorageAdapter`）、
    `SecretAdapter`、`HttpAdapter`、`SchedulerAdapter`、`NotifierAdapter`
  - **設計決定見 roadmap §4.4b，照著走不要重新發明。** 最關鍵的兩條：
    - 四家 LLM 走的是**官方 SDK 不是裸 HTTP**（roadmap §4.4 原本寫錯），
      故 HTTP 介面做成 **`fetch` 同形**，把 adapter 注入 SDK 即可，
      不必為跨平台重寫四家的請求對映；日後要拿掉 SDK 也不用改介面
    - `HttpAdapter.supportsStreaming` 旗標容納 Capacitor 串流支援不佳（§4.3）：
      **串流是加分項不是前提**，呼叫端先問旗標，false 走非串流路徑，不可當錯誤
  - 其餘：儲存 key 是平台無關相對路徑（core 不認識絕對路徑）；二進位一律
    `Uint8Array` 不用 `Buffer`；儲存留同步版給既有桌面路徑沿用（手機端不實作）；
    金鑰維持同步（改非同步會擴散到整條存檔鏈）
  - **兩個新的落地慣例**：core 拋**錯誤代碼**、平台層翻成中文文案
    （`PngCardError` + `toUserFacingError`）；core 收「已讀好的資料」，
    **不要讓 core 自己讀檔**（`pngCard` 就不需要 `StorageAdapter`）
  - 順手搬完 `pngUtils`（當介面試金石）：`core/card/pngCard.ts` ＋
    `core/util/base64.ts`（自寫——`Buffer` 是 Node 專屬，`atob`/`btoa` 型別
    不在 `lib: ES2022` 裡，而 core 要被兩套 tsconfig 編譯）。
    base64 已與 Node `Buffer` 逐位元組比對驗過
  - **前端吃 core 已解決**：`tsconfig.json` 加 `src/core` 與 `@core/*`、
    `electron.vite.config.ts` renderer alias 加 `@core`。手機 UI（B3）走同一套。
    core 在 web tsconfig（無 `@types/node`）下編得過 ＝ 零 Node 依賴的硬證明
  - Capacitor：`capacitor.config.ts`（`appId` = `tw.nori.dest`，發布後不可改）、
    `src/mobile/README.md`。`@capacitor/*` 放 **devDependencies**，
    否則會被 electron-builder 打進 `.exe`
  - **刻意沒做**：`npx cap add android`（還沒有 `webDir`，生成的原生樹會過時，
    等 B3 能 build 出 `out/mobile` 再說）、簽章 keystore（owner 未決定，
    **不要自行產一把**）、預裝 Filesystem／LocalNotifications 等外掛（用到再裝）
- [x] **B2.7 `fileStore` 邏輯抽 core（2026-08-03）**
  - **形狀：core 完全不碰 I/O**（owner 拍板的選項 C）。`core/store/` 只做「資料進、資料出」，
    檔案由平台層讀好後傳進來、該回寫什麼由回傳值告知。
    **同步／非同步的難題因此直接消失** —— 純函式沒有同步非同步之分，
    桌面照舊同步、手機照舊非同步，兩邊呼叫同一份核心邏輯。
    `SyncStorageAdapter` 維持原用途，不必為了跨平台把桌面存檔鏈改成非同步
  - 進 core：`store/normalize.ts`（模型 id 改名對照、`isPinnedNote`）、
    `store/prune.ts`（debug prompt 剪枝）、`store/migrate.ts`（舊 `persona`／`worldSetting`
    欄位遷移，**改成純函式：回傳待建 preset、不再自己存檔**）、
    `store/settings.ts`（`hydrateSettings` ＋ `toPersistedSettings`：`DEFAULT_SETTINGS`
    深層合併、金鑰加解密編排、`needsResave` 判定）、`store/keys.ts`（檔案佈局的單一真相）
  - `fileStore.ts` 989 → 777 行；**所有對外簽名一行未改**，`ipcHandlers.ts` 那 144 處零改動
  - **兩個為了守住約束而做的小改寫**：preset 名稱與暱稱預設值（「我的設定」「主人」等）
    改由平台層以 `MIGRATE_LABELS` 傳入（core 不寫死中文，roadmap §3.3）；
    金鑰改收 `SecretAdapter`（`electronSecrets`，加解密邏輯零改動）
  - ⚠️ `fileStore` 引用 `SecretAdapter` 必須**直接指到 `./adapters/secretAdapter`**，
    不可走 `adapters/index` —— index 會拉進 `storageAdapter`，而那支 import 本檔 → 循環
  - **蓄意不搬（桌面平台行為，非業務邏輯）**：`relocateDataDir`、`getPathSizeBytes`、
    `getDataDirSummary`、`initDefaultCharacters`／`initDefaultPresets`（吃 `appRoot` 與
    dstpack 解壓）、全部 debounce 計時器、`_scenesCache`
  - **仍未解**：`StorageAdapter` 的呼叫端依然是 0。要接上得先反轉
    `storageAdapter → fileStore` 的依賴方向，那超出 B2.7 範圍 → 留給 B3
  - 驗證：新增**設定載入全等比對**（`scripts/settings-hydration-harness.ts`，
    用法見 `scripts/README-settings-hydration.md`）。18 個人造樣本，
    **golden 產自重構前的 `7f5ef7b`**，重構後逐字比對零差異；
    反向驗證改壞一行只抓到該樣本、不誤報。prompt 全等 48/48 亦維持零差異
- [x] **APK 試打（2026-08-03，實機 Pixel 10a／Android 17）** → 詳見 `docs/pre-b3-work-assessment.md` §5.1
  - Capacitor 殼、`cap add android`、Gradle 建置、裝機、執行**全線打通**（APK 4.2 MB）
  - **Gemini 靠 Capacitor 全域 fetch patch 繞 CORS：實機證實可行**
    （不帶金鑰打 endpoint 收到 **403** ＝ 請求真的到了 Google；被 CORS 擋會是 `TypeError`、
    連狀態碼都拿不到 —— 兩者必須分清楚）。需 `capacitor.config.ts` 開
    `plugins.CapacitorHttp.enabled`
  - ⚠️ **`rss-parser` 不能直接 import**：預設進入點 require Node 的
    `http`／`https`／`url`／`events`／`timers`，打包給瀏覽器會五個錯誤全開。
    改用套件自帶的 `rss-parser/dist/rss-parser.min.js`（UMD，`window.RSSParser`）即可；
    `DOMParser` 備案實測結果相同，**這項有兩條路不會卡死**
  - ⚠️ **Android Studio 內建 JDK 太新，Gradle 不吃**：Studio 附 JDK 25，
    Capacitor 8 的專案用 Gradle 8.14.3（上限 Java 24）→ `Unsupported class file major version 69`。
    解法是另裝 **Temurin JDK 21** 專給 Gradle 用（`winget install --id EclipseAdoptium.Temurin.21.JDK`），
    **不要動 Studio 自己那份**。每次 Studio 大改版都可能再撞一次
  - 探針原始碼 `src/mobile/smoketest/`（一次性驗證，非產品程式碼）。
    結果讀取走 `adb forward` ＋ WebView devtools socket（CDP 取 `innerText`），不必人工看螢幕
  - **仍未解**：`sources.ts` 的 `crypto.createHash` 要換純 JS hash 才能進 core
- [x] **`mobile.html` 功能對照清單（2026-08-03）** → `docs/mobile-html-feature-inventory.md`
  - B3 的**範圍定義**：49 項獨立版必做、15 項遙控專屬，每項標了行號／分類／依賴
  - **Owner 2026-08-04 四題定案**：①手機「角色管理」＝「這次對話誰在場」（UI 用語），
    同步時對應桌面角色清單，**桌面端缺位置資訊自行產生**（位置是桌面獨有顯示狀態，不進同步）；
    ②截圖「加入對話」歸遙控模組，獨立模式不做手機自身截圖（相簿選圖已涵蓋）；
    ③獨立／遙控走**同一個「事件來源」介面**，UI 不知道差別；
    ④**編輯功能全部進 B3** —— 情境／Persona／World 預設組 ＋ **角色庫與角色卡編輯**
  - ⚠️ **B3 階段 0（不含任何 UI）必做三件事**，晚做的成本是「拆掉重寫」而非「慢一點」：
    事件來源抽象、`StorageAdapter` 呼叫端接上（要先反轉 `storageAdapter → fileStore` 依賴方向）、
    隨機工具搬 core
  - ⚠️ **既有 drift 實例**：新聞分欄寫了兩份（`mobile.html` 的 `nrGroupByKeyword`
    vs 桌面 `groupNewsItems`），隨手機 UI 改 React 自然解掉。
    隨機工具那份 ✅ 已解，見下條
  - B3 估時因決議 ④ 上修為 **8–12 週**；但 owner 明示**時間非限制條件**，
    取捨一律選「架構漂亮、好維護」
- [x] **隨機工具搬進 `core/`（2026-08-04）**
  - 原本**三份實作且機率已長歪**：御神籤與擲筊在桌面、`mobileServer`、`mobile.html`
    三處的權重互不相同（對照表見 `docs/mobile-html-feature-inventory.md` §4）
  - 配置：`core/random/dice.ts`（`computeRandomResult` / `diceNotation` /
    `modifierString` / `keptRolls` / `sanitizePendingRandomTool`）＋
    `core/prompt/randomTokens.ts`（`makeTokenString` / `hasRandomTokens` /
    `expandRandomTokens`，含 token 正則與展開文字）
  - **以桌面版那份為準逐字沿用**；`renderer/utils/randomTools.ts` 改為轉出檔
    ＋ 保留三支 UI 文案（`getToolEmoji` / `formatPendingLabel` /
    `formatResultBadgeText`，依 §3.3 不得進 core）。既有 import 路徑一行未改
  - **兩條分界線**：token 字串放 `core/prompt/`（是**訊息內容**，適用 §3.3 例外）；
    籤詩等第／筊象／正反面留 `core/random/`（是 `RandomResult` 的**資料值**，
    會存檔與進 prompt，不是介面語言）
  - HTTP 端點的參數夾擠獨立成 `sanitizePendingRandomTool()`，在信任邊界呼叫；
    `computeRandomResult` 本身不夾（否則桌面與手機行為難以推理）
  - ⚠️ **唯一的行為改變**：`mobile.html` 擲筊 50/25/25 → 40/30/30（與桌面對齊）。
    `/api/random` 端點零呼叫端，故該處改動無感
  - ⚠️ `mobile.html` 那份**蓄意保留**（純 vanilla、無建置步驟、不能 import TS），
    已加註解：**改 core 的機率表要同步過去**。B6 整份取代後自然消失
  - 驗證：新舊實作吃同一串偽亂數比對，**3,819 項零差異**（一次性，未保留成常設測試）
- [ ] **手機獨立版與平台擴充** → `docs/multi-device-platform-roadmap.md`
  - ⚠️ **下一步不是 B3。** 2026-08-03 盤點發現規劃缺一塊、且 B1／B2 尚未實機驗證
    → **先讀 `docs/pre-b3-work-assessment.md`**（含測試策略：哪些能自動測、
    哪些只能 owner 手動測）。順序：~~驗證合併~~ ✅ → ~~APK 試打~~ ✅ →
    ~~B2.7 `fileStore` 抽 core~~ ✅ → ~~`mobile.html` 對照清單~~ ✅（2026-08-03）→
    **B2.5 Lorebook core（下一步）** → B2.6 → B3
  - **B2.7 是新增項目**：`fileStore` 989 行、128 處 `fs`，內含設定遷移等真邏輯；
    五個 adapter 目前只有 HTTP 有呼叫端，**儲存／金鑰／排程／通知零呼叫端**。
    不抽的話 B3 會在手機端重寫一份 → 最核心資料的 drift
  - **定位修正**：DeST 從「桌寵程式」擴張為「AI 角色聊天平台，有桌寵版與手機版」。
    目標客群的路徑（卿卿我我 → SillyTavern → DeST）起點在手機，一般使用者不見得有電腦
    → **手機獨立版是主線，不是進階選項**
  - 手機獨立版範圍：自訂角色、聊天（單張主圖免表情差分）、傳圖、自動總結、群組聊天、
    新聞、天氣、條件式主動提醒 + Google Calendar。**不做**桌寵視窗、遙控、截圖
  - **功能基準線（硬性）**：手機獨立版必須具備現行行動網頁版 `assets/mobile.html` 的全部功能
    （含隨機工具：御神籤／擲筊／硬幣／骰子），扣除遙控專屬項目
  - **關鍵路徑：抽出 `src/core/`**（純 TS、零 Node/Electron、儲存與網路走 adapter）。
    桌面注入 Electron adapter、手機注入 Capacitor adapter。不抽就會 drift
  - **手機 UI 只寫一份**（React），資料來源可抽換：本機 core（獨立模式）／遠端 relay API
    （遙控模式）。散布為 APK ＋ mobileServer 提供的網頁。
    **掃 QR 開網頁連電腦的方式永久保留、不得移除**（唯一不挑裝置的入口，iOS／平板／他人手機皆可）；
    被取代的只是 `mobile.html` 那 3,290 行 vanilla 實作，換成同一份 React UI 的 web build
    → 網頁版與 APK 是同一份原始碼，功能結構性同步，drift 不可能發生
  - 網頁版**無法**做獨立模式（網頁由電腦提供，電腦沒開就連不上）＝拓樸限制，非取捨。
    要獨立運作就裝 APK。**已知缺口：沒有電腦的 iOS 使用者目前無解**
  - **資料同步走點對點（手機↔自己的電腦），不是雲端**：S1 掃 QR 初始化匯入（單向一次性）→
    S2 手動雙向同步（推送／拉取／合併＋差異預覽）→ S3 自動同步暫不做（靜默出錯風險）。
    否決的是「雲端後端」，不是同步本身
  - **API Key 僅在區網直連時傳輸**，由電腦端檢查來源 IP 判定（不可信任手機端自稱），
    UI 直接顯示連線狀態不要求使用者判斷，不提供覆寫選項；且永不參與雙向同步
  - 遙控功能要保留在手機獨立版中（owner 之後的唯一入口），但為**可選模組、預設關閉**
  - 順序：A1 Google Calendar 模組（3–5 天，可立即開工）→
    B1 抽 core（3–5 週）→ B2–B5 手機獨立版（合計約 3–4 個月）→
    C 進階（host/client、macOS、WoL，隨時可插隊但不擋 B）
  - **公開版四大目標**（設計約束）：單機可完整運作／不需付費給作者／敏感資料不放第三方
    （relay 為例外，須揭露並提供自架 Tunnel）／新手三步上手（分層規則見文件 §2）
  - **在地化**：台灣取向為主，不導入 i18n。但兩條低成本約束要遵守——
    天氣／新聞來源走 provider 介面（別把 CWA 寫死在呼叫端）、`core/` 不寫死中文文案
  - **iOS**：目前不做。無等同 APK 的免費途徑（AltStore 7 天過期、DMA 僅限歐盟），
    實際只有 TestFlight 或正式上架兩條路，皆需 $99/年 ＋ macOS 建置環境
  - **已否決不要重提**：雲端同步後端、RTC 半夜喚醒、Relay 代排程、React Native、
    NAS 當 host（armv7 無 Electron 建置）、付費模式（理由見文件 §8）

**提案中、尚未實作：**
- **角色對使用者的印象（自動記憶）** → `docs/future-character-impression.md`
  - 定位是「這個角色從相處中認識的我」，**不是** ChatGPT 式的全域使用者記憶；
    與 Persona（我希望每個角色都知道的我）分工
  - 記錄鍵是**角色 × Persona 兩個一起**（換 Persona 等於換一個「我」，關係分開算），
    惰性建立、存 `impressions.json`，**不加欄位到角色卡**（私人資料不該隨卡片外流）
  - 這把鍵順帶解掉「TRPG 劇情被記成現實」：`ScenePreset.activePersonaId` 是必填，
    **切情境必然切 Persona** → TRPG 印象天然存在另一把鍵底下，不會污染日常
  - 必須可全域開關 ＋ 可看可編可刪（owner 明確要求）；TRPG 情境**也保留**此功能
  - 追加規格：**角色對「角色」的印象**（鍵是觀察者 × 被觀察者 × Persona，
    手動觸發、只生成勾選的角色、產出可編輯），見該文件 §3.4。**不能單獨插隊**，
    地基與主功能共用
  - ~~時機：等 `core/` 抽乾淨後再做~~ → **`core/` 已於 2026-08-03 抽乾淨，該等待理由消失**。
    但 owner 決議**仍排在 B3 之後（B8）**：它是 LLM 自動寫入、驗收靠手感、會持續花 token，
    不宜與 B3（4–8 週）同時點火。理由見 `docs/pre-b3-work-assessment.md` §4

**已排程、尚未實作：**
- **Lorebook（用語解說）** → `docs/future-lorebook.md`（規格已定案，無待決事項）。
  排程 B2.5（core，擋 B3）／B2.6（桌面 UI）。**2026-08-03 owner 決議要做**，
  不再屬於「第一版排除」
- **角色對使用者／角色對角色的印象** → `docs/future-character-impression.md`。
  排程 **B8（B3 之後）**，owner 2026-08-03 決議完全延後、連型別都不先定
  （理由見 `docs/pre-b3-work-assessment.md` §8）

**尚未實作（第一版排除）：**
- TTS（文字轉語音）
- Live2D
- SillyTavern 對話記錄匯入

詳細開發階段見規格書 §11。
