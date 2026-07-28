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
- 第一版不實作：Lorebook、自動發話、TTS、Live2D、ST 對話記錄匯入
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

**尚未實作（第一版排除）：**
- Lorebook
- TTS（文字轉語音）
- Live2D
- SillyTavern 對話記錄匯入

詳細開發階段見規格書 §11。
