# DeST 開發進度詳細記錄

這份文件是 `CLAUDE.md`「目前進度」的完整版——每項完成功能的實作細節、
設計取捨、踩過的坑，全部原文保留在這裡，只是**不再每次對話都自動載入**。

**一般開工不需要讀這份**。CLAUDE.md 的精簡清單已經夠用；只有在你要動到
某個舊功能、想知道當初為什麼這樣設計、或懷疑自己正在重踩一個已知的坑時，
才用 Grep／Read 來查這份文件裡對應的段落。

---

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
  - ~~**仍未解**：`StorageAdapter` 的呼叫端依然是 0~~ → ✅ **已解**，見下方 B3 階段 0 第一項
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
    ~~事件來源抽象~~ ✅、~~`StorageAdapter` 呼叫端接上~~ ✅（皆 2026-08-04）、
    ~~隨機工具搬 core~~ ✅ —— **階段 0 三件事全數完成，可以開分支寫手機 UI 了**
  - ⚠️ **既有 drift 實例**：新聞分欄寫了兩份（`mobile.html` 的 `nrGroupByKeyword`
    vs 桌面 `groupNewsItems`），隨手機 UI 改 React 自然解掉。
    隨機工具那份 ✅ 已解，見下條
  - B3 估時因決議 ④ 上修為 **8–12 週**；但 owner 明示**時間非限制條件**，
    取捨一律選「架構漂亮、好維護」
- [x] **自動測試導入（vitest，2026-08-04）** → `tests/README.md`
  - **149 項測試、7 個檔案**，只測 `src/core/`（純函式層）。`npm test` ／ `npm run test:watch`
  - 涵蓋 `pre-b3-work-assessment.md` §6.2 的第 1、2、3、5、6、7、8 項：
    prompt 組裝（快照）、群組接龍、新聞六層篩選與加權抽選、隨機工具、
    ST 角色卡往返、PNG 卡嵌入取出、base64、提醒觸發時刻
  - **還沒補**：`store/`（設定遷移）、`summarizer` 的訊息挑選、`news/trigger` 六個 builder。
    這幾塊有既有 harness 當替代驗證，不是零防護
  - 兩條硬規則：**不准依賴當下時間與亂數**（時間用 `vi.setSystemTime`，
    亂數用 `fixtures.ts` 的 `makeSeededRandom`）；**測試紅了先確認是程式錯還是測試寫錯**
    —— 導入時有四次是後者
  - 反向驗證過：故意改壞擲筊權重 → 精準抓到 1 項；改壞 trigger 措辭 → 精準抓到 3 項，皆不誤報
  - ✅ **順帶撞出並修掉一個既有 bug**（非重構造成，由自動測試發現）：
    `nextIntervalMs` 在沒有 `lastTriggeredAt` 時（＝剛建立的 interval 提醒）
    把「已經過的時間」當成一整個間隔 → 夾成 `MIN_INTERVAL_MS`，
    「每 N 小時提醒」設好後**第一次是 1 分鐘後就跳**。
    owner 2026-08-04 決議修正為字面語意（`elapsed` 改取 0），已加迴歸測試
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
- [x] **B2.5 Lorebook core（2026-08-04）** → `src/core/lore/`，規格 `docs/future-lorebook.md`
  - **純函式、零 I/O、目前零呼叫端**（B2.6 桌面 UI 才會接上）。做的是**用語解說子集**，
    不是完整 ST World Info：`recursive_scanning`、`position` / `depth`、真 tokenizer 一律不做
  - 五個檔：`types.ts`（`LoreEntry` / `Lorebook` / `LoreError`）、
    `scan.ts`（`buildScanText` / `matchesEntry` / `selectLoreEntries` / `resolveScanDepth`）、
    `format.ts`（`formatLoreBlock` → `[Glossary]`）、
    `resolve.ts`（`resolveLorebookIds` / `orderLorebooks`）、
    `stLorebook.ts`（`importStLorebook` / `exportStLorebook` / `extractCharacterBook`）
  - 型別欄位已定案（B3 手機 UI 要接的就是這幾個）：`Character.lorebookIds?`、
    `WorldPreset.lorebookIds?`（皆**疊加**，角色卡排前面）、
    `ScenePreset.lorebookIds?`（**取代式**，空陣列＝這情境一本都不用）。
    儲存 key `lorebooks/<id>.json`（`core/store/keys.ts`），`DATA_SUBDIRS` 已加
  - ⚠️ **掃描文字必須用 `contextMessages()` 的結果**（規格 §6.2）：
    否則會出現「已被摘要吃掉的舊訊息還在觸發 lore」—— 角色手上沒那段對話卻收到術語解說。
    `buildScanText` 收的是已過濾的內容，過濾本身留在平台層
  - ⚠️ **`[Glossary]` 不是 `[Lore]`**（規格 §5.4 已定案）：前者讓模型被動查閱、
    後者會讓模型主動科普使用者自己的設定，日常閒聊很煩。**沒有任何條目時回空字串**，
    連空標籤都不出現（§6.1 新手不受影響）
  - 裁切語意沿用 ST：`insertion_order` 管**順序**、`priority` 管**超預算先砍誰**（低的先砍，
    未設＝100）。預算是**字元數近似非真 token**；多本書取**最大**的 `token_budget`，
    小上限不連坐砍掉別本
  - ST 未實作欄位一律進 `_passthrough`（條目層與書層各一份），匯出原樣吐回 →
    ST → DeST → ST 不掉資料。**唯二例外**：`enabled` / `constant` 有明確預設值，匯出一律寫明
  - core 不生亂數也不讀時間：`importStLorebook` 的 `id` / `now` / `makeEntryId` 全部由呼叫端注入
  - **手動預覽工具** `scripts/lore-preview.ts`（用法見 `scripts/README-lore-preview.md`）：
    改一個 JSON 就能看見「哪些條目被觸發、為什麼、實際注入 prompt 的逐字內容」。
    core 零呼叫端期間唯一能親眼驗證的方式；B2.6 接上 UI 後由設定視窗取代
  - 測試 `tests/lore/`（**57 項**，總數 149 → 206）。反向驗證過兩次（改標籤 → 抓到 3 項；
    改裁切方向 → 抓到 2 項），皆不誤報
  - **B2.6 待辦**（本次刻意不做）：世界觀分頁編輯器、情境綁定 UI、ST `.json` ／
    `character_book` 匯入匯出接線、角色卡自動生成條目（規格 §8）、
    `applySceneModuleOverrides()` 加 `desktopst.lorebook`（`LORE_MODULE_ID` 常數已備好）、
    DST Pack 匯出勾選框（規格 §7.3，預設不勾）
- [x] **B2.6 Lorebook 桌面 UI（2026-08-04）** —— B2.5 的 core 正式接上呼叫端
  - **注入**：`ChatLLMParams.loreBlock` → `buildSystemPrompt()` 的 CONTEXT 區塊，
    `[World]` 之後、`[Scene]` 之前（規格 §5.3，走 CONTEXT 不走 `extraSystemContext`）。
    生效於**一般聊天（主要＋接話角色）、說點什麼、群組接龍、提醒**；新聞發話與摘要不注入（§6.5）
  - ⚠️ 掃描文字一律由 `buildLoreBlockFor()`（`ipcHandlers.ts`）用**該路徑的
    `contextMessages()` 結果**組出來（§6.2），不是完整 `messages`；`conv.summary` 也納入掃描
  - ⚠️ **`DEFAULT_SCAN_DEPTH` 改為 `0` ＝ 跟隨上下文**（owner 2026-08-04 拍板）。
    原本照抄 ST 的 5，但 `keepRecentN` 是 20 → 第 6～20 則**明明在 prompt 裡、模型讀得到，
    卻不觸發解說**，角色對同一個詞會忽懂忽不懂。這是 §6.2 那個 bug 的鏡像版：
    §6.2 管上限（別掃模型看不到的），這條管下限（模型看得到的都要掃）。
    `resolveScanDepth` 因此改成**「跟隨上下文」優先**——任一本是 0 就整體是 0，
    不讓一本書的小視窗連坐縮掉別本（比照 `token_budget` 取最大的邏輯）
  - ST 匯入的書若原檔有寫 `scan_depth` 就照它的值（相容）；匯出時 `scan_depth <= 0`
    **整個欄位不輸出**——ST 那邊 `0` 會被讀成「不掃描」，語意剛好相反
  - `core/lore/normalize.ts`：B2.6 開發期間自建的書寫死了 `scan_depth: 5`，
    載入時正規化回 `0`。只動 `_passthrough` 為空的書（ST 匯入的幾乎都會帶未知欄位），
    判斷不到 100% 精準但誤判方向是放寬，與新預設一致
  - **零設定零影響**：沒建立任何一本時 `loreBlock` 是 undefined，prompt 逐字不變 ——
    已加迴歸測試（`tests/prompt/promptUtils.test.ts`，與無參數版本全等比對）
  - **儲存**：`fileStore.loadLorebooks/loadLorebook/saveLorebook/deleteLorebook`
    （`lorebooks/<id>.json`，讀取失敗靜默略過該本）。刪除一本時會一併清掉
    角色卡／世界觀／情境上的參照，不留下指向不存在的 id
  - ⚠️ **注入行帶詞頭**：`詞（別名、別名）：解說`（`formatLoreLine`）。UI 把「關鍵字」與
    「內容」分兩欄，使用者很自然會把內容寫成不含主詞的補語（「就是你們身處的那個程式」），
    只丟 `content` 進 prompt 模型無從得知這句在解釋哪個詞 —— owner 2026-08-04 實測發現。
    ST 靠使用者自己把詞名寫進 content 才不需要這層，故**內容已以該詞開頭時不重複加詞頭**
  - **UI**：設定 → 世界觀分頁底下「用語解說」摺疊區（`components/LorebookSection.tsx`）。
    條目**只暴露四個欄位**：關鍵字 chip／內容／常駐／啟用（§7.1）；
    關鍵字與常駐兩處的說明文字照規格 §7.2 寫死，常駐那段把 §6.2 的掃描深度限制講明
  - ⚠️ **「使用哪幾本」與「編輯哪一本」是兩個分開的區塊**，不可合併：初版把綁定做成
    「編輯中那本」旁邊的一個 checkbox，owner 2026-08-04 立刻誤以為只能綁一本 ——
    與 `docs/news-future-keyword-groups.md` §8 那個 chip 被誤讀成「使用中的組」是同一種坑。
    綁定一律是**全部書的複選清單**（世界觀、角色卡、情境三處皆然）
  - **情境**：`ScenePreset.lorebookIds`（取代式，情境卡片摺疊區多選）＋
    模組開關列 `desktopst.lorebook`；`scene:capture` 覆寫時保留這兩個欄位
  - ⚠️ **`desktopst.lorebook` 蓄意不進 `applySceneModuleOverrides()`**：
    settings 裡沒有對應的 enabled 旗標可改寫，直接在 `buildLoreBlockFor()` 問
    `isModuleEffectivelyEnabled()` 即可（該函式的註解已寫明理由）
  - **ST 匯入匯出**：`lorebook:import-st` / `lorebook:export-st`（獨立 `.json`，
    也吃包著 `character_book` 的角色卡）；角色卡匯入（PNG ／ JSON 兩條路徑）時
    `attachCharacterBookOnImport()` 自動撈 `character_book` 另存一本並掛到該角色，失敗不擋匯入
  - **DST Pack**：匯出對話框多一個「包含用語解說」勾選框，**預設不勾**（§7.3，私人資料）；
    勾選時只帶這些角色與當前世界觀實際掛到的那幾本。匯入時**同 id 不覆蓋**本機既有版本
  - **角色卡自動生成條目（§8）**：`core/lore/generate.ts`（輔助模型、指令英文輸出繁中、
    LLM 只產 `content`、`keys` 由程式填角色 name ＋ nicknames、預設 `constant:false`）。
    入口是角色編輯器 → 進階分頁每本書旁的「生成用語條目」按鈕。
    ⚠️ **匯入角色卡時詢問生成那條沒做**（§8.2 的觸發時機 1）—— 現行匯入流程沒有對話框，
    加一個會動到匯入 UX；事後手動按鈕已涵蓋同樣的功能
  - ⚠️ `core/lore/generate.ts` **蓄意不掛進 `core/lore/index.ts`** 的 `export *`：
    它 import `core/llm`，掛上去會讓 renderer 只為了型別就把整個 LLM 層拉進 bundle
  - 測試 213 項（新增 5 項生成器純函式 ＋ 2 項注入位置與零影響）
- [x] **B3 階段 0-①：`StorageAdapter` 接上呼叫端（2026-08-04）**
  - **依賴方向已反轉。** 資料根目錄的真相從 `fileStore` 搬到新的 `src/main/dataDir.ts`
    （`getDataDir` / `getDefaultDataDir` / `setDataDir` / `saveDataDirMeta`），
    方向變成 `fileStore ─→ adapters/storageAdapter ─→ dataDir`。
    `fileStore` 因此改回正常 `import { … } from './adapters'`，
    B2.7 那個「直接指到實作檔以避開循環」的繞路註解已移除。
    `fileStore` 仍轉出 `getDataDir` / `getDefaultDataDir`，**呼叫端一行未改**
  - `fileStore` 的**同步讀寫全部改走 `electronStorage`**：設定、便利貼、提醒、
    Persona／World／Scene／Lorebook、角色卡、對話（讀取與刪除）。
    對外 144 處呼叫零改動，桌面維持同步（`SyncStorageAdapter`），core/store/ 仍完全不碰 I/O
  - `SyncStorageAdapter` 補三支：`listSync` / `removeSync` / **`readTextSync`**。
    ⚠️ **`readTextSync` 不是多餘的**：`readJsonSync` 把「檔案壞掉」與「內容就是 null」
    都收斂成 `null`，但設定載入必須分辨 —— 壞掉要走 catch 保住磁碟上的舊檔，
    收斂掉會變成把損毀的 settings.json 當空設定回寫。harness 樣本 17（損毀 JSON）守著這條
  - ⚠️ **debounce 寫檔蓄意留在 `fs`**（settings／pinned notes／conversation）：
    它們手上是「呼叫當下就序列化好的字串」，這是刻意的（之後對話物件再被改動也不影響
    已排程的那次寫入）。改走 adapter 會把序列化時機延到 timer 觸發時，語意會變。
    `ensureDirs` 同樣留下 —— 目錄不是 `StorageAdapter` 的概念（手機沙箱寫入時自動建立）
  - 驗證：typecheck ＋ 221 項測試 ＋ `electron-vite build` 全過；
    **設定載入全等比對 18/18 零差異**。反向驗證做過（在 `readTextSync` 裡動手腳改字串 →
    精準抓到 4 個含該欄位的樣本，其餘不誤報）
- [x] **B3 階段 0-②：事件來源抽象（2026-08-04）**
  - `src/core/events/`：`AppEvent`（五種）＋ `ConnectionStatus` ＋ `EventSource` 介面 ＋
    `EventHub`（訂閱／派發骨架，兩種模式共用）。實作在 `src/mobile/events/`：
    `remoteEventSource.ts`（包住現行 WebSocket）與 `localEventSource.ts`（**刻意的空殼**，
    等 B3 有本機聊天流程才接得上）
  - **五種事件是從現行 WS 實際推的六種正規化而來**（不是照決議③ 的草稿名字憑空定）：
    `message` / `thinking` / `thinking-done` / `reminder` ＋
    **`state-invalidated`**（`desktop-updated` 與 `remote-control-state` 在 `mobile.html`
    都只是觸發 `fetchState()`，故收斂成一種、只帶原因）
  - ⚠️ **決議③ 的草稿有 `onStateChange`，實際做成「發 `state-invalidated` 事件」** ——
    因為這樣一來**重連對帳也只是同一種事件**（`reason: 'reconnect'`），
    G6「鎖屏漏訊息」這個遙控獨有的問題完全關在遙控實作裡，UI 一行特例都不必寫。
    `localEventSource.ts` 短到只有 30 行，就是這件事做對了的證據
  - 遙控實作逐條沿用 `mobile.html` 1210–1268 行：指數退避（上限 8 秒）、連續失敗 4 次
    回 relay 重載、重連對帳、回前景重抓、**思考逾時保險 90 秒**
    （`thinking-done` 沒送到時自行補一則，否則 UI 動畫永遠轉下去）
  - `notifyForeground()` **由 UI 呼叫、不由實作自己監聽 document**：core 不碰 DOM，
    而且 APK 的前景事件來自 Capacitor 而非 `visibilitychange`
  - 連線狀態獨立模式永遠是 `'online'` —— UI 讀同一個欄位，**不做 `if (獨立模式)`**
  - `tsconfig.json` 的 `include` 加入 `src/mobile`（`exclude` 掉一次性的 `smoketest`）；
    測試 16 項（`tests/events/`），反向驗證兩次皆精準抓到、不誤報
  - **這次沒做任何 UI**（階段 0 的定義）
- [x] **新聞 id 的 `crypto.createHash` 解掉（2026-08-04）**
  - `core/util/sha1.ts`（純 TS SHA-1）＋ `core/news/stableId.ts`；`sources.ts` 改吃 core
  - ⚠️ **蓄意不換成「更簡單的雜湊」**（`pre-b3-work-assessment.md` §8 原本建議換）：
    這個 id 已經寫進使用者資料 —— `seenIds`（看過哪些）與新聞報的釘選／不看了都以它當鍵。
    換演算法＝全部變號＝看過的新聞重新冒出來、釘選掉光，而且**靜默發生**。
    維持與 SHA-1 逐位元組相同才是零成本的那條路
  - 驗證比照 `base64`：與 Node `crypto` 對 200 組隨機字串 ＋ 補綴邊界（55/56/57/63/64/65）
    ＋ CJK ／ emoji 逐字比對，全數相同（`tests/util/sha1.test.ts`，7 項）
  - `sources.ts` 仍留在 `main/`（`rss-parser` 是 B4 的決定），只是 id 計算不再是 Node 專屬
- [x] **B3 階段 0-③：`DataSource` 抽象（2026-08-04）** —— 拉取方向的介面
  - 階段 0-② 的 `EventSource` 管「事情發生了」（推播），這支管「我要讀資料／下指令」（拉取）。
    兩者合起來就是手機 UI 的全部外界接觸面，元件因此不知道自己在獨立還是遙控模式
  - `core/data/`（介面 ＋ `Capabilities` ＋ `DataError`）、`mobile/data/`
    （`httpClient` ／ `remoteDataSource` ／ `localDataSource` ／ `deviceIdentity`）
  - **三條硬規則**寫在 `core/data/types.ts` 檔頭：全部 async、不得有 UI 文案（回錯誤代碼）、
    **編輯類兩種模式都要實作**（遙控下手機沒有自己那份資料，編輯是 RPC 改電腦上唯一一份，
    不可能分歧；真正的同步是 roadmap §4.7 的 S1／S2）
  - `Capabilities` 只有三個旗標，編輯不在其中。**唯一例外是 API Key**：
    條件是「是否區網直連」而非模式（§4.7），且該判定**電腦端目前還沒做**，階段 4 才補
  - ⚠️ `LocalDataSource` 是**刻意的空殼**（比照 `localEventSource`）：每個方法都要經過
    Capacitor 版 `StorageAdapter`，那個還沒實作，先寫一份猜的等於階段 0 要避免的「拆掉重寫」
- [x] **B3 階段 1：UI 骨架（2026-08-04）** —— G1–G4，已 owner 實機驗證
  - `vite.mobile.config.ts` → `out/mobile`（capacitor 的 `webDir`，階段 7 也給 mobileServer 當網頁版）。
    Tailwind／PostCSS 另立一份，避免與桌面互相把 class 掃進對方的 CSS
  - ViewStack（overlay 堆疊）／Sheet／Toast／Dialog／9 種主題／安全區域／返回鍵
  - ⚠️ **返回鍵拿 history 當堆疊的影子**，讓返回手勢、Android 實體鍵、自家 ✕ 走同一條路徑
  - ⚠️ **對話框自己做**，不用瀏覽器 `prompt`／`confirm`（WebView 會跳出帶網址的系統彈窗且沒有返回鍵處理）
- [x] **B3 階段 2a：聊天主線（2026-08-04）** —— A1–A5、A8、A9，已 owner 實機驗證
  - `appStore` 是聊天元件**唯一**的資料入口，`DataSource` 與 `EventSource` 由外部注入；
    ⚠️ **元件不得直接 import 任何實作**
  - 樂觀渲染的取代靠 role ＋ 內容比對，**不靠 id 或時間戳**（暫時 id 伺服器不認得、兩邊時鐘不一致）
  - 錯誤代碼→中文集中在 UI 層，分 send／load 兩種情境（同一個 `unreachable`，
    剛打完字的人與畫面空白的人關心的事不同）
  - 色彩主題**讀寫電腦端的 `settings.ui.colorTheme`**，不是手機本機偏好 ——
    新增 `POST /api/settings/color-theme` ＋ `setColorThemeDirect()`
  - **順帶修掉桌面既有 bug**：`ipcHandlers` 的一般聊天與群組接龍**從來沒推過 `thinking-done`**，
    手機思考動畫只能靠 90 秒逾時收掉。修法是把桌面動畫與手機推播綁進同一支 `setThinking()`
    （17 個呼叫點全改），讓「少一邊」不再可能；連帶讓接話角色也會推播思考狀態
  - ⚠️ **五個實機踩到的坑記在 `docs/b3-mobile-ui-plan.md` §4.10**，共同性質是
    「桌機正常、手機才壞」或「完全沒有錯誤訊息」。**寫手機 UI 前務必讀完**
- [x] **B3 階段 2b：圖片附件（2026-08-04）** —— B1–B5
  - 前端縮圖壓縮（`ui/chat/imageCompress.ts`，長邊 1024／JPEG 0.8／鋪白底）逐字沿用
    `mobile.html:1311-1343`。實測 4000×3000 → 1024×768、237 KB → 5.4 KB。
    **獨立模式直送 API 也要壓**（省 token 與流量），不是只為了遙控的請求上限
  - ⚠️ **`MessageSnapshot` 沒有 `images`**（base64 不隨快照走），所以剛送出那則的原圖
    記在 `appStore.localImages`（訊息 id → data URI）；伺服器回音取代樂觀那則時
    **key 一起搬過去**，否則同一張圖會為了換個網址再下載一次
  - ⚠️ `findOptimisticMatch()` 是**併訊息與搬 `localImages` 共用的判斷** ——
    各寫一份的話症狀是「圖片跑到別則訊息上」，從畫面推不回原因。測試釘住兩者一致
  - ⚠️ 送失敗時**文字不放回、圖片一定放回**（B5）：文字還在錯誤泡泡裡可複製，
    圖卻得重新從相簿一張張找。只在使用者還沒選新圖時才放回
  - 燈箱（B4）放 `uiStore` 而非元件內（兩個來源 ＋ 要吃返回鍵）。
    ⚠️ **收的是「整組圖 ＋ 從第幾張開始」不是單一張**：owner 2026-08-05 實機回報
    「看完一張要先關掉再點下一張」很難用 → 左右滑 ＋ 箭頭按鈕 ＋ 鍵盤方向鍵三種都給
    （分別對應單手、不知道能滑、網頁版用電腦開）。到頭停住不繞回去；
    `MessageImages` 傳進去前要**濾掉取不到位址的那幾張**，否則翻到會是一片空白
  - ⚠️ **燈箱沒有「點一下關閉」，這是刻意的**（owner 2026-08-05）：關閉已有 ✕ 與
    返回手勢兩條路，而點擊這個動作留給**雙擊放大**遠比再開一條關閉路徑有用 ——
    **一個手勢只能有一個意思**，否則兩邊都會誤觸。縮放（雙指 1×–6×、放大後單指平移、
    雙擊 1×↔2.5×、滾輪給網頁版）沿用 `mobile.html` 遙控截圖那份（2157–2232 行），
    含「雙指放開剩一指要重設平移基準」那個漏了會跳一大段的細節。
    ⚠️ touch／wheel 監聽器**必須自己掛且 `passive: false`** ——
    React 掛的是 passive，裡面的 `preventDefault()` 不會作用也不報錯，
    症狀是「手勢有時候會把整頁一起捲走」；
    `handleBack()` 順序改為**由上而下**：燈箱 > 對話框 > 畫面堆疊，
    `useBackButton` 的 depth 也要算它 —— 少算一項，返回一次會連關兩層
  - 測試 281 項（新增 5 項 `findOptimisticMatch` 與 `mergeIncoming` 的一致性）
- [x] **B3 階段 2c：隨機工具（2026-08-04）** —— C1–C6 ＋ A7
  - 新增 `ui/stores/composerStore.ts`（草稿文字 ＋ 游標 ＋ `respond`）：
    輸入框的**寫入者不只一個**（隨機工具插 token、之後 F10 的「聊這個」），
    留在 `Composer` 的 `useState` 會逼中間每一層都認識輸入框。
    ⚠️ **圖片附件蓄意不搬進去** —— 它跟送出／失敗回填（B5）綁在一起
  - ⚠️ **游標位置要接 `onSelect` ＋ `onClick` ＋ `onKeyUp` 三個**：
    `select` 涵蓋不到「用點的移動游標」與方向鍵，而手機上「點句子中間再插一顆骰子」
    正是最常見的用法。只接 `onSelect` 時實測 token 一律插在字尾
  - 面板**完全不呼叫 `computeRandomResult`**，只產生 token（`makeTokenString`）；
    展開在 `submit()` 走 `@core/prompt/randomTokens` —— 與桌面同一份機率表與措辭，
    「先擲看看、不滿意就不送」因此不可能
  - A7 skipLlm ＝ C4 勾選框的反面（UI 問「送出後讓角色回應」）。
    ⚠️ 沿用 `mobile.html` 放在隨機工具面板裡，故 **C6 總開關關閉時 A7 也不可達**
    （既有行為，非新缺陷；獨立版若要給不用骰子的人，得另找位置）
  - ⚠️ `ui/chat/randomLabels.ts` 與桌面 renderer 有**一處刻意的小重複**：
    兩份都是 UI 文案（§3.3 不得進 core），而目前沒有「兩個 UI 共用」的層。
    **重複的只有措辭（`骰：`／`取：`與四顆 emoji），算式全部來自 core**
  - 測試 289 項（新增 8 項 `composerStore`）
- [x] **B3 階段 2d：角色列與訊息編修（2026-08-05）** —— D1–D6 ＋ A6
  - `ui/characters/`：`Avatar`（🐾 fallback）／`AvatarBar`（頂列）／
    `CharacterMenu`（說點什麼、禁言）／`PresenceSheet`（誰在場）＋ `ui/chat/MessageMenu`
  - ⚠️ **頭像不可讀 `character.avatar`**，一律經 `CharactersApi.avatarUrl()`
    （遙控是電腦本機路徑、獨立是沙箱位址，兩邊 WebView 都載不動）。
    `useAvatarUrl` 的快取放模組層 —— 頭像列與在場清單會同時問同一批角色
  - ⚠️ **🐾 fallback 要涵蓋兩種失敗**：`avatarUrl()` 回 `null`（沒設頭像）
    與圖片載入失敗（`onError`，檔案被刪／位址失效）。只做前者會看到破圖
  - D5「至少保留一個」**兩邊都擋**：UI 只剩一位時不給移出按鈕，電腦端仍會拒絕。
    ⚠️ 端點用 **HTTP 200 ＋ `ok: false`** 表示拒絕，不是錯誤狀態碼 ——
    `remoteDataSource` 要翻成 `conflict`，否則 UI 顯示成功但清單沒變
  - ⚠️ **修掉階段 0-③ 的既有 bug**：`/api/messages/*` 三支端點讀的是 `payload.id`，
    而 `remoteDataSource` 送的是 `messageId` → 一定回 400。已加測試釘住
  - ⚠️ `/api/messages/*` **不推 WebSocket 事件**（`/api/characters/*` 有 `pushDesktopUpdate`），
    所以編輯／刪除／重送完都要自己 `refresh()`，否則畫面停在舊內容
  - 訊息選單入口是**常駐的 ⋯ 而非長按**：長按在 WebView 會跟系統選字選單打架，
    而且沒有任何提示告訴使用者可以長按。樂觀渲染那則不給（伺服器還不認得那個 id）。
    ⚠️ **⋯ 要跟泡泡同一列並 `items-center`** —— 放在最外層那個 `items-start` 的 flex 裡
    （頭像對齊第一行是聊天 UI 慣例）會被拉到右上角，訊息越長越歪，owner 2026-08-05 回報
  - ⚠️ **「重新發送」只對使用者訊息顯示**：電腦端明文擋著
    （`ipcHandlers.ts:639`「只能重新發送使用者訊息」），對角色訊息給這一項
    等於又一顆必定失敗的按鈕（同 D5 那顆移出鈕）
  - 對話框新增 `multiline`（編輯訊息用）：多行不接 Enter 送出、不全選內容
  - 測試 298 項
- [x] **B3 開發工具：假 mobileServer（2026-08-05）** —— `scripts/mobile-stub-server.mjs`
  ＋ `scripts/README-mobile-stub.md`。沒開 DeST 也能驗手機 UI，且**每一則請求印在終端**
  （手機按了什麼、送出什麼、圖片壓縮後多大），這是接真 `mobileServer` 反而看不到的。
  ⚠️ **要連拒絕條件一起模擬，不能只回成功** —— 只模擬成功路徑的 stub 會安靜掩蓋
  真實限制，比沒有 stub 更糟（「重新發送」那個 bug 就是這樣晚被發現的）
- [x] **B3 階段 3：角色庫 ＋ 角色卡編輯（2026-08-05）** —— 決議④ 的最大單項
  - **端點是新的，邏輯一行都沒新寫**：`mobileServer` 補 10 支寫入端點
    （card／create／save／delete／avatar／import-card／export-card／
    import-pack／export-pack ＋ `/api/lorebooks`），實作全部指向
    `ipcHandlers.ts` 那批 `*Direct`，**桌面 IPC handler 同時改成薄轉呼叫**。
    共用一份的理由：「桌面存得起來、手機存出一張壞卡」這種 drift 沒有錯誤訊息
  - DST Pack 匯入抽出 `DstPackImportResolvers`（桌面彈對話框逐一問；
    手機**送出前就選好策略** —— 電腦前面沒有人，彈框等於讓手機那頭卡住）
  - ⚠️ **信任邊界**：`mergeCharacterFromRemote()` 只收文字欄位。
    `avatar`／`emotions`／`spriteIds` 是本機**檔案路徑**，而 `/api/avatar/:id`
    會照著它讀檔回傳 —— 讓遠端指定等於開一個讀取任意檔案的洞。
    換主圖只能走 `/api/characters/avatar`（檔名與位置由電腦端決定）；
    `id`／`createdAt` 同樣以本機為準
  - ⚠️ **主圖不走聊天附件那支壓縮**：`imageCompress` 鋪白底輸出 JPEG，
    套上去角色會失去去背（站在桌布上，透明是必要條件不是畫質問題）。
    另立 `avatarFile.ts`：能不動就不動、太大才縮且保留透明、GIF 一律原檔
  - ⚠️ `invalidateAvatar()`：換圖後位址沒變（`/api/avatar/:id`），不清快取
    畫面會留在舊圖 —— 使用者只會覺得沒存到，於是再存一次
  - ⚠️ **🐾 fallback 的第二種失敗**：遙控的 `avatarUrl()` 永遠回得出網址，
    沒設主圖時是那個網址回 404。只判斷 `null` 的話新角色看到破圖（實測撞到）
  - **未儲存攔截**：`uiStore.requestPop()` ＋ `closeGuard`，
    **返回手勢與 ✕ 走同一道關卡**（手機上多數人用前者，只擋 ✕ 等於沒擋）；
    guard 刻意同步，改 async 會讓 history 深度與畫面堆疊錯位
  - **不做**：情緒圖片分頁（roadmap §3.1 單張主圖的範圍決定）、
    複製角色（桌面版也沒有，做了就不是「對齊現行功能」）
  - 落地筆記 `docs/b3-mobile-ui-plan.md` §4.14；測試 298 → 300
- [x] **B3 階段 4：設定 UI（2026-08-05）** —— 第一層 API Key ＋ 供應商／模型，
  進階摺疊區收 endpoint／記憶參數／模組開關／提醒 CRUD
  - **範圍刻意比桌面窄**：不搬 `temperature`／`maxResponseTokens`／`maxGroupRounds`／
    輔助模型等桌面獨有調校欄位——owner 交付時列的清單本身就是範圍，不是暫定子集
  - `SettingsApi` 新增 `getLlm`／`setLlmProvider`／`setLlmModel`／`setLlmEndpoint`／
    `setLlmApiKey`／`getMemory`／`setMemory`／`listModules`／`setModuleEnabled`；
    新增 `RemindersApi`（`list`／`create`／`save`／`remove`／`toggle`）。
    邏輯全在 `ipcHandlers.ts` 的 *Direct（與桌面共用），`mobileServer.ts` 補對應
    HTTP 端點，`LocalDataSource` 依慣例維持全空殼（Capacitor storage 未接上）
  - ⚠️ **API Key 只能寫、讀不到明文**：`LlmSettingsSnapshot.hasApiKey` 只回布林。
    就算區網直連可編輯，也不必把金鑰送到手機顯示——換新的不需要先看到舊的
  - ⚠️ **`Capabilities.apiKeyAccess` 需要先問過電腦才知道，但 capabilities 是
    唯讀同步欄位**：`App.tsx` 建構 `RemoteDataSource` 前先打一次
    `GET /api/connection-info`（不需要 bridge ready），問到答案才建構並 `attach()`。
    代價是遙控模式開啟多一次序列往返，換來 capabilities 全程唯讀同步不必訂閱
  - ⚠️ **LAN 判定是「私有位址且非 loopback」，不是「同網段」**：relay／cloudflared
    tunnel 轉發進來的請求，從 `req.socket.remoteAddress` 看也是 `127.0.0.1`
    （tunnel client 在本機轉給 mobileServer），跟「桌機自己開瀏覽器測」是同一種
    表面特徵。`isLanDirectRequest()`（`mobileServer.ts`）因此只分「私有位址且非
    loopback」vs 其他，不比對子網路遮罩——差異只在「同路由器下的不同網段」這種
    邊緣案例，不影響「區網直連 vs 經 relay」這條真正要守的界線
  - ⚠️ **API Key 寫入被拒絕用 409 不是 401/403**：`httpClient.ts` 的
    `statusToCode()` 把 401/403 都翻成「連線權杖失效」，會誤導使用者去重新掃
    QR code。改用 409（`conflict`），UI 端講「API Key 只能在與電腦同一個區網時
    修改」。正常情況走不到——`Capabilities.apiKeyAccess` 應該已經把欄位藏起來，
    409 只是「畫面顯示之後連線方式才變」那種邊緣情況的防線
  - **提醒 id 沿用 `characters.create()` 的產生方式**：`RemindersApi.create()`
    在電腦端建好空白提醒並生 id，不讓 UI 自己生——手機上 `crypto.randomUUID()`
    在非安全內容下不存在，同計畫書 §4.10 第 3 點的坑
  - 桌面 `reminder:list/save/delete/toggle` 四支 IPC handler 順手瘦身成薄轉呼叫
    對應的 `*Direct`，與手機共用同一份邏輯
  - 假伺服器新增對應端點（**含拒絕與空值路徑**：`llm-apikey` 在 `LANDIRECT=0`
    時回 409、`memory` 數值超出範圍回 400、`modules/toggle` 未知 id 回 400、
    `reminders/save` 缺 id 回 400）
  - 落地筆記 `docs/b3-mobile-ui-plan.md` §4.15。**這一輪沒有截圖**（環境限制，
    理由同 §4.14），改用直接呼叫 React 事件 handler 驗證每個互動的落地結果，
    **外觀仍待 owner 過目**
- [ ] **B3 剩餘**：5 預設組 → 6 新聞報 → 7 取代 `mobile.html` ＋ APK。
  進度表與開發時連真資料的方式見 `docs/b3-mobile-ui-plan.md` §4.9
- [ ] **手機獨立版與平台擴充** → `docs/multi-device-platform-roadmap.md`
  - ⚠️ **下一步不是 B3。** 2026-08-03 盤點發現規劃缺一塊、且 B1／B2 尚未實機驗證
    → **先讀 `docs/pre-b3-work-assessment.md`**（含測試策略：哪些能自動測、
    哪些只能 owner 手動測）。順序：~~驗證合併~~ ✅ → ~~APK 試打~~ ✅ →
    ~~B2.7 `fileStore` 抽 core~~ ✅ → ~~`mobile.html` 對照清單~~ ✅（2026-08-03）→
    ~~B2.5 Lorebook core~~ ✅（2026-08-04）→ ~~B2.6 Lorebook 桌面 UI~~ ✅（2026-08-04）→ **B3（下一步）**
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

**已排程、尚未實作／進行中：**
- **Lorebook（用語解說）** → `docs/future-lorebook.md`。
  **B2.5 core ＋ B2.6 桌面 UI 已於 2026-08-04 完成**；**B3 階段 9 手機內容編輯已於 2026-08-06 完成**（待真機驗證）。
- **B3 階段 6 個人新聞報** → 見 `docs/b3-mobile-ui-plan.md`（**目前下一步**）
- **角色對使用者／角色對角色的印象** → `docs/future-character-impression.md`。
  排程 **B8（B3 之後）**，owner 2026-08-03 決議完全延後、連型別都不先定
  （理由見 `docs/pre-b3-work-assessment.md` §8）

**尚未實作（第一版排除）：**
- TTS（文字轉語音）
- Live2D
- SillyTavern 對話記錄匯入

詳細開發階段見規格書 §11。
## 2026-08-05 B3 Stage 5 交接盤點

- 完成 Scene／Persona／World preset 的 RemoteDataSource `get/save/remove`、mobileServer 端點、stub 拒絕條件，以及共用 `ipcHandlers.ts` `*Direct` 寫入邏輯；桌面 IPC 改為薄轉呼叫。
- 手機 UI 新增共用預設組清單／編輯器；目前 Scene／World 在角色列上方顯示名稱 chip，Persona 在 Composer 上方顯示「目前以誰發言」並可點選切換。Scene 套用後會 refresh，既有每情境最後對話邏輯未另寫手機版本。
- 新增 `MobileST-test.bat`（假伺服器）與 `MobileST-real-test.bat`（DeST 真資料，自動找 IP／token／mobileServer 埠並配對 Vite 埠）。
  ~~階段 7 前 DeST 內建 QR 仍服務舊 `assets/mobile.html`。~~ → **已過時**：2026-08-06 起 QR 出兩組碼（見下方「雙入口」條）。
- 驗證：`npm.cmd run typecheck` 通過；`npm.cmd test` 通過，300/300（18 files）。尚未宣稱 owner 真機端到端通過；下一步需確認 UI 操作後 `%APPDATA%\desktop-st\Data\` 下 `card.json`／`settings.json`／preset 檔案的最終內容，而非只看 HTTP 200。

## 2026-08-05 B3 階段 8 —— 對話清單與切換

- E1／E2：對話清單、切換、新增／改名／刪除；改名與刪除走 `ConversationEditor`（不用瀏覽器 `prompt()`／`confirm()`）。
- 桌面切換對話時推播給手機；`RemoteDataSource.conversations` 端點此前已齊，本階段主要是 UI。
- 程式與 stub 端點驗證完成；**待 owner 真機驗證**。詳見 `docs/b3-mobile-ui-plan.md` 階段 8。

## 2026-08-06 B3 階段 9 —— 用語解說內容編輯

- `LorebooksApi` 補 `get/save/remove/create`；`mobileServer`／stub 薄轉呼叫既有 `*Direct`。
- 手機 `LorebookEditor`；入口後來依資訊架構重整併進 `PresetsView`（見下）。
- 程式與 stub 端點驗證完成；**待 owner 真機驗證**。詳見計畫書 §4.18。

## 2026-08-06 資訊架構重整 ＋ 單色圖示（§4.19）

- Header：狀態標籤即入口（`HeaderChips`）＋ ☰ `MainMenu`（`uiStore.replace`，避免選單留在返回堆疊）。
- 設定頁拆成連線／記憶／模組開關／進階；提醒搬到主選單；用語解說併進情境頁 accordion。
- `MonoIcon` 抽到 `src/shared/`（桌面 re-export）；`modelCatalog.ts` 桌面手機共用型號與參考價。
- ⚠️ 改 vite alias／tailwind `content` 後一定要重開 dev server，否則圖示無聲消失。
- DOM 驗證通過；**畫面觀感待 owner 實機確認**。

## 2026-08-06 雙入口並存 ＋ relay 硬約束（§4.20）

- `/`＝舊 `mobile.html`（含遙控）；`/?ui=app`＝新版 React（`out/mobile`）。QR 視窗兩組碼。
- ⚠️ relay 三約束（實測）：①產物必須單一自足 HTML（`inline-mobile-build.mjs`）；
  ②`baseUrl` 用相對路徑；③WebSocket 用注入的 `__tunnelWsUrl`。
- `DesktopST-dev.bat` 先 `build:mobile`；新版無 HMR，邊改邊看仍用 `MobileST-test.bat`。
- **`mobile.html` 不能在 B6 之前刪掉**（H1–H11 只有舊版有）。
- 下一步：**階段 6 個人新聞報** → 7（收尾／APK）。
