# DeST 開發進度詳細記錄

> **選讀。新對話不要打開這份。** 預設只讀 [`CLAUDE.md`](../CLAUDE.md)。
>
> 這是進度的完整版（取捨、踩坑原文）。CLAUDE.md 的精簡清單已夠開工；
> **只有**要動舊功能、查「當初為什麼」、或懷疑重踩已知坑時，
> 才用 **Grep／Read 對應段落**——不要從頭讀到尾。
> 文件分級見 [`docs/README.md`](README.md)。

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
  - 介面設定分頁加入色彩主題選擇器（初版 9 種；**2026-08-07 起為 12 種**，見文末「介面配色擴充」）
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

## 2026-08-07 介面配色擴充（v0.4.0）

- 主題由 9 → **12** 組。`ColorTheme`：`forest`／`sepia`／`cyber` 新增；`white`／`dark` **改寫為無彩度**。
- **給人看的標籤**（設定／手機 ThemePicker／情境色條）：森林、復古、賽博、黑白灰、純白……；**給機器的 key** 維持英文。
- 色值對齊兩份資產（名稱刻意不統一，見既有註解）：
  - 桌面：`src/renderer/src/styles/theme.css`（`--color-*`）
  - 手機：`src/mobile/ui/theme.ts`（`--mint`／`--mint2` 等）
- 深色組另覆寫 `--shadow-soft`／`--shadow-panel`，避免預設偏綠陰影透出來。
- 手機深色 `surface` 仍比桌面再亮一階（自動調光下卡片才分得出來；沿用 2026-08-04 實機結論）。
- `cyber`：**不用純黑＋霓虹**；底 `#0F1518`、冷白字、深綠／深藍當區塊底，明顯彩度留給使用者語氣色（護眼優先）。
- 信任邊界：`mobileServer.ts` 的 `MOBILE_COLOR_THEMES` 白名單必須同步，否則手機選新主題會 400、桌面卻正常。
- Spec §介面配色段落已改「共 12 種」；Release 草稿：`docs/release-notes-0.4.0-draft.md`。

## 2026-08-08 W3 debug APK 上機 ＋ 首輪真機修正

**APK 出來了**（Pixel 10a 實測通過）。建置流程與兩個環境陷阱寫在 `src/mobile/README.md`，
`android/` 是 gitignored 所以那份 README 是唯一的紀錄來源。

- ⚠️ **Capacitor 外掛必須放 `dependencies`。** `cap sync` 只掃 dependencies，
  放 devDependencies 會靜默不註冊 Filesystem／SecureStorage 的原生實作 ——
  **APK 裝得起來、沒有任何編譯錯誤，但儲存與金鑰全滅**。
  正常時 sync 會印 `Found 2 Capacitor plugins for android`。
- ⚠️ **`JAVA_HOME` 不能指向 Android Studio 的 jbr**（本機那顆是 JDK 25，
  Gradle 8.14 只到 Java 24）→ `Unsupported class file major version 69`。
- `httpAdapter` 不可在模組載入時 bind `globalThis.fetch`：CapacitorHttp 是 plugin
  初始化才 patch，先 bind 會抓到未 patch 的 WebView fetch，**只在真機上炸**。

**真機驗過**：預設角色包解開、settings／對話落地、API Key 以 `enc:v1:` 密文存入
（Android Keystore 正常），force-stop 重開資料都在。

### 這輪修掉的 LLM 問題（都是真機才發現的）

- **Claude 完全不能用**：`@anthropic-ai/sdk` 偵測到 `window` 就拒跑。已加
  `dangerouslyAllowBrowser`（OpenAI 那支本來就有，Claude 是漏掉）。
  WebView 只跑我們這份 bundle、金鑰在本機 Keystore，該防護在此無意義。
- **Gemini 2.5 三個型號下架**（新帳戶 404），已從清單移除，價格表保留。
- **預設模型不可以拿清單第一個**：清單照新舊排，Claude 第一個是 `claude-fable-5`
  （$10／$50）。改用 `DEFAULT_MODEL_BY_PROVIDER`，一律挑該家最便宜且非高單價的。
- **`llm.model` 是早期單一供應商時代的欄位**，`resolveModel()` 仍會拿它墊底。
  跨供應商墊會把 gpt 型號真的送去 Anthropic（畫面上則卡在 Claude 清單頂端）。
  切換供應商時要同步它，且只在型號屬於本家時才採用。
- Grok 借用 OpenAI 相容那支實作，該處把 `debugPrompt.provider` 寫死成 `openai`，
  導致 Grok 回覆被標成 OpenAI（桌面同樣中獎）。

### 其他

- **訊息模型小圖示**：角色名右邊 14px 小圓，點一下展開型號（桌面是 hover）。
  開關 `settings.ui.showLlmBadge`（預設開，設定 → 對話），電腦與手機共用同一個值，
  桌面 Log 視窗也跟著關。字母對照表在 `src/shared/llmBadge.ts`，桌面 re-export。
- **獨立模式改資料後一定要 `events.push({ kind: 'state-invalidated' })`**。
  「重新發送」漏推 → 截斷後畫面不更新，要重開 app 才正確。新增／刪除／編輯都有推，就它漏了。
- 獨立模式 LLM 失敗**不要往上拋**：使用者訊息早已落地，往上拋會讓 `Composer`
  誤報「送出失敗」並把圖片倒回附件列，照提示重送就產生重複訊息。
- `tests/mobile/standaloneSession.test.ts` —— 獨立模式 runtime 的第一組測試。

---

## 2026-08-08 對話記錄三項可用性補強（發話身分／完整 Prompt／頭像進角色卡）

owner 實機使用後回報。三項都同時做在**獨立模式與遙控模式**，走同一份 `DataSource` 介面。

### 1. 對話記錄顯示「這句是誰說的」

使用者身分可以隨時切換，玩角色扮演時回頭看會分不清哪句是哪個身分說的。

- 新欄位 `Message.personaName`，**發話當下寫入的快照**（顯示名 → 暱稱 → 設定組名稱，
  與輸入框上方身分列同一套取名規則）。
- ⚠️ **刻意存名字而不是 id**：身分之後被改名或刪掉，舊記錄仍該保持當時的樣子。
  舊訊息沒有這個欄位就**不顯示**，不要拿目前使用中的身分去補 —— 那會是錯的。
- 開關 `settings.ui.showPersonaName`（未設定＝開，與 `showLlmBadge` 同慣例），
  UI 放在「情境與設定組 → 使用者設定」區塊裡，而不是設定頁：
  會想關掉它的人正是在那頁切身分的人。
- 寫入點有兩處，改一邊會漏：`ipcHandlers.ts` 的 `send-message`（桌面／遙控）
  與 `src/mobile/runtime/chat.ts`（獨立）。

### 2. 訊息選單「顯示完整 Prompt」（除錯用）

- **沒有做成長按。** `MessageList` 早就寫了理由：長按在 WebView 會跟系統選字選單打架，
  也沒有任何提示告訴使用者這裡可以長按。改成放進既有的 ⋯ 選單最後一項。
- **只有 `hasDebugPrompt`／`hasNewsDebug` 為真的訊息才出現入口** ——
  `core/store/prune.ts` 會把較舊訊息的 prompt 剝掉（不然對話檔會被撐爆），
  常駐顯示等於給一顆多半按了沒東西的按鈕。「沒保留」是正常結果，畫面顯示說明而不是報錯。
- 排版與圖片剝除從 `LogWindow.tsx` 搬到 `core/prompt/debugPromptView.ts` 兩邊共用：
  抄成兩份的話，比對桌面與手機為什麼結果不同時會先被排版差異誤導。
- 新增 `MessagesApi.getDebug()`、`POST /api/messages/debug`。
  遙控模式打到舊版電腦端會 404 → 客戶端當成 `null` 處理，不丟連線錯誤。

### 3. 聊天串點角色頭像 → 角色卡

原本要繞去角色庫再找一次。`Avatar` 外面包一層按鈕 push `character-editor`。
（**2026-08-08 稍晚改掉**：改成 push `character-menu`，見下一則。）

**驗過**：`?mode=standalone` 下發話、身分名顯示與開關即時生效、頭像進角色卡、
沒留 prompt 的訊息不出現除錯入口。typecheck 與 375 個測試全綠。

---

## 2026-08-08 真機第二輪回饋（表情合約、Token、頭像選單、分隔線）

owner 在 Pixel 10a 上用 debug APK 實測後回報。四項都是小改，但第一項省的是每則對話的錢。

### 1. ⚠️ 獨立版 prompt 白白帶著整份表情合約

owner 看到 `[Output Format]` 裡有一串「寫死的表情檔名」，追下去發現不是寫死的：
`buildEmotionContract()` 會把角色卡每張表情圖的 **id（預設取自圖檔檔名）與用途**
逐條寫進 system prompt，好讓模型第一行輸出 `[emotion_id]` 來選圖。

問題是**手機獨立版是單張主圖、不做表情差分**（roadmap 定的範圍），
`src/mobile/runtime/chat.ts` 也從來沒呼叫 `classifyEmotionWithLLM`。
從桌面匯入的角色卡帶著十幾張表情圖時，那段可以長到數十行 —— 每則對話都白付。

桌面靠 `splitEmotion`（`utilityEnabled && hasCustomSprites`）省掉這段，
但它的語意是「稍後有獨立的分類呼叫接手」，手機沒有那個呼叫。
所以另開 `ChatLLMParams.omitEmotionTag`：**呼叫端根本不需要情緒標籤**。
三家 provider 都是 `splitEmotion: params.splitEmotion || params.omitEmotionTag`。

> 之後手機若要做表情差分，改的是這個旗標，不是 `buildEmotionContract`。

### 2. 完整 Prompt 顯示 Token 數

與桌面 Log 視窗同樣三組（主模型／輔助／對話搜尋）。
**沒留 prompt 的訊息也要顯示** —— token 數存在訊息本體，`prune` 不會剝掉它。
欄位不存在就整組不顯示，不要印「0」（那會被讀成「這次沒花錢」）。

### 3. 頭像點擊改成開角色選單

owner：「群組聊天要一直手打名字。」`character-menu` 加一項**提及** ——
把角色名插進輸入框（走 `composerStore.insert`，插在游標處）。
插純名字**不加 `@`**：`isAddressed()` 直接比對別名，而名字會原樣留在送出的訊息裡，
多一個符號在對話記錄看起來很怪。前後只在真的黏著別的字時才補空白。

聊天串頭像改 push `character-menu`（與頂部 `AvatarBar` 同一個選單）
而不是自己做一個兩項的小選單：同一顆頭像在兩個地方點出不同東西會很奇怪。

### 4. debug prompt 分隔線縮短

`── [system] ───⋯` 原本補到 44 字元，手機寬度不夠會折成兩行，反而看不出分段。
縮成 `── [role] ────`。

> ⚠️ 這條分隔線**只在除錯檢視裡**，沒有送給模型，所以縮短它不會省 token
> （owner 原本以為會）。真正在省 token 的是上面第 1 項。

---

## 2026-08-08 獨立版缺口 #1：情境與設定組刪除

owner：「手機上無法刪除使用者資料、無法修改情境很不方便。」
`PresetsView`／`PresetEditor` 的畫面與按鈕**本來就都在**，缺的只是
`LocalDataSource` 那六支 `pending`。接上之後不必動任何 UI。

### 設定層套用抽到 `core/scene/apply.ts`

桌面 `applySceneById` 有一段是純設定指派（persona／world／sceneId／配色／
lastActiveConversationId），與手機一模一樣；剩下的開關角色視窗、搬視窗座標才是平台專屬。
把共用那段抽成 `applySceneSettings()`，兩邊都改成呼叫它 —— 日後情境多一個欄位時
不會只有一邊記得跟上。

`colorTheme` 與 `lastActiveConversationId` **只有情境真的存了才覆蓋**：
舊情境檔沒有這兩欄，拿 `undefined` 蓋下去會把使用者現在的配色洗成預設。

### 手機專屬的兩個判斷

- **情境帶著手機沒有的角色 id**（從電腦匯入的情境必然如此）：只留這台真的有的，
  一個都沒有時維持原狀。照抄會讓聊天列出現一排點不開的空角色。
- **`captureScene` 要保留** `newsKeywordGroupId`／`lorebookIds`／`moduleOverrides`：
  它們不是「目前狀態」的一部分，一起清掉會讓使用者以為設定被吃了（桌面同樣保留）。

### 其他

- `getState().activeSceneDirty` 原本硬寫 `false`，改成真的用 `isActiveSceneDirty()` 算，
  「存回目前狀態」那顆按鈕才會在該出現時出現。
- 刪最後一組 persona／world 一律擋（`conflict`，與桌面同規則）。
  `PresetEditor` 的刪除路徑自己翻這個代碼 —— 共用文案會列出三種可能成因，
  使用者得自己猜是哪一種。
- 刪掉正在用的情境只是「不再跟著任何情境」，身分與世界觀維持現狀。

**驗過**：typecheck 綠、381 個測試綠（新增 6 個情境／設定組測試）。

---

## 2026-08-08 S1 對話匯入（勾選式，預設全不選）

owner：「掃電腦 QRCode 沒辦法把對話資料帶過來？要給使用者勾選，
並且要有『全選』『取消全選』，**預設全部不選**。」

### 為什麼預設不選

對話是所有資料裡最私密、也最佔空間的。預設全帶＝使用者在不知情下把整個聊天記錄
複製到另一台裝置。全選那顆按鈕讓「我就是要全部」只多按一下，成本很低。

### 電腦端兩支端點

| 端點 | 回什麼 | 為什麼分開 |
|---|---|---|
| `GET /api/sync-conversations` | 標題／則數／參與角色，**不含訊息** | 十幾則對話的內容一次送是幾十 MB，而這一步只是在挑 |
| `GET /api/sync-conversation?id=` | 一則的完整內容 | 同 `/api/sync-pack`：訊息帶圖片 data URI，整批會在 CapacitorHttp 的 base64 bridge 上爆掉，也沒進度可顯示 |

`getConversationForSyncDirect()` **不切換電腦上正在看的那則**
（`loadConversationDirect` 會切，那是遙控用的），並剝掉 `debugPrompt` 三兄弟與
`newsDebug` —— 一則 prompt 動輒數十 KB，手機那邊只是要保存聊天記錄。圖片保留。

> ⚠️ 解析 `?id=` 要用 `requestUrl` 不是 `url`，`url` 已經去掉 query 了
> （`/api/sync-pack` 踩過同一個坑）。

### 角色 id 要重新對上

`.dstpack` 解包一律發新 id（`extractOneCharacter`），所以電腦端訊息裡的
`characterId` 在手機上根本不存在。**靠名字對** —— 名字也正是 S1 判斷「同名衝突」的依據，
兩處用同一把尺才不會出現「匯入時算同一隻、對話卻對不上」。

對不上的（角色沒一起帶、或事後改名）原樣保留：內容照樣看得到，只是少了名字與頭像。
硬塞給別隻角色比這糟糕得多。

### 留給 S2 的對應關係

`Conversation.importedFrom = { sourceId, sourceUpdatedAt, importedAt }`。

`sourceUpdatedAt` 記的是**匯入當下電腦那份**的 `updatedAt`：S2 要判斷「電腦端有沒有
變動過」得比對它，本地的 `updatedAt` 一被使用者接著聊天就往前跑了。

匯入一律發新 id、不覆蓋手機上任何既有對話，也**不設為使用中** ——
一次勾五則的話，最後一則變成正在看的那則毫無道理。

### 其他

- 已匯入過的照樣列在清單裡但停用勾選並標「已經帶過來了」。直接濾掉的話
  使用者會以為那幾則不見了。`runSyncImport` 那邊再擋一次當保險。
- 舊版電腦沒有這兩支端點 → 清單抓失敗時**只隱藏這一區**，角色與設定照樣匯入。
- 進度條分母改成「角色 ＋ 對話」的總和。

**驗過**：typecheck 綠、387 個測試綠（新增 6 個對話匯入測試）、`build:mobile` 綠。

---

## 2026-08-08 獨立版天氣（缺口 #4）＋「從電腦重新拉設定」

owner：「天氣和提醒希望也可以和電腦同步，這樣我不用設定兩次。」

### 先拆成兩件事

「同步設定」和「功能能用」不是同一回事。天氣設定帶過去，手機**還是查不到天氣**
——獨立模式沒有電腦可問，得自己打 Open-Meteo。所以這輪是**先把天氣做出來**，
設定同步只是順手。

提醒**刻意沒動**：同步過去但不會響（缺口 #5 未做）比現在誠實失敗更糟，
而且會冒出「兩邊都響」的新問題。決議與 `Reminder` 要加的欄位見
`mobile-standalone-gap-inventory.md` §3.1。

### 邏輯搬進 `core/weather/`

`main/weatherService.ts` 原本就只用標準 `fetch`，沒有 Node 專屬 API，
所以整組搬得動。桌面現在是薄殼，只補兩件平台的事：注入 `electronHttp`、
以及仍屬桌面限定的地震／颱風關鍵詞查詢。

| 檔案 | 放什麼 |
|---|---|
| `core/weather/wmo.ts` | WMO 代碼 → 中文 |
| `core/weather/providers.ts` | 地理編碼、IP 定位、Open-Meteo、wttr.in 備援、`[Weather]` 排版 |
| `core/weather/cwa.ts` | `cwaFetch` ＋ **只有背景預報**（F-C0032-001） |
| `core/weather/context.ts` | 30 分鐘快取、潤飾、來源選擇 |

CWA 只搬背景那一支。地震（E-A0016-001）與颱風（W-C0034-005）是**關鍵詞即時查詢**，
綁在桌面聊天管線上，手機還沒接 —— 硬搬過去只會多一份沒人呼叫的程式碼。

`WeatherDeps` 形狀比照 `LLMDeps`。**一定要注入 http、不能用全域 `fetch`**：
手機的全域 fetch 要被 CapacitorHttp patch 過才繞得過 CORS，而那個 patch 是
plugin 初始化後才生效。

### 手機定位：GPS 優先、退回 IP

順序跟桌面**相反**。桌面只有對外 IP，而 IP 常落在電信商機房；手機會移動、
又有定位硬體，沒理由不用。

- 新依賴 `@capacitor/geolocation`（放 `dependencies`）
- ⚠️ **這個外掛的 AndroidManifest 是空的，權限不會自動合併** ——
  `ACCESS_COARSE_LOCATION` 得自己寫進 `android/app/src/main/AndroidManifest.xml`
- **只要粗略位置**。天氣是縣市級的，`FINE` 純屬過度索取，
  而且 Android 會多跳一層「精確／大概」讓使用者猶豫
- 動態 `import()` 載入外掛：瀏覽器煙測與 vitest 沒有原生 plugin，
  靜態 import 會讓整個模組在載入時就炸，連退回 IP 都走不到
- GPS 只給經緯度，`locationName` 另外用 BigDataCloud 反查（Open-Meteo 沒有反向地理編碼）
- 權限被拒**不是錯誤**，安靜退回 IP
- `locationSource` union 加了 `'gps'`（`core/types.ts` 的 `WeatherLocationSource`）

`ip-api.com` 免費版只有明文 HTTP。這裡可以接受：請求不含使用者資料，
回應揭露的「你在哪個城市」本來就是網路業者從 IP 看得到的。真正精確的那條是
GPS，走裝置本機、根本不出網路。另補了 HTTPS 的 `ipwho.is` 當備援（ip-api 有 45 次／分鐘限制）。

### 聊天真的會帶天氣了

`mobile/runtime/chat.ts` 原本**完全沒有** `extraSystemContext` ——
就算設定裡開了天氣也不會進 prompt。這才是缺口 #4 的實質內容，
不接上的話前面三支 API 只是裝飾。

### S1 帶天氣設定，但**不帶地點**

owner 選的：手機自己定位為主。帶電腦的座標過去只會讓它出門在外顯示家裡的天氣。

帶的是「設定兩次很煩」的那幾項：潤飾開關、CWA 縣市與金鑰。
`cwaApiKey` 規矩完全比照 LLM 金鑰 —— 判定在電腦端做，非直連時**連欄位都不出現**
（不是空字串，否則手機會誤判成「電腦上清空了」而洗掉自己填的那把）。

### 「從電腦重新拉設定」

S1 是一次性的，解決不了「電腦改了設定、手機又要再設一次」。那本來是 S2 的範圍，
但 S2 貴在雙向合併與差異預覽；**把方向固定成電腦 → 手機**就退化成單純的覆蓋，
不需要任何衝突處理。

`pullSettingsFromDesktop()`，入口在設定頁「與電腦同步」，可重複按。

**刻意不碰**角色、預設組、對話 —— 這三樣每次匯入都會新增一份（一律發新 id），
放進可重複執行的入口會爆量。天氣地點同樣不碰。

按鈕寫「以電腦的設定覆蓋」不是「同步」：手機這邊改過的真的會被蓋掉，
這種事不能用含糊的字眼帶過。

順手記住同步主機（`sync-host.json`，roadmap §4.7 星狀拓樸），下次不必重掃。
**權杖會在電腦重開手機連線時換新，所以 401 是最常見的失敗、不是異常** ——
UI 直接請使用者重掃，不要丟一句「請再試一次」。

不放進 `settings.json`：那是「這台裝置跟誰配對」，不該跟著設定被同步或匯出。

**驗過**：typecheck 綠、415 個測試綠（新增 20 個天氣與同步測試）、
`build:mobile` 綠、**debug APK 建置並安裝成功**（42.5 MB）。

---

## 2026-08-08 根目錄 bat 從七個併成三個

owner：「現在太多個我搞不清步驟了。」

七個 `.bat` 裡有五個叫 `MobileST-*`，檔名長得像但做的事天差地遠 ——
`build-apk` 打包、`serve-apk` 只重開 QR、`test`／`real-test` 是完全不打包的 HMR 預覽、
`allow-apk-firewall` 是一次性的防火牆。要點哪個得先想一下，這本身就是設計失敗。

### 現在只有三個

| 檔案 | 做什麼 |
|---|---|
| `DesktopST-dev.bat` | 日常開發（未動） |
| `MobileST.bat` | 手機全部，選單三項，直接 Enter＝打包裝機 |
| `release.bat` | 發布，新增可選的 APK |

選單邏輯在 `scripts/mobile-tool.mjs`，**只做編排**；實際工作仍在原本那三支
（`build-mobile-apk`／`serve-apk`／`mobile-test-qr`），沒有搬動邏輯。

### 順手修掉的兩個問題

**防火牆從「使用者要自己想到」變成「工具會問」。** `serve-apk` 本來就會試著加規則，
但沒提權時是**靜靜失敗**的 —— 症狀是手機瀏覽器一直轉圈，看起來完全像網路問題。
現在 `[1]`／`[2]` 會先查規則在不在，不在就問一句並提權加一次（規則是永久的，只煩一次）。

**`build-mobile-apk.mjs` 不再自己開 serve 視窗。** 那是給舊 bat 用的方便設計，
但單獨跑這支（例如 `release.bat` 裡）就會莫名冒出一個關不掉的視窗。
開 QR 改由 mobile-tool 負責。同時刪掉裡面寫死的「本輪測試提醒」清單 —— 那種東西下一次改動就過期。

### `release.bat` 的 APK

打包前一次問完（`y/N`，預設不打），中途不用顧螢幕。debug 簽章，
所以提示裡就講明「裝的人要允許未知來源、不能上架」，附件檔名帶版本號
（`DeST-v0.4.0-debug.apk`），Release notes 會多一段 Android 說明。

**APK 失敗不讓桌面版陪葬** —— 那時桌面安裝檔早就好了，改問要不要繼續發布。

---

## 2026-08-08 手機版顯示建置資訊（設定頁最底）

owner：「手機獨立版要有版本號，不然我不知道我更新了沒。」

### 主角是建置時間，不是版本號

照字面做「顯示 `package.json` 的版本」會**解決不了他的問題** ——
debug APK 一天重打十次，從頭到尾都是 `0.4.0`，畫面上那行字永遠不變，
還是不知道裝到的是哪一份。真正能分辨的是建置時間，所以那才是第二行的主角。

顯示三個值：版本、建置時間（裝置當地時區）、git 短雜湊（回報問題時對照程式碼）。

第一行還標了模式，因為兩種模式的「更新」是不同的動作：
遙控模式跑的是**電腦提供的** bundle，時間戳舊代表該去電腦上 `build:mobile`，不是手機沒更新。

```
DeST v0.4.0 · 獨立版
建置 2026-08-08 16:21 · 775e41d
```

### 怎麼進到 bundle

`vite.mobile.config.ts` 的 `define`，bundle 階段就替換成字面值 ——
執行期零成本，也不需要 IPC（獨立模式根本沒有電腦可問）。
包裝在 `src/mobile/buildInfo.ts`，型別在 `src/mobile/vite-env.d.ts`；
元件不要直接碰 `__APP_VERSION__` 那三個全域名字。

取不到 git 就給空字串、時間壞掉就整行不顯示 —— 沒有 `.git` 的原始碼包也要建得起來。

### 不做成可收合區塊

`Section` 都是可收合的，但這行字的意義就是「捲到底一眼確認」，
多一次點擊就沒意義了。所以是 `<footer>`，永遠攤開。

### 順手：Android 的版本號本來是騙人的

`cap add android` 產生的 `build.gradle` 寫死 `versionCode 1` / `versionName "1.0"`，
跟 `package.json` 毫無關係 —— `adb shell dumpsys package` 與系統的「應用程式資訊」
一直顯示 1.0。`prepare-android.mjs` 現在每次 sync 都同步過去
（`versionCode` = major×10000 + minor×100 + patch，0.4.0 → 400）。

`android/` 是 gitignored，所以跟權限一樣，只能靠這支腳本每次補。

**驗過**：typecheck 綠、415 測試綠、`build:mobile` 產物內確認有版本／雜湊／時間戳，
**連續兩次建置時間戳不同**（這是整件事的重點），瀏覽器實際開設定頁確認頁尾算繪正確。
APK 重打後 `adb shell dumpsys package` 確認 `versionCode=400 versionName=0.4.0`。

### 順手抓到的 bug：serve-apk 的 Content-Length 會過期

驗證過程中發現 8731 還開著一個 16:14 啟動的 serve，而 APK 在 16:23 被我重打覆蓋。
`serve-apk.mjs` 原本在**啟動時**就 `fs.statSync` 記死大小，於是它宣告 44,614,018 bytes、
實際檔案只有 39,612,057 —— 手機會等那些永遠不會來的位元組，**下載卡在 89% 不動**，
症狀看起來完全像網路問題。

這個視窗常開著不關、旁邊繼續重打 APK，所以踩到的機率不低。
改成每次請求重新 stat；檔案不在（正在重打）時回 503 並說明原因，
不要讓手機下載到一半的檔案。

---

## 2026-08-08 情境匯入 id 未重映射＋清單左右對調＋版號上移 header

### 情境星號永遠亮、套用沒反應

owner：「APK 版切情境都會顯示星號，而且角色和對話也沒跟著套用，是因為資料從電腦匯過來的關係嗎？」——**是。**

S1 匯入預設組時只換了情境自己的 id，內部的 `activePersonaId`／`activeWorldId`／
`desktopCharacters[].characterId`／`lastActiveConversationId` 仍是電腦端 id。
角色與對話匯入時都會發新 id，所以套用時：

- 在場角色過濾全滅 → roster 不變
- 對話 lookup 失敗 → 不切換
- dirty 比對永遠不相等 → 星號常亮

修法：`remapSceneReferences`，靠名字對回本地 id（對話靠 `importedFrom.sourceId`）。
對不到的角色／對話引用刪掉，不要留幽靈 id。
**「從電腦重新拉設定」也會跑同一支**，用來修舊資料——同名情境再匯入會被略過，
光重做 S1 修不到已經壞掉的那幾份。

順手：情境沒記 `colorTheme` 時 dirty 不再視同 mint（與 `applySceneSettings` 一致），
否則非 mint 主題下星號會永遠關不掉。

### 清單：左邊編輯、右邊套用

owner：「套用或者加入／移除會比編輯常用」。
角色庫／在場／情境／使用者／世界觀／對話統一：點名稱（＋小鉛筆）進編輯，
右側較大的 `StatusChip` 做套用／加入／開啟。

### 版號移到 header 左上角

模式標籤下方加 `v0.4.0 · 08-08 16:21`，一步看得到。
HeaderChips 去掉 `overflow-x-auto`，改 `overflow-hidden`＋chip 可收縮，
避免字一長右邊出現橫向捲軸。

---

## 2026-08-09 情境同名略過導致套用永遠對不齊電腦

owner：「從電腦拉資料，但切情境時都沒有切到和電腦一樣的角色和對話。」

兩層洞疊在一起：

1. **同名情境直接略過**——手機上只要有同名（先前匯壞的、或空的），
   電腦那份在場角色／綁定對話永遠寫不進來；只做 id remap 也救不了「內容根本是空的」。
2. **對話預設不匯入**——情境要切的那則若不在手機上，套用時 lookup 失敗就不動。

修法：同名情境改為覆寫綁定欄位；S1 與「重新拉設定」都會自動帶上
**情境綁定的那幾則對話**（使用者沒勾也會帶）。套用時若情境有記在場角色，
對不到也不再「靜靜保持原狀」。

---

## 2026-08-11 提醒：台詞生成策略定案 ＋ 進階選項與歷史紀錄（原生化前的 TS 部分）

### 為什麼不預先生成台詞

owner：「我有可能先設完提醒、然後再大量跟角色互動、之後才關掉 App，
如果預先生成的話，設定提醒之後的互動會被略過。」

所以**建立提醒時就把台詞生好是明確否決的做法**，不要再提。
「劃掉 App 的當下生成」也不成立——從最近工作清單上滑劃掉之前 App 早就
`pause` 過了，`onTaskRemoved` 不保證跑得完一次 LLM 往返。可攔截的是
「離開前景」，不是「劃掉」。

**定案：現場生成為主、快取為底**（詳見 `mobile-standalone-reminder-plan.md` §2.1）：

- 主線＝AlarmManager 到點 → short foreground service → **隱藏 WebView 載入既有
  手機版 HTML（headless 旗標）** → `reminderSpeak.ts` 原封不動跑一遍。
  好處是 **TS 邏輯零重寫**、**API Key 直接可用**（同一個 App 的 WebView，
  secure storage 正常）。
- **不要用 `@capacitor/background-runner`**：獨立 QuickJS context，拿不到
  secure storage（＝拿不到金鑰）也讀不到資料層，等於被迫重造一套。
- 底線＝快取台詞，只在現場生成失敗且 `allowOfflineFallback !== false` 時使用。

### 這一輪做完的（純 TS，原生層尚未開工）

| 項目 | 說明 |
|---|---|
| 型別 | `Reminder` 加 `wakeMode`／`inactiveBehavior`／`allowOfflineFallback`／`sceneId`／`sceneConstraint`／`conversationId`；新增 `ReminderHistoryItem`／`ReminderHistoryStatus` |
| `core/reminder/gate.ts` | 「該不該響」的單一真相。手機 JS 排程器、日後原生喚醒、桌面三條路徑共用，否則同一則提醒在不同路徑上結果會不一樣。**情境比對排在螢幕判定前面**——情境不符是「根本不該出現」，不該被 `notify_on_unlock` 補發 |
| `core/reminder/cache.ts` | 快取的保鮮期（24h）與「對話沒動過就不重生」的判斷（省 Token 的主要閘） |
| `core/reminder/history.ts` | 歷史的組裝／上限（100）／刪除。`reminderLabel` 是觸發當下的快照，提醒改名或刪掉後舊紀錄仍讀得懂 |
| 排程器 | `fire()` 前先過 gate；`defer` 的進 `deferred` set，`flushDeferredReminders()` 在回前景時補發（**只留 id 不留內容**，補發時要重新生成當下的台詞） |
| `reminderSpeak.ts` | **不再退回 `reminder.prompt` 原文**（那是給角色的指令，照搬等於降級成行事曆）。改成退回快取台詞；沒有快取或使用者關掉降級就回 `null`。新增 `mode: 'cache-refresh'`（只回台詞、不進對話、不推事件） |
| 生命週期 | `visibilitychange`：hidden → `refreshReminderCache()`（唯一吃得到「剛剛那輪互動」的時機）；visible → 補發押後的提醒 |
| UI | `ReminderEditor` 進階摺疊區（預設收起，設過的話自動展開）；`ReminderHistoryView` 新畫面，入口在提醒清單底下 |
| 測試 | `tests/core/reminderGate.test.ts` 14 條；`reminderSpeak.test.ts` 改寫成新契約（原本斷言「退回提醒原文」的兩條已不成立） |

### 順手修正

計畫書原本寫 package 是 `tw.nori9.dest`，實際是 **`tw.nori.dest`**
（`android/app/src/main/java/tw/nori/dest/`，目前只有 `MainActivity.java`）。

### 已知未完成

`screenLikelyOn()` 目前**一律回 true** —— 純 JS 側無法判定螢幕狀態
（App 在背景不等於螢幕暗），保守回 true 寧可多響。真正的判定要等原生層的
`PowerManager.isInteractive()`。因此 `screen_on_only` 現階段等同 `always`，
欄位存得下、UI 選得到，但要等第②步原生化才會真的生效。

### 同日：②a 原生鬧鐘完成

`android/app/src/main/java/tw/nori/dest/reminder/` 新增五個類別：
`ReminderPlugin`（Capacitor 介面）、`ReminderScheduler`（AlarmManager）、
`ReminderAlarmStore`（SharedPreferences 落地，開機重註冊靠它）、
`ReminderAlarmReceiver`（到點；`PowerManager.isInteractive()` 判定螢幕）、
`ReminderBootReceiver`（BOOT_COMPLETED ＋ MY_PACKAGE_REPLACED）、
`ReminderNotifier`（頻道 id 與 JS 側同一個 `dest-reminders-v1`）。

要點：

- **原生完全不碰 prompt**。JS 在註冊鬧鐘時就把「App 死掉時要發什麼」
  （快取台詞）一起交過去，原生只負責發出來。快取一刷新就 `rearmNativeAlarms()`
  重註冊，否則刷了等於白刷。
- **快取是空的就不發通知**。硬擠一則「提醒：喝水」等於降級成行事曆。
- **原生鬧鐘刻意慢 15 秒**（`NATIVE_ALARM_GRACE_MS`）。JS 計時器與原生會同刻到期，
  同時響的話使用者會看到舊句子被新句子蓋掉、橫幅彈兩次。App 活著時 JS 發完會
  `cancelNativeAlarm`；App 死著時就晚這幾秒。②b 接上後要拿掉。
- **權限**：Android 14+ 一般 App 拿不到 `SCHEDULE_EXACT_ALARM`，要用
  `USE_EXACT_ALARM`（本來就是「使用者自己設的鬧鐘」情境）。兩個都宣告；
  真的沒拿到時 `ReminderScheduler` 退回 `setAndAllowWhileIdle`（誤差數分鐘），
  且提醒清單頁會出現引導banner——**不能靜默失敗**，不然使用者只覺得「提醒不準」。
- **PendingIntent 要用 `setData` 區分**：extras 不參與比對，只靠 requestCode
  不夠，會互相覆蓋。
- 順手修好 `AndroidManifest.xml` 裡位置權限那段被寫成亂碼的中文註解。

驗證：`gradlew assembleDebug` 通過，合併後的 manifest 確認兩個 receiver 與
三個新權限都在。**尚未實機測試**（手邊沒有連著的裝置）。

### 同日：②b headless 現場生成完成

提醒到點 → `ReminderForegroundService`（shortService）起隱藏 WebView →
載 `index.html?headless=reminder` → 既有 `reminderSpeak.ts` 原封不動跑一遍 →
結果回原生發通知。**TS 邏輯零重寫**，桌面／前景／背景三處同一份 prompt 組裝。

關鍵是三個 adapter（`src/mobile/headless/bridgeAdapters.ts`）：headless 沒有
Capacitor Bridge，Filesystem／SecureStorage／CapacitorHttp 都用不了，
改用 `HeadlessBridge.java` 注入的 `window.DestHeadless` 補回同樣形狀。
檔案根目錄用 `getFilesDir()`——實測 `@capacitor/filesystem` 的
`Directory.Data` 就是它，不一致的話 headless 會讀到空資料夾然後安靜地什麼都不做。

`SecureStoreReader.java` 解 master key，**與外掛內部格式綁定**
（`WSSecureStorageSharedPreferences`、U+0010 分隔的 ciphertext∥iv、
KeyStore alias ＝ prefixedKey）。升級 `@aparajita/capacitor-secure-storage` 要回頭確認。
拿不到就回 null，headless 退回快取台詞，不會崩。

實作時推翻的兩個原計畫假設：

1. **「②b 之後就能拿掉 15 秒偏移」不成立**。兩條路徑各自都會生成，
   同時跑＝兩次 LLM ＋ 兩個 session 寫同一個對話檔（後寫的蓋掉先寫的）。
   偏移要留，而且 `cancelNativeAlarm` 必須在**開始生成之前**呼叫，
   不能等發完通知——生成一慢就來不及。
2. **回到前景一定要重讀對話**。背景那句話是另一個 session 寫進檔案的；
   前景記憶體是舊的，不重讀就會在下次存檔時把它蓋掉，看起來像提醒沒觸發。
   `onAppResumed()` 現在會重讀對話／提醒／歷史並推 `state-invalidated`。

`useCache` 旗標：只有 TS 整條路壞掉時才讓原生補快取台詞。「情境不符」
「關掉離線降級」是判定結果，TS 已考慮過快取——原生再補會讓「安靜略過」失效。

驗證：瀏覽器煙測（假 bridge ＋ 記憶體檔案系統）跑過四條路徑——
找不到提醒、快取降級（訊息有進對話、歷史有紀錄）、情境不符略過、
關掉降級時安靜略過；`assembleDebug` 通過、manifest 確認 shortService 與兩個權限。
**仍未實機測試。**

### 同日：實機第一輪回報的三個 bug

owner 實測：「通知是 A 角色叫我洗杯子，點進 App 卻是 B 角色說的」、
「把提醒改成別的內容，時間到了跳出來的還是一模一樣的舊句子」。

**根因 1（最關鍵）：master key 一直讀不出來 → 每次都在走降級。**
`@aparajita/capacitor-secure-storage` 的 `set()` 存的是 `JSON.stringify(value)`，
所以解密後拿到的是**帶雙引號**的 `"BASE64=="`。`SecureStoreReader` 第一版直接
原樣回傳，`base64ToBytes` 解出垃圾 → 金鑰無效。

雪上加霜的是 `unavailableSecrets.decrypt` 是**原樣回傳**，於是 `enc:v1:…`
那串密文被當成 API Key 送去打 LLM，拿 401、進 catch、退回快取——
整條路徑「看起來有在跑」，只是永遠用舊句子。
headless 改用專屬的 `undecryptableSecrets`（密文一律回空字串，
`hasApiKey` 直接是 false），並在拿到金鑰時驗長度是否為 32 bytes。

**根因 2：降級時用「這次隨機挑到的角色」掛名。**
快取只存了文字，`useFallback` 拿當下挑到的 `char` 去掛——
通知標題是快取存的 A、對話訊息卻掛在 B 身上。快取改成連
`characterId`／`characterName` 一起帶，降級時掛回原本那個角色。

**根因 3：改了提醒內容，快取不會重生。**
`needsRefresh()` 只比對「對話有沒有更新」。加上 `reminderFingerprint`
（label／prompt／角色／情境／對話／注入開關，**不含排程時間**——
含了的話每算一次下一輪就白重生一次），並在 `saveReminder` 時
內容一變就立刻丟掉那則快取＋重刷，不等下一次背景刷新。

順帶：降級原因（`fallbackReason`）現在會一路寫進提醒紀錄並顯示在畫面上。
在此之前「現場生成一直失敗」與「本來就沒網路」長得一模一樣，只能翻 logcat。

### 同日：實機第二輪——headless HTTP 沒帶回應標頭

owner 實測兩次：10:17 完全沒通知、紀錄寫「連不上網，跳過」；
10:23 有通知但紀錄底下吐出一大片錯誤。**兩次同一個根因。**

紀錄裡的錯誤訊息是關鍵：

```
Cannot use 'in' operator to search for 'object' in {…整包 API 回應…}
```

OpenAI SDK 用 `content-type` 決定要不要 `JSON.parse`（`openai/core.mjs` 的
`isJSON`）。headless 的 `httpRequest` 只回了 status 與 body、**沒帶回應標頭**，
於是 SDK 把整包回應當純文字字串回傳，接著在 `'object' in text` 炸掉。
**LLM 其實每次都正常回話了**（紀錄裡看得到 `usage.total_tokens: 2437`
與生成好的中文台詞），卻整趟被判定失敗而退回快取。

- 10:23：有快取 → 用了 10:22 生成的舊句子（所以「看起來正常」）
- 10:17：快取還不存在 → 沒有底線可用 → 完全不發

修法：`HeadlessBridge.httpRequest` 把 `conn.getHeaderFields()` 一併回傳
（key 為 null 的 status line 那筆要跳過），TS 端 `new Response(body, { status, headers })`。

順帶修的三件事：

| 問題 | 修法 |
|---|---|
| 回 `null` 的路徑什麼都沒留下，紀錄只寫得出「跳過」 | `speakStandaloneReminder` 加 `onFailure` 回呼；沒角色／沒對話／空回覆／生成失敗都會回報，session 收進 `lastSpeakFailure` 寫進歷史 |
| 錯誤訊息把整包 API 回應存進 `reminder-history.json` | `history.ts` 加 `ERROR_MESSAGE_LIMIT = 200`，存之前壓成單行並截斷 |
| 狀態標籤寫死「連不上網，跳過」會誤導 | 改成「沒有可用的台詞，跳過」——實際上常常是生成失敗／沒金鑰／沒角色 |

**實機驗證（這次是自己在裝置上跑完的）**：
推一則 `once` 提醒進 `reminders.json`、開 App 讓它註冊鬧鐘
（`shared_prefs/dest_reminder_alarms.xml` 確認 `body: ""`＝**故意不給快取**），
`am kill` 殺掉進程模擬劃掉，等鬧鐘。結果：

```
headless 驗證 | success | 22:33:37
角色：琉緋璃
台詞：欸，背景生成正常運作，今天也順利把我蹦出來了。
```

沒有快取還能發出通知且 `status: success`，證明走的是現場生成。

> 之後要重現這個測法：`am force-stop` 會**清掉鬧鐘**，不能用；
> 要先按 HOME 讓 App 進背景，再 `am kill`（只殺得掉背景進程）。

### 同日：實機第三輪——同一次觸發被做了兩遍

owner：「手錶跳了提醒，過幾分鐘解鎖螢幕，程式又現場重新生成了一個，
對話看到的是後者，提醒紀錄變成兩筆。」

紀錄對得上：排程 22:41:00 → 背景 22:41:24 觸發一次 → **22:47:10 又一次**（解鎖時）。

**根因：JS `setTimeout` 在 App 被凍結時不會觸發，回到前景會「補跑」。**
原生鬧鐘早就在背景把那次做完了，但 JS 這條完全不知道。
先前做的 `cancelNativeAlarm` 只擋得住「JS 先跑」那個方向，擋不住反向。

修法是兩邊都問一次「這一次是不是已經有人做過了」：

- `core/reminder/gate.ts` 加 `occurrenceAlreadyHandled(lastTriggeredAt, fireAtMs)`。
  比對基準是**這個計時器原本預定的觸發時刻**，不是現在——否則分不出
  「補跑同一次」與「interval 的下一輪」。
- JS 側：`scheduleOne` 記下 `fireAtMs` 傳進 `fire()`；觸發前透過
  `hooks.occurrenceHandled` **重讀磁碟上的** `reminders.json` 比對
  （記憶體那份是舊的，背景寫的它看不到）。
- 原生側：鬧鐘多帶一個 `occurrenceAtMs`（= 預定時刻，不含刻意延後的 15 秒），
  一路傳到 headless；`runReminderHeadless` 同樣先比對。
  **這個方向也真的會發生**：前景服務會把整個 App 進程解凍，
  被凍住的 JS 計時器可能搶在 headless 之前補跑。

順帶修：**一次性提醒響過之後 `enabled=false` 沒有落地**。
原本只在排程器的記憶體裡設，重開 App 後那則用過的提醒在清單上還是開著的。
改在 `recordReminderTriggered` 裡一併寫檔。

**實機驗證**：推一則 `once` 提醒 → 開 App 註冊（JS 計時器 23:02:10、
原生鬧鐘 23:02:25）→ **按 HOME 並關螢幕但不殺進程**（讓 JS 計時器留著被凍結）
→ 等鬧鐘 → 解鎖回前景。結果：

```
23:02:26 [headless] 啟動        23:02:30 [headless] 結束：success（發通知）
23:03:44 回到前景 → 沒有任何補跑觸發
提醒紀錄：這次觸發只有 1 筆        對話：只有 1 則訊息
reminders.json：enabled 已落地為 false
```

> 重現這個測法的注意事項：**不能 `am kill`**——那樣 JS 計時器跟著死掉，
> 就測不到補跑。要讓進程活著被系統凍結（HOME ＋ 關螢幕）。

### 同日：實機第四輪——離線時提醒整個被吞掉

owner：「沒有網路的情況下提醒被吞掉是正常的嗎？」紀錄是
`skipped_offline`＋`Connection error.`，快取是空的。

**不正常，而且是 UI 承諾了程式沒做到的事。** 那個開關的標籤是
「連不上網時仍要提醒」、預設開著，勾了卻完全沉默。原本的設計
（「沒有快取就不發，免得降級成行事曆」）在這個情況推過頭了——
沉默比一則樸素通知更糟，連「有件事該做」都丟了。

改成三層（見計畫書 §2.1）：成功→角色的話；失敗有快取→先前的角色台詞；
失敗沒快取且開關開著→**樸素提醒事項**（`offline_plain`，老實寫
「（離線中，角色暫時說不了話）」，不裝成角色在講話、不進對話）；
開關關著才是真的沉默。原生鬧鐘身上那份底線也照同樣三層準備。

**修的時候又抓到一個更隱蔽的**：第一次驗證時狀態記成 `offline_fallback`
而不是 `offline_plain`，追下去發現**刷快取把降級結果存起來了**——
按 HOME 進背景時已經離線，`refreshReminderCache` 生成失敗後走了降級，
然後把「（離線中，角色暫時說不了話）」當成生成結果寫進 `reminder-cache.json`
（`characterId` 還是空的）。快取會這樣一路自我複製下去。
修法：`cache-refresh` 模式下**永不降級**（直接回 null），
`refreshReminderCache` 再加一道 `status === 'success'` 才存。

**實機驗證**（飛航模式、快取清空、App 背景凍結）：

```
23:32:05 已交給前景服務現場生成 → [headless] 啟動
23:32:09 [headless] 結束：offline_plain（發通知）
提醒紀錄：離線驗證2 | offline_plain | 「提醒我把水壺裝滿（離線中，角色暫時說不了話）」
快取：{} —— 沒有被毒化
```

---

## 手機獨立版個人新聞報（缺口 #6，2026-08-12）

依 `news-standalone-kickoff.md` §4 的建議順序，分七步把新聞報從只有桌面能用
抽成桌面／手機共用的 `core/news/`，逐步接上 `LocalDataSource.news.*`（15 支
`pending` 全部接完）。過程中每步都 `npm test` ＋ `typecheck`，重要節點另外
用 Browser 分頁跑過。

**新增的 core 檔案**：`moduleId.ts`（module id 單一來源）、`rssAdapter.ts`
（`RssParseAdapter` 介面）、`sources.ts`（抓取／快取，改吃注入的
`{http, rss}`）、`readerState.ts`（釘選／不看了）、`settings.ts`（正規化＋
讀寫）、`readerFetch.ts`（批次／單欄抓取＋配額／排序）、`enrich.ts`
（原本純規則那半之外，把抓原文／輔助模型摘要那半也搬進來，改吃
`{http, storage}`）、`schedule.ts`（定時陪聊要塞進提醒清單的那條特殊
Reminder，純函式）、`injection.ts`（「說點什麼」／主動發話的抽選＋記已讀＋
enrich 整套流程，桌面與手機共用）。桌面 `main/modules/news/*` 全部改薄殼，
固定綁 `electronHttp`／`electronRssParser`（包 `rss-parser` 的 `parseString`）
／`electronStorage`，函式簽章不變，`ipc.ts`／`mobileRoutes.ts` 完全沒動。

**§3.1 的技術決策（RSS 解析）**：實測 `rss-parser`（底層 `xml2js`）在
`vite build --config vite.mobile.config.ts` 下會把 `events`／`timers`／
`stream` 外部化成空殼——build 不報錯，但那些模組是真的被用到（`sax` 內部
靠 `events.EventEmitter`），一執行就炸。改成 `core` 只定義
`RssParseAdapter` 介面（`parseFeed`／`parseTrendsFeed`，吃已解析好的
`ParsedFeed`），桌面注入包 `rss-parser` 的版本，手機注入
`mobile/adapters/rssParseAdapter.ts`（瀏覽器原生 `DOMParser`，含 Google
Trends 的 `ht:news_item` 命名空間解析）。手機版沒辦法走 vitest（Node 環境
沒有 `DOMParser`），改用 Browser 分頁的 `javascript_tool` 對著真的 Chromium
餵 Google News／一般 RSS＋`content:encoded`／Atom／Trends 熱搜四種樣本
XML，全部欄位解析正確才定案。

**步驟⑦「聊天注入」是真正的缺口本體**：`mobile/runtime/chat.ts` 原本
只認得已經掛好的 `newsLink`（「聊這個」明確點選才會動，靠 `chatWithLLM`
內建的 `expandNewsLinkForPrompt` 自動展開，這段其實早就通了），但完全沒有
「主動抽一則新聞當話題」的邏輯——`forceSpeakStandalone`（說點什麼）與
`reminderSpeak.ts`（`reminder.injectNews`）都是照抄桌面砍掉新聞那段留下的
空缺。這次比照桌面 `ipcHandlers.ts` 的兩條路徑接上
`core/news/injection.ts` 的 `getNewsInjectionForSpeak`：說點什麼走
`triggerDirective` 傳指令（跟桌面 force-speak 路徑一致），提醒路線因為
沒有「便利貼併選」的候選機制，指令直接併進 `[發話重點]`（跟桌面提醒路線
一致）。兩處都會把抽中的新聞（或釘住的話題）轉成 `newsLink` 掛回訊息，
讓聊天泡泡的 📰 標題與「作為後續聊天主題」按鈕動起來。角色卡的
`newsKeywords`／情境的 `newsKeywordGroupId` 也一併接上抽選情境。

**刻意沒做的**：桌面「使用者回話後幫剛聊的新聞來源加分」那段
process 級待結算回饋（`pendingNewsCreditSourceId`）沒有搬——那是回饋
微調的錦上添花，不是「聊天會不會提到新聞」的必要條件，先不擴大這輪的
風險面。背景定時抓新聞、對話新聞搜尋、搬家包三項延續 kickoff 文件原本
就排除的範圍，這輪沒碰。

`MainMenu.tsx` 的 `STANDALONE_PENDING.news` 與 `ReminderEditor.tsx`
「抓一則新聞當話題」的灰字都已解除。新增／改動測試：
`tests/core/moduleSettings.test.ts`、`tests/news/{readerState,readerFetch,
schedule,injection}.test.ts`，`tests/data/dataSource.test.ts` 更新了
「未接的面該 reject」那個斷言（15 支全部接完，改驗證 `enrichForChat` 在
沒有 URL 時走 RSS fallback 而不連線）。全程 `npm test`（516 通過）、
`typecheck`、`build:mobile`（無 Node 模組外部化警告）、`npm run build`
（桌面 electron-builder 全量打包）都過。

### 同日：owner 實機回報的兩件事

**① 「新聞模組打勾完切到個人新聞報又回到沒開的狀態」。**

`session.ts` 的 `listModules` 把 `desktopst.news` 的 enabled 寫死成
`false`，`setModuleEnabled` 對新聞是**空的 no-op**，註解還留著
「獨立模式新聞模組設定檔尚未接；先忽略不炸」——接 core 那七步全程沒掃到
這兩處，因為它們在 `session.ts` 的模組開關區、不在新聞相關檔案裡。

根因是**新聞的開關與其他三個模組不同層**：天氣／Spotify／日曆都住在
`settings.json`（所以 `listModules` 一直是同步的），新聞的住在
`modules/desktopst.news/settings.json`，讀寫是非同步的。`DataSource`
介面本來就宣告 `listModules(): Promise<ModuleToggle[]>`，只是 session
那層偷懶做成同步，於是新聞沒地方接。改成 async 之後兩邊都對上了。

補了迴歸測試（`tests/mobile/standaloneSession.test.ts`）：打開 →
**用同一份 storage 重新 boot** → 仍是開的。重點在「重新 boot」而不是
只驗當下的回傳值，不然這個 bug 照樣測不出來。

**② 「新聞設定能從電腦匯入過來嗎？不然我要手動重設關鍵字很麻煩」。**

`/api/sync-init` 的 bundle 加 `news` 欄位（`getNewsSyncSettingsDirect`），
手機端新增 `applyNewsSettings` 落地。因為新聞設定不在 `settings.json`，
沒辦法塞進既有的同步 `applySettings`，得另外走一支非同步的。

**刻意不帶的四項**（都寫進了函式註解，免得日後有人「順手補齊」）：
- `enabled`：走既有的 `modules`。兩處各送一份而值不同時，行為會變成看
  誰後套用，不值得為了「一次寫完」冒這個險。
- `seenIds`：「這則聊過了」是每台裝置各自的去重歷史，不是設定。
- `feedback.adjustments`：學習來的權重是衍生資料，跟著各自的使用習慣長。
- `reminder`（定時陪聊排程）：手機的提醒是原生精準鬧鐘、有自己一套，
  把電腦的排程灌過去會憑空多出一則使用者沒在這台裝置答應過的鬧鐘。

順帶補上 `applySettings` 的模組開關迴圈**原本也漏掉新聞**——同一個遺留的
另一半，只是這半要等 ① 修好才有意義。

**驗證方式的限制**：瀏覽器分頁抓不到真新聞（`news.google.com` 沒有
`Access-Control-Allow-Origin`，只有真機的 CapacitorHttp 繞得過）。
但這反而驗到了三件事：關鍵字加完重整後還在、抓取管線用它組出了正確的
Google News URL 並真的發了請求、被 CORS 擋下之後畫面正確落回
「目前沒有新聞」而不是炸掉。**除了網路層本身，其餘都通了。**

---

## 2026-08-12｜獨立版新聞「聊這個」真機除錯：解不開 Google 新聞原文

owner 實機試用個人新聞報時回報三件事，其中一件牽出了一個**只在手機發生、
而且會靜悄悄退化**的根因。整輪是插 USB 開 logcat、加診斷 log、
打 debug APK 反覆驗證出來的。

### 症狀

「聊這個」抓不到原文，面板只給一段很短的 RSS 摘要，角色講得很空泛。
owner 的體感是「有的成功有的失敗」。

### 診斷過程（`[news-diag]` log 就是這次加的，**請保留**）

`core/news/enrich.ts` 整條管線橫跨四個外部依賴（解 Google 跳板 → 抓正文 →
抽內文 → 輔助模型），失敗時只會回一句籠統的 warning，**分不出斷在哪一步**。
所以先加了 `diag()`，每一步印 `[news-diag]`，真機用
`adb logcat -s Capacitor/Console | grep news-diag` 就能定位。

第一輪 log 立刻推翻了「有時成功」的假設：

```
start  isGoogle=false → end source=rss-adequate     ← 成功的其實是這種
start  isGoogle=true  → end source=rss-fallback warning=google-news-resolve-failed
```

**成功的那些根本沒走抓原文那條路**（RSS 摘要夠完整就直接採用，連輔助 LLM
都沒叫）。凡是 Google 新聞來源的，一律失敗，`forceRefresh` 也一樣。

### 根因（兩層，第二層才是真的）

**第一層**：`batchexecute` 的回應是**分段格式**，每段前面有一行長度數字、
段數不固定。舊寫法只剝掉第一個長度數字就整包 `JSON.parse`，多一段就必炸。
炸完落在一條沒有 log 的早退路徑上（`if (!Array.isArray(envelopes)) return null`），
所以連錯誤都看不到。

**第二層（真正只影響手機的那個）**：修完第一層真機仍全滅，log 顯示

```
resolve.rpc-body head=")]}'\n\n[[\"wrb.fr\",\"Fbv4je\",\"[\\\"garturlres\\\",\\\"https://…
```

換行是**字面上的 `\n` 兩個字元**、引號是 `\"`、`garturlres` 前面**三個**反斜線
—— **CapacitorHttp 把回應多做了一次 JSON 編碼**。原因是這個回應宣稱
`content-type: application/json`，但有 `)]}'` 前綴不是合法 JSON，原生層
`JSON.parse` 失敗後當字串留著，fetch patch 再 `JSON.stringify` 一次還給我們。

**桌面走 Node fetch 不會這樣**，所以症狀是「桌面完全正常、只有手機壞」，
而且壞得很安靜。這條已寫進 `CLAUDE.md` §5。

### 修法

- `extractGarturlres()`：逐段掃（跳過長度數字行），最後留一層 regex 保底，
  Google 之後再改外層包裝也不會整條啞掉。regex 用 `\*`（零到多個反斜線），
  **不要寫死轉義層數**。
- `normalizeRpcBody()`：偵測到「沒有真換行、卻有字面 `\n`」才還原，
  桌面那條路徑逐字不受影響。
- 測試直接用真機 log 觀察到的字串形狀釘住（`tests/news/enrich.test.ts`）。

修完真機四則全部 `resolve.ok` → 抓到原文 → 兩則走輔助模型摘要、
兩則正文夠短直接用，整趟 0.8–4.4 秒，沒有任何 warning。

### 同一輪的其他三項

**① 「聊這個」面板下緣被手勢列吃掉、按不到「確認帶去聊」。**
原本整塊 `overflow-y-auto` ＋ `max-h-[80vh]`：整塊捲會把按鈕推到捲動區最底，
`vh` 又不含 Android 手勢列。改成外層 flex column、只有中段 textarea 捲，
`85dvh` ＋ `paddingBottom: calc(var(--safe-bottom) + 12px)`。真機確認 OK。

**② 面板補齊到與桌面 `NewsContextPanel` 對等**：來源、失敗提示
（`hintFromWarning`，文案與桌面逐字對齊）、開原文 ↗、**重新總結**
（`forceRefresh: true`，跳過 enrich 快取真的重抓）。

原本 UI 只看 `enrichForChat` 的 `ok`，但**失敗時兩邊都回 `ok: true` ＋
`warning`**，於是「抓原文失敗、退回 RSS 摘要」被畫成正常結果——使用者只看到
一段沒總結過的字，不知道發生什麼事，也不知道可以重試。

**③ 送出之後找不到原文、也清不掉摘要。**
- 聊天紀錄點 📰 標題的視窗加「原文 ↗」（手機借 `DialogRequest.extraActions`，
  桌面在 `NewsContextPanel` 加 `onClear`／既有的 `onOpenOriginal`）。
- 加「清除摘要」。**摘要會跟著訊息一路留在上下文視窗裡**
  （`expandNewsLinkForPrompt` 每輪重新展開），不清就一直在。
  owner 要的語意是「留下我們討論過這則的紀錄，細節不用」——
  所以清除後 **Prompt 只留 `Title:`**，不帶 `Details:`。
- ⚠️ 沒有 Details 時那句 `use the Details above` **要換掉**，指著不存在的東西
  會讓模型自己補一段沒人講過的內容。
- ⚠️ **空字串與 `undefined` 意義不同**：`''` 是使用者清掉的，`undefined` 是
  從沒整理過（仍該退回 `summary`）。面板初始值原本寫 `promptContext || summary`，
  `||` 會把空字串當「沒有」→ 清掉、關掉、再點開摘要就**復活**，
  看起來像按鈕壞掉。兩邊都改成 `??`。
- ⚠️ `cacheManualPromptContext(id, '')` 原本會把空字串當有效的手動摘要存進
  enrich 快取，於是清除之後同一則再按「聊這個」拿到空的，4 小時內連
  「重新總結」都救不回來。改成空的就刪快取。

### 不是 bug 的那一項

owner 回報角色回覆句尾出現 `♀♀♀♀`。把手機上的對話 JSON 拉下來逐字檢查：
`ZWJ(200D): 0 / VS16(FE0F): 0 / 非 BMP 字元: 0`，程式碼裡也沒有任何地方會
產生或過濾這個字元。**不是 emoji 被截斷（那會留下 ZWJ 或變體選擇符），
是模型自己吐的**（gpt-5.6-luna）。程式面無事可修。

> 真機除錯備忘：`adb shell run-as tw.nori.dest cat files/conversations/<id>.json`
> 可以直接讀原始對話（debug build 才行），懷疑「畫面顯示壞掉」時先看這個，
> 能立刻分辨是資料本來就長這樣還是 UI 畫錯。

---

## 2026-08-12（續）｜新聞報 UI 四項回報：兩個真 bug、一個誤解、一個版面重做

承上一節，owner 繼續試用時回報四件事。真機用 `adb shell input tap` ＋ `screencap`
逐項驗過（螢幕不能鎖，鎖了就只能請 owner 解）。

### ① 「操作到一半自己跳回首頁」＝ 返回鍵在 APK 裡從來沒生效過

**最有價值的一條。** 加 `[nav-diag]`（`uiStore.ts`，印每次 push／pop／popAll／back
與當下堆疊）之後，真機按一次返回鍵 —— log 裡**完全沒有 `back`**，app 直接被關掉。

根因：`useBackButton.ts` 原本整支只靠 `history.pushState` ＋ `popstate`，
註解還寫著「Android WebView 會把返回鍵轉成 popstate」。**那是錯的。**
Capacitor 8 的 `BridgeActivity` **沒有覆寫 `onBackPressed`**，返回鍵走 Activity
預設行為（`finish()`），完全不碰 WebView 歷史。於是每一層 sheet 都是單向陷阱：
往回滑 ＝ 結束 activity，從最近使用回來是全新啟動、停在聊天畫面——
使用者看到的就是「我在管理關鍵字，點一點就跳回首頁」。

修法就是那段註解自己預言的：裝 `@capacitor/app`，用它的 `backButton` 事件。
瀏覽器仍走 popstate，兩條路徑共用 `handleBack()`，所以「哪一層先關」只有一份規則。
真機驗證：新聞設定 →（返回）→ 新聞報 →（返回）→ 聊天，app 不再退出。

> ⚠️ 這個 bug **在瀏覽器上永遠測不出來**（瀏覽器的返回真的會發 popstate）。
> 凡是「返回鍵／手勢」相關的行為，只有真機算數。

### ② 配額設 5 卻只拿到 3 —— 兩個原因，都不是抓取端的錯

`[news-diag] pick` 印每一欄的 `limit / pool / excluded / taken` 之後就清楚了：

```
初次抓取  kw:女性向  limit=5 pool=5 excluded=0 taken=5
重抓      kw:女性向  limit=5 pool=5 excluded=4 taken=1
```

- **配額根本沒送到抓取端**：`newsStore.setQuota` **從來不更新 store 裡的配額**
  （`readerBreakoutQuota`／`readerPerKeyword`／`sources[].readerQuota` 都沒動），
  數字框是 `key={value}` 的 uncontrolled，於是畫面停在舊值。已補上，
  正規化規則與 `core/news/readerFetch.setReaderQuota` 對齊。
- **更陰的一層**：`setReaderQuota` 是「先存檔、再重抓那一欄」，原本的程式碼在
  `!r.ok` 時直接 return —— **重抓失敗不代表沒存到**。配額更新必須放在 `r.ok`
  檢查**之前**，否則弱網下存了卻不反映，就是「設了 5 還是 3」。
- 剩下的「只有 4 則」是真的：「女性向」整個池子只有 5 則（其他關鍵字是 50–108）。
  重抓只拿 1 則則是 `strictExclude` 的預期行為（寧願少也不重複）。

### ③ 「選管理關鍵字就跳回全部」

`NewsView` 有一條「目前分頁的欄沒東西了就退回全部」的保險，但在管理面板裡
加／刪／改名關鍵字都會讓欄位 id 變動，每編一次就被踢回全部；而分頁列當下是
隱藏的，所以只在關掉面板時才發現。改成**面板開著時不判**，關掉後再判一次。

### ④ 兩層導覽 ＋ 熱門話題開關（owner 選的方向）

- 導覽拆成第一層「關鍵字組」、第二層「該組底下的欄」（縮排＋小一號字）。
  固定欄（熱門／地方／訂閱／其他）不屬於任何關鍵字組，集中成「其他來源」，
  不散在關鍵字組之間。只有一個組時第一排不畫。
- 熱門話題開關：背後就是把該欄配額設 0（`setReaderQuota` 對 `__breakout__`
  本來就允許 0），**沒有新機制**，只是把本來做得到卻看不出來的事變成開關。
  關掉前記住則數，打開時還原。

### 不是 bug 的那一項

角色回覆句尾的 `♀♀♀♀`：把手機上的對話 JSON 拉下來逐字檢查，
`ZWJ: 0 / VS16: 0 / 非 BMP 字元: 0`，程式碼也沒有任何地方會產生或過濾它。
不是 emoji 被截斷（那會留下 ZWJ 或變體選擇符），是模型自己吐的。

### 還沒做

owner 提議**把地方新聞併回一般關鍵字組**（它本來就是 `type: 'keyword'`，
只是 `origin: 'location'` ＋ 六處特例）。已討論方向與三個要決定的點
（`fromDetection` 自動帶入要不要留、搬家包語意會變、必須保留一個預設組），
**實作計畫待寫**。

---

## 2026-08-12（續二）｜地方新聞併回一般關鍵字組

owner 提議、拍板後當天做完。計畫與落地紀錄在 `docs/news-local-merge-plan.md`
（含 §9 的兩處「與計畫不同」與兩個真機 bug），這裡只留索引與最關鍵的一條教訓。

**做了什麼**：地方新聞本來就是 `type: 'keyword'`、縣市名當查詢字，只差一個
`origin: 'location'` 與散在 9 個檔案的 10 處特例。把資料搬平成一般關鍵字之後
特例全刪，桌面／遙控／獨立版自動一致。順帶解掉「手機完全編輯不到地方新聞」
（`NewsEditableSettings` 不含 `localNews`）。

**owner 的兩個決定**：
- 情境切換會讓地方新聞跟著被切掉 → **接受**（「不是每個使用者都想看地方新聞」）
- 「偵測我的縣市」按鈕**保留**（「出外時看一下當地狀況有用」），改成加一個一般關鍵字

**最關鍵的教訓**：**遷移只寫在讀取路徑等於沒有做完。** 正規化是純函式、
只作用在記憶體，磁碟要等下次有人存設定才會被覆蓋；在那之前每次讀都重跑遷移，
冪等旗標永遠不生效。單元測試全綠、畫面完全正常，只有 `adb shell run-as ... cat
settings.json` 看得出磁碟還是舊的。已寫進 `CLAUDE.md` §5。

---

## 2026-08-13｜S2 M3 推送實作盤點與文件校正

M3 的手機 → 電腦推送引擎已落地：角色、人設、世界觀、Lorebook、情境會依使用者選取
逐項送出；每一項成功後立即寫回 `sync-baseline.json`，角色重推另會先確認基準中的
`remoteId` 仍存在，避免過期基準覆蓋同名但無關的電腦角色。相關測試在
`tests/mobile/syncPush.test.ts`。

**尚未完成／不可宣稱 M3 完成：**設定推送尚未接入主流程，電腦 → 手機拉取尚未接入，
對話仍屬 M4。更重要的是，檢查發現 `ModeSwitcher` 把手機 → 電腦的 `pushSync()` 接在
「遙控 → 獨立」流程；正確的資料流應是「獨立 → 遙控」推送，以及「遙控 → 獨立」拉取。
這是 P1：修正前不可用真機同步驗收，以免手機舊資料覆蓋電腦資料。

本次盤點時 `npm.cmd run typecheck` 與 `npm.cmd test` 均通過（45 個測試檔、594 項測試）；
自動測試目前未覆蓋 `ModeSwitcher` 的兩個實際切換方向，修正時須補上流程測試與 Pixel
真機資料驗證。

---

## 2026-08-13（續）｜S2 M3 P1 方向修正

修正上面那條 P1：`ModeSwitcher.tsx` 的 `tryConnect`（獨立 → 遙控，含 `goRemote`／
`onScan`／`onManual` 三個入口）現在選「帶過去並切換」時呼叫 `pushLocalToRemote()`
（手機 → 電腦，沿用既有 `syncPush.ts`）；`goStandalone`（遙控 → 獨立）選同一個選項
時改呼叫 `pullRemoteToLocal()`（電腦 → 手機，新檔 `src/mobile/runtime/syncPull.ts`）。

**拉取方向的做法**：不是重新設計一套「依 diff 逐項選取」的拉取邏輯，而是直接複用
S1 既有的 `runSyncImport()`，`onConflict` 固定 `'overwrite'`——當作「使用者在切換
當下按下的這次帶過去，等同再跑一次初始化匯入，且電腦端是剛用過的那份，同名就該
蓋過去」。丟給 `runSyncImport()` 前會先拔掉 `bundle.llm.apiKeys` 與
`bundle.weather.realtimeQuery.cwaApiKey`——`runSyncImport()` 本來是 S1 專用，會把
電腦附的金鑰一併帶下來，但 S2 同步任何情況都不該碰金鑰。

**路由邏輯抽成純函式**：新檔 `src/mobile/runtime/modeSwitchSync.ts` 匯出
`pushLocalToRemote()`／`pullRemoteToLocal()` 兩支，不碰 React／zustand／Capacitor，
讓「哪個方向該打哪些端點」能被單元測試直接驗證，而不必掛整個 UI 元件才測得到
P1 這種方向接錯的問題。新增 `tests/mobile/modeSwitchSync.test.ts`（驗證兩個方向
分別只打各自的端點，不會混）與 `tests/mobile/syncPull.test.ts`（驗證真的落地資料、
API Key 被拔掉、同名 overwrite）。

**仍未完成**：設定推送（`syncPush.ts` 的 `pushSettings()`）還是死碼，獨立 → 遙控
這個方向推不動手機端改過的設定；對話同步仍是 M4，兩個方向這次都沒碰。
`npm run typecheck` 與 `npm test` 均通過（47 個測試檔、600 項）——**這只驗證了
邏輯正確，不是真機驗證**。真機上兩條切換路徑（獨立→遙控的推送終點是電腦、
遙控→獨立的拉取終點是手機）尚待用 Pixel 10a 實測，細節列在
`docs/mobile-sync-m3-kickoff.md` §9。

---

## 2026-08-13（續二）｜手機頭像三連修（真機測 S2 M3 時一路揪出來的）

owner 真機驗證 S2 M3 的過程中連續踩到三個頭像相關的坑，成因**互不相同**，
但症狀都長得像「圖片壞了」。按發現順序：

### ① 獨立版選圖後頭像放不進去（`?v=` 把 data URI 弄壞）

換頭像後為了破瀏覽器快取，程式會在網址後面接 `?v=N`。遙控模式的頭像是真的
網址（`/api/avatar/:id`），接了沒事；但**獨立模式回的是
`data:image/png;base64,...`**（`session.avatarDataUrl()`），在 base64 內容
後面接 `?v=1` 等於把整串弄成非法 data URI。**瀏覽器不會拋錯**，`<img>` 只是
靜靜 `onerror`，畫面上就是「選完圖欄位閃一下又變空、沒有任何錯誤訊息」。
修法：`withCacheBuster()` 只對非 `data:` 開頭的網址加版本號
（`ui/characters/useAvatarUrl.ts`，有單元測試）。

### ② 裁切畫面全黑（`<img>` 掛在 `ready &&` 底下，ref 抓不到）

新做的裁切畫面（見下）一開始把 `<img>` 包在 `{ready && ...}` 裡，但設定
`src` 的程式碼在解碼完成的 callback 裡、**那時 `ready` 還是 `false`**，
`imgRef.current` 是 `null`，設 src 那段被靜靜跳過；等 `setReady(true)` 讓
`<img>` 真的掛上去時，設 src 的程式碼早就跑完不會重跑。結果畫面全黑
（看到的只是黑底遮罩），按完成時 `drawImage` 對著一張沒有 src 的圖裁，
存進去的頭像也是黑的。修法：`<img>` 一律掛著，用 `visibility` 控制可見性。

**教訓**：要用 ref 抓的 DOM 節點不能條件式掛載，否則「設定它」與「它存在」
的時序不保證對得上。

### ③ 電腦端換的主圖不會反映到遙控版（伺服器沒送快取標頭）

最隱蔽的一個。`GET /api/avatar/:id` **完全沒送任何 `Cache-Control`**，
瀏覽器就套用啟發式快取自己猜有效期，之後連問都不問直接用舊圖。
而網址（`/api/avatar/:id`）在換圖前後**一模一樣**，所以沒有任何東西會
讓它失效。

**症狀為什麼難聯想**：owner 的回報是「電腦上改角色卡內文有即時反映到手機，
只有圖片不行」——因為文字是 JSON，點進角色詳細資料時
`CharacterEditor.load()` 當場重抓一份，永遠是新的；圖片則只是一張永遠
不變的「提貨單」，倉庫裡換了貨沒人通知它。看起來像「圖片同步沒做」，
實際上兩者根本走不同機制。

修法兩半：
- **伺服器端**（真正的修法）：送 `Cache-Control: no-cache` ＋ 由 mtime／size
  算的 ETag，沒換過回 304 不傳位元組。已寫進 CLAUDE.md §5。
- **手機端**：已經畫在畫面上的 `<img>` 就算重新 render 也不會自己重抓，
  所以 `state-invalidated` 要順手清掉全部頭像快取（`invalidateAllAvatars()`）。
  版本號**故意改成全站共用一個**而不是每隻角色一個——那個事件不會告訴你是
  哪一隻角色變了，與其去追蹤「哪些角色可能被電腦動過」，不如換頭像這種低頻
  操作就讓全部一起重問。

⚠️ 中途一度誤判：先只做了手機端那半，並跟 owner 說「切背景再切回來就會更新」。
owner 回報「我沒切背景，文字就已經是新的了」才發現**那個事件在該情境根本沒觸發**
（文字新是因為畫面掛載時自己重抓，不是事件驅動），手機端那半對該情境完全無效。
**教訓：使用者說「A 會更新、B 不會」時，要先確認 A 是靠哪條路徑更新的，
不要假設兩者走同一條。**

### 順帶完成：選頭像後的裁切畫面（owner 2026-08-13 提案）

拿手機相簿實測才發現沒有裁切根本不能用（塞進去的都是構圖不對的原圖）。
規格由 owner 拍板：pinch 縮放、正方形裁切框、選完圖直接跳裁切、
圓形虛線預覽框（頭像顯示時是圓的）。

- `ui/characters/AvatarCropView.tsx`——全螢幕，套路照抄專案裡唯一有手勢的
  `Lightbox.tsx`（觸控事件自己掛不用 React 的 `onTouchMove`，因為 React 掛的是
  passive listener、`preventDefault()` 沒作用；手勢狀態放 ref 不進 state，
  否則每幀重繪整棵樹會頓；雙指放開剩一指要重設平移基準否則畫面會跳）。
- `ui/characters/avatarCropMath.ts`——座標數學抽成純函式另外測（9 例）。
  抽出來的理由：pinch/拖曳**只有真機摸得出手感**，瀏覽器煙測驗不到，
  程式碼至少要能用單元測試鎖住「裁切框對應原圖哪個矩形」的公式沒寫錯。
- 掛在 `uiStore` 的獨立欄位（比照 `lightbox`，不進 `stack`），用
  Promise 包裝讓 `changeAvatar()` 能直接 `await`；返回鍵優先關它。
- **GIF 跳過裁切**：裁切一定要過 canvas，動圖只會留下第一格。

`npm run typecheck`／`npm test`（49 檔、613 項）／`npm run build:mobile` 全過。
①② 已經真機驗證通過（owner 實測選圖正常、裁切畫面正常顯示）；
③ 的伺服器端修正**尚未真機驗證**（要重開電腦端 DeST 才會生效）。

---

## 2026-08-13（續三）｜同步造成的角色 id 斷裂：修復 ＋ 加名字快照

### 出了什麼事

owner 回報「電腦上之前的對話記錄，角色名稱掉光了」。查磁碟後確認**對話內容一個字都沒少**，
壞的是「訊息 → 角色」這條連結：訊息只存 `characterId`、不存名字，7 隻角色的 id 換掉之後
五月到八月的對話全部查不到人。

**成因鏈**（每一環都是這兩天在修的東西）：
1. S2 M3 方向接錯（遙控→獨立時反而把手機資料推去電腦）＋ 基準沒寫回
2. → 同一批角色被反覆推去電腦，每次都被判成新角色 → 電腦上出現整批重複角色
3. → owner 手動把重複的移走（`D:\duplicates`），但**留下來的是手機推過去的新複本（新 id）**
4. → 所有舊對話與情境指向的原始 id 全部消失

### 修法：把原始角色搬回去，而不是改寫對話

一開始打算改寫對話裡的 id，查完之後改用相反的方向，理由是資料本身講得很清楚：

- 兩邊內容**完全相同**（連 8 張表情差分圖的檔名與大小都一樣）——手機那趟來回沒有損失任何東西
- **幾乎所有東西都在用舊 id**：22 則對話（含兩個各約 95MB 的大檔）、全部情境
- 用新 id 的只有三處：一則當天凌晨的對話、`settings.json` 裡桌面上的兩隻角色

所以把 7 個原始資料夾搬回角色庫，對話與情境**全部自動修好**，完全不用碰那 190MB 的對話檔；
只需要改那三處。實際執行：備份 → 搬回原始 → 新複本移到 `D:\duplicates-新複本`（不刪）→
改三處 id。驗證結果：22 則對話與全部情境的角色都查得到。

> **教訓**：修資料前先問「哪一邊的引用比較多」。往引用少的那邊改，動的檔案少一個數量級。

### 加上名字快照（`Message.characterName`）

owner 提議「對話記錄要不要多存一個角色名稱」——對，而且這個專案**早就對使用者身分做了同樣的事**
（`personaName`，註解寫著「身分可以被改名或刪除，但當時的對話記錄應該保持原樣」）。
角色那一側沒防到，正是這次名字整片消失的原因。

實作上與 `personaName` 有一個關鍵差異，**不要照抄**：

| | `personaName` | `characterName`（新） |
|---|---|---|
| 定位 | 唯一來源（純快照） | **只做備援** |
| 顯示 | 一律用快照 | id 查得到 → 用角色**現在**的名字；查不到才用快照 |
| 理由 | 「當時用哪個身分講話」是歷史事實 | 角色是至今仍存在的實體，改名後舊對話也該跟著更新 |

- 邏輯放 `core/chat/characterName.ts`（`resolveCharacterName` / `stampCharacterNames`），兩平台共用，有單元測試
- 補寫時機在**存檔收口**：桌面 `fileStore.saveConversation`、手機 `session.saveConversation`。
  不在 13 個建立訊息的地方各寫一次——那種散彈式改法一定會漏，而且之後新增的路徑也不會記得帶
- 桌面的角色名單靠注入（`fileStore.setCharacterNameSource`），不讓 fileStore 自己讀檔：
  真相在 `ipcHandlers` 的記憶體名單上，讀檔會拿到落後一步的版本。傳 getter 不傳陣列，
  因為 `characters` 這個變數會被整個換掉
- 規則刻意保守：**只補不覆蓋**（已有的快照比現在的猜測可信）、**查不到就不寫**
  （寧可留空讓 UI 顯示「不知道是誰」，也不要塞一個猜的名字進使用者的存檔）
- ⚠️ `src/renderer/src/types/index.ts` 有一份**平行的 `Message` 定義**（不是 core 的 re-export，
  `src/main/types.ts` 才是）。core 加欄位時這裡要一起加，否則 renderer 讀得到值卻過不了型別檢查

**沒有回填舊訊息**：修復方式改成搬檔案之後，補名字就不再是「順便」的事，而是要額外改寫 250MB
對話檔。所以只讓**之後**產生的訊息帶名字，舊訊息要不要回填另外決定。

`npm run typecheck`／`npm test`（50 檔、623 項）／`build:mobile` 全過。

### 還沒解決的隱患

**基準失效時遇到同名角色仍會直接新增**。這次修掉的是「重複推同一隻角色」（基準有效時改用
overwrite），但基準本身失效／不存在時（例如這次把角色搬回去之後，手機基準記的新 id 全部消失），
下一次推送仍會判成「沒推過」而新增一批重複。**這正是這次出事的原始機制，還在。**
在處理掉之前，不要從手機推角色到電腦。

---

## 2026-08-13（續四）｜開 App 卡在「載入中」（遙控模式 ＋ 電腦已關機）

owner 回報：上次停在遙控版，之後電腦上的 DeST 關掉了，下次開 App「卡在那邊沒東西」。

**成因**：`App.tsx` 的 attach effect 在遙控模式下會先 `await detectLanDirect(conn)`
才 `attach()`，而 `detectLanDirect` 用的是**沒有逾時的 `fetch`**。APK 上 `fetch` 是
CapacitorHttp，`signal` 無效（CLAUDE.md §5 早就記過這條，但只套用在 `core/` 的
`httpAdapter`，`connection.ts` 這幾支探測用的 `fetch` 是漏網之魚）。電腦**整台關機**時
封包沒有任何人回應，作業系統的 TCP 逾時可能超過一分鐘 —— 這段期間 `attach()` 根本
沒被呼叫，`ready` 永遠 false、`loadError` 永遠 null，於是連既有的 `LoadFailed`
重試畫面都出不來，只剩「載入中⋯⋯」。

**修法**兩件事：

1. `connection.ts` 新增 `probeRemote()`：一次問完「電腦在不在 ＋ 是不是區網直連」
   （兩者共用同一支 `/api/connection-info`，分兩次問等於在關機時等兩次逾時），
   並用 `Promise.race` 自帶 6 秒逾時。`detectLanDirect()` 保留為它的薄包裝，
   `AboutView` 那邊不用改。
   權杖過期（401／403）刻意算成「電腦在」——那要走重新配對，不是叫使用者切回本機。
2. 連不上時**問使用者**（owner 拍板的互動）：「要先改用手機獨立版嗎？」
   是 → `switchTo({ mode: 'standalone' })`，effect 帶著新的 conn 重跑；
   否 → 照常 `attach()`，由 `RemoteEventSource` 自己退避重連，畫面顯示既有的
   離線橫幅與重試按鈕。

**刻意不自動切**：電腦只是還沒開機的人會莫名其妙進到另一個資料庫，而兩邊的對話是
分開的，看起來就像資料不見了。設計文件 §4.3 那句「切到獨立永遠是安全的」講的是
使用者主動切換的情境，開機這條路徑要問過。

**一次開機只問一次**（`askedOfflineRef`）：之後的斷線由 `RemoteEventSource` 退避重連，
每次失敗都彈視窗會沒完沒了。用 ref 不用 state —— 問過就不再問這件事不需要重繪，
而且 state 會讓 attach effect 因相依變動而重跑。

`npm run typecheck`／`npm test`（50 檔、623 項）／`build:mobile` 全過。
**真機未驗**：要在 Pixel 10a 上「停在遙控模式 → 關掉電腦的 DeST → 重開 App」才測得到。

---

## 2026-08-13（續五）｜三個連環問題：API Key 消失 ＋ 兩處切換卡死

owner 回報三件事，查完是**兩個根因**，而且第一個是這次 S2 M3 改動造成的資料損失。

### ① 獨立版的 API Key 不見了（我造成的，資料已無法復原）

**鏈路**（每一步都是既有設計，湊在一起才致命）：

1. `App.tsx` **只在獨立模式分支**呼叫 `initCapacitorSecrets()`；遙控模式下整個
   app 從沒解封過 secrets
2. `ModeSwitcher` 在遙控模式下臨時 `bootStandaloneSession()` 讀本機資料 —— 沒初始化
3. `capacitorSecrets` 這時是 `unavailableSecrets`，`decrypt()` **原樣回傳**
   `enc:v1:…` 密文
4. `hydrateSettings()` 看到解出來的還是密文，依既有規則把記憶體裡的金鑰設成 `''`
   （本意良善：別讓使用者看到亂碼、以為要自己清掉）
5. S2 M3 新增的「從電腦帶回資料」跑 `runSyncImport()` → `session.saveSettings()`
   → `encrypt('')` 也原樣回傳 `''` → **磁碟上的密文被空字串覆蓋**

M2 那一版同樣會 boot 這份 session，但**唯讀、不存檔**，所以一直沒事；
M3 加上寫入之後才引爆。**金鑰已無法復原**（密文沒了，Keystore 裡的 master key
救不回不存在的密文），owner 需重新輸入。

**修法兩道**：

- **保險絲（第一道，新增）**：`session.saveSettings()` 在
  「secrets 不可用 ＋ 磁碟上是密文 ＋ 準備寫入空字串」三者同時成立時保留舊值。
  回歸測試 `tests/mobile/secretsFuse.test.ts`，最關鍵的一項是**用正確的 secrets
  重開一次、確認金鑰解得回原文**，不只是比對字串沒變。
- **呼叫端（第二道）**：`ModeSwitcher` 的三處 boot 收斂成 `localSessionForSync()`，
  裡面先 `await initCapacitorSecrets()`。

> **教訓**：「安靜地毀掉使用者資料」的失敗不能只靠「每個呼叫端都記得先做某件事」。
> 既有的 `hydrateSettings` 把解不開的金鑰填成 `''` 本身是合理的 UI 考量，
> 但它預設了「之後一定有人拿正確的 secrets 存回去」——這個假設沒有任何東西在保護。

### ②③ 切換模式卡在「連線中」／「載入中」

同一類根因，**而且是同一天內第三次踩到**：CapacitorHttp 忽略 `signal`，
電腦整台關機時封包沒人回應，TCP 逾時可能超過一分鐘。上一則日誌只修了開機那條
（`detectLanDirect`），沒把其他路徑一起掃：

| 症狀 | 卡在哪 |
|---|---|
| 開 App 停在「載入中⋯⋯」 | `detectLanDirect()`（上一則已修） |
| 獨立→遙控 停在「連線中⋯⋯」 | `resolveLiveRemote()` → `fetchSyncInitInfo()` |
| 遙控→獨立 沒反應 | 切換前預覽 `fetchRemoteManifest()` → `syncTransport.request()` |

現在的逾時：探測 6 秒、切換前 manifest 8 秒、`syncTransport` 預設 30 秒
（那支也用來抓角色包，可能好幾 MB，不能設短）。`request()` 逾時直接丟
`SyncError('unreachable')`，呼叫端既有的錯誤處理就會接手——切換前預覽抓不到清單
本來就會當成「這次不帶資料」放行，不擋切換（設計文件 §7.7）。

> **教訓**：修這種「整類」的問題時，**修一處不等於修完**。已在 CLAUDE.md §5
> 列出 `mobile/` 底下所有對電腦的 `fetch` 位置，下次改連線相關程式先掃一遍。

`npm run typecheck`／`npm test`（51 檔、625 項）／`build:mobile` 全過。
**真機未驗**：三條都要在 Pixel 10a 上關掉電腦的 DeST 才測得到。

---

## 2026-08-13（續六）｜等待時顯示倒數秒數

owner 提議：「可以在 UI 上顯示時間倒數嗎？這樣我才知道是卡住還是還沒跑完。」

合理，而且是前一天連續踩三次逾時之後的直接後果——使用者已經不信任「連線中⋯⋯」
這種沒有進展資訊的提示了。會動的數字同時回答兩件事：**它還活著**、
**最久還要等多久**。

- `ui/shell/useCountdown.ts`：`useCountdown(totalMs, running)` ＋
  `countdownLabel()`。算術抽成純函式 `secondsLeftAt()` 另外測邊界
  （不足一秒仍顯示 1，不會提早跳 0——跑著卻顯示 0 看起來像壞掉）。
- **以「開始時刻 ＋ 現在時刻」推算，不是每秒遞減**：手機把背景分頁計時器降頻是
  常態，遞減式倒數切出去再切回來會嚴重落後，牆上時鐘不會。
- 三個等待點都接上：開機探測（`App.tsx`，6 秒）、切換到遙控
  （`ModeSwitcher` 的 `resolveLiveRemote`，6 秒）、切換前預覽
  （`fetchRemoteManifest`，8 秒）。

> ⚠️ **倒數的秒數一定要跟真正的逾時同一個來源。** `PROBE_TIMEOUT_MS` 與
> `MANIFEST_TIMEOUT_MS` 都改成 export，UI 直接用同一個常數。自己另外寫死一個
> 數字的話，兩邊一旦不一致就會出現「倒數到 0 卻還在轉」或「還沒數完就跳錯誤」——
> **那比沒有倒數更糟**，因為它會讓使用者不再相信畫面上的任何提示。
> `tests/mobile/useCountdown.test.ts` 有一項專門釘住這兩個常數。

另外把 `ModeSwitcher` 的按鈕文字分成三態：等待中顯示倒數、`busy` 但沒在等網路
（使用者正在看對話框、或正在逐項推送）顯示「處理中⋯⋯」、其餘顯示原本的動作名稱。
`busy` 涵蓋整趟切換含使用者思考的時間，直接拿它做倒數會對不上。

**瀏覽器實測過**：`dev:mobile` 帶 `?server=http://192.0.2.1:3721`
（TEST-NET-1，保證不可路由）開啟，畫面確實出現「正在連電腦⋯⋯（4 秒）」並在
逾時後往下走。真機仍待驗（手勢／WebView 行為不同）。

`npm run typecheck`／`npm test`（52 檔、632 項）／`build:mobile` 全過。

---

## 2026-08-13（續七）｜斷線提示、同名角色勾選、金鑰帶到手機

owner 三個回報，其中第二個解除了「不敢測手機→電腦推送」的封鎖。

### ① 用到一半斷線沒有任何提示

原本只有一條很細的紅色橫幅（`py-1.5`、12px 字），而且**任何開著的 Sheet
都會蓋住它**——owner 把電腦的 DeST 關掉時完全沒注意到。改成：

- 斷線持續 8 秒後主動跳對話框問要不要改用本機。**不是一斷就問**：鎖屏、
  切背景、Wi-Fi 換頻段都會造成幾秒斷線且會自己接回來，一斷就問會在正常
  使用中打斷好幾次
- 選「取消」＝繼續等，橫幅升級成有圖示、粗體、而且**帶一顆「改用本機」按鈕**，
  拒絕之後不會變成死路
- 重連成功會把「問過了」歸零，下一次斷線重新問（不是整個 app 生命週期只問一次）
- 已經有別的對話框開著就不搶（`uiStore.dialog` 只有一個位子，蓋過去會把
  使用者正在看的東西弄掉），這時仍有橫幅按鈕可用

### ② 同名角色：列出清單讓使用者勾（解除測試封鎖）

這是「角色名稱掉光」事故的**正源頭**，也是先前叫 owner 不要推角色的原因。
owner 拍板：列出同名清單逐一勾選，要有全選／全不選，**預設全選**。

語意上做了一個收斂並在 UI 上標明：

- **打勾＝覆蓋電腦上那隻**。電腦端 `importDstPackDirect` 的 nameHit 分支會
  **沿用它原本的 id**，所以舊對話的連結不會斷——正是上次斷掉的那個環節
- **沒打勾＝這次不推這隻**，而**不是**「另外建一隻新的」。刻意不留那條路：
  它就是出事的機制。真的想要第二隻同名角色，在手機上改個名字再推

實作要點：
- `pushSync` 在推送迴圈**開始前**一次算完所有衝突並問一次（`onNameConflicts`
  回調），不是邊推邊問——推到一半才跳視窗，前面已經送出去的收不回來
- 基準記的 remoteId 還在電腦上 → 已知是同一隻，**不問**（那是正常重推）
- **沒有提供回調時一律不推**衝突的那幾隻。舊的預設值是「默默送出去變成重複」，
  那個預設害過一次，不留回頭路
- 略過的角色會列在推送結果的「未推送」段落，不能默默不推
- 名字比對去空白、統一大小寫，與電腦端判定一致
- UI 走 `avatarCrop` 那套 Promise 包裝（`uiStore` 獨立欄位 ＋ 頂層元件），
  因為 `ui.confirm` 只能回是／否。返回鍵＝取消整趟，不是「當作全都不覆蓋」——
  後者會安靜地推一半

`tests/mobile/syncPush.test.ts` 新增 7 例涵蓋：有問／勾了用 overwrite／沒勾要
出現在 skippedByName／取消丟 `PushCancelled`／沒回調時保守不推／大小寫空白仍算
同名／沒同名就完全不問。

### ③ 電腦的 API Key 能不能帶到手機

**可以，而且本來就有**：設定頁的「從電腦重新拉設定」（`DesktopPullSection`）會
帶金鑰，只是**限區網直連**（走中繼會被電腦端剝掉，roadmap §4.7 硬規則）。
S2 的模式切換同步刻意不碰金鑰，兩者是不同的東西——這次沒有改任何規則，
只是把既有入口指給 owner。

`npm run typecheck`／`npm test`（52 檔、639 項）／`build:mobile` 全過。

---

## 2026-08-13（續八）｜斷線提示還是沒跳：重連狀態把計時歸零

owner 回報「遙控版斷線好像還是沒跳訊息」，接 USB 用 adb 直接查。

**先排除舊版本**：`dumpsys package tw.nori.dest` 顯示 `lastUpdateTime=20:50`，
而斷線提示是 20:39 那一版就建置進去的 —— 功能確實在 APK 裡，是真的沒生效。

**成因**（logcat 直接看到）：

```
21:03:17 [RemoteEventSource] close
21:03:19 [RemoteEventSource] connecting ws://192.168.50.136:3721/...
```

斷線後 2 秒就重連一次，而 `RemoteEventSource.connect()` 開頭會
`setStatus('connecting')`。所以斷線期間狀態是這樣一直跳：

```
offline → connecting → offline → connecting → ⋯   （退避 0.5→1→2→4→8 秒）
```

第一版的判斷是「`status === 'offline'` 就開始計時，**否則歸零**」——
`'connecting'` 落進了「否則」，於是每次重連嘗試都把計時歸零。退避上限 8 秒、
門檻也是 8 秒，**計時永遠數不完**，對話框自然不會出現。

**修法**：規則抽成純函式 `ui/shell/offlineWatch.ts` 的 `nextOfflineSince()`——
**只有真的 `'online'` 才算恢復**，`'connecting'`／`'idle'` 一律維持原本的計時。
7 個回歸測試，其中一項直接模擬 offline→connecting→offline 的跳動串，
驗證計時一路從第一次算起。

> **教訓**：連線狀態不是二元的。看到 `status !== 'offline'` 就當成「連上了」
> 是很自然的直覺，但重連中的狀態既不是斷線也不是連線——**寫這種判斷時要把
> 狀態機的所有值都列出來想一遍**，尤其是這種「中間態會高頻反覆出現」的。
> 也是這次驗證方式的價值：純粹讀程式碼很難發現，接 USB 看 logcat 兩行就清楚了。

`npm run typecheck`／`npm test`（52 檔、646 項）／`build:mobile` 全過。
真機仍待驗（要重打 APK）。

---

## 2026-08-13（續九）｜斷線提示：橫幅踩同一個坑，外加「從頭就連不上」的漏洞

owner 回報「有跳詢問視窗了，但沒有斷線提示，點進去顯示連線中」，並提議把左上角
模式標籤在斷線時轉成警告色。三件事一起處理。

### ① 橫幅踩的是我剛修好的同一個坑

上一則只修了「計時器」，**橫幅本身還是 `status === 'offline'`**。重連退避期間
狀態多數時間是 `'connecting'`，所以橫幅一閃一閃、幾乎看不到 —— owner 點進
「關於」看到「連線中」正是如此。改成看 `offlineSince`（真的連上之前不會歸零）。

> **教訓**：同一個錯誤觀念通常不只寫在一個地方。修掉「把 connecting 當成已連線」
> 之後應該把**所有**依賴連線狀態的 UI 掃一遍，而不是只修觸發我去看的那一處。

### ② 更大的漏洞：「一開始就連不上」完全不會有提示

瀏覽器實測（`?server=http://192.0.2.1:3721`，TEST-NET-1 不可路由）抓到的：
**14 秒內橫幅與標籤都沒出現**。原因是這種情況下 WebSocket 一直卡在連線中，
`'offline'` 根本不會出現（要等 TCP 逾時，可能好幾分鐘），而 `nextOfflineSince`
當時只認 `'offline'`。

也就是說：**用到一半斷線**會提示，**開 App 時電腦就關著**（或按了「繼續嘗試連線」）
反而一片安靜——後者才是 owner 最早回報的那個情境。

修法：`'connecting'` 也開始計時，只有真的 `'online'` 才歸零；`'idle'`（事件來源
還沒啟動）維持不動，避免開 App 瞬間就誤判。橫幅文案同步改成「連不上電腦，正在
重試⋯⋯」，同時涵蓋兩種情況（原本寫「連線中斷」對第二種是錯的）。

### ③ 左上角標籤轉警告色（owner 提議）

持續連不上 8 秒後，標籤變成 `電腦·斷線` ＋ 警告底色。橫幅是即時顯示（短暫閃斷
也會看到，那是正確的資訊），標籤則要「持續一段時間」才變色，兩層分開。

### ④ 反覆重連的代價（owner 提問）

原本不論斷多久都固定每 8 秒試一次而且**永遠不停**（原生殼沒有 `onNeedsReload`，
不會走重載那條路）。電腦關機一整晚＝整晚每 8 秒一次 TCP 連線嘗試：單次成本很小，
但會週期性喚醒網路介面。改成連續失敗 10 次之後（約一分鐘）退避上限放寬到 30 秒——
前一分鐘維持快節奏讓「電腦重開機」「Wi-Fi 換頻段」能立刻接回，之後才降頻。

**瀏覽器實測**（同上不可路由位址）：橫幅立刻出現；約 8 秒後標籤變成
`電腦·斷線`、底色由 `rgb(247,255,252)` 轉為 `rgb(255,187,187)`。

`npm run typecheck`／`npm test`（52 檔、651 項）／`build:mobile` 全過。
真機仍待驗。

---

## 2026-08-13（續十）｜本機模式常駐掃 QR ＋ 切模式後清掉斷線提示

### ① 本機模式一律顯示掃 QR（owner：隨時可以換一台電腦）

原本配對區塊只有在「連上次那台」失敗時（`setShowPair(true)`）才會出現，於是
**已經配對過的人永遠找不到換電腦的入口**——記憶反而把功能藏起來了。

改成本機模式一律顯示掃 QR／手動貼網址；「切換到遙控」那顆按鈕則只在真的有
記住主機時才畫（沒記憶時按下去只會什麼都不做，不如不要畫），文案也改成
「連上次那台」，與「掃 QR 換一台」區分開。有記憶時說明文字改成
「要改連別台電腦，掃那台的 QR 就會換過去」。

### ② 切到本機之後斷線提示還留著

`nextOfflineSince` 的規則沒問題，但 effect 裡是
`if (conn?.mode !== 'remote') return` —— **early return 等於「不更新」，不是
「歸零」**，所以從遙控切到本機時計時值原封不動留著，橫幅與紅色標籤跟著留在
本機模式的畫面上。

修法：模式也交給純函式判斷（`nextOfflineSince(..., isRemote)`，本機一律回
`null`），effect 裡不再自己判斷任何東西。橫幅與標籤另外加一道
`conn?.mode === 'remote'` 的算繪閘門當第二層保險。

> **教訓**：這個 effect 已經因為「在裡面自作聰明判斷」踩了兩次
> （①把 connecting 當成已連線 ②本機模式 early return）。狀態推進的規則
> **全部**放進純函式，effect 只負責把結果塞回 state —— 現在檔頭註解直接寫死
> 這條，避免第三次。

**瀏覽器實測**：斷線 9 秒後橫幅出現、標籤為 `電腦·斷線`／`rgb(255,187,187)`。
**沒有驗到的**：切模式之後的清除、以及本機模式的配對 UI —— 兩者都只在原生殼
出現（`ModeSwitcher` 與橫幅的按鈕都有 `Capacitor.isNativePlatform()` 閘門），
瀏覽器摸不到，只有純函式那層有單元測試涵蓋。真機待驗。

`npm run typecheck`／`npm test`（52 檔、653 項）／`build:mobile` 全過。

---

## 2026-08-14（續十一）｜S2 M4（逐項比對）＋ M5（設定同步）

### ① M3 的重複問題根因與修法

M3 實機驗發現資料愈同步愈多份：電腦端 23 個情境（應該 7 個）、各 10 份世界觀與
使用者設定。**根因是基準表整份是假的**（`syncPush` 推送時記 `remoteId: id`，
但電腦端 `savePersonaPresetDirect` 會丟掉送來的 id 另發 uuid，手機完全沒讀過
回應），加上 diff 的名字後備配對無法收斂 ＋ 推情境沒翻譯參照導致電腦側死參照。

**改成每次切換當場配對**（`core/sync/pair.ts`，純函式，身分判斷＝id 相同或名稱
相同），左手機右電腦逐列選（本機／電腦／保留差異），內容一致判斷**看 contentHash
不看 updatedAt**——推送會把接收端時間戳覆蓋成現在，用時間戳永遠對不齊。

新增 M4 的比對畫面（`SyncComparePicker.tsx`，沿用 nameConflicts 那套視覺語言），
UI 設計上完全不同於名稱衝突：**資料衝突同一列裡兩邊都可能有對方沒有的項目**
（聯集合併，不是互斥選擇），呈現方式是「手機有⋯⋯，電腦有⋯⋯」的對照。

選項語意統一（本機／電腦／不動），三顆快捷鍵「全部用手機」「全部用電腦」「全部不動」。
**刪除一律走既有 API**（刪手機走 `session.remove*`，刪電腦走 DELETE 端點），
刪除本身由一套獨立的防線保護（警告色 ＋ 二次確認逐筆清單 ＋ 推送端不產生刪除）。
參照翻譯靠 `syncApply` 的 id 對應表，避免情境推送時找不到角色。

**教訓**（M3→M4）：不要依賴基準表判斷「兩邊是不是同一個」，每次都現場配對。
同時確保 `contentHash`、欄位子集等定義**只有一份**（放在 `core/`），
M4 那次 `contentHash.ts` 的漂移正是因為桌面和手機各自手打了一份判斷邏輯。

### ② M5 設定同步（獨立型別、逐欄位比對）

跟資料不同，設定欄位**兩邊永遠都有值**（沒有「只有手機有」的狀態），所以不能
用 M4 那套「單邊獨有＝刪除」的語意。另起一套型別（`core/sync/settingsPair.ts`），
選項只有 `'local' | 'remote' | 'keep'`（預設不動）。

涵蓋 LLM（供應商＋每個供應商各自的模型、端點、對話限制）、記憶、外觀主題、模組開關，
都經由 `core/sync/settingsSnapshot.ts` 統一定義（用來對齊桌面與手機，避免
M4 那次欄位漂移的坑）。`POST` 時分組端點要整個送（例如對話限制分三欄但用同一支
端點），推送邏輯**算出「電腦端最終狀態」**：被推的欄位用手機值，其餘（不動或拉）
維持電腦原值，不會漏送的欄位被當成清空。

同步 UI 多開一個「設定」分頁，沿用比對畫面；跟資料分頁獨立（資料部分選的快捷鍵
不影響設定、反之亦然）。新增 `GET /api/settings/sync-snapshot` 讓手機能對齐讀到
兩邊的完整值並排顯示。

**2026-08-14 追加（owner 真機回報）**：第一版遺漏了 `weather.polish`
（天氣是否經輔助模型潤飾）——模組除了 `enabled` 常帶子設定，但子設定要不要同步
是逐個判斷的決定，不是「加了 modules 分組就自動涵蓋」。現在補進去；
其餘模組子設定（新聞的關鍵字組、提醒的喚醒模式…）尚未逐一排查，之後如有人
回報也大概率是同一類漏掉。

`npm run typecheck`／`npm test`（47 檔、600 項）全過。
真機驗證六項見 `docs/mobile-sync-m4-compare.md` §7 ＆ §8.6。

---

## 2026-08-15（續十一）｜本機 LLM 供應商（Ollama、LM Studio 等相容端點）

新增供應商 `local`，支援任何 OpenAI 相容的自架或本機 LLM（Ollama、LM Studio、
llama.cpp 等）。**主模型與輔助模型都能各自選**：配對一家雲端＋一家本機是合法
組態（主要特性 Claude、分類特性 Qwen3:8B），`endpoints` 按 provider 分流，
換 provider 時端點跟著換，無須另起 `utilityEndpoints` 欄位。

不需寫新 adapter：Ollama 支援 Responses API，沿用 `openai.ts`，只多送
`reasoning:{effort:'none'}`（思考模型會把 token 預算吃光、正文回空字串）。
模型清單靠「測試連線」打 `GET /v1/models` 動態取得；金鑰選填。

**既有 bug 順手修掉**：
1. 輔助模型連線測試用錯端點（寫死主模型的 URL）
2. `httpAdapter` 的 30 秒天花板被套在有 signal 的請求上（本機 LLM 冷啟動會超）——
   現改成有 signal 就只聽呼叫端的。⚠️ 這條影響**全部手機請求**，不只本機模型，
   真機驗證時值得留意副作用

**金鑰檢查散落十幾處**：第一輪只改了連線測試，導致本機仍聊不了（`ipcHandlers.ts`
與手機 runtime 各自寫著 `apiKeys[provider]?.trim()`，共 9 處關卡都會說「尚未設定
API Key」——訊息本身是錯的）。現統一走 `hasUsableApiKey(settings)` ＋
`providerNeedsApiKey(provider)`，UI 金鑰欄位在 local 下改成「不需要填」。

新增欄位 `llm.extraInstruction`（使用者自訂補充指示，選填），通用於所有供應商，
接進設定同步；位在 prompt 尾端讓使用者規則蓋過預設規則（而非被稀釋在中間）。

`npm run typecheck`／`npm test`（58 檔、731 項）全過。
**尚未驗證**：桌面 UI（供應商下拉、端點欄位、連線後模型回填）、手機真機（特別是
§9.2 的逾時改動有無副作用）、設定同步的端點逐列比對。

---

## 2026-08-15（續十二）｜載入中點選單白畫面、背景等候回應誤報網路錯誤

### ① 載入中點選單白畫面

獨立版開機路徑較長（探測區網、啟動 standalone session），`MainMenu` 可能在
appStore 的 `deps` 還沒 `attach()` 時被渲染，`getData()` 例外未被 catch，整棵
React 樹由 Error Boundary 卸載成白畫面。修法：選單按鈕在 ready 前禁用；
`MainMenu` 改用 `isAttached()` 安全讀取而非直接呼叫 `getData()`。
頂層再加一個 `ErrorBoundary` 當最後防線。

### ② 背景等候時誤報網路錯誤

手機切到背景，系統會砍斷連線讓 `send()` 失敗（`unreachable`）。但電腦端的 LLM
是獨立在跑、不會因此停下。修法：`send()` 遇到 `unreachable` 時先呼叫 `refresh()`
對帳一次，如果樂觀訊息不在新清單裡（代表已經被伺服器版本取代），就不顯示錯誤
——實際有送到，不該給使用者假的「連不上電腦」。真的沒送到（電腦真的離線）才
會留下錯誤泡泡。

### ③ 回前景時立刻重連

一直沒被呼叫的 `EventSource.notifyForeground()` 現在補上來源：
`App.tsx` 的 resume 事件。回前景時立刻 reconnect ＋ refresh，而不是乾等
退避重連排程。

`npm run typecheck`／`npm test`（52 檔、653 項）全過。

---

## 2026-08-16｜B-1 對話刪除（階段一：整則對話），真機驗證通過

owner 2026-08-16 真機測試 S2 對話同步時回報：故意刪掉的對話，同步後又被另一邊
補回來（`convPair.ts` 的 `copy` 預設行為）。收斂成 `TODO.md` §1.1b B-1，分兩階段，
先做風險較低的階段一。

`core/sync/convPair.ts` 的 `ConvChoice` 加一個 `'delete'`，只在**單邊獨有**的列
有意義（`convActionFor` 對應到 `delete-local`／`delete-remote`）；兩邊都有的合併列
不受影響——`merge` 仍然不刪東西，訊息聯集裡少的一律當「還沒收到」。執行端在
`mobile/runtime/syncConversations.ts`：本機呼叫既有的 `session.removeConversation`，
電腦呼叫既有的 `/api/conversations/delete`（rename 用的同一支端點，不用新開）。
UI 複用資料分頁（`pair.ts`／`CompareRow`）已驗證過的那套：警告色外框、
`DeleteHint` 副標、送出前逐筆確認清單（`listConvDeletions`）。

**真機測出一個漏洞，過程中就地修掉**：`ModeSwitcher.tsx` 判斷「這趟同步要不要
真的跑」的加總式（openSyncCompare 之後、要不要呼叫 apply 系列函式之前）沒算進
新加的 `convPlan.deleteLocal`／`deleteRemote`。結果是使用者只選了刪除、其他列都
不動時，`SyncComparePicker` 的確認流程整段都正常（外框變紅、二次確認清單都對），
但 `ModeSwitcher` 把「合計為 0」誤判成「沒事要做」，**整個跳過 apply 步驟直接
切換模式**——症狀是「畫面上看起來刪除成功，電腦端卻什麼也沒發生」，而且沒有
任何錯誤訊息。修法：加總式補上那兩個欄位。這類「加了新的 plan 欄位、卻漏改
某處既有的加總判斷」的坑，改 `ConvPlanCounts`／`PairPlanCounts` 之類的結構時
要記得全域搜一次所有把各欄位加總的地方，不能只改定義那一處。

階段二（訊息層刪除，哪幾句被刪）仍未做，理由見 `convPair.ts` 檔頭：`merge` 光看
指紋分不出「對面新增的」跟「這邊被刪的」，要墓碑紀錄或逐句確認清單，等階段一
用一陣子再決定要不要做。

`npm run typecheck`／`npm test`（61 檔、797 項）全過。

---

## 2026-08-16（續）｜B-2 修正：「保留差異」快捷鍵改成真的全部不動

M4 第 8 條真機測試發現：按「保留差異」，單邊獨有的列沒有變成「不動」，還是
照樣被補到對面去，跟按鈕字面意思不符。

原因在 `core/sync/pair.ts` 的 `applyPreset()`：`preset === 'keep'` 時，兩邊都有
的列會走到 `defaultChoice()` 正確判成 `keep`，但單邊獨有的列 `defaultChoice()`
判的是 `local`／`remote`（＝補到對面），這其實是原本刻意的設計——`defaultChoice`
的語意本來是給「開啟比對畫面時的預設值」用的，「保留差異」快捷鍵直接沿用它
只是圖方便，沒考慮到單邊獨有那段語意會漏出來，讓按鈕文字跟實際行為對不上。

跟 owner 確認後決定：「保留差異」改成**整批真的不動**，不再呼叫
`defaultChoice()` 補單邊缺的資料——要補齊的話用「全部用手機／電腦」或逐列
自己按。`pair.test.ts` 原本把舊行為釘成測試（`onlyL` 期待 `'local'`），一併改成
期待 `'keep'`。

`npm run typecheck`／`npm test`（61 檔、797 項）全過。**尚未真機驗證。**

---

## 2026-08-16（續二）｜B-4／B-5／B-6 修正：真機測試揪出的三個小 bug

### B-4：同步完馬上點設定／角色會顯示「載入失敗」

切換模式時 `App.tsx` 的 attach effect 先同步 `detach()` 舊的、再非同步 `attach()`
新的，中間有一段 `deps === null` 的空窗。`appStore.ts` 原本只有 `getData()`
throw 一個「appStore not attached」——`SettingsView.tsx`／`CharacterEditor.tsx`
的 `load()` 把這個 throw 跟真的失敗混在一起看待，兩者都設 `failed = true`，
顯示「載入失敗」。

新增 `appStore` 的 `attached` 欄位（`attach()` 設 true，detach 的 cleanup 設
false），並讓 detach 順便把 `ready` 也歸零——不歸零的話 `App.tsx` 頂層的選單
按鈕判斷不出「現在其實接不上」，使用者照樣點得進設定／角色編輯。兩個畫面的
`load()` 改成：`catch` 裡先問 `isAttached()`，沒接上就安靜放棄（不設
`failed`），讓已有的 `if (!llm) 載入中⋯⋯`／`if (!draft) 載入中⋯⋯` 自然接手；
`useEffect` 依賴加上 `attached`，變 true 時自動重跑 `load()`。真的接上了卻還
失敗，才是貨真價實的失敗，才顯示「載入失敗」＋重試鍵。

### B-5：手機上傳圖片送出後第一時間看不到縮圖

`appStore.ts` 的 `handleEvent` 對 `'message'` 事件原本直接 `e.message as
MessageSnapshot` 硬轉型——但 `AppEvent` 的 `message` 欄位型別雖然標成
`Message`，兩種模式實際塞進去的形狀不一樣：獨立模式（`chat.ts`）塞的是真的
完整 `Message`（帶 `images: string[]`，沒有 `imageCount`）；遙控模式收到的
WS 廣播早被電腦端 `mobileServer.ts` 的 `sanitizeMessage()` 拿掉 `images`、
換算成 `imageCount` 送過來。獨立模式送出的使用者訊息回音取代樂觀訊息時，
把原本正確算好的 `imageCount`（`appStore.ts` 的 `send()` 那邊有算）蓋成
`undefined`，`MessageList.tsx` 的縮圖判斷 `if (message.imageCount)` 因此不
渲染——圖確實送出去了、角色也正確看得到，只是手機自己那則泡泡沒縮圖，
要等下一次 `state-invalidated` 重抓（`refresh()` 走的是不同的
`toMessageSnapshot()`，那支沒這問題）才會冒出來。

新增 `toEventMessageSnapshot()`：有 `imageCount` 就直接信，沒有才用
`images.length` 現算，兩條路徑都接得住。

### B-6：電腦上改對話名稱，手機上方標題列沒即時更新

遙控模式下切去獨立模式前，`ModeSwitcher.localSessionForSync()` 會自己 boot
一份「拋棄式」session 來跑同步比對（比對當下 `sessionHolder` 的 `current`
還是 null，遙控模式沒有活著的獨立 session）。同步把改動（例如對面改過的
對話標題）寫進**這份** session 的記憶體與磁碟，但緊接著的 `switchTo()` 會讓
`App.tsx` 的 attach effect 重跑，重新 boot **另一份**新 session——理論上兩份
都讀同一份磁碟，最終仍會收斂，但中間有雙重 boot 造成的時序空窗，使用者會
看到標題暫時沒更新。

直接讓 `ModeSwitcher` 把剛 boot 好的 session 塞進 `sessionHolder` 的
`current` 沒有用：`App.tsx` attach effect 的 cleanup **無條件**
`setStandaloneSession(null)`，而且 cleanup 一定搶在新 effect 本體之前跑，
塞進去的東西會在被讀到之前就被清掉（那段 cleanup 邏輯本身踩過好幾次坑，
不敢直接改）。改用另一個完全獨立的變數繞開：`sessionHolder.ts` 新增
`setPendingStandaloneSession`／`takePendingStandaloneSession`，`App.tsx`
進入獨立模式時優先收下這裡的 session，不再重複 boot。順手拿掉
`localSessionForSync()` 原本傳的 `skipPackFetch: true`——這份 session 現在
真的會被拿來用，裝置角色庫全空時（第一次用獨立模式）不該跳過抓預設角色包；
其餘裝置這個 fetch 一定會被 `seedDefaultCharactersIfEmpty` 的
`existingKeys.length > 0` 短路掉，不會多花時間。

三個都只是**自動測試通過，尚未真機驗證**。`npm run typecheck`／`npm test`
（62 檔、810 項）全過。

---

## 2026-08-16（續三）｜B-2／B-4／B-5／B-6 真機驗證通過

owner 在 Pixel 10a 逐項驗證了今天修的四個小 bug（B-2 保留差異快捷鍵、B-4
同步後載入失敗、B-5 圖片縮圖沒有樂觀更新、B-6 對話標題沒即時更新），
三項全部通過。`docs/handoff/real-device-checklist.md` 的「本次測試結論」
B-1～B-6 除了 B-3（無法重現，擱置）跟 M4 第 6 條補驗（開電腦端檔案核對），
其餘全部收尾。

---

## 2026-08-16（續四）｜v0.4.0 真機煙測：新聞泡泡揪出 3 個小 bug

配色主題（12 組）與遙控 owner 真機測過沒問題（多半是先前已測過、只是文件沒補記錄）。
新聞陪聊「聊這個」流程揪出三個獨立的小 bug：

1. **摘要視窗下緣被系統手勢列擋住**：`Composer.tsx` 裡「點輸入框上方新聞泡泡看摘要」
   那個 sheet 沒補安全區底部留白，是 `NewsContextSheet.tsx` 已經修過的同一個坑
   （Android 手勢列吃掉畫面下緣，按鈕按不到）——新的 sheet 是後來加的，沒沿用
   同一套處理。補上 `paddingBottom: calc(var(--safe-bottom) + 16px)`，高度改用
   `dvh`（不含網址列／手勢列動態高度的 `vh` 不夠）。

2. **不打字直接送新聞泡泡會誤報「送不出去：內容或圖片不符合限制」**：
   `main/mobileServer.ts` 的 `POST /api/send` 判斷「這是不是空訊息」時，條件裡
   有 `content`／`images`／`randomResult(s)`，但漏了 `newsLink`——手機端
   `Composer.tsx` 的 `submit()` 本來就允許「只掛新聞標題泡泡、不打字不附圖」
   直接送出，這一關卻把它當空訊息擋掉回 400，手機收到的錯誤訊息還誤導成
   「圖片太大或張數太多」。補上 `!payload.newsLink` 這個條件。

3. **某幾組配色下新聞標題幾乎看不到**：`MessageList.tsx` 裡已送出訊息的新聞標題
   用 `--mint2` 當文字色，疊在 `--user-bubble` 背景上。深色三組主題（深色／
   復古／賽博）的 `--mint2` 刻意調暗（原本設計是給邊框／強調色用，不是給文字用），
   跟同樣偏暗的 `--user-bubble` 疊在一起對比度趨近於零；淺色系粉彩主題裡兩者
   也常是同色系深淺相近的版本，一樣不夠清楚。改用泡泡本文本來就在用的
   `--text`——那是保證跟 `--user-bubble`／`--surface` 在所有 12 組主題下都
   讀得清楚的顏色，同一個泡泡裡已經在用。

三個都只有自動測試（`npm run typecheck`／810 項 `npm test`）驗過，`mobileServer.ts`
沒有既有測試骨架（`npm test` 範圍只到 `src/core/`），沒硬加。尚未真機覆驗。

---

## 2026-08-17｜S2 M5 設定同步補幾項漏掉的欄位（§2.1／§2.2）

owner 逐項決定 `docs/handoff/module-settings-audit.md` 的盤點結果：

- **輔助模型設定（§2.1）**：要同步。`core/sync/settingsSnapshot.ts` 的
  `LlmSyncSubset` 加 `utilityEnabled`／`utilityProvider`／`utilityModels`，
  逐 provider 拆列（比照既有的 `models`／`endpoints`），跟已經在同步的
  `endpoints` 是同一張表的另外幾欄，理由跟當初補 `weather.polish`一樣：
  手機 UI 已經做出來、卻永遠不會同步、也沒有任何錯誤訊息。執行端沿用既有的
  `/api/settings/llm-utility-*` 三支端點（本來就是給手機 UI 自己調用的）。

- **外觀（顯示模型徽章／發話身分名稱）跟新聞陪聊頻率（§2.2）**：也同步了，
  沿用既有端點，跟 `colorTheme` 是同一類單值偏好。

- **Spotify／日曆的 `enabled`**：owner 決定從比對範圍拿掉——這兩個模組的
  授權只接桌面（OAuth 跳轉流程），手機同步 `enabled: true` 也用不了，
  容易誤導使用者以為手機上能用。`settingsPair.ts` 加 `EXCLUDED_MODULE_IDS`
  白名單排除，id 對齊 `main/ipcHandlers.ts` 的 `SPOTIFY_MODULE_ID`／
  `CALENDAR_MODULE_ID`。

- **新聞其餘欄位沒有一起補**：`langMode`／`replyModel`／`maxAgeDays`／
  `readerMaxItems` 這些手機端**根本沒有讀寫路徑**——`NewsApi.getSettings()/
  saveSettings()`（`session.getNewsEditableSettings()`）跟桌面端
  `POST /api/news/settings` 的白名單都只認 `enabled`／`sources`／
  `keywordGroups`／`blacklist`／`speakButton` 五個欄位。要同步這些得先幫
  兩層都開洞，範圍比「加一列比對」大很多，這次只做了白名單裡本來就有、
  手機也調得到的 `speakButton`。

- **`keywordGroups`／`sources`（清單型）、`blacklist`／`excluded*`（聯集型）**：
  owner 決定先擱著。這類資料不能套簡單的三選一（會讓某一邊辛苦調的組整包
  消失或被覆蓋），得另外做一套類似對話同步的逐項比對／合併畫面，工程量
  接近一個新功能。

- **天氣 `realtimeQuery.enabled`、日曆細節設定**：套用跟 Spotify／日曆
  `enabled` 同一個判斷——功能本身桌面限定，手機沒有對應功能可以生效，
  不需要同步。

- **提醒同步**：owner 決定要同步提醒資料本身（逐項比對，比照角色／情境），
  但「哪台裝置響」跟裝置本地細節設定留在各自裝置、不進同步子集。**方向已定，
  尚未實作**——這是新的同步類別，工程量接近對話同步，還沒動工。

`npm run typecheck`／`npm test`（62 檔、819 項）全過。全部只有自動測試驗過，
尚未真機驗證。

## 2026-08-18｜飲食記錄 App：B9a UI 四項微調＋Health 讀提前排程

owner 用過 B9a 之後回報四個 UI 問題，桌面／手機（`nutrition/desktop`、
`nutrition/mobile`）都同樣修：

- **快速入帳選食物看不出是哪一種**：`food-option` 選項比照食物庫列表加上
  品牌／口味小字（`food-option-name`），跟同名不同品牌／口味的食物能一眼分開。
- **「新增食物」按鈕不夠明顯**：快速入帳卡片裡的按鈕從 `icon-button`
  改成 `add-food-button`（實心底色），跟旁邊其他次要按鈕拉開視覺層級。
- **食物表單返回會固定跳食物庫**：`openFoodForm()` 加 `origin` 參數
  （`library`／`quickEntry`／`mealEditor`），`leaveFoodForm()`／存檔後都
  改呼叫新的 `returnFromFoodForm()` 依來源導回——從快速入帳點「新增食物」
  存完／取消會回快速入帳（並重新展開），不會被丟去食物庫。
- **編輯飲食紀錄只能改當筆用到的欄位**：在 `mealEditor` 底下加
  「食物庫資料」區塊，文字講清楚這些欄位（品牌／口味／別名／標籤／碳水
  脂肪／照片）存在食物庫、不是這筆紀錄的一部分；按「編輯食物庫資料」直接
  開現有的食物表單（`openFoodForm(linkedFoodItem, 'mealEditor')`），
  沿用同一套 UI 與存檔邏輯，不重複造欄位，改完存檔後照 origin 導回
  `mealEditor`。

另外 owner 要求把 Google Health 讀（體重／體脂雲端同步、手錶當日消耗熱量
→ 動態調整 `dailyKcalLimit`）從 B9c 提前到 B9b（LLM 拍照估價）之前，理由：
拍照估價有「先手動輸入」可以頂著，體重／體脂／手錶消耗熱量目前完全沒有
替代輸入路徑，owner 自用天天要看。**這次只更新規格排程**
（`future-nutrition-module.md` §3.5／§6／§8 已改），還沒有寫任何 Health
串接程式碼——Health Connect／Google Fit 的 OAuth、權限、真機測試留到真的
開工那一輪再做。

`npm run typecheck` 全過；`tests/core/nutrition/*` 8 檔 38 項全過（這次只動
UI 層，沒有改 `core/`，資料模型／純函式不受影響）。這次沒有真機／模擬器
手動驗證。

## 2026-08-19｜飲食記錄 App：Health 讀（B9-Health-lite）真機驗證通過，修掉 3 個真機才會出現的 bug

分支 `feat/nutrition-health-connect`。owner 在家用真機（Android 手機＋
Pixel Watch＋MovingLife 體重計）走完整套流程，開工指令
`docs/nutrition-health-lite-kickoff.md` §7 步驟①的兩個開放問題當場確認：
手錶來源 App 是 Watch / Health，體重計是 MovingLife；開關 2（自動同步）
預設開（跟程式碼原本寫死的一致，不用改）。

真機組 APK、跑起來後陸續揪出 3 個自動測試完全測不出來的 bug：

- **`minSdkVersion` 太低，Gradle build 直接失敗**：`@capgo/capacitor-health`
  的 manifest 要求 `minSdk 26`（Health Connect 的正式最低支援版本），這個
  App 沿用 DeST 主 App 的 `minSdkVersion = 24`。manifest merger 報錯
  「uses-sdk:minSdkVersion 24 cannot be smaller than version 26」。改成
  26 才編得過——**代價是 Android 7.x 裝置從此裝不了這個 App**，owner 自用
  機器沒問題。
- **體重同步到好幾週前的舊數字**：根因是 `@capgo/capacitor-health` 原生層
  的分頁邏輯（`HealthManager.kt` 的 `readRecords()`）湊到 `limit` 筆就停止
  翻頁，但 Health Connect 不保證分頁本身是新到舊排序。體重／體脂原本用
  `limit: 5`，在 30 天視窗裡真機實測會抓到「30 天內最舊的 5 筆」而非最新
  5 筆，導致同步進 `BodyProfile` 的體重跟 Google Health App 顯示的差很多。
  改成外掛單頁上限 `500`（跟 `totalCalories` 原本就用的值一致）——500 遠
  超過 30 天內正常量測次數，一次就能蓋滿整個時間窗，之後排序取最新才有
  意義。`totalCalories` 因為本來就用 500，這次真機比對只有約 50 kcal 的
  小誤差，量級上印證了同一個根因。
- **體重／體脂帶一長串小數**：Health Connect 的公斤數是從來源 App 單位
  （常見是磅）換算來的，換算會拖出浮點數尾巴。加了 `roundToOneDecimal()`，
  讀進來就四捨五入到小數點後一位。

owner 追加了一個原規劃沒有的需求：翻到過去的日期時，也顯示「當日手錶總
消耗熱量」當作那天的熱量上限。因為過去的一天已經過完，§5.1 公式的「剩餘
時間外推」項自然歸零，不需要新公式——只需要新的查詢方式：`HealthAdapter`
加 `readDailyCaloriesBurned(dateIso)`（查某一整天的加總，跟「今日到現在」
的 `readSnapshot()` 不同），`main.tsx` 用 `historicalKcalCache` 依日期
快取查詢結果避免翻頁反覆打 Health Connect。真機比對 Google Health App，
誤差同樣落在約 50 kcal 內。

另外照 owner 要求在「Health 同步」設定區塊加了兩行簡短說明（讀 Health
Connect／Google Health 背後同一份資料，已驗證 Pixel Watch 與 MovingLife，
其他品牌未實測），第一版字數太長，砍半到兩行。

驗證通過的完工判準（`nutrition-health-lite-kickoff.md` §8）：三個開關的
預設值與隱藏/顯示邏輯、開啟開關 1 走一次授權流程、開關 2 自動/手動同步、
體重體脂同步寫回並顯示「上次同步」時間、開關 3 開關切換時 `dailyKcalLimit`
本身完全不被動態值覆蓋、Health Connect 未安裝時自然降級、桌面完全沒有
新增 Health 相關程式碼。**沒驗證到的兩條**（次要，不阻擋收工）：拒絕權限
的 UI 分支（owner 這輪一路都允許）、資料是舊的（非今日）時的提示文案
（這輪真機資料一直是新鮮的）。

`npm run typecheck`、`npm test`（71 檔、861 項）全過。

---

## 2026-08-19（續）｜拍照估熱量 P1：core 純函式＋單元測試

B9b 第一個切片開工，規格見 `docs/nutrition-photo-estimate-plan.md`。這次只做
**P1**（該文件 §7 分期表第一項）：`src/core/nutrition/photoEstimate.ts` 一次
到位，含規格 §6 列出的所有純函式——`matchFoodItem`、`buildPhotoEstimatePrompt`、
`parseEstimateResult`、`applyEstimateToEntries`、`resolveEatenAt`、
`hashPhoto`／`findDuplicateLog`、`resolveMaxFoodSlots`／`canAddAnotherFoodSlot`、
`estimateRequestCost`、`checkRequestCompatibility`、`parsePastedNutrition`、
`normalizeLabel`、`nutritionFromGrams`、`stepServings`／`formatServings`。
`hashPhoto` 直接複用既有的 `core/util/sha1.ts`（新聞模組已經寫過同一顆輪子）。

`types.ts` 同步補齊 §6 的資料欄位：`FoodNutritionPerServing` 加
`sugarG`／`sodiumMg`；新增 `FoodNutritionLabel`／`NutritionLabelBasis`；
`FoodItem.source` 擴充 `label`／`llm-photo`／`llm-photo-edited`（`label`
最硬，之後任何 LLM 路徑都不准覆寫）；`FoodItem` 加 `labelRaw`／`lastAmount`；
`MealLog` 加 `amountMode`／`grams`／`eatenAtSource`／`photoHash`／
`photoHashes`／`estimatedCostMinor`／`tokenUsage`；`NutritionAppSettings`
加第三層開關 `photoEstimate?: { enabled }`（規格 §2.10 拍板，**預設關**）。

`normalizeLabel` 的 `per100g` 基準換算要特別注意 `eatenPortion` 的意義隨
`basis` 而變：`perServing`／`perPackage` 時是「吃了幾份／幾包」，直接當乘數；
`per100g` 時卻是「吃了幾個『一份量 × 份數』的包裝單位」，要先乘出總克數
再除 100——規格文件裡的 JSON 範例三個基準都叫同一個欄位 `eatenPortion`，
但語意其實不同，寫測試時發現規格範例自己的數字（sugarG／sodiumMg 那兩欄）
兜不起來，判斷是文件手寫範例本身的四捨五入誤差，沒有照抄，改用內部自洽
的數字驗證邏輯正確性。

`estimateRequestCost` 的圖片 token 估值（`FIXED_MODEL_IMAGE_TOKENS`／
`TILED_MODEL_IMAGE_TOKENS`）規格沒給精確數字，用業界常見的量級抓一個
保守估值——反正這行字本來就標「（估）」，且單價表本身也可能是使用者自填。

**這次只做 P1**，還沒有：手機／桌面 UI、真的呼叫 LLM、拍照入口、補充頁、
份量 stepper 元件、`model-capabilities.json` 執行期檔案（型別已定義，
資料檔案是 P2.8 的事）。下一步是 P2（手機拍照→結果卡→存入的三步正常路徑）。

`npm run typecheck`、`npm test`（72 檔、894 項）全過。

---

## 2026-08-19（續二）｜拍照估熱量 P2：接真模型＋手機三步正常路徑

延續（續）的 P1，這次做 P2（§7）：真的呼叫模型、手機拍照→結果卡→存入。
**範圍刻意縮小到單張照片、單份食物**——多份食物、送出前補充頁、營養標示、
相簿補記都還沒做，那些是 P2.5 之後的分期，先把「拍一張、存一筆」的骨架
跑通、真的接上模型，比一次把全部功能疊起來更容易抓錯。

**core 新增** `src/core/nutrition/photoEstimateLlm.ts`（`requestPhotoEstimate`）：

- 走 OpenAI 相容的 **Chat Completions**（`/v1/chat/completions`），不是
  `openai.ts` 那條走的 Responses API——這支是本地模型伺服器（Ollama／
  LM Studio）最普遍支援的格式，且不想把 `openai` SDK 這個重依賴拉進
  `nutrition/mobile` 這個目前很輕量的獨立小 App（它的 `package.json`
  只有 4 個 Capacitor 套件）。直接用注入的 `HttpAdapter` 打 fetch，
  `response_format: json_object` 要求模型回 `{ "results": [...] }`
  （json_object 模式要求根節點是物件，不能直接回陣列）。
- 只支援 `openai`／`local`／`grok` 三家（都是 OpenAI 相容格式）；Claude／
  Gemini 圖片格式不同，且 nutrition.llm 是獨立於角色主模型的一套設定，
  暫不支援，丟明確錯誤而不是靜默失敗。
- 逾時外部自己包 `AbortController`＋`setTimeout`（規格 §3.3 建議 12 秒）——
  跟 CLAUDE.md §5 提醒的「CapacitorHttp 忽略 signal」是同一個坑，這支雖然
  目前用瀏覽器原生 fetch，但寫法上不依賴呼叫端的 signal 生效，先把保險絲
  裝上。
- 9 項新測試（假 `HttpAdapter` 驗證請求 URL／body／逾時／各種錯誤情境）。

**手機 UI**（`nutrition/mobile/src/main.tsx`）新增第三層開關「AI 拍照估算」
（`docs/nutrition-photo-estimate-plan.md` §2.10，預設關）：

- 設定頁（「身體資料與每日目標」畫面）新增一個區塊，開關開啟時同一頁
  能設 `nutrition.llm`（供應商／模型／API Key／端點），不必跳到別的設定頁。
- 開關關閉時，日常首頁「拍照記錄」入口整個不渲染（不是變灰）。
- 拍照流程：相機直接開（`<input capture="environment">`）→ 壓縮
  （沿用既有 `compressImageFile`，跟食物庫照片同一套管線）→ 呼叫模型
  → 本機 `matchFoodItem` 比對食物庫（命中就沿用庫內數字，不採用 AI 的）
  → 結果卡（名稱／品牌／熱量／蛋白／來源徽章／`note`）→「存入」一次寫
  `FoodItem`（未命中時）＋`MealLog`；「不對，我改」直接把估算結果帶進
  **既有的食物新增表單**（不重造一套編輯 UI，複用 `openFoodForm` 那一路
  的欄位與存檔邏輯）。
- 新增 `nutrition/mobile/src/http.ts`：這個獨立 App 目前沒有裝
  CapacitorHttp（跟 DeST 主 App 不同），直接用瀏覽器原生 fetch 實作
  `HttpAdapter`——之後若要繞 CORS 打本地模型，這是要補的地方。

**順手修掉一個潛伏 bug**：`src/core/nutrition/storage.ts` 的
`normalizeSettings()` 過去手動列出 `llm`／`health` 兩個欄位重建整個
settings 物件，**沒有把 `showWeightBadge`（上一輪剛加的體重徽章開關）
轉存過去**——代表那個開關每次重開 App 讀檔案時都會被靜靜清空。這次加
`photoEstimate` 時發現同一個坑，一併補上兩個欄位並加了回歸測試
（`storage.test.ts` 新增一筆：寫入含這兩欄位的 settings.json，讀回來
要原封不動）。這類「加一個頂層設定欄位」的坑以後還會再踩，寫在
`normalizeSettings` 旁邊的註解提醒了。

**手機端手動驗證**（瀏覽器預覽 + mock fetch，非真機）：`npm run
build:nutrition:mobile` 建置成功後，用 Browser 工具跑了一次完整路徑——
開關開啟後「拍照記錄」按鈕出現 → 塞一張假圖片並攔截 `fetch` 回傳假的
模型回應 → 結果卡正確顯示「燻雞三明治 · 7-11 · 約 320 kcal · 蛋白 18 g」
→ 按「存入」→ 回到今日列表，熱量／蛋白數字正確累加、清單多一筆紀錄，
全程 console 無錯誤。**這不是真機驗證**，Capacitor 原生層（相機權限、
CapacitorHttp 若之後補裝）完全沒測到。

尚未做（P2.5 起）：多份食物與翻頁確認、送出前補充說明頁、營養成分表
OCR 與換算、秤重模式、相簿補記批次流程、模型能力／費用預估 UI、
「不對，我改」的對話式重估、舊食物一鍵重估。

`npm run typecheck`、`npm test`（73 檔、904 項）全過。

---

## 2026-08-19（續三）｜拍照估熱量：模型清單下拉＋一鍵測試能不能傳圖

owner 實測 P2 時回報兩個上手障礙：模型欄只能手打型號 ID（跟 DeST 桌面／
手機那份共用模型目錄體驗不一致，光要湊對一個型號名稱就卡關）；設完
才發現選錯模型不支援讀圖，白設一輪。兩個都在這次補上。

**模型清單**：`nutrition/mobile/src/main.tsx` 直接從 `@core/llm/modelCatalog`
（純資料，不含任何 SDK）拉 `MODELS_BY_PROVIDER`／`DEFAULT_MODEL_BY_PROVIDER`／
`splitModelsByPrice`／`modelPriceText`——跟桌面／DeST 手機共用同一份目錄，
之後桌面加新型號這裡自動跟上，不會重蹈 roadmap §4.1 提過的模型清單
drift（`providerInfo.ts` 檔頭記載的同一個坑）。`modelOptionLabel()` 沒有
直接從 `providerInfo.ts`（DeST 手機自己的 UI 文案層）import——那支已經
耦合了 DeST 手機的其他 UI 型別，硬拉進來會把 nutrition 這個獨立小 App
跟主 App 的手機 UI 層綁在一起；改成在 nutrition 這邊用同樣兩行邏輯
（`modelPriceText` + 組字串）自己重寫一份，型別/資料仍是同一份，
只有那行組字串的文案重複，不算違反單一事實來源。

**下拉選單分兩層**：`local` 供應商本來就沒有寫死目錄（使用者自己 pull
什麼就有什麼），下拉清單改吃「測試連線」按鈕動態抓回來的
`localModels`；`openai`／`grok` 吃靜態目錄，並用 `splitModelsByPrice`
分「一般／⚠ 高單價」兩個 `optgroup`，跟桌面／DeST 手機的分組規則同一份。
選單下方保留一個「或手動輸入模型 ID」文字欄——清單不可能永遠跟得上
新模型發布，兩者共用同一個 `llmSettings.model` 狀態，選或打都算數。
切換供應商時 (`changeLlmProvider`) 自動帶出 `DEFAULT_MODEL_BY_PROVIDER`
的預設值，不會讓舊供應商選過的型號卡在欄位裡誤導使用者。

**core 新增兩支函式**（`src/core/nutrition/photoEstimateLlm.ts`）：

- `testNutritionLlmConnection`：`GET /v1/models`，local 用來抓實際模型
  清單（上限 200），雲端供應商純粹驗證 Key／端點有效（上限 5，跟桌面
  `testLLMConnection` 的量級一致）。
- `testPhotoEstimateVision`：owner 這次明確要的「一鍵測試能不能傳圖」——
  送一張 1×1 透明像素 PNG（體積接近零）＋簡短指令「看得到就回『可以讀圖』」，
  故意跟 `requestPhotoEstimate` 分開一支、不要求 JSON 格式，這樣失敗時
  好判斷是「模型真的不支援讀圖」還是「JSON 格式沒照指示回」兩種不同問題。
  空回應或回覆內容講到「無法／看不到」的情況都判定失敗（有些模型看不到圖片
  時不會老實說看不到，而是照樣掰一段話，所以不能只看「有沒有回應」）。
  兩支跟 `requestPhotoEstimate` 共用抽出來的 `fetchWithTimeout()` 與
  `checkBasicRequestPreconditions()`，避免第三次複製貼上同一段逾時／
  前置檢查邏輯。

**手機 UI**：設定頁新增「測試連線」（local 顯示「測試連線（抓模型清單）」）
與「一鍵測試能不能傳圖」兩顆按鈕，結果訊息用 `.hint.danger-text`
（新色票）跟一般提示區分。兩顆按鈕與模型清單邏輯都用瀏覽器預覽
＋ mock `fetch` 驗證過：openai 選 `gpt-4o-mini` 測讀圖成功顯示
「✅ 這個模型可以讀圖」，換一個回「無法看到圖片」的假回應顯示
「❌ 模型回應顯示看不到圖片內容」；local 供應商測試連線後下拉選單
正確填入 `qwen3:8b`／`llama3.2-vision:11b`。

8 項新測試（`testNutritionLlmConnection` 4 項、`testPhotoEstimateVision`
4 項），加上既有 9 項 `requestPhotoEstimate` 測試維持全過（重構抽出共用
函式沒改變外部行為）。

`npm run typecheck`、`npm test`（73 檔、912 項）全過；
`npm run build:nutrition:mobile` 建置成功。

---

## 2026-08-19（續四）｜拍照估算修 3 個 owner 實測回報的問題

owner 實測上一輪的模型清單／測讀圖功能，選 OpenAI 卻還看得到「端點」欄位、
測連線說「已連線找到 5 個模型」但不確定連到哪、選 `gpt-5.6-luna` 一鍵測讀圖
回 400。三個都修了：

1. **`gpt-5.6-luna` 400 錯誤（根因）**：gpt-5／o 系列（推理模型）的
   Chat Completions **不接受 `max_tokens`**，要用 `max_completion_tokens`
   ——跟 `core/llm/openai.ts` 的 `shouldOmitTemperature()` 判斷同一批模型
   （`/^gpt-5(\.|-|$)/i` 或 `/^o\d/i`），只是換了要繞的參數。
   `photoEstimateLlm.ts` 新增 `reasoningAwareParams()`，兩個呼叫模型的
   函式（`requestPhotoEstimate`、`testPhotoEstimateVision`）都改用它。
   順手處理了第二個坑：推理模型的**推理本身會佔用同一份 token 預算**，
   讀圖測試原本的 20 tokens 很容易被推理吃光、正文回空字串（看起來像
   「沒反應」而不是「不支援讀圖」）——加 `reasoning_effort: 'minimal'`
   把推理壓到最低，並把測試用的預算下限拉到 300。
2. **openai 供應商為什麼有端點欄位**：那個欄位其實是給「走 OpenAI 相容
   代理」這種進階情境用的，但攤平顯示在主要欄位裡讓人誤以為必填。
   照桌面／DeST 手機（`SettingsView.tsx` 的「進階」收合區）同樣的處理方式，
   雲端供應商（openai／grok）的端點欄位收進 `<details>「進階：自訂端點」`，
   `local` 供應商維持攤平顯示（那裡是必填）。
3. **「已連線，找到 5 個模型」到底連到哪裡**：這句話本身沒錯——雲端供應商
   固定只列前 5 筆當連線佐證（跟桌面 `testLLMConnection` 同一個量級），
   拿去 OpenAI 官方 API 驗證 Key 有效而已，UI 補一句「雲端只列前 5 筆佐證
   連線成功，實際可選的模型看下面的下拉清單」講清楚。
   **但過程中發現一個真正的 bug**：`NutritionLlmSettings.endpoint`
   原本是單一扁平欄位（不像 `apiKeys` 是 per-provider 的
   `Record<string,string>`），切供應商時舊值會被錯誤沿用——例如切去
   `local` 測完填了 `http://localhost:11434/v1`，切回 `openai` 那個
   位址還在，下一次請求會送去錯的地方。這正是 CLAUDE.md §5「llm.endpoint
   是遺留欄位」記載的同一類坑，只是這次出現在 nutrition 模組自己那份
   獨立設定裡。改成 `endpoints?: Record<string, string>`，比照
   `apiKeys` 做成 per-provider（`types.ts`／`storage.ts` 正規化／
   `migrationPack.ts`／`photoEstimateLlm.ts` 的 `resolveBaseUrl`／
   `main.tsx` 的兩個端點輸入框都一併改掉），新增回歸測試覆蓋「切供應商後
   端點互不影響」與「endpoints 正規化後維持 per-provider」。

新增 3 項測試（`max_completion_tokens` 行為 2 項、endpoint 隔離 1 項）
＋ storage 正規化 1 項，共 4 項；瀏覽器預覽 + mock fetch 重新驗證
`gpt-5.6-luna` 讀圖測試，body 正確帶 `max_completion_tokens: 300` ／
`reasoning_effort: 'minimal'`、不帶 `max_tokens`，顯示「✅ 這個模型可以讀圖」。

`npm run typecheck`、`npm test`（73 檔、916 項）全過；
`npm run build:nutrition:mobile` 建置成功。

---

## 2026-08-19（續五）｜拍照估算加 Claude、修 local CORS 提示與 grok 端點 bug

owner 三個新回報：本機模型連不上、OpenAI 選另一個型號還是 400、Claude 選項不見了。

1. **加 Claude（Anthropic）供應商**。之前只支援 OpenAI 相容的 Chat
   Completions（openai／local／grok），Claude 的 Messages API 形狀完全不同
   （端點 `/v1/messages`、`x-api-key` 不是 `Authorization: Bearer`、
   圖片是 `{type:'image', source:{type:'base64', media_type, data}}`
   不是 `image_url`、回應是 `content[].text` 不是
   `choices[0].message.content`）。`photoEstimateLlm.ts` 抽出
   `buildContentParts()`／`buildRequestHeaders()`／`extractReplyText()`
   三個依供應商分流的小函式，三個對外函式（估算／測連線／測讀圖）都改
   吃這幾支，不必各自維護一份 if-else。**沒用 `@anthropic-ai/sdk`**——
   跟先前不用 `openai` SDK 的理由一樣，維持 nutrition/mobile 這個獨立小
   App 的依賴精簡，直接發 fetch＋手動組 header。Anthropic 官方 API
   預設擋瀏覽器直連（CORS），要多帶一個 `anthropic-dangerous-direct-
   browser-access: true`——這正是 `@anthropic-ai/sdk` 的
   `dangerouslyAllowBrowser: true` 底下實際做的事（`core/llm/claude.ts`
   用 SDK 蓋掉了這個細節，這裡沒用 SDK 所以要自己補上）。手機供應商下拉
   新增「Anthropic Claude」選項，模型清單一樣吃 `@core/llm/modelCatalog`
   的 `CLAUDE_MODELS`，不必另外維護。
2. **OpenAI 換一個模型還是 400**：上一輪加的 `reasoning_effort: 'minimal'`
   是沒有文件佐證的猜測，這次很可能是新的根因——不同 gpt-5 子型號支援的
   `reasoning_effort` 取值不見得一樣，猜錯一樣會 400。**拿掉這個猜測**，
   改成通用機制：`postJsonWithParamFallback()`——送出後若收到 400 且錯誤
   訊息符合 OpenAI 文件的固定格式「`Unsupported parameter: 'X'`」，就把
   該參數從 body 拔掉重送一次（僅一次，不無限重試）。這樣不管未來還踩到
   哪個「這個模型不吃這個參數」的組合，都不必事先猜對，讓錯誤訊息自己講。
   `max_completion_tokens`（有 OpenAI 文件佐證的必要修正）保留。
3. **本機模型連不上**：`describeNetworkError()` 補一句可行動的提示——
   瀏覽器 CORS 失敗時 JS 拿到的訊息一律是無意義的
   `TypeError: Failed to fetch`（瀏覽器基於安全考量刻意不透露細節），
   猜不出真正原因，所以改成「猜最常見的成因」直接講給使用者：
   Ollama 預設不開放跨來源存取，要設 `OLLAMA_ORIGINS=*` 或確認位址/埠號、
   同一區網。這不是修 bug（技術上沒有東西能修——`fetch` API 本身就是這樣
   設計的），是把猜測的診斷步驟直接寫進錯誤訊息，省得使用者自己爬文。
4. **順手修一個沒人抓到的 bug**：`resolveBaseUrl()` 原本沒填端點時**一律**
   退回 `https://api.openai.com/v1`，包含 `grok`——代表 Grok 沒填端點時
   會悄悄把請求（帶著 Grok 的 Key）送去 OpenAI，只會 401，且訊息不會
   提到「端點錯了」。改成 `grok` 沒填端點時退回官方 `https://api.x.ai/v1`
   （跟 `core/llm/index.ts` 的 `endpointForProvider()` 同一個預設值），
   `claude` 同理退回 `https://api.anthropic.com/v1`。

6 項新測試（Claude 估算／讀圖各 1、grok 預設端點 1、400 重試機制 2、
不支援供應商改用真的不支援的 gemini 驗證）。瀏覽器預覽 + mock fetch
驗證 Claude 端到端（讀圖測試顯示「✅ 可以讀圖」，headers/URL 正確）與
local 的新錯誤訊息（顯示 OLLAMA_ORIGINS 提示）。

Gemini 仍未支援（圖片格式又不同，且目前沒人要求），供應商清單裡就不
列出來，避免使用者選了才發現不能用。

`npm run typecheck`、`npm test`（73 檔、921 項）全過；
`npm run build:nutrition:mobile` 建置成功。

---

## 2026-08-19（續六）｜拍照估算補上送出前補充說明頁（提前把 P2.6 的核心搬進 P2）

owner 實測回報：拍好幾張都被 AI 猜回一堆「？」，浪費 token。根因是 P2
範圍刻意先跳過規格 §2.7「送出前補充說明頁」，直接拍完就送出——但
`docs/nutrition-photo-estimate-plan.md` §1 原則 5 早就講清楚「文字比讓
模型從圖上猜準得多」，沒有這一步，AI 只能憑空猜測，猜錯基本欄位（連
「這是三明治還是便當」都猜不到）自然全部問號。

不等 P2.6 排到再做，直接把這個核心體驗補進 P2：選好照片後**不直接送**，
先進一個可留白的補充說明頁（一個 `<textarea>`＋照片縮圖預覽），按「估算」
才真的呼叫模型。`estimatePhase` 加一個 `noteInput` 中繼狀態；
`requestPhotoEstimate` 的 `note` 參數其實在 P1／P2 就已經接好了
（`photoEstimateLlm.ts` 的 prompt 組裝本來就有處理 `note`），這次只是
**手機 UI 真的把這個欄位露出來**——之前 P2 為了衝三步流程直接跳過了。

- `pickEstimatePhoto()`：選完照片先存 `File`＋建立預覽 blob URL，phase
  切到 `noteInput`，不呼叫 `compressImageFile`／不打 API。
- `submitEstimate()`：這時才真的壓縮＋呼叫模型，`estimateNote.trim()`
  留白時傳 `undefined`（純依圖片判斷，跟原本行為一致）。
- `resetEstimateState()` 一併清掉 note／file／預覽 URL（含
  `URL.revokeObjectURL`，避免累積孤兒 blob）。
- 「重試（重新選照片）」也改走 `pickEstimatePhoto`，讓使用者重試時能
  補一句說明，而不是繼續盲猜。

瀏覽器預覽驗證：選照片後正確停在補充說明頁（不會自動送出）；填入
「燻雞三明治，7-11，吃了一整份」後攔截 `fetch` 讀出實際送出的 prompt，
確認補充說明原文有出現在 `使用者補充說明：` 那一行；結果卡正確命中
食物庫既有紀錄（示範了規格 §2.3「文字講到名稱→本機比對→沿用庫內數字」
那條路徑）。

這次沒做的（仍在 §7 分期表）：多份食物分槽、份量 stepper、秤重模式、
營養標示 OCR——補充說明頁目前只有一個文字欄，不含這些。

`npm run typecheck`、`npm test`（73 檔、921 項）全過；
`npm run build:nutrition:mobile` 建置成功。

---

## 2026-08-19（續七）｜「一直回問號」的真正根因：prompt 從沒告訴模型輸出格式

owner 加了補充說明之後**還是回一堆問號**，並問「我平常用自己的 AI 網頁介面
都估得出來啊」。這句話就是關鍵線索——模型看得懂圖、也答得出來，**錯的是
我們沒告訴它要怎麼回**。

**根因**：`buildPhotoEstimatePrompt()` 從頭到尾只說「請以 JSON 回覆，每個
元素為**規格所述**的單份食物估算結果」——但那份「規格」在 `docs/` 裡，
**從來沒有被送進 prompt**。模型只能自己發明欄位名（`熱量`／`calories`／
`protein`…），而 `parseEstimateResult()` 只認 `perServing.kcal`／
`perServing.proteinG`，一律 parse 成 `null` → UI 顯示「？」。
症狀極具迷惑性：模型其實運作正常、token 也真的花了，錯在我們這端的契約
只寫在文件裡、沒寫進請求裡。**這類「兩邊各有一份格式定義」的漂移，
CLAUDE.md §5 在 M4 `contentHash.ts` 那次已經記過一模一樣的教訓**，
只是這次漂移的另一半不是另一個模組，而是「文件 vs. 實際送出的 prompt」。

順帶一提，舊 prompt 還自相矛盾：`buildPhotoEstimatePrompt()` 結尾說
「請以 JSON **陣列**回覆」，呼叫端又接了一句「請回傳一個 JSON **物件**，
格式為 `{ "results": [...] }`」。已合併成單一份格式說明，只留在 prompt 組裝那支。

修法三層（由內而外）：

1. **prompt 逐欄寫出完整輸出格式**（含註解的 JSON 範例＋`label` 子物件格式）。
   欄位名稱與大小寫必須完全一致這件事直接寫在 prompt 裡。
2. **明講 `kcal`／`proteinG` 不得回 null**：謹慎的模型碰到看不清楚的照片會
   傾向留空，但在這個 App 裡「誠實的 null」等同估算失敗——使用者要的是一個
   可以先存、之後再改的數字。不確定時改用 `confidence: "low"` 表達。
3. **解析器放寬當防禦層**：認 `calories`／`protein`／`carbohydrates` 等近義名，
   營養數字攤在最外層（沒包進 `perServing`）也撈得到；只有熱量沒有蛋白質時
   蛋白補 0 而不是整筆作廢（能存下熱量比顯示「？」有用），**只有連熱量都沒有
   才回 null**（那才是真的失敗）。

**同時做掉 owner 要的多張照片**（規格 §2.6 拍法 A：包裝正面＋營養成分表＋
內容物，本來就是準確率最高的拍法，而且成分表那張才是數字準的關鍵）：

- 補充說明頁改成照片格（上限 3 張＝`FoodItem.photoKeys` 上限），可多選、
  可逐張移除，按鈕顯示「估算（N 張）」。
- **多張一律當成同一份食物**（都送 `slot: 1`），新食物存入時依序寫進
  `photoKeys`；命中既有食物時只把第一張留成該餐的紀錄照，不動食物庫。
- 圖片前的標註從「（以下圖片屬於 slot 1）」改成「（第 N 張照片，與其他照片
  **同屬一份食物**）」——只標 slot 的話模型會把 3 張照片當成 3 份食物回 3 筆。
  多份食物時（未來 §2.6.1）則標「第 N 份食物」，兩種措辭都有測試守著。
- 失敗頁多一顆「回上一步改說明再試一次」：估錯時最有效的動作是補一句話，
  而不是重選同一批照片盲猜。

**過程中抓到一個自己剛引入的 bug**：`addEstimatePhotos()` 原本把
`URL.createObjectURL()` 這個副作用寫在 `setState` 的 updater 函式裡，
而 updater 必須是純函式——React StrictMode 刻意雙呼叫來抓這種寫法，
結果每張照片被建兩個 blob URL（畫面出現 6 張縮圖、而且洩漏 blob）。
瀏覽器預覽一跑就看到縮圖數量不對。已改成在 updater 外面先算好；
`removeEstimatePhoto()`／`resetEstimateState()` 的 `revokeObjectURL`
同樣移出 updater，並改用 ref 追蹤目前活著的 URL——後者會在存檔完成的
`.then()` 裡被呼叫，那時 closure 抓到的 state 可能已經過期，少 revoke
一個就是一個永遠不會被回收的 blob。

9 項新測試（prompt 必含各欄位名／必含「不得填 null」／必含「同一份食物可能
有多張照片」、解析器 4 種寬鬆情境、多張同屬一份的標註、多份食物的 slot 標註）。
瀏覽器預覽驗證：一次選 3 張正確顯示 3 格縮圖（不是 6 格）、移除一張後
加號格回來且按鈕變「估算（2 張）」、送出的 request 確認 2 張圖都在、
標註寫「同屬一份食物」、補充說明在 prompt 末端、結果卡顯示真實數字
（210 kcal · 蛋白 24 g · 依營養標示）而不是問號。

⚠️ 預覽 console 有 `createRoot() on a container that has already been
passed` 警告，那是 dev server HMR 重跑模組造成的既有雜訊
（`git diff` 確認 `createRoot` 那段本次完全沒動），APK 沒有 HMR 不受影響。

`npm run typecheck`、`npm test`（73 檔、930 項）全過；
`npm run build:nutrition:mobile` 建置成功。

---

## 2026-08-19（續八）｜**prompt 大幅瘦身**：規則堆太多反而把估算值推高

修完問號後 owner 回報估出來的熱量「比之前用網頁估的多好多」，先猜是
「我拍食物都用手當比例尺，但我的手比一般人小很多」。接著他提出更關鍵的
一句話：**「我去網頁 LLM 只說『如果我拍食物照片，請幫我計算熱量、蛋白質、
碳水化合物、脂肪、糖、鈉』，沒有給任何額外 prompt，你是不是自作主張加太多了」**。

**是的，加太多了，而且其中一條正在主動製造這個偏差。** 檢討如下：

`buildPhotoEstimatePrompt()` 一路長到八條規則，其中：

- 規則 3 尾巴那句「用可見的份量線索推份量，**不要一律預設一份**」——
  這等於叫模型別保守、從畫面往大推。配上偏小的比例尺（owner 用自己的手）
  就是系統性高估。**體積是長度的三次方**，線性差 20% 就是體積差約 1.7 倍。
- 更糟的是我當下的第一反應：再加一條規則 7「**寧可保守也不要高估**」去對沖。
  **用偏見抵銷偏見**只會讓行為更難預測，兩條都該刪掉而不是留著互相拉扯。

所以這次把規則砍到只剩**結構上非有不可**的三行（幾乎就是 owner 自己那句話）：

```
請看照片估算食物的熱量、蛋白質、碳水化合物、脂肪、糖、鈉。
同一份食物可能有多張照片（包裝正面、營養成分表、內容物），請合併判讀成一筆結果。
照片中有營養成分表時，數字以標示為準，不要用經驗值覆蓋。
```

保留 JSON schema 那一大段——**那是我們跟網頁介面唯一真正的結構性差異**
（人可以用讀的，程式要 parse），拿掉就回到「一片問號」那個 bug。
第二行是多張照片的功能需求，第三行是實質正確性（有標示卻用經驗值猜是錯，
不是風格偏好）。函式檔頭寫下判準：**想加規則前先問「這是在補結構性缺口，
還是在微調模型的判斷傾向」——後者不要加**，改用下面兩個機制。

配套做了兩件讓使用者自己掌握、而不是我在 prompt 裡猜的事：

1. **比例尺校正設定**（`NutritionAppSettings.photoEstimate.scaleReference`）：
   設定頁一個 textarea，填一次、之後每次估算自動附進 prompt
   （例如「照片裡的手是我的，手掌寬約 7 公分，比一般成人小」）。
   校正資訊每次都一樣，不該逼使用者每張照片重打（違反 §1 原則 1「不打字」）。
   留白時 prompt 完全不會出現這一段。
2. **結果卡顯示份量與判斷依據**：模型多回 `estimatedWeightG` 與 `portionBasis`，
   卡片顯示成「估計份量約 380 g — 依常見超商便當份量」。
   數字偏高時這一行才看得出**是哪一步估錯**（通常是份量，不是熱量密度），
   比信心分數有用得多——這也讓下次再有偏差時可以直接診斷，不必再靠猜。

順手修掉 `updatePhotoEstimateEnabled()` 直接寫 `{ enabled: next }` 會把
同一層 `scaleReference` 洗掉的問題（開關關掉再開啟就要重填），改成展開既有值。

新增／改寫 12 項測試，含兩條「防止規則再度膨脹」的守門測試：
prompt 不得出現「不要一律預設一份」「寧可保守」這類傾向性字眼、
規則段落不得超過 4 行。瀏覽器預覽驗證校正資訊確實出現在送出的 prompt、
結果卡正確顯示份量與依據。

**仍待 owner 真機驗證**：這次砍 prompt 是否真的讓數字回到合理範圍。
若還是偏高，下一步該查的是「有沒有比例尺參考物」對結果的影響，
而不是再往 prompt 加規則。

`npm run typecheck`、`npm test`（73 檔、939 項）全過；
`npm run build:nutrition:mobile` 建置成功。

---

## 2026-08-19（續九）｜本機模型連不上：飲食 App 漏開 CapacitorHttp

owner 回報「本機模型現在是 DeST 可以連，這邊連測試連線都顯示 Failed to fetch」。
**「DeST 連得上、這個 App 連不上」就是最強的線索**——同一台電腦、同一個
Ollama，差別只在兩個 App 的 HTTP 走哪條路。

**根因**：`nutrition/mobile/capacitor.config.ts` 少了
`plugins: { CapacitorHttp: { enabled: true } }`。DeST 的 config 一直有這段
（註解還寫著「原生 HTTP 接管全域 fetch，讓 WebView 的跨網域請求不受 CORS 限制」），
建立飲食 App 的 config 時漏抄。沒開的話 `fetch` 就是 WebView 原生的那個，
要受 CORS 管；Ollama 預設不送 CORS 標頭 → 一律 `Failed to fetch`。
CLAUDE.md §5 其實已經記過這條規則（「core 裡要打外部 API 就注入 HttpAdapter…
手機那邊要 CapacitorHttp patch 過才繞得過 CORS」），我在 P2 建
`nutrition/mobile/src/http.ts` 時還親手寫了「目前沒有裝 CapacitorHttp，
直接用瀏覽器原生 fetch」的註解——等於把已知的坑寫成註解然後跳進去。

⚠️ 改 `capacitor.config.ts` 之後**一定要 `npx cap sync android`**：原生層讀的是
`android/app/src/main/assets/capacitor.config.json`，不是那份 .ts。
只重建 www 不會生效（已在 config 檔頭寫下這句提醒）。

同時把 `nutrition/mobile/src/http.ts` 改成跟 DeST 的
`src/mobile/adapters/httpAdapter.ts` 同一套處理，這幾點都是 CLAUDE.md §5
記載過、開了 CapacitorHttp 才會浮現的坑：

- **呼叫當下才讀 `globalThis.fetch`**，不可在模組載入時 bind——CapacitorHttp
  是 plugin 初始化時才 patch `window.fetch`，先 bind 會抓到未 patch 的版本，
  CORS 繞道整個失效，而且**只在真機炸、瀏覽器預覽看不出來**。
- **`withAbort()` 把 signal 翻成 reject**：CapacitorHttp 完全忽略
  `init.signal`，`photoEstimateLlm.ts` 裡的 12 秒逾時在真機上形同虛設，
  模型一慢就無限等、UI 永遠停在「估算中...」。用 `Promise.race` 讓等待中止。
  有 signal 時就不疊保底天花板——本機模型冷啟動（載模型進記憶體）可能要
  好幾十秒，疊上去會變成「第一次問一定失敗、之後才正常」。
- **`supportsStreaming: false`**（原生 HTTP 對 ReadableStream 支援不佳）。

順帶把 `postJsonWithParamFallback()` 的 `response.clone()` 拿掉：手機端的
Response 是原生橋接重建的，clone 支援度不如瀏覽器原生。改成讀完 body 後
在不重試時用同樣內容重建一個還給呼叫端，行為一樣但不依賴 clone
（新增測試驗證重建後錯誤內容仍讀得到，不是空字串）。

`describeNetworkError()` 的提示也改寫了：開了 CapacitorHttp 之後 APK 端
不再是 CORS 問題，最可能的成因換成「Ollama 預設只聽 127.0.0.1，手機根本
連不到」，依機率重排成四點，並註明「瀏覽器預覽才需要 OLLAMA_ORIGINS」。

瀏覽器預覽驗證三條路徑：連線失敗顯示新的四點提示、底層 fetch 永遠不 settle
時仍在 12 秒後中止等待（證明 `withAbort` 有效，否則真機會永久卡住）、
正常回應仍能抓到模型清單填進下拉選單。

**仍待 owner 真機驗證**：這次要重打 APK 才會生效（config 改動只靠重建 www
不夠）。若裝上去還是連不上，最可能是 `OLLAMA_HOST=0.0.0.0` 沒設——
那是 App 這端無法解決的，錯誤訊息現在會把它列在第一條。

`npm run typecheck`、`npm test`（73 檔、939 項）全過；
`npm run sync:nutrition:android` 已跑，`capacitor.config.json` 確認含 CapacitorHttp。

---

## 2026-08-19（續十）｜明文流量被擋、逾時砍太早，順手補等待動態／語音輸入／費用提示

### 本機模型連不上（續九的下半場）

續九開了 `CapacitorHttp` 修掉 CORS，owner 實測**還是連不上**。真正的第二個原因：
`nutrition/mobile/android/app/src/main/AndroidManifest.xml` **少了
`android:usesCleartextTraffic="true"`**。Mac Mini 上的 Ollama 是區網 `http://`，
而 `targetSdkVersion` 是 36 —— Android 從 targetSdk 28 起預設禁止明文流量，
**原生層**（CapacitorHttp 走的 OkHttp）的請求直接被系統擋掉。

- `android.allowMixedContent` 蓋不到這個：那是 WebView 的政策，跟原生 HTTP 是兩層。
- DeST 主 App 的 manifest 一直有這一行（`android/app/src/main/AndroidManifest.xml:5`），
  這就是「同樣設定 DeST 連得上、飲食 App 連不上」的全部差別。
- 兩件事要**一起**才會通：`CapacitorHttp`（繞 CORS）＋ `usesCleartextTraffic`（准明文）。
  只做一個的症狀長得一模一樣，都是「送出去就失敗」，很容易以為前一個修法沒生效。

順手修 `scripts/build-nutrition-apk.mjs`：`gradlew.bat` 沒帶絕對路徑，
在停用 `NoDefaultCurrentDirectoryInExePath` 以外的環境下 cmd 不搜尋目前目錄，
建置會停在 `'gradlew.bat' is not recognized`。

### 測讀圖固定 `The operation was aborted`

那是我們自己的逾時，不是網路問題。`DEFAULT_TIMEOUT_MS = 12_000` 是照雲端抓的，
**本機視覺模型第一次要把模型載進記憶體**，動輒數十秒到數分鐘，12 秒必砍。

- `photoEstimateLlm.ts` 新增 `resolveTimeoutMs()`：`local` → 300 秒，雲端維持 12 秒；
  估算／測連線／測讀圖三個入口共用（呼叫端都沒指定逾時，改預設就全數生效）。
- `describeNetworkError()` 把 `AbortError` 跟「連不上」分開講。原本逾時會套上
  「檢查 OLLAMA_HOST／防火牆／同一個區網」那串清單，**方向完全錯**，
  會讓人去查一個沒壞的東西。

### 順手補的四個 UI（owner 當場回報）

1. **「估算中」等待動態**（`EstimateLoading`）：三顆跳動的點＋已等秒數，
   本機模型等超過 20 秒補一句「第一次要載模型，可能要好幾分鐘」。
   純文字「估算中...」在本機模型那種等待長度下看起來就是當掉。
   有 `prefers-reduced-motion` 的靜態版本。
2. **補充說明的語音輸入**（`nutrition/mobile/src/voiceInput.ts`）：
   ⚠️ **Web Speech API 在 Android WebView 不能用**——WebView 沒有綁系統語音服務，
   `webkitSpeechRecognition` 不是不存在就是一啟動就 `network` 錯誤（Chrome 瀏覽器可以，
   WebView 不行）。走 `@capacitor-community/speech-recognition`，它自己的
   AndroidManifest 已帶 `RECORD_AUDIO` 與 `RecognitionService` 的 `<queries>`，
   **這個外掛不必手動合併權限**（跟 geolocation 那次相反）。
   `available()` 回 false 就不畫按鈕；離開頁面 unmount 時強制 `stop()`，否則麥克風一直開著。
   照 CLAUDE.md §5 包一層 `{ plugin }` 回傳，不直接 return plugin proxy。
3. **AI／模型／費用提示行**：拍照入口下方與估算鈕上方各一行。原本按鈕上
   完全看不出會連網、用哪個模型、要花錢。單價**沿用 `core/llm/modelCatalog`
   的 `MODEL_PRICES`**，不另編一組憑印象的數字；查無單價顯示「費用未知」不擋操作。
   金額走既有的 `estimateRequestCost()`，新增 `capabilitiesFromPriceTable()`／
   `formatEstimatedCost()` 兩支純函式（§2.9.3 的「不換算匯率、帶 ISO 幣別、
   絕不顯示 $0.00」都在 formatter 裡）。
4. **今日列表顯示份量**：名稱後面接小字 `2 份`。份量 span 放在 `<strong>` **外面**，
   長名稱被 ellipsis 截斷時份量才不會跟著被吃掉。

### 文件

`docs/nutrition-photo-estimate-plan.md` 補了 **§6.5 實作對照表**（逐項對過 core／UI）。
結論值得記住：**`core/` 幾乎全做完了，缺口幾乎都在「UI 沒有呼叫端」**——
`estimateRequestCost`、`nutritionFromGrams`、`parsePastedNutrition`、
`checkRequestCompatibility`、`hashPhoto`／`findDuplicateLog` 全是寫好沒人叫的死碼。
挑下一項做時先看那張表，不要照 §7 分期表的順序推測進度。

---

## 2026-08-19（續十一）｜接上貼上自動填欄位（§2.10.3）與送出前相容性檢查

兩支寫好沒人叫的 core 函式接上呼叫端，都是「接線」不是新功能。

- **`parsePastedNutrition`**：食物表單多一個摺疊區「貼上營養資訊自動填欄位」，
  貼上就即時填，回報填了哪幾欄；抓不到**不跳錯誤、不阻擋**（規格明文要求）。
  **零網路請求**，跟 AI 開關無關、開關關閉時照樣可用。
- 順手發現的缺口：`FoodItem.perServing` 有 `sugarG`／`sodiumMg`，拍照估算也會回存，
  但**手打表單從來沒有這兩欄的入口**——貼上解析抓得到糖與鈉卻無處可放。
  補進表單的「更多（糖、鈉）」摺疊區（§1 原則 7b：隨手記、不主打，所以摺疊不佔第一眼）。
  五個地方要一起改：`FoodDraft` 型別、`blankFoodDraft()`、從既有食物開表單、
  從估算結果開表單、兩支存檔（`saveFoodDraft`／`duplicateFoodConfirmed`）。
- **`checkRequestCompatibility`**：估算送出前先擋「沒選模型」「非本機卻沒填 API Key」，
  照片與說明保留。`vision: false` 這條**擋不了**——沒有 §2.9.1 的能力表就無從得知
  哪些模型不能讀圖，寧可不擋也不要憑型號名猜（猜錯會擋掉能用的模型）。
- 開表單時記得清掉貼上區的文字與訊息，否則會留著上一筆食物的內容。

---

## 2026-08-19（續十二）｜貼上自動填欄位實測全部抓不到：解析不能假設格式

owner 貼了網頁 LLM 的實際回覆，**一欄都沒填到**：

```
蛋白質：約4克
碳水化合物：約30克
```

根因：第一版的正則要求數字**緊接在**標籤與冒號後面（`蛋白質?\s*[:：]?\s*(\d+)`），
中間多一個「約」就整條失效。

**修法方向的取捨**（owner 也問到）：要不要改成「給使用者一段固定格式的 prompt
去貼給網頁 LLM」？**不採用**——那是把問題丟回給使用者，而且他換一家 LLM
（甚至同一家不同次回答）格式又不一樣，等於每次都要重來。
**格式是不可控的輸入，該寬鬆的是解析器。**

現在容許：`約`／`大約`／`~`／`≈` 這類模糊詞、全形數字與冒號、條列符號、
換行、單位可省略、中英文標籤（`Protein`／`Carbs`／`Calories`）、千分位逗號。

兩個實作上的坑，都有測試守著：

- **`kcal` 不能當標籤去找「後面第一個數字」**：`320 kcal 蛋白 18g` 會把蛋白質的
  18 抓成熱量。熱量要**先**試「數字在前」的寫法（`320 大卡`），標籤式擺後面。
- **標籤與數字之間不准跨過逗號或句號**：`這份蛋白質很低，整份大約有 320 大卡`
  原本會把 320 填進蛋白質。跨過標點就是換一句話了，寧可抓不到讓使用者手打，
  **也不要填一個錯的數字——錯的數字他不會發現**。

還沒做（owner 提的另一個選項）：把貼上的原文**存進資料裡**留底。
需要給 `FoodItem` 加一個自由文字欄位，牽涉搬家包與桌面端，這輪先不動。

---

## 2026-08-21（續）｜飲食記錄 App 桌面小工具（B9b）：專案第一次加 Kotlin

`docs/nutrition-widget-plan.md` §9 七步照做完。這個 App 原本純 Java（`MainActivity.java`
只有五行），小工具三支原生檔（`NutritionWidgetDataReader`／`NutritionWidgetProvider`／
`NutritionWidgetBridgePlugin`）第一次引入 Kotlin，`android/build.gradle`／
`app/build.gradle` 要補 Kotlin Gradle plugin。

**踩到的坑**：`gradlew assembleDebug` 一開始炸滿頁
`Class 'kotlin.Unit' was compiled with an incompatible version of Kotlin`，
根因是 `@capgo/capacitor-health` 自己的 `android/build.gradle` 寫死用
Kotlin **2.4.10**，但 `capacitor-filesystem`／`capacitor-camera` 讀的是
`project.hasProperty('kotlin_version')`（底線）當覆寫來源、預設 2.2.20——
我原本只設了 `ext.kotlinVersion`（駝峰，自己取的名字），這些外掛完全不认，
繼續用各自的預設版本，導致同一次建置裡編譯器版本對不齊。**兩個屬性名字都要設**
（`kotlin_version` 底線才是這幾支外掛真正在讀的）。

**點擊行為沒有另開一支 Activity**，比照 `@capacitor/app` 標準深連結模式：三顆按鈕
（相機／鉛筆／其餘區域）都是 `ACTION_VIEW` PendingIntent，帶 Capacitor 產生的
`custom_url_scheme` 字串資源（原本就在 `strings.xml` 裡、一直沒用到）當 scheme，
JS 端用 `getLaunchUrl()`（冷啟動）＋`appUrlOpen`（App 已在背景）收下。「拍照」
連結額外自動打開系統相機（不是進一個還要再按一次的中繼頁）——抽出
`captureCameraPhoto()` 共用函式，跟既有的 `PhotoSourceButtons` 元件共用同一段
呼叫 `@capacitor/camera` 的邏輯，不重寫第二份。

**存檔／App 離開前景這兩個更新時機**卡在「JS 沒辦法直接發 Android broadcast」——
只有小工具「重新整理」按鈕是原生層自己收廣播（不進 App）。另外寫了一支最小
Capacitor 外掛 `NutritionWidgetBridgePlugin`（`refresh()` 呼叫
`NutritionWidgetProvider.updateAll()`），這是計畫書原本檔案結構沒列出來、
但存檔／背景觸發點缺不了的補充。`runAction()` 存檔成功後一律推一次（不逐一分辨
是不是真的動到 MealLog，換取簡單可靠）。

**真機驗證（Pixel 10a，debug APK）**：App 啟動無 crash、三個深連結
（`daily`／`photo`／`quick-entry`）都正確導覽（拍照連結開系統相機、取消後正確
落回拍照記錄頁；快速入帳連結直接開入帳面板）、小工具重新整理 broadcast 在
zero widget instance 時 `updateAll()` 安全 no-op 不 crash。**沒驗到**：實際把
小工具拖上主畫面看三種尺寸排版——owner 的主畫面是塞滿 KWGT 風格自訂桌布/小工具
的複雜排版，找不到安全的空白處長按喚出「新增小工具」選單，怕誤觸動到既有排列
沒硬點下去，留給 owner 自己找時間試。

`npm run typecheck`／`npm test`（955 項）皆過。

---

## 2026-08-22｜飲食小工具版面重做：RemoteViews 的尺寸宣告要對得起實際內容高度

owner 實機回報兩輪，第二輪的症狀是「寬度縮小時空一大塊，然後資料被卡掉」。

**根因不是版面本身，是尺寸宣告說謊。** `RemoteViews(Map<SizeF, RemoteViews>)` 的
每個 `SizeF` 意思是「這個版面**最少需要多大**」，系統會挑「放得下的當中最大的」。
我把中版宣告成 `SizeF(180f, 40f)`（高 40dp 就適用），但中版實際堆了五列
（重新整理自己佔一列＋標籤＋數字＋標籤＋數字），真實高度要 80dp 以上。
於是系統照著宣告把它挑進一格高的容器，塞不下就**從底部整片裁掉**——
被裁掉的正好是蛋白質數字，而使用者看到的「莫名空白」其實是被裁掉的內容留下的洞。

**一格高的小工具內部大約只有 45～50dp 可用**，這個預算比想像中緊得多：

- 重新整理按鈕**不能佔一列**，要跟數字、按鈕同一列（垂直置中）擺角落。
- 相機／鉛筆在一格高**只能並排**：直排要 2×26＋間距 ≈ 56dp，比整個可用高度還高。
  owner 要的「按鈕上下排、把旁邊空間讓出來」只有在高版（≥3 格高）兌現得了。
- 兩組數字在「寬但矮」時要**左右並排**而不是上下堆——橫向空間拿來換稀缺的垂直空間，
  這樣連標籤字都放得下。
- `includeFontPadding="false"` 兩列文字可省 6～8dp，在這個預算下是關鍵不是微調。

現在三個版面各自對應一種**形狀**（不是單看寬度）：窄／矮（無標籤）、寬／矮
（數字左右並排＋標籤）、高（上下堆＋進度條＋按鈕直排）。斷點常數
`BREAKPOINT_*` 的註解寫明「這幾個數字必須 ≥ 對應版面的實際內容高度」，
高版門檻抓 120dp 而內容約 110dp，刻意留 10dp 餘裕。

順帶修掉 owner 第一輪回報的另外兩點：數字改粗體＋等寬數字（`tnum`，
這是「看起來像時鐘」的主因——每個數字寬度固定，不會因為 1 窄 8 寬而跳動）；
**蛋白質的紅字方向跟熱量相反**（熱量超標紅字，蛋白質**沒達標**才紅字，
達標用新增的 `widget_good` 綠）。目前攝取量用大字、上限／目標值退成小字尾巴。

### 同日續：照 owner 的 mockup 重做，並放棄兩個「看起來很聰明」的 API

owner 給了一張 mockup（標籤小字在上、大數字主導、`/ 1256kcal` 小字尾巴、
鉛筆／相機**圓形直排**在右、重新整理在左側垂直置中、**沒有進度條**）。
照著做的過程中，兩個原本以為能一勞永逸的 API 都被實機打臉：

- **`RemoteViews(Map<SizeF, RemoteViews>)` 不要用。** 它由系統決定挑哪一份，
  而挑選規則不是直覺的「放得下的當中最大的」。owner 那個 **373×204dp** 的
  小工具，明明完整版（宣告 150×76）放得下，系統卻挑了中版（宣告 200×40）。
  版面選擇正是這個小工具反覆出包的地方，所以改成**自己讀 options、自己挑**
  （`pickLayout()`），API 26–30 與 31+ 走同一條路徑，只需要驗一次。
  順手加了 `Log.d(TAG=NutritionWidget)` 印出「實際幾 dp → 挑了哪個版面」——
  就是靠這行才知道真實尺寸是 373×204（之前都在用截圖比例硬猜）。
  真機除錯：`adb logcat -s NutritionWidget`。
- **`autoSizeTextType` 在 RemoteViews 裡不可靠。** 想用它一勞永逸解決「內容溢出」，
  搭配 `layout_height="match_parent"`＋weight 後，owner 實機上**蛋白質那個數字
  整個沒顯示**（只剩 `/ 70g`），熱量那個卻正常——量測時機的問題，很難除錯。
  改成 `NutritionWidgetProvider.valueTextSizeSp(heightDp)` 依實際高度算好字級，
  再用 `setTextViewTextSize()` 指定：行為完全確定，而且順便讓數字會**跟著
  小工具變高而變大**（22→40sp 階梯），這是 autosize 本來想要的效果。

還有一個排版陷阱：**數字列不要用 `layout_weight` 撐開**。容器一高（204dp）就會
被拉成上下兩大塊空白、標籤跟自己的數字離得老遠。現在整個數字區塊是
`wrap_content` ＋ 外層 `gravity="center_vertical"`，多出來的高度變成上下對稱留白。

### 同日再續：三種尺寸各自的規格（owner 定案）

owner 逐一尺寸給了規格，三個版面現在職責分明：

| 版面 | 尺寸 | 內容 |
|---|---|---|
| `narrow` | 2x1 | **不顯示標籤**，把空間全給數字 |
| `medium` | 3x1／4x1 | 標籤移到**數字左邊**（`minWidth=42dp` 讓兩列數字起點對齊） |
| `wide` | 4x2 以上 | 標籤在上、**有進度條**、**按鈕放大到符合版面高度** |

**進度條只在最大尺寸出現**——一格高只有 60～90dp，多兩條進度條就會把數字擠爆。

⚠️ **加東西進完整版時一定要回頭調 `BREAKPOINT_TALL_HEIGHT_DP`。**
這一輪 owner 回報「2x1／3x1 的蛋白質數字只剩半個字」，就是進度條加回來之後
門檻還停在 76dp，害一格高的容器誤用完整版。現在完整版一整欄要
`82 + 2×數字高度`（padding 20 ＋ 2×(標籤 13 ＋ 數字 ＋ 進度條 11) ＋ 組間距 10），
所以門檻設 140dp，字級由 `valueTextSizeSp()` 反推：`V ≤ (高度 − 88) / 2`。
**這條公式跟版面 XML 是綁死的，改其中一邊就要改另一邊。**

### 同日三續：按鈕尺寸的兩個錯誤（owner 逐尺寸回饋第二輪）

owner 一次貼了 2x1／3x1／4x2／2x2 四種尺寸的實機畫面，抱怨看起來是四件事，
根因其實只有兩個：

1. **放大邊框卻沒放大內距。** 只用 `setViewLayoutWidth/Height()` 把圓形底撐到
   80dp，`padding` 卻還是 XML 寫死的 12dp → 圖示變成 56dp，幾乎填滿整個圓，
   邊緣看起來像畫出去（owner 回報「icon 太大而且有點畫出去」）。
   現在內距固定佔邊長的 26%，跟著一起算。
   ⚠️ `setViewPadding()` 吃的是 **px 不是 dp**，要自己乘 `displayMetrics.density`。
2. **按鈕大小只看高度、沒看寬度。** 2x2 那種又高又窄的尺寸，只看高度會算出很大的
   按鈕，把文字擠到只剩「蛋⋯」（owner 回報 ④）。現在同時受
   「高度能放多少」與「不可以吃掉超過 28%（直排）／32%（並排）寬度」兩個上限夾。

順帶處理的三件小事：**3x1／4x1 的按鈕改左右並排**（橫向空間是這個版面最不缺的
資源，直排反而被一格高的高度限制住大小）；**上下限那行字級跟著大數字等比放大**
（`大數字 × 0.45`，夾 10～20sp），否則大數字旁邊會像註腳；**2x1 恢復顯示
`kcal` 單位**——原本一律用不帶單位的 short 版，但 2x1 沒有標籤列其實放得下，
真正會擠的是完整版又高又窄（2x2）那種，改成只有那個情況才退回 short。

API 30 以下沒有 `setViewLayoutWidth/Height`，按鈕會吃 XML 的預設大小、不會跟著
縮放（內距則不受限，至少比例是對的）——這是能力限制不是 bug。

### 同日四續：2x2 專用版面，與「字級也要看寬度」

owner 回報「2x2 的上限數字被卡掉，可能需要自適應大小」。兩個修正：

**① 字級同時受寬度限制（通用防呆）。** 原本只從高度反推字級，又高又窄的尺寸就會
算出「高度放得下、寬度卻塞不進」的字級，尾巴被 `ellipsize` 吃掉。現在會先估
這行要多寬（粗體等寬數字每字約 0.62em、尾巴每字約 `SUFFIX_RATIO × 0.55em`），
再反推寬度容許的字級上限，取兩者較小。**估算與實際設定共用同一個 `SUFFIX_RATIO`
常數**，不可以各寫各的，否則估算會失準。

實測（8/21 真資料搬到今天）：2x1 顯示 `1103 / 1256kcal`、`90 / 70g` 時字級被壓到
**20.2sp**（高度本來允許 32sp），完整顯示沒有被裁；資料是 `0` 時則回到 31.9sp。
**字級會隨數字位數變動**是這個設計的必然結果，如果覺得跳動礙眼，就要改成固定
用最壞情況（四位數）算——目前選擇「能大就大」。

**② 2x2 改用新的方形版 `widget_nutrition_square.xml`。** 完整版是「左數字、右按鈕直排」，
2x2 的寬度要分給重新整理＋標籤欄＋按鈕，數字欄只剩 55dp 左右，四位數上限一定塞不下；
純縮字級要縮到 15sp，大數字就沒意義了。方形版**把按鈕移到最下面一列**，
數字欄因此吃到整個寬度（約 135dp），同樣資料可以用 23sp 以上顯示。
代價是沒有進度條（垂直空間要留給按鈕列）。

版面選擇因此變成四種形狀：`wide`（夠高夠寬）／`square`（夠高但窄）／
`medium`（矮而寬）／`narrow`（矮又窄）。

### 怎麼用真實資料測小工具版面（安全作法，之後會一直用到）

小工具只顯示「今天」的合計，剛開始用的時候常常是 0，看不出版面好不好。
把過去某天的資料暫時搬到今天來測，**順序很重要**，否則會把假資料寫死進使用者的紀錄：

1. `run-as <pkg> cp files/meal-logs.json files/meal-logs.bak`（裝置端備份）
   ＋ `run-as <pkg> base64 files/meal-logs.json` 拉回本機，**算 SHA256 記下來**。
2. **先還原真資料、再啟動 App**，讓 App 記憶體裡是真的——這樣就算中途被觸發存檔，
   寫回去的也是真資料。
3. 換上假資料檔，然後**開 App 再按 HOME**：`appStateChange(isActive:false)` 會
   推一次小工具更新。⚠️ `am broadcast` 送自訂 action 給 Provider **實測不會觸發**
   （被 force-stop 過之後尤其不會，`-f 0x00000020` 也救不回來），走 App 這條才可靠。
4. 截圖看版面。
5. **先 `am force-stop`**（丟掉記憶體裡的假資料）**再還原檔案**，然後比對 SHA256
   確認逐位元組相同，最後刪掉裝置端備份、重開 App 讓它讀回真資料。

⚠️ 這次測完有確實驗證：`sha256` 與原始完全相同、64 筆、沒有殘留 `-fake` id。

### 同日五續：「無法載入小工具」＝ RemoteViews 的 view 白名單

owner 拉到 2x2 時整個變成「無法載入小工具」。logcat 一看就有答案：

```
android.view.InflateException: ... Class not allowed to be inflated android.view.View
```

**RemoteViews 只允許白名單內的 view 類別**（LinearLayout／RelativeLayout／FrameLayout／
GridLayout／TextView／ImageView／ProgressBar／Button／ImageButton／Chronometer／
ViewFlipper／ViewStub／TextClock…）。我在方形版底列用了一個
`<View>` 當彈性間隔物——**純 `android.view.View` 與 `Space` 都不在名單上**，
一放進去整個小工具就掛掉。改成 `RelativeLayout` ＋ `alignParentStart`／
`alignParentEnd` 讓兩邊各自靠邊，不需要間隔物。

**這類錯誤在編譯期完全看不出來**（XML 合法、Gradle 也過），只有真機放上去才會炸，
而且症狀是整個小工具不顯示、看不出是哪一行。診斷方式固定：

```bash
adb logcat -d | grep -i "not allowed to be inflated"
```

它會直接指出檔名與行號。加新的版面時可以先跑一次
`grep -ho '^\s*<[A-Za-z][A-Za-z.]*' widget_*.xml | sort -u` 自我檢查用到哪些類別。

驗證方式（不需要在真機上拖曳改尺寸）：暫時把 `pickLayout()` 的回傳值寫死成要測的
版面、裝上去截圖，確認後再改回來。這樣可以在**不動使用者主畫面版型**的前提下
驗證任何一個版面能不能正常 inflate。

⚠️ **不要用 adb 的 `input swipe` 去測小工具 resize。** 這次踩到：長按叫出調整
把手後，接著的拖曳被 launcher 判定成「點擊」而不是「拖把手」，點到鉛筆按鈕
→ 開了快速入帳 → 又選到清單裡的食物，**在 owner 的真實飲食紀錄裡寫進一筆
垃圾資料**（零卡蒟蒻、份量 4）。因為是零卡食物、總計數字沒變，畫面上完全看不出來，
是後來去 `run-as cat files/meal-logs.json` 逐筆比對才發現的。
已用 `run-as base64` 把整份檔案取出、刪掉那筆再寫回（其餘 63 筆逐筆比對完全相同）。
**小工具的尺寸驗證只能請 owner 自己動手**，AI 不要在真機上模擬拖曳手勢。

---

## 2026-08-22（續六）｜2x2 也要進度條：把它塞進標籤那一行

owner：「2x2 有沒有機會加入進度條而不弄壞版面？」

**直覺作法會弄壞版面。** 方形版一格一格算：padding 20 ＋ 2×(標籤 13 ＋ 數字 V)
＋ 組間距 8 ＋ 按鈕列 48 ≈ 100 ＋ 2V。155dp 高時 V 只剩 27dp（約 23sp）。
再插兩條獨立的進度條（各含間距約 11dp）就變成 122 ＋ 2V，V 掉到 15dp、
字級只剩 **13sp**——大數字就沒意義了。

**解法：進度條不要自己佔一列，塞進標籤那一行的右邊。**
標籤列本來就有約 13dp 高，放一條 5dp 的進度條進去**垂直方向是零成本**；
而橫向正是方形版最寬鬆的資源（按鈕已經移到底下，數字欄吃滿整寬）。

實測（8/21 真資料，179×204dp）：`熱量 ▂▂▂▂▂▂` ＋ `1103 / 1256kcal`、
`蛋白質 ▂▂▂▂▂▂` ＋ `90 / 70g`，數字維持 **32sp 完全沒被壓縮**，進度條長度正確
（熱量約 88%、蛋白質滿格）。

一般化的教訓：**小工具的垂直空間永遠比橫向稀缺**。要加東西時先問
「能不能跟既有的某一列共用一行」，而不是直接往下堆。

---

## 2026-08-22（續七）｜小工具的熱量上限跟 App 同步（含手錶動態）

owner：「上限數字設定可以跟 App 內同步嗎？如果有跟手錶連動就用手錶的。」

靜態上限本來就同步（小工具每次都重讀 `body-profile.json`）。真正對不起來的是
**手錶動態上限**：App 顯示 1163、小工具顯示 1256。原因是動態上限由
`suggestTodayKcalLimit()` 現算，而它需要的 `healthSnapshot` 只活在 React state、
從不落地，原生層根本讀不到。

**作法：App 落地「原生層拿不到的原料」，小工具在繪製當下補完最後一步。**
新檔 `files/widget-health.json` 存三個數：`burnedSoFarToday`、`measuredAt`、
`restingKcalPerHour`；Kotlin 只做 `已消耗 + 剩餘時間 × restingKcalPerHour`。

兩個決定值得記下來：

1. **存原料而不是存算好的上限。** 公式含「剩餘時間」會隨時間遞減，存定值的話
   小工具整天顯示早上那個數、連按重新整理都不會變。存原料由小工具現算，上限
   就會自己收斂——真正會過期的只有 `burnedSoFarToday`（那個只有 App 前景查
   Health Connect 才拿得到，這是無法避免的部分）。
2. **連 `restingKcalPerHour` 都先在 TS 算好。** BMR 有兩套公式（有體脂率用
   Katch-McArdle、否則 Mifflin-St Jeor），在 Kotlin 抄一份就是計畫書 §7 警告的
   跨語言漂移。先算好之後原生層只剩一次乘加，沒有可以抄錯的東西。
   **這個「把跨語言的複雜計算留在 TS、只把純量結果送過去」的模式，
   之後小工具要再加任何衍生數值都應該照做。**

**用「檔案在不在」表達開關狀態**：關掉 `useWatchCalorieLimit`（或還沒同步過）時
App 把檔案刪掉，小工具自動退回靜態上限。這樣小工具就不必再讀 `settings.json`
判斷開關，少一個要保持同步的真相來源。`measuredAt` 不是今天時也退回靜態值，
判斷與 `suggestTodayKcalLimit()` 一致。

⚠️ **寫檔的條件必須跟畫面上 `todayDynamicKcalLimit` 那段完全一致**，
不然就會再次出現「App 一個數、小工具另一個數」——那正是這次要修的問題本身。

上限來自手錶時，有標籤的版面把「熱量」改成「熱量 · 手錶」（2x1 沒有標籤列，
`setTextViewText` 對不存在的 id 安靜略過，不必特別判斷尺寸）。

真機驗證（03:01）：`widget-health.json` 內容為
`burnedSoFarToday=146.5、restingKcalPerHour=48.46`，App 顯示 `/ 1163`（帶
「依手錶動態」標籤）、小工具顯示 `/ 1163kcal`，**兩邊完全一致**。

## 2026-08-22（續八）｜CWA 地震／颱風／天氣預報即時查詢搬到手機獨立版

`TODO.md` §3 排入的項目，owner 自用優先。原本桌面限定：`main/cwaService.ts`
偵測使用者訊息裡的關鍵詞（地震／颱風／天氣預報，優先序地震 > 颱風 > 預報），
命中就打對應 CWA API 組成 `[即時查詢：...]` 注入 prompt。手機獨立版原本只有
背景 `[Weather]`（`core/weather/` 的 F-C0032-001），沒有這條主動關鍵詞路徑。

開工前跟 owner 對了三件事，跟原本排程筆記的假設都不一樣：

1. **天氣預報關鍵詞要不要一起搬**——原始排程筆記猜測「手機已有背景
   `[Weather]`，預報大概不用搬」，owner 決定三支全搬：背景天氣是「每次聊天
   都帶」，跟「使用者主動問明天天氣」語意不同，不能互相取代。
2. **CWA API Key 來源**——決定跟桌面同步（S2 M5），不是手機自己填一把。
3. **要不要做 UI 開關**——決定要，加在天氣設定頁。

### 怎麼搬

邏輯本體移進新檔 `core/weather/realtimeQuery.ts`：`detectQueryType`、
`fetchCwaData`（forecast／earthquake／typhoon 三支內部函式）、與新增的
`getRealtimeQueryContextString`（把桌面 `weatherService.ts` 原本那段
「未啟用／無 Key／查詢失敗都靜默回 null」的判斷邏輯也一併搬進 core，
桌面與手機才不會各自維護一份判斷）。搬動時所有函式都加了
`deps: WeatherDeps` 第一參數，跟已經共用的背景天氣 `cwaFetch` 同一個
注入模式。桌面 `main/cwaService.ts`／`weatherService.ts` 改成薄殼，
呼叫核心邏輯並注入 `electronHttp`。

手機 `mobile/runtime/chat.ts` 的 `sendStandaloneMessage`（不是
`forceSpeakStandalone`——那條路徑沒有使用者訊息可以偵測關鍵詞）在抓完
`[Weather]` 之後多跑一次 `detectQueryType`／`getRealtimeQueryContextString`，
兩段注入合併塞進 `extraSystemContext`，兩個主／副角色回合都吃得到。

### CWA Key 沒有塞進 S2 M5，是刻意的

`core/sync/settingsSnapshot.ts` 檔頭明講「API Key 不在這裡——S2 任何情況
都不碰金鑰，子集裡連欄位都不能出現」。owner 選「跟桌面同步」不代表要
違反這條規矩——實際金鑰仍然只透過既有的 **S1 一次性匯入**帶到手機（區網
直連才附真正的值，非直連時手機保留自己原本那把，這條規則早就存在）。
M5 這次只新增兩個非機密欄位進比對子集：`weather.realtimeQueryEnabled`／
`weather.realtimeQueryForecastCounty`，讓「要不要開」「用哪個縣市」這兩件
事也能在設定同步畫面上看到差異、選邊套用。

### 手機自己編輯這組設定的管道

`WeatherSettingsSnapshot`（`core/data/types.ts`）原本的註解明講「不含 CWA
API Key」——那是搬過來之前的舊決定，這次刻意覆蓋。做法比照
`LlmSettingsSnapshot.hasApiKey`：新增 `realtimeQuery: { enabled,
hasCwaApiKey, forecastCounty }`，金鑰本身只回「有沒有設定」，不回明文；
覆寫金鑰另開一支只寫不讀的 `setCwaApiKey`（遙控模式下這支比照
`setLlmApiKey` 的規矩，非區網直連一律拒絕，見 `mobileServer.ts` 的
`isLanDirectRequest` 檢查）。手機天氣設定頁新增「即時氣象查詢」區塊：
啟用開關（沒 Key 前反白鎖住）、API Key 輸入＋儲存＋測試連線、預設縣市
下拉；拿掉舊的「地震與颱風查詢仍只在電腦版」提示文字。

### 驗證

新增 `tests/weather/realtimeQuery.test.ts`（17 項，涵蓋關鍵詞優先序、三種
查詢類型的成功／空結果／API 失敗分支、`getRealtimeQueryContextString` 的
未啟用／無 Key／密文金鑰／查詢失敗全部靜默回 null）。`npm run typecheck`／
`npm test`（76 檔、974 項）／`npm run build:mobile`／`npm run build` 全過。

**尚未真機驗證**：新的天氣設定頁區塊、CWA Key 只寫不讀的行為、S2 M5
新增的兩個欄位在真的兩台裝置間比對套用、以及聊天裡實際觸發地震／颱風／
預報關鍵詞查出正確資料，這幾件事都還沒有人在 Pixel 10a 上按過。

## 2026-08-22（續九）｜對話新聞搜尋搬到手機獨立版

`TODO.md` §3 排入的項目，owner 自用優先。原本桌面限定：使用者訊息含時事
意圖時，回應前即時查一次 Google News RSS 補充事實，跟新聞陪聊（主動定時／
「說點什麼」）是兩套獨立機制。整支邏輯搬進 `core/news/conversationSearch.ts`，
逐字保留桌面 `main/modules/news/conversationSearch.ts` 原本的觸發詞前置過濾
／輔助模型萃取查詢詞／RSS 搜尋／組注入字串四段流程，只換掉兩處平台耦合：
`rss-parser` 換成注入的 `RssParseAdapter`（手機沿用個人新聞報已驗證過的
`mobile/adapters/rssParseAdapter.ts` 原生 `DOMParser`，這個坑之前踩過也解過，
這次直接複用）；LLM 呼叫換成 core 的 `chatWithLLM`／`applyUtilitySettings`
（沿用 `core/news/enrich.ts` 的 `summarizeWithUtility` 那套「假角色＋
`Promise.race` 手動計時器」寫法，不是 `AbortSignal`——CapacitorHttp 忽略
signal，這條路徑已經在 enrich 那邊驗證過安全）。RSS 查詢字串直接複用
`core/news/sources.ts` 的 `buildKeywordRssUrl`，沒有重複兜一份。

桌面 `main/modules/news/conversationSearch.ts` 改薄殼，`ipcHandlers.ts` 的
呼叫端不用改。`disasterNewsSupplement.ts`（CWA 即時查詢命中時的災害新聞
補搜，刻意沒動這支邏輯）用到的 `searchGoogleNewsRss`／
`buildConversationSearchInjection` 兩個既有匯出也留著，只是簽章換成薄殼
內部固定綁 `electronHttp`／`electronRssParser`。

手機 `mobile/runtime/chat.ts` 的 `sendStandaloneMessage` 送出使用者訊息前
（在既有 `[Weather]`／即時氣象查詢之後）跑一次，命中就把
`[Conversation search: ...]` 併進 `extraSystemContext`；debug prompt／
token 數先存回 `userMsg`，主要回覆者的 `charMsg` 再複製一份，比照桌面
`ipcHandlers.ts` 的慣例——`Message` 型別本來就有
`convSearchDebugPrompt`／`convSearchInputTokens`／`convSearchOutputTokens`
三個欄位（桌面早就在用），`MessagePromptView.tsx` 也已經有「對話搜尋」這個
分頁，接上就直接生效，不用另外加 UI。不是在回一則使用者訊息的
`forceSpeakStandalone`（「說點什麼」強制發話）刻意沒接這段——跟桌面一樣，
對話新聞搜尋只掛在「回覆使用者這句話」的路徑上。

開關新增到 `core/data/types.ts` 的 `NewsEditableSettings.conversationSearch:
{ enabled: boolean }`，刻意只給這一項——觸發詞清單／查詢時效維持桌面
設定面板專屬的進階項（`NewsSettingsView.tsx` 檔頭本來就寫明範圍刻意小）。
`mobileRoutes.ts` 的 `GET/POST /api/news/settings`、`session.ts` 的
`getNewsEditableSettings`／`saveNewsEditableSettings` 都加上這個欄位；
手機新增一個 Section（開／關按鈕，比照既有「熱門話題」的樣式）。

### 順手修掉一個坑：巢狀設定物件整包取代

`NewsModuleSettings.conversationSearch` 是巢狀物件
`{ enabled, triggerWords, maxAgeHours }`，`normalizeNewsModuleSettings` 對
這個欄位是整包取代、不是逐欄合併（`raw.conversationSearch?.triggerWords`
沒給就直接退回預設值，不會保留舊值）。桌面設定面板一直是整包送（本地先
`{...cs, ...patch}` 合併好才送出），沒踩到；但手機只給得起 `enabled`，
若直接把 `{ conversationSearch: { enabled } }` 當 patch 送進
`saveNewsModuleSettings`，會把桌面設定的觸發詞清單／查詢時效一併重置成
預設值——症狀會是「手機上開關對話新聞搜尋之後，桌面的觸發詞清單被清空」，
而且看起來跟「按開關」完全無關，很難聯想到根因。`mobileRoutes.ts`／
`session.ts` 的存檔路徑都改成：收到 `conversationSearch` patch 時先讀一次
現況，只覆蓋 `enabled`，`triggerWords`／`maxAgeHours` 從現況帶著走。

### 驗證

新增 `tests/news/conversationSearch.test.ts`（14 項），涵蓋觸發詞前置過濾、
RSS 搜尋的標題／媒體拆解與相關標題摘要抽取、3 則上限、`maxAgeHours` 篩選、
抓取失敗回空陣列、注入字串格式化（含摘要裁切）、以及
`getConversationSearchContext` 整條流程（模組關閉／未命中觸發詞時不打任何
請求、LLM 判斷非時事仍帶回 debugPrompt、LLM 給查詢詞後組出注入字串、
查詢詞搜不到結果時回 null）。`npm run typecheck`／`npm test`（77 檔、
988 項）全過。

**尚未真機驗證**：手機設定頁的開關、實際聊天觸發對話新聞搜尋並正確注入
回覆，這兩件事都還沒有人在 Pixel 10a 上按過。

## 2026-08-22（續十）｜對話新聞搜尋：開放手機編輯觸發詞／時效＋真機驗證通過

上一節做完後 owner 決定觸發詞清單與 `maxAgeHours` 不要維持桌面專屬——手機
`NewsSettingsView.tsx` 的「對話新聞搜尋」Section 補上跟黑名單同一套標籤
加／刪 UI（觸發詞）與一個 0–168 的數字框（`maxAgeHours`，0＝不限制）。
連帶把 `core/data/types.ts` 的 `NewsEditableSettings.conversationSearch`
從 `{ enabled }` 擴成 `{ enabled, triggerWords, maxAgeHours }`，
`mobileRoutes.ts`／`session.ts` 的存檔路徑跟著從「只覆蓋 enabled、其餘
帶著走」改成「沒送到的欄位才帶著走」（三個欄位現在都可能被手機端真的改動）。

打包 APK 裝機時踩到一個跟這次改動無關的既有腳本 bug：
`scripts/build-mobile-apk.mjs` 呼叫 `gradlew.bat` 用裸檔名（沒有路徑
前綴），這台機器的 Windows 設定 `NoDefaultCurrentDirectoryInExePath=1`
（安全性設定，關掉 cmd.exe 用 cwd 找可執行檔的行為）會讓
`spawnSync(..., { shell: true })` 底下的 cmd.exe 回「不是內部或外部命令」，
即使 `cwd` 已經指到 `android/` 目錄——cmd.exe 的隱式目前目錄搜尋被系統設定
關掉了，跟 cwd 有沒有設對是兩回事。改成傳絕對路徑
`path.join(root, 'android', 'gradlew.bat')` 繞過，不依賴 cmd.exe 的
隱式搜尋行為。

**真機驗證通過**（2026-08-22，Pixel 10a）：開關、觸發詞加／刪、對話觸發
搜尋並正確注入回覆，owner 實測皆正常。owner 也指出一個已知限制：要不要搜
／抽什麼查詢詞是丟給輔助模型（或無輔助模型時的主模型）做的一次分類任務，
準確度跟模型能力有關——弱模型可能誤判「是不是在問時事」或抽出不好的
查詢詞。這是設計本身就有的限制（桌面版同樣邏輯、同樣風險），這次是逐字
搬遷沒有加額外校驗層，記錄下來但不當成這次的 bug 處理。

`npm run typecheck`／`npm test`（77 檔、988 項）全過。已 commit
（`220727a`），未 push。

## 2026-08-22（續十一）｜文件補追：B9a／CWA 即時查詢真機驗證確認＋資安免責警語落地

盤點 `TODO.md` 時發現兩處文件落後於實際進度：

- **飲食記錄 App B9a MVP**：`TODO.md` §0 與 `docs/nutrition-module-kickoff.md`
  文首都還寫「尚未開工」，但 2026-08-18 那則條目其實已經寫著「owner 用過
  B9a 之後回報四個 UI 問題」——代表 MVP 早就完成並在用，只是完工當下沒有
  回頭改這兩處的狀態列。已補上 `[x]` 與說明。
- **CWA 地震／颱風／天氣預報即時查詢**（續八那節）：owner 確認已經真機
  驗證通過，`TODO.md` 對應段落原本寫「尚未真機驗證」一併更正。

順手把 2026-08-22 討論資安風險時定案、owner 說「現在做」的兩則警語補上
（`TODO.md` §2.5，原本只列了範圍還沒實作）：

- **配對／QR 警語**：QR code／配對網址等同能連進電腦資料的憑證，勿外流
  截圖；`mobile.useTunnel` 預設開啟會經 `relay.nori.tw` 讓資料可從網際
  網路連入。放在桌面 `SettingsPanel.tsx`（手機遙控設定的配對區塊）、
  `QRCodeWindow.tsx`（QR 實際顯示畫面）、手機 `SyncImportView.tsx`（S1
  掃碼匯入 pair 步驟）、`ModeSwitcher.tsx`（S2 切換遙控模式掃碼區塊）。
- **無雲端備份免責聲明**：本機／手機資料沒有雲端副本，硬碟壞掉／解除
  安裝／手機遺失都會永久遺失資料，籲請自行用搬家包／角色卡匯出定期
  備份。放在桌面設定「記憶」分頁（資料夾位置下方）、手機「關於」頁
  （`AboutView.tsx`）。

純文案＋UI 插入，沒有動任何邏輯。`npm run typecheck` 全過；未特別加測試
（無邏輯可測）。未真機/未點開實際畫面驗證排版（純文字段落，風險低）。

## 2026-08-22（續十二）｜文件補追（B9b 拍照估價確認完成）＋兩份新規劃文件

再次盤點待辦時 owner 指出兩件事：

- **B9b LLM 拍照估價**其實已經大致做完，`docs/progress-log.md` 前面幾節
  （`docs/nutrition-photo-estimate-plan.md` §6.5 對照表那次）早就把 core／UI
  的缺口補齊了，`TODO.md` 沒有把這條標成完成。owner 決定「先實際使用，
  等用出問題再回頭調」，不是繼續往下開發——`TODO.md` 已標記 `[x]` 並註明
  這個決定，避免下次又被當成「還沒做」重新排程。

順手寫了兩份新的開工用文件（純規劃，沒有動程式碼）：

- **`docs/reminder-sync-kickoff.md`**（新增）：`TODO.md` §2.3「提醒同步」的
  開工指令。核心難點不是「多加一個 S2 M4 的 kind」，是 `Reminder` 裡
  `notificationDevice`／`wakeMode`／`inactiveBehavior` 這幾個欄位是裝置本地
  設定，同步時不能整包覆蓋——文件裡指名 `mobile/runtime/syncApply.ts` 的
  `scenes` case（`desktopCharacters` 座標「電腦專屬，一律保留接收端原值」
  那段）當作直接抄的範本，並列出 `characterId`／`sceneId` 可以用既有的
  `Maps` id 對照表轉換，但 `conversationId` 沒有對應的對照表（對話同步是
  獨立的 `convPair.ts` 配對邏輯），解不開就整欄位不推，不產生死參照。
- **`docs/mobile-android-widget-plan.md`**（整份改寫，取代 2026-08-10 初版）：
  owner 給出更具體的規格——角色頭像（可框選臉部範圍，重用既有
  `avatarCropMath.ts`／`AvatarCropView.tsx` 的裁切數學）＋名稱＋一句話
  （最新發言或使用者手動釘選過去發言，新入口規劃在 `MessageMenu.tsx`），
  可選擇不顯示頭像，尺寸只做 3x1／4x1（拿掉初版的便利貼模式與多尺寸斷點）；
  點擊小工具**只開主程式，不做任何小工具內操作**（拿掉初版的「對話」快捷
  按鈕）。核心架構決定：DeST 主 App 有獨立／遙控兩種資料來源模式（飲食
  記錄 App 沒有這個問題），設計上讓 JS 端 Bridge 把要顯示的內容（已裁切好
  的圖片＋文字）落地成固定路徑的檔案，原生層只管讀檔案、不必分辨目前是
  哪個模式，跟「資料到底存在手機還是電腦上」完全解耦。

兩份都只是設計文件，**沒有寫任何程式碼**，不需要跑 typecheck／test。

## 2026-08-22（續十三）｜owner 追加需求：小工具顯示提醒與兩則對話、聊天記錄換表情

owner 對兩份新規劃文件追加需求，追加內容全部併回原文件，不另開檔：

- **提醒能不能顯示在小工具上**：查證後發現這**幾乎是白送的**——提醒觸發時
  `mobile/runtime/reminderSpeak.ts` 本來就會把生成的台詞
  `conv.messages.push(msg)` 推進某個對話（`reminderSpeak.ts:360`），跟一般
  聊天訊息完全同一種資料形狀。所以只要小工具 Bridge「找這個角色最新一則
  訊息」時掃過角色參與的**全部**對話（不是只看使用者目前開著的那個），
  提醒的台詞自然會被抓到。`mobile-android-widget-plan.md` §4.1／§4.2
  補了這個說明，並提醒動工時要確認 `reminderSpeak.ts` 這條背景路徑真的有
  掛到 Bridge 的觸發鏈，不是只掛在使用者主動聊天的 `chat.ts`。
- **小工具拉到 3x2/4x2 時顯示最新兩則或最多釘選兩則**：資料模型從單一
  `pinMode`／`pinnedMessage` 改成 `pinnedMessages` 陣列（最多 2 筆，順序＝
  顯示順序），未釘滿的位置依最新到最舊遞補（跳過已釘選那幾則，避免同一句
  重複出現在兩格）。頭像**只對應陣列第 0 筆**的表情——3x2/4x2 不會有兩張
  頭像，這是刻意簡化，理由寫在 §5.2。尺寸判定沿用飲食小工具已驗證過的
  「不用 API 31+ 的 `RemoteViews(Map<SizeF,…>)`，自己讀
  `onAppWidgetOptionsChanged()` 判斷」做法，這次改判斷**高度**（1 格高
  vs 2 格高）挑版面，`resizeMode` 也從原本設計的「只鎖橫向」改回開放縱向
  （3x1/4x1 ↔ 3x2/4x2 本來就需要使用者能拉高）。
- **手機對話記錄頭像也要換表情，且要跟小工具共用同一個框選範圍；並新增
  手動指定表情覆蓋 AI 判斷**：這已經超出「小工具」的範疇（影響一般聊天
  畫面），拆成新文件 **`docs/mobile-character-expression-plan.md`**，
  `mobile-android-widget-plan.md` 改成引用它、不重複設計裁切邏輯。新文件
  重點：
  - 框選範圍存放位置從原本命名 `widget-config.json` 改名
    `character-display-config.json`（mobile-only，不進同步／搬家包，理由
    跟原本一樣，只是現在明確服務兩個消費端）。
  - 新純函式 `resolveDisplayImagePath()`（放 `core/character/`）：找不到
    對應 `emotion` 的圖就退回 `avatar`，聊天泡泡與小工具 Bridge 共用同一份，
    不要各自算一次。
  - `Message` 型別新增 `emotionOverride?: string`（使用者手動指定，跟 AI
    判斷的 `emotion` 分開存，只影響顯示不影響下一輪 prompt）；因為是普通
    `Message` 欄位，隨對話整包同步，不用碰任何同步引擎程式碼。
  - **這份文件推翻一個舊決策**：`CharacterEditor.tsx` 檔頭與
    `b3-mobile-ui-plan.md` §3.1／§5.1 寫過「手機版是單張主圖免表情差分」
    是 2026-08 初的範圍決定，owner 2026-08-22 改變主意——文件開頭特別
    加了警語，避免下一個接手的 AI 看到那句舊註解就誤以為這是誤讀規格。

`TODO.md`／`CLAUDE.md` 依任務選讀表都補了對應項目與前置依賴關係
（先做 `mobile-character-expression-plan.md` 再做
`mobile-android-widget-plan.md`）。三份規劃文件都還沒有任何程式碼，
不需要跑 typecheck／test。

## 2026-08-22（續十四）｜owner 第三輪追加：小工具對白要多字＋點對白跳轉、手機新增表情圖片

同一天第三輪追加，兩份規劃文件再更新：

- **`mobile-android-widget-plan.md`**：
  - **對白要顯示 20–50 字，不要單行截斷**：頭像改成**固定佔一格寬度**，
    不論 3x1 拉到 4x1 都不變大，多出來的寬度全部給文字；名字改小字，
    對白才是視覺重點；文字排版從「單行 `ellipsize`」改成「多行、依實際
    寬高動態算字級/行數」（比照飲食小工具 `valueTextSizeSp()` 的做法），
    只有真的超長才在最後一行截斷。
  - **點對白要跳到對應的那一則訊息**：`widget-cache/<id>/state.json` 的
    每則對白現在要帶 `conversationId`／`messageId`，不是只有顯示文字；
    點擊行為從「整個小工具一個 PendingIntent」改成「對白區域各自獨立的
    PendingIntent（帶 extra）＋其餘區域共用一個（不帶 extra）」。App 端
    收到後呼叫既有的 `conversations.load()`（`ConversationsView.tsx` 已在
    用的方法）切換對話，再捲動到指定訊息——**這是全新功能**，`MessageList.tsx`
    檔頭剛好已經寫死一條教訓「用容器自己的 `scrollTop`，不要
    `scrollIntoView()`（Capacitor WebView 裡常去捲外層）」，這次直接沿用
    那條規則，沒有繞過去。
- **`mobile-character-expression-plan.md`**：owner 追加「手機端也要能新增/
  指定表情圖片本身」，理由是「可能有人拿去平板上用，畫完就直接指定過來」。
  查了桌面版現況：`EmotionSpritesTab.tsx` ＋ `emotionUtils.ts` 的
  `EMOTION_OPTIONS`（28 個固定情緒 key）＋ IPC `character:save-emotion-sprite`
  就是現成的完整流程，這次是把同一套資料模型搬一份操作介面到手機——
  新增 §3.3，把 `EMOTION_OPTIONS` 搬到 `core/` 給兩邊共用（避免兩份清單
  漂移，這個專案已經在 `contentHash.ts` 等地方吃過同類虧好幾次），手機
  存檔路徑要跟桌面現有的檔案佈局對齊（S1/S2/搬家包才讀得到）。這件事
  跟 §3.1 的框選、§3.2 的手動指定顯示都不一樣——**這是真正的角色卡內容**，
  正常隨同步走，不是裝置本地設定。

`TODO.md` 兩條對應項目都同步更新細節。兩份都仍是純規劃文件，沒有動任何
程式碼，不需要跑 typecheck／test。

## 2026-08-23｜手機版對話記錄換表情＋手動指定表情＋手機新增表情圖片：實作完成

照 `mobile-character-expression-plan.md` §8 步驟做完，`npm run typecheck`／
`npm test`（78 檔、993 項）皆過，尚未真機驗證。

- `core/types.ts`：`Message` 新增 `emotionOverride?: string`。
- `core/character/emotionCatalog.ts`（新檔）：`EMOTION_OPTIONS`／`emotionLabel`
  從 `renderer/src/utils/emotionUtils.ts` 搬過來；桌面那支改成 re-export。
- `core/character/displayImage.ts`（新檔）：`resolveDisplayImagePath()`
  （純函式，補了測試 `tests/core/character/displayImage.test.ts`）＋
  `FaceCropRect`／`CharacterDisplayConfigMap` 型別。
- `core/store/keys.ts`：新增 `CHARACTER_DISPLAY_CONFIG_KEY`。
- `core/data/types.ts`：`CharactersApi` 加 `getFaceCrop`／`setFaceCrop`／
  `saveEmotionSprite`；`MessagesApi` 加 `setEmotionOverride`；`DataSource`
  加 `characterDisplayImageUrl(characterId, emotion)`。

**跟文件原本設計有一處偏離，值得記下來**：文件 §4 說「裁切在讀圖那一層做，
獨立模式在 `session.ts`、遙控模式在讀取端點回應後」，隱含兩邊各自存一份
`getFaceCrop`/`setFaceCrop` 邏輯。實作時發現 `faceCrop` 跟 `MODE_PREF_KEY`
是同一類東西——**裝置偏好，不是模式資料**：不管手機當下連哪一種模式，
框選範圍都該讀寫同一份 `character-display-config.json`（`capacitorAdapters.storage`，
跟連線模式無關）。於是抽成共用模組 `mobile/runtime/faceCropConfig.ts`
（`getFaceCrop`／`setFaceCrop`／`cropImageToFace`），`LocalDataSource`（經
`session.ts` delegate）與 `RemoteDataSource` 都直接呼叫它，**遙控模式的
`getFaceCrop`/`setFaceCrop` 完全不打 HTTP**——沒有新增對應的
`/api/characters/face-crop` 端點，這點跟文件字面稍有出入但不影響行為，
只是實作位置更集中。

另一個沒寫進文件但值得記的細節：`FaceCropView.tsx`（框選 UI）**完全不用
canvas 讀取像素**——跟 `AvatarCropView.tsx` 不一樣，這裡只需要算「比例矩形」
不需要輸出裁切後的檔案，所以只讀 `<img>.naturalWidth/naturalHeight` 就夠，
canvas／`toDataURL()` 只用在**套用**裁切時（`cropImageToFace()`）。這樣
框選來源圖可以直接是遙控模式的網路位址（`/api/avatar/:id`），不會有跨來源
canvas「已污染」丟 `SecurityError` 的問題；真正需要讀像素的
`cropImageToFace()` 則要求呼叫端先把圖轉成 `data:`／同源 `blob:` URL
再傳進來（`RemoteDataSource.characterDisplayImageUrl` 用 `http.getBinary`
取位元組轉 blob URL，不是直接把網路位址塞給 `<img>`）。

`GET /api/avatar/:id` 加了 `?emotion=` query（找不到就退回主圖）；新增
`POST /api/characters/save-emotion-sprite`（落地即指定情緒並持久化，
`ipcHandlers.ts` 的 `saveCharacterEmotionSpriteAndAssignDirect`，跟桌面
既有的 `character:save-emotion-sprite`——那支只落地不指定情緒——是兩支
不同函式，服務不同 UI 流程）與 `POST /api/messages/set-emotion`。

手機 UI：`useCharacterDisplayImage()`（`useAvatarUrl.ts`，cache key 含
emotion）、聊天泡泡改用它（`MessageList.tsx` 的 `MessageAvatar`）、
`MessageMenu.tsx` 新增「換表情」（只在角色訊息且該角色有表情圖時顯示）
進 `MessageEmotionPicker.tsx`、`CharacterEditor.tsx` 新增「顯示設定」
區塊（框選按鈕＋28 情緒 key 的縮圖網格，點了直接选圖上傳並指定）。

真機待驗：框選手感、聊天泡泡表情切換有沒有跑版、手機新增表情圖片後
桌面版能不能正確讀到（檔案佈局已對齊 `characters/<id>/emotions/`，理論上
可以，但沒有實機測過）。

## 2026-08-23（續）｜owner 首次真機實測回報五個問題，四個確認並修掉

1. **框選之後沒有預覽圖**：`CharacterEditor.tsx` 的「顯示設定」框選按鈕旁加了
   `FaceCropPreview`（用 `useCharacterDisplayImage(id, undefined)`，跟框選成功後
   `invalidateAllCharacterDisplayImages()` 接得上，馬上看得到套用結果）。
   **順手把「全部角色圖都要採用框選版」也做了**：`Avatar.tsx`（角色庫／
   `AvatarBar`／`CharacterMenu`／`PresenceSheet` 共用的那顆頭像元件）原本吃
   `useAvatarUrl`（永遠原圖），改成 `useCharacterDisplayImage(id, undefined)`，
   沒框選時兩者結果相同，框選後全站頭像才會一致跟著變——原本只有聊天泡泡
   會變，其餘頭像看不出框選有沒有生效。
2. **手機本機版角色卡有表情設定，對話頭像卻沒反映**：**真正的成因**，
   不是顯示邏輯的問題，是**手機獨立版聊天管線根本沒有在生成情緒標籤**。
   `mobile/runtime/chat.ts`（3 處）與 `reminderSpeak.ts`（1 處）呼叫
   `chatWithLLM()` 時都帶著 `omitEmotionTag: true`——這行字面上的意思是「這次
   不需要情緒標籤」，是 2026-08 初「手機獨立版單張主圖免表情差分」那個舊決議
   留下的參數，這次功能已經推翻該決議，但**送出聊天請求那幾行沒有跟著拿掉**。
   `openai.ts`／`claude.ts`／`gemini.ts` 三個 provider 都把
   `splitEmotion: params.splitEmotion || params.omitEmotionTag` 一起丟給
   `buildSystemPrompt()`，而 `promptUtils.ts` 只在
   `hasCustomSprites && !opts.splitEmotion` 時才會叫模型輸出 `[emotion_id]`
   標籤——`omitEmotionTag: true` 等於永遠讓這個條件是 false，模型完全不會被
   要求輸出情緒標籤，`chatWithLLM()` 回傳的 `emotion` 自然永遠是空/預設值。
   **修法：4 處全拿掉 `omitEmotionTag: true`**，不需要額外的輔助模型分類呼叫
   （跟桌面「不分離」模式一樣，情緒標籤就是主模型回覆的第一行）；角色卡沒有
   任何表情圖時 `hasCustomSprites` 本來就是 false，不會多花 token，安全。
3. **`36`／`28`：情緒圖片數量統計爆掉**：`resolveDisplayImagePath()` 與
   `CharacterEditor.tsx` 的顯示設定區塊，都把 `character.spriteIds` 的
   **key**（那是「圖片路徑 → 自訂 id」的路徑）跟 `character.emotions` 的
   **key**（「情緒 key → 圖片路徑」）混進同一個 `Set` 算數量——兩者是完全不同
   的命名空間，desktop 角色只要曾經在 `EmotionSpritesTab.tsx` 設過自訂 ID，
   `spriteIds` 就會多出幾個「圖片路徑」當 key，跟 28 個情緒 key 加起來就超過
   28（角色卡若有 8 張自訂 ID 圖，28+8=36，正好對上 owner 回報的數字）。
   `resolveDisplayImagePath()` 的型別也從 `Pick<Character,'avatar'|'emotions'|'spriteIds'>`
   改成不吃 `spriteIds`；`mobileServer.ts` 的 `/api/avatar/:id?emotion=` 端點
   同一個坑也一起修掉。`tests/core/character/displayImage.test.ts` 補一條
   「不查 spriteIds」的測試鎖住這個行為。
4. **點聊天泡泡頭像應該放大顯示這則訊息用的表情圖**：`CharacterMenu.tsx`
   拆成 `CharacterMenu`（給 `AvatarBar` 用，維持原樣）與新匯出的
   `CharacterMenuActions`（純動作列表，不含頭像/名字那段）；新檔
   `MessageAvatarPanel.tsx`（新 `ViewKind: 'message-avatar-panel'`）放大
   顯示 `message.emotionOverride ?? message.emotion` 對應的那張圖
   （128px，`useCharacterDisplayImage`），底下重用 `CharacterMenuActions`
   維持原本的提及／說點什麼／禁言／編輯角色／移出對話。`MessageList.tsx`
   的泡泡頭像 `onClick` 從 `push('character-menu', characterId)` 改成
   `push('message-avatar-panel', messageId)`。
5. **「遙控版的表情設定全部都一樣，出不來」尚未在程式碼裡找到對應的邏輯錯誤**
   ——重新審過 `/api/avatar/:id?emotion=` 端點與 `RemoteDataSource` 的
   `characterDisplayImageUrl()`／`getFaceCrop`／`setFaceCrop`，資料流看起來
   是對的。**最可能的原因是 owner 測試時桌面 App／已裝的 APK 還是舊版**——
   `mobileServer.ts`／`ipcHandlers.ts` 是 Electron **主行程**程式碼，改完
   一定要重新 build 並整個重啟桌面 App（不是 renderer 那種可以熱更新的
   部分），APK 那邊本來就要重新打包裝機。請 owner 重新走一次
   `DesktopST-dev.bat`（桌面）／`MobileST.bat [1]`（手機）流程再測一次，
   如果重建之後還是一樣，需要 owner 提供更具體的現象（例如：是「全部角色的
   全部情緒都顯示同一張圖」還是「同一個角色的不同情緒顯示同一張圖」還是
   「顯示不出來變成腳印圖示」）才能繼續往下查。

`npm run typecheck`／`npm test`（78 檔、993 項）皆過。1–4 已修好但這輪仍然
只是程式碼層級驗證，**還沒有 owner 二次實機驗證**。

## 2026-08-23（續二）｜二次實機回報：真正的根因找到了（三個症狀同一個成因）

owner 重測後回報：本機版跟遙控版都一樣，AI 選出來的表情完全沒反映在頭像上，
**對話記錄上寫的表情看起來像檔名**，手動「換表情」才會正常顯示。

「看起來像檔名」是關鍵線索，一路查回 `core/prompt/promptUtils.ts` 的
`buildEmotionContract()`——**送給模型的情緒 id 合約，本來就不是
`EMOTION_OPTIONS` 那 28 個 canonical key**：只要角色卡有任何一張表情圖，
合約用的 id 是 `spriteIds[imagePath]`（自訂 id），**沒設自訂 id 時退回檔名主幹**
（去掉副檔名，例如 `joy-1755900000000.png` → `joy-1755900000000`）。這是桌面
版原本就有的機制（一張圖可以同時涵蓋好幾個情緒 key，需要一個共用 id），
但這次 §4 寫的 `resolveDisplayImagePath()` 只做了「查 canonical 情緒 key」
這一層，**完全沒有反查自訂 id／檔名主幹回圖片路徑**——而手機新增表情圖片
時（`saveEmotionSprite`）從來不會填 `spriteIds`，所以合約 id 100% 會是
檔名主幹。模型忠實地回傳這個檔名主幹當 emotion tag，`resolveDisplayImagePath`
查不到對應的 canonical key，於是**每一句都判定「沒對到表情」，退回主圖**——
本機版跟遙控版都是同一份 `resolveDisplayImagePath()`，所以兩邊症狀一致；
手動「換表情」是直接從 `character.emotions`／`spriteIds` 的 key 選，本來就
繞過了這個對應問題，所以唯獨那條路正常。

**修法**：
- `buildSpriteIdMap()`（原本只有桌面 `emotionUtils.ts` 私有）搬到
  `core/character/emotionCatalog.ts`（連同 `stemFromFilename`），
  `promptUtils.ts` 的 `buildEmotionContract()` 與桌面 `emotionUtils.ts`
  都改成呼叫同一份——**這兩處算 id 的規則必須對稱**，各自維護一份遲早
  又會漂移出同一種坑。
- `resolveDisplayImagePath()` 補上第二層查詢：先查 `emotions[emotion]`
  （canonical key），查不到再用 `buildSpriteIdMap()` 反查自訂 id／檔名主幹。
  型別簽章加回 `spriteIds`（上一輪為了修 36/28 那個 bug 誤刪的，那個 bug
  的成因是「統計時混用兩種命名空間」，不是「查 spriteIds 本身是錯的」——
  這裡是另一個場景，兩者互不衝突）。
- `mobileServer.ts` 的 `/api/avatar/:id?emotion=` 改呼叫同一支
  `resolveDisplayImagePath()`，不要自己在端點裡重寫一次比對邏輯。
- `saveEmotionSprite`（`session.ts` 與 `ipcHandlers.ts` 的
  `saveCharacterEmotionSpriteAndAssignDirect`）新增時順手把
  `spriteIds[path] = emotionKey` 填上——這樣 LLM 合約看到的 id 就是乾淨的
  `joy`，不是一串檔名，除錯與 debug prompt 也更好讀（雖然檔名主幹的
  fallback 已經能正確運作，這只是讓新存的資料更乾淨）。
- 補了兩條測試鎖住這個對稱關係：自訂 id 能反查回圖、沒有自訂 id 時檔名
  主幹也能反查回圖。`npm run typecheck`／`npm test`（78 檔、995 項）皆過。

這輪修完才是真正解到「AI 選的表情能不能顯示」這個核心功能——前一輪
（1–4）修的都是週邊（預覽、統計、放大面板），這條資料對應鏈路一直是斷的，
兩輪加起來才是完整的東西。**仍待 owner 三次實機驗證**：本機版與遙控版
聊天時，AI 選的表情這次應該真的會換頭像了。

## 2026-08-23（續三）｜三次實機回報：跨裝置同步後表情又消失——真正的架構級成因

owner 三次測試：遙控版剛發的新訊息表情正常了（確認上一輪修的沒錯），
但**把那則訊息同步到本機版之後，同一則訊息卻變回沒有表情**，要在本機版
再發一則新訊息才又正常。

**這是比前一輪更深一層的架構問題**：上一輪修的 `resolveDisplayImagePath()`
能反查自訂 id／檔名主幹沒錯，但反查用的 `character.emotions`／`spriteIds`
是**每台裝置各自的本機資料**——自訂 id／檔名主幹本身是**裝置本地產生的**
（獨立版存表情圖檔名是 `<key>-<timestamp>.ext`，桌面版另一套時間戳／可能
另一個自訂 id）。`message.emotion` 存的若是這種裝置本地 id，訊息一旦透過
S2 對話同步換一台裝置檢視，那台裝置用**自己的**（值不同、id 命名不同）
`emotions`／`spriteIds` 反查，字串當然對不上——即使那台裝置的角色卡明明
也有同一個情緒的圖片。原本能動是因為訊息與角色資料在**同一台裝置**上是
自洽的（同一份 id 生成規則），一旦訊息離開原生裝置，這個自洽性就破了。

**真正的修法：訊息落地前就換算成 canonical key（`EMOTION_OPTIONS` 的固定
英文字，例如 `joy`），不要存裝置本地的自訂 id／檔名主幹**。canonical key
兩邊定義完全相同（`core/character/emotionCatalog.ts` 是共用的唯一真相），
不受各裝置檔名／自訂 id 差異影響，換裝置檢視時 `resolveDisplayImagePath()`
的第一層（`emotions[emotion]`）就能直接用那台裝置自己指派的圖命中，不需要
依賴任何跨裝置一致性假設。

新函式 `canonicalizeEmotionId(character, id)`（`core/prompt/promptUtils.ts`）：
本來就是 canonical key 就原樣回傳；不是的話用 `buildSpriteIdMap()` 反查
成圖片路徑，再反查出對應的 canonical key。接進**唯一**兩個會產生
`message.emotion` 的地方（不管桌面／獨立版／遙控版哪個平台呼叫，全部都
只走這兩支）：
- `chatWithLLM()`（`core/llm/index.ts`）：原本直接把 provider 回傳的
  `emotion` 往外傳，改成先過 `canonicalizeEmotionId()` 再回傳。
- `classifyEmotionWithLLM()`：`resolveId()` 跟它的 `fallback`（`knownIds[0]`
  本身也可能是自訂 id／檔名主幹）都要換算。

補了 4 條測試（`tests/prompt/promptUtils.test.ts`）鎖住：canonical key 原樣
回傳、自訂 id 換算、檔名主幹換算、查無對應時安全回退（不擲錯）。
`npm run typecheck`／`npm test`（78 檔、999 項）皆過。

**這次修完之後，只有這次修正之前就已經生成的舊訊息**（`message.emotion`
還是裝置本地 id 的那些）在跨裝置檢視時仍會退回主圖——這是資料問題不是
程式問題，不會自動修好，使用者可以對那幾則手動「換表情」補回來。
**之後新產生的訊息，不管在哪個裝置生成、同步到哪一台看，都應該正確**。

**owner 第四次實機驗證通過**：跨裝置同步後表情正常顯示。三輪修正到此收工，
已 commit（`0cf918f`）並推上 `origin/main`。

---

## Android 桌面小工具（DeST 主 App，2026-08-23）

`docs/mobile-android-widget-plan.md` 整份實作完成，`npm run typecheck`／
`npm test`（999 項）皆過。**真機測試清單完全還沒跑**——這是原生 Android／
Capacitor 外掛工作，自動測試測不到原生層，詳細待驗清單見計畫書 §11.2。

核心架構跟計畫書一致：JS 端 Bridge 把「角色現在該顯示什麼」落地成
`widget-cache/<characterId>/state.json`＋`image.png`，原生層只讀檔案、
不必分辨獨立／遙控模式。新增 `core/character/widgetSnapshot.ts`（掃全部
對話找角色最新訊息的純邏輯，`mobileServer.ts` 與 `session.ts` 共用同一份，
不重複維護）、`DataSource.widgetLatestMessages()` 新介面方法（獨立模式
委派 `session.ts` 直接掃 `conversationIndex`；遙控模式打新端點
`GET /api/widget/latest-messages/:id`，複用既有的 `bridge.getConversationList()`／
`getConversationForSync()`，沒有改 `MobileBridge` 介面）。頭像圖片完全
沿用既有的 `characterDisplayImageUrl()`（含表情解析與框選裁切），Bridge
只需要把回傳的 `data:`／`blob:` URL 轉成位元組寫檔。

觸發時機沒有分散掛在 `chat.ts`／`reminderSpeak.ts` 每個訊息推送點，改成
集中在 `appStore.ts` 的 `handleEvent()`「message」分支（涵蓋前景與背景但
JS 還活著的情境）＋ `session.ts` 的 `runReminderHeadless()`（這支本來就是
「前景排程與原生 headless WebView 共用的同一條路徑」，是唯一可能在
`appStore` 未 `attach()` 時執行的路徑，另外用不經過 `getData()` 的
`refreshWidgetCacheWith()` 版本 hook）。兩個點就涵蓋了計畫書 §4.1 列的
四種觸發時機，不用改 `chat.ts`／`reminderSpeak.ts` 一行。

原生端（`android/app/src/main/java/tw/nori/dest/widget/`）：
`DeSTWidgetProvider.kt`（讀快取、依高度挑 1 行/2 行版面、頭像在 Kotlin 端
用 Canvas 裁成圓形、每則對白與其餘區域各自的 `PendingIntent`）、
`DeSTWidgetConfigureActivity.kt`（選角色＋顯示頭像開關，標準
`ACTION_APPWIDGET_CONFIGURE` 流程）、`DeSTWidgetBridgePlugin.kt`
（`refresh()` 觸發 `updateAll()`，照抄飲食小工具的既有做法）。DeST 這個
Android 專案原本純 Java，這次比照飲食小工具補了 Kotlin 工具鏈
（`kotlin-android` plugin＋`kotlin-stdlib`，`kotlinVersion 2.4.10` 對齊）。

§5.0 要求的動態字級／行數演算法目前是簡化版（依寬度分三段給固定
12/13/14sp，不是像飲食小工具 `valueTextSizeSp()` 那樣精確算可用 dp
反推），先求「對白不會被單行截斷」的核心要求成立，真機測出字級不合適
再回頭調整那三個數字即可。完整偏離設計的清單見計畫書 §11.1。

### 第一次真機測試回饋後的改版（同日稍後）

owner 裝機後回報六項，完整記錄在計畫書 §12。兩個純技術坑值得記在這裡：

**① Kotlin 的區塊註解會巢狀，`/*` 出現在註解字串裡就編不過。** KDoc 裡寫了
`` `widget-cache/*` ``，那個 `/*` 被當成又開一層註解，整份檔案「Unclosed
comment」，而錯誤位置指向檔案最後一行，完全看不出跟註解有關。Java／TS
都沒有這個行為（不巢狀），所以很容易寫出來。**Kotlin 註解裡不要出現
`/*` 或 `*/`**。

**② `RemoteViews` 不認得裸的 `<View>`。** 兩則對白版的分隔線用了
`<View android:layout_height="1dp">`，inflate 直接丟例外，launcher 顯示
「無法載入小工具」——而且**只有拉高到兩格的尺寸會壞**（一行版沒有分隔線），
症狀看起來像尺寸判定寫錯，完全不會聯想到分隔線。RemoteViews 只吃帶
`@RemoteView` 註解的白名單類別（FrameLayout／LinearLayout／TextView／
ImageView／ProgressBar⋯⋯），改用 `FrameLayout` 當分隔線就好。
**之後往小工具版面加任何新元素，先確認那個類別在白名單上。**

**架構上最大的一項：小工具不再綁角色，改成跟著「目前這個對話」走。**
owner 的三項回饋（不想先選角色／不知道為什麼顯示那一則／釘選沒反應）
其實是同一個問題——小工具實例綁在角色 A，釘選的卻是角色 B 的發言，
於是「釘了但沒反應」，而使用者根本不知道有綁定這回事（那是放置時點過
一次就再也看不到的設定）。改成全域一份快照之後連帶簡化掉不少東西：
`DataSource.widgetLatestMessages()` 與 `mobileServer.ts` 的
`/api/widget/latest-messages/:id` 端點整個拿掉（`getState()` 本來就帶
目前對話的訊息，遙控模式不必多打一支 API、電腦端完全不用動）、
`DeSTWidgetConfigureActivity` 與 `widget-character-list.json` 一起刪掉。
另外補了 App 內的「桌面小工具」設定頁（預覽＋管理釘選＋頭像開關，
預覽走跟小工具同一支 `computeWidgetLines()` 保證不漂移）、釘選狀態的
單一真相 `ui/stores/widgetStore.ts`、以及表情選單的「使用預設圖片」
（新哨符 `DEFAULT_IMAGE_EMOTION`——「跟隨 AI 判斷」不等於「顯示主圖」，
少了這一顆就真的換不回去）。

`npm run typecheck`／`npm test`（79 檔、1014 項）與
`gradlew assembleDebug` 皆過；**真機仍待驗證**，清單見計畫書 §12.7。

### 兩則不同角色時各自顯示頭像與名字（同日再追加，計畫書 §13）

owner：「小工具顯示兩則對話的時候，如果兩則是不同角色，希望兩則都能顯示
各自的頭像和名字。」——推翻原 §5.2「頭像只有一張」那條刻意簡化。原本的
理由（同一張臉的兩個表情擺在一起像故障）在**同一個角色**連講兩句時仍然
成立，但群組聊天裡只掛一張臉等於分不出哪句是誰說的。所以規則變成三態：
一則／兩則同角色 → 共用一張臉；兩則不同角色 → 各自一張。

判斷 `hasDistinctSpeakers()` 放在 core（有測試），結果寫進 `state.json` 的
`perLineSpeaker`，原生層照著挑版面不重算——延續「原生層不做決策」的做法。
版面新增第三份 `widget_dest_character_2line_multi.xml`（兩列各自完整）
而不是靠 visibility 兜：兩種結構本來就不一樣，硬塞同一份會變成一堆互相
牴觸的 margin，而 RemoteViews 能改的屬性又有限。`widget_line1/2` 與
`widget_root` 的 id 三份共用，所以點擊與對白那幾段完全不用分支。

頭像檔案從 `image.png` 改成 `image1.png`／`image2.png`。**抓不到圖時一定要
把舊檔刪掉**，否則角色換了、頭像卻停在上一位的臉。`state.json` 的 `name`
也從頂層移到每一則，JS 端解析完再寫，原生層不必知道 `presentCharacters`。

typecheck／test（1018 項）／`gradlew assembleDebug` 皆過，真機待驗項見
計畫書 §13.5。

### 顯示順序與配色／透明度（同日第三輪，計畫書 §14）

owner 三項：自動顯示的要「新的在下面」、小工具要能選 12 組配色＋調底色
透明度、飲食小工具也要同一套但兩邊各自獨立。

**①「新的在下面」有一個很隱蔽的連鎖反應。** `buildWidgetLines()` 取最新
N 則後再反轉成時間序，於是 **`limit` 不再是單純的截斷關係**：`limit=1`
拿到「最新那則」，`limit=2` 的第 0 則卻是**比較舊**的那則。矮版小工具
（3x1／4x1）若照舊拿 `limit=2` 的結果取第一個，群組聊天時就會顯示 A 的
舊發言配 B 的頭像。改成 `limit=1` 另外算一份寫進 `state.json` 的
`singleLine`，並讓每一則各自帶 `avatarIndex` 指向要用哪張 `imageN.png`
（頭像也因此改成「每則顯示出來的都準備一張」，不再只在 perLineSpeaker 時
才產第二張）。有測試守著這條。

**② 色表搬到 `src/shared/colorThemes.ts` 當唯一真相。** 飲食記錄 App 只吃
得到 `@core`／`@shared` 兩個 alias，碰不到 `src/mobile/`；抄一份過去就是
這個專案踩過好幾次的雙邊定義漂移（`contentHash.ts`／`settingsSnapshot.ts`）。
`src/mobile/ui/theme.ts` 改成 re-export，既有 import 全部不用動。
**CLAUDE.md §3 那條「改主題要一起改的清單」已經跟著更新。**
換算邏輯也共用（`src/shared/widgetAppearance.ts`）：主題色 ＋ 透明度算成
`#AARRGGBB` 交給原生層——原生層讀不到 TS 色表，而且 Android 的
`Color.parseColor()` **不吃 CSS 的 `rgba(...)`**，色表裡的 `border` 剛好
就是那個格式，一定要先換算。

**③ 圓角底板只能用 ImageView。** RemoteViews 在 minSdk 26 上，
`setBackgroundColor` 會失去圓角、`setBackgroundTintList` 要 API 31——
兩條都不能用。所以八份版面（DeST 三份、飲食四份）的 root 都改成
`FrameLayout` 包一個 `widget_bg` ImageView，由 Provider 依實際尺寸畫一張
圓角矩形 bitmap 塞進去。⚠️ 那個 ImageView **不可以設 `android:background`**，
會蓋在透明 bitmap 底下讓透明度完全失效。

飲食小工具的語意色（熱量超標紅／蛋白質達標綠）**刻意不跟著配色跑**，
但「正常」那一側的大數字改用配色文字色——否則深色配色下是深綠字配深底。

typecheck／test（80 檔、1035 項）／兩支 APK 的 `assembleDebug` 皆過，
真機待驗項見計畫書 §14.4。

### 按鈕沒跟著配色 ＋ 飲食 App 本身也要換色（第四輪，計畫書 §15）

owner：「改了飲食小工具配色，結果按鈕還是原本的淺綠色」「飲食 App 本身
配色也是要可以設定那 12 組」。

**按鈕漏掉的原因就是 §14.3 記過的那條限制，只是上一輪只修了容器。**
三顆按鈕的圓底是 `android:background` 指到寫死 `@color/widget_mint` 的
drawable，而 RemoteViews 在 minSdk 26 上不能 tint 背景 drawable、
`setBackgroundColor` 又只會得到方形。修法是**把「圓底＋圖示」整顆畫成
bitmap 當 src**，再用 `setBackgroundResource(0)` 拿掉原本的綠圓底；
圖示的線條色也寫死在向量圖裡，靠 `drawable.setTint()` 蓋一層 color filter
連筆畫一起換。⚠️ 內距要一起歸零，否則會連圓底一起被縮小。

進度條是同一個坑（`progressTint` 只能 XML 寫死），順手把四個 `ProgressBar`
換成 `ImageView` 自繪圓角長條。⚠️ **換完絕對不能再呼叫 `setProgressBar()`**
——那會對 ImageView 呼叫不存在的 `setMax`／`setProgress`，套用時丟例外，
症狀又是「無法載入小工具」（跟 `<View>` 那次同一種死法、不同原因）。

**按鈕顏色刻意不吃底色透明度**：底板調到 0% 時整排按鈕會跟著消失，
但按鈕要按得到就要看得見。有測試守著。

**飲食 App 本身**：`styles.css` 21 個寫死色值全部換成 CSS 變數，新增
`nutrition/mobile/src/theme.ts` 依主題塞進 inline style（比照 DeST 手機端的
`applyTheme()`，但變數名各自獨立——共用的是色值不是命名）。過程中三個
非機械性的判斷：①「accent 底＋白字」的主按鈕改成「accent 底＋主題文字色」
（12 組的 `mint2` 多半是淺色，白字會看不到）②輸入框一定要明確給
`background`（原本靠瀏覽器預設白底，深色主題下＝白底配淺字）③未分類標籤的
橘、錄音中的紅、超標／達標的紅綠都是**語意色不跟著配色跑**，但超標／達標
備了淺色／深色兩版，因為深色底上那組深紅深綠會糊掉。

至此四個配色設定彼此獨立：DeST App／DeST 小工具／飲食 App／飲食小工具。
typecheck／test（80 檔、1040 項）／兩支 APK 皆過，待驗項見計畫書 §15.4。

### 設定頁預覽壞掉：`#AARRGGBB` vs `#RRGGBBAA`（第五輪，計畫書 §16）

owner：「改顏色和透明度沒有正確在上面的預覽顯示」。

**成因是一個很值得記住的格式陷阱**：`resolveWidgetColors()` 回的是 Android
的 `#AARRGGBB`（alpha 在最前面），而 CSS 的八碼十六進位是 `#RRGGBBAA`
（alpha 在最後面）。設定頁把前者直接塞進 `style`，於是 alpha 被當成紅色、
藍色被當成 alpha——**兩種都是合法的八碼十六進位，所以不會噴任何錯誤**，
瀏覽器照畫，只是顏色與透明度全錯。這種「有反應但反應不對」比整個不動
更難聯想到成因。新增 `toCssColor()`／`widgetColorsToCss()`（`shared/`），
預覽一律走這支，**不另外算一份 CSS 色票**（否則預覽與實際顏色會漂移，
跟「預覽走同一支計算」同一個理由）。測試裡放了一條「轉兩次不等於原值」
把這個陷阱釘住。

順帶重排設定頁：配色／透明度／頭像開關**全部搬到預覽正下方**（owner：
「應該放在預覽旁邊，才不用一直上下來回拉看結果」）。三者都會改變預覽，
所以收進同一段「外觀」；配色格改四欄讓 13 個選項從五列縮成四列，
預覽與控制項在一般手機上能同框。透明度拉桿吃拖曳中的 draft，
拖的當下預覽就跟著變，放開才寫檔＋叫原生重繪。

typecheck／test（80 檔、1044 項）／兩支 APK 皆過，待驗項見計畫書 §16.3。

### 頭像底色圓也要跟著配色（第六輪，計畫書 §17）

owner：「DeST 小工具的頭像背景要跟著顏色設定跑」。

**這是第三個踩到同一條 RemoteViews 限制的地方**（容器底板 §14.3、飲食小工具的
按鈕與進度條 §15.1／§15.2，現在是頭像底色圓）——`android:background` 指到
寫死顏色的 drawable，而 minSdk 26 上不能 tint 背景 drawable。這一顆特別
容易漏，因為多數時候被頭像蓋住；但角色圖多半是**去背 PNG**，透明的地方
就會露出那顆綠圓，換配色後看到的是「臉的周圍還是一圈原本的綠」。

修法同按鈕：底色圓畫進 bitmap，再 `setBackgroundResource(0)` 拿掉 XML 那顆。
⚠️ **不能沿用原本的「先畫遮罩 → `PorterDuff.SRC_IN`」寫法**——那個模式會把
來源的 alpha 套到整層，連剛畫好的底色圓一起挖掉，等於白畫。改用
`BitmapShader` 一次畫完（填色圓 → 用 shader 畫同一個圓），順便少一張暫存
bitmap。底色圓一樣不吃底板透明度（臉要看得清楚就得有穩定背景）。

`bg_dest_widget_avatar.xml` 沒刪（還是小工具選單預覽圖的底色），但檔案裡
加註了「改這裡不會改變實機顏色」，免得之後有人在那邊白改。

順帶：DeST 的 Kotlin `WidgetColors` 上一輪漏加 `accent`／`accentStrong`
兩個欄位（只加在飲食那邊），這次補齊，兩個 App 的色票欄位現在一致。

typecheck／test（80 檔、1044 項）／APK 皆過，待驗項見計畫書 §17.1。

---

## 2026-08-23（續五）｜設定同步子集盤點：補兩個漏（對話新聞搜尋、memory 欄位漂移）

owner 要求盤點「還有哪些模組子設定沒進同步」。起因是 2026-08-14 `weather.polish`
那次遺漏——當時只補了那一個，沒有逐一排查完。這次對照
`core/sync/settingsSnapshot.ts` 的子集定義、桌面 `mobileServer.ts` 與手機
`syncManifest.ts` 兩端的組裝，找到兩個真的漏，都已修掉。

### ① 新聞的 `conversationSearch` 沒進比對子集

三欄（開關／觸發詞／查詢時效）2026-08-22 就加進 `NewsEditableSettings`，
而且 owner 當時特別要求**手機端也能編輯**——但 `NewsSyncSubset` 到這天為止
還是只有 `speakButton` 一欄。結果是兩台裝置永遠各自為政，而且**比對畫面上
連一列都不會出現**，使用者不會意識到它沒被同步。

跟 `weather.polish` 是完全同一個錯誤類別：**模組除了 `enabled` 之外還有自己的
子設定，加欄位時沒有回頭看同步子集**。第二次踩到，所以這次在 `NewsSyncSubset`
的註解裡把這個模式寫明，提醒下次加欄位要回頭看。

修法：子集加三欄、兩端組裝對齊、`settingsPair.ts` 加三列、`syncSettingsApply.ts`
加套用邏輯。兩個實作細節值得記：

- **三欄逐一分開送，不合併成一包。** 送出去的雖然是同一個巢狀物件
  `conversationSearch`，但使用者可能只想同步其中一欄。兩端的存檔路徑
  （桌面 `modules/news/mobileRoutes.ts`、手機 `session.saveNewsEditableSettings`）
  在 2026-08-22 都已經改成「先讀現況再疊 patch」，所以分開送不會把沒選到的
  另外兩欄重置掉。為了少送一次請求而合併，會讓「只選一欄」的語意消失。
- **觸發詞是陣列，但 `SettingsFieldRow` 的值只能是純量。** 存成串好的字串，
  兩端一律走共用的 `joinTriggerWords()`／`splitTriggerWords()`，分隔符抽成
  `SEP` 常數——分隔符只要兩邊不一致，雜湊就永遠對不起來。

### ② `memory` 子集兩端欄位數不一樣，`settingsHash` 永遠對不起來

手機 `syncManifest.ts` 直接寫 `memory: session.settings.memory`，而
`settings.memory` 有**四**個欄位（多一個 `keepDebugPromptN`，桌面 Log 視窗專用、
手機根本沒有對應 UI）；桌面 `getMemorySettingsDirect()` 只回**三**個。
`settingsSnapshotHash()` 是對整個物件做雜湊，欄位數不同 → 雜湊永遠不相等。

症狀相當隱蔽：**摘要那行一直說「設定不同步」，但點進去逐欄比對每一列都相同**。
因為逐欄比對（`settingsPair.ts`）只挑那三欄，所以畫面上完全看不出原因。

諷刺的是，`settingsSnapshot.ts` 檔頭那段警語就是在講這個錯誤類別（M4 時
`contentHash.ts` 兩邊手打物件字面量漂移的教訓），結果 `memory` 這一欄自己踩了。
教訓要更新一句：**「兩端 import 同一個型別」擋得住欄位名稱打錯，擋不住
「其中一端多塞了東西」**——結構化型別對「多給幾個欄位」不會抱怨。
修法是手機端明列三欄，並在 `MemorySyncSubset` 上加警語說明為什麼不能整包塞。

### 測試與範圍

新增 5 項守門測試（`settingsPair.test.ts` 2 項、`syncManifest.test.ts` 3 項），
其中一項專門守「改 `keepDebugPromptN` 不該影響 `settingsHash`」。
`npm run typecheck` 乾淨、`npm test` 80 檔 1049 項全過。**兩項都尚未真機驗證。**

**照規則不該補的**（沿用 owner 2026-08-17 的「桌面限定不同步」）：日曆的
`lookaheadHours`／`maxEvents`／`mentionWhenEmpty`、Spotify／日曆的 `enabled`、
`ui.theme`／`unfocusedBubbleOpacity`／`hoverMenuOnHover`／`keepDebugPromptN`
（桌面專用）、`llm.temperature`／`ui.chatFontSize`（手機沒 UI）。

---

## 2026-08-23（續六）｜文件對帳：把「做完但文件沒更新」的狀態補齊

同一輪順手做的。owner 問「還有什麼沒做、有沒有文件沒更新」，盤出來的落差比
預期多，重點是**幾乎全部都是「做完了但文件停在舊狀態」**，不是真的沒做：

- `CLAUDE.md` 的現況表少了三項近期完工（對話新聞搜尋、手機表情、DeST 桌面小工具），
  而且新聞那列還留著「**不做**：對話新聞搜尋（刻意不搬）」——那條 2026-08-21 就被
  owner 推翻、08-22 做完並真機驗證過了，自相矛盾
- S2 M4／M5／對話同步三列還寫著「尚未真機驗證」，但 TODO §1.1 記著 08-16 就在
  Pixel 10a 實測完 23 條。**TODO 有更新、CLAUDE.md 沒有**——這正是「待辦唯一入口」
  規矩要解決的問題，但反方向漏了：狀態從 TODO 回流到 CLAUDE.md 這一步沒人做
- `docs/README.md` 落後最多：M3 那列還寫「尚未完成，勿當可驗收功能」（早被 M4 取代），
  Health-lite 還寫「開工前有 3 個開放問題要問 owner」（已完工並真機驗證），
  而且**有 9 份文件從來沒被索引**，包括 `mobile-sync-m4-compare.md` 這種現行主文件
- 飲食模組的**本機報表頁其實 2026-08-20 就完成了**（`future-nutrition-module.md` §6.1
  有落地筆記），TODO §3 卻還把它列為待辦——owner 因此以為還要做，回覆「可以先不用」

另外釐清一個**容易誤判成 bug 的設計**：owner 問「情境切換後使用者設定有換、
但對話沒換」。查證後確認是刻意的——`lastActiveConversationId` 跟桌面視窗座標同一類，
屬**裝置本地狀態**，`syncApply.ts` 兩個方向都保留接收端原值不搬（兩台的對話 id
本來就不同，搬過去會指到不存在的對話）。S1 初次匯入是另一回事，那裡有 id 對照表
翻譯（`syncImport.ts`）。順手修掉 `syncApply.ts` 那行誤導的註解——原本寫
「手機沒有對應概念」，實際上手機也有這個欄位，照著註解讀會誤判成漏翻譯。

M4 第 6 條（電腦端 `scenes/*.json` 的 `activePersonaId` 是否正確翻譯）也在這輪
由 owner 補驗通過，S2 的真機待驗清單至此清空。

---

## 2026-08-24｜QR 配對入口／出口合併：真正的根因不是 AP isolation，是 Tailscale

`docs/qr-entry-merge-plan.md` 開工指令的實作。owner 換裝正式簽章 APK 後撞到三件事
（見該文件 §1），§6 四個開放問題當天都已答完，直接動工，分兩階段做完。

**階段一最重要的發現**：§2.3「自動升級區網為什麼沒生效」原本懷疑是 AP isolation，
**查下去發現完全不是**。用 `adb shell` 對電腦的 3721 port 直接發 raw TCP 請求
（`nc` 手搓 HTTP GET），區網連線本身完全正常，回 `401 Unauthorized`（沒帶 token，
但連得到）；`AndroidManifest.xml` 也早就有 `usesCleartextTraffic="true"`，
cleartext 也不是問題。真正原因是 `src/main/index.ts` 的 `getLocalIp()`：
它從 `os.networkInterfaces()` 拿「第一個非內部 IPv4」，而這台電腦裝了 Tailscale——
用 `node -e "os.networkInterfaces()"` 實測確認，Tailscale 的虛擬網卡（`100.86.50.84`，
100.64.0.0/10 CGNAT 位址）排在真正的 Wi-Fi 網卡（`192.168.50.136`）**前面**。
QR 上「區網位址」因此變成 Tailscale 位址，`isPrivateHost()`／`isRfc1918()` 判它
不是 RFC1918 私有位址就直接拒絕升級——**連網路請求都沒發生**，回 `null` 回得
無聲無息，難怪 owner 完全排查不出來。這也連帶炸到 `localUrl`（QR 的「區網位址」
本身）與 `isLanDirectRequest()` 之外的所有依賴 `getLocalIp()` 的地方。

修法：新增 `isRfc1918()`，`getLocalIp()` 改成優先挑 RFC1918 位址，真的沒有
（例如使用者的電腦真的只有 VPN 沒有實體網卡）才退回舊行為（第一個非內部位址）。
這個坑理論上會咬到**任何裝了 Tailscale／其他 VPN 的 DeST 使用者**，不是
owner 這台機器獨有的巧合，值得記住：`os.networkInterfaces()` 的順序不可信任，
要看位址本身是不是真的私有網段。

**同一輪順手修的 §2.1**：`QRCodeWindow.tsx` 的 `pickUrl()` 短路 bug——
`getRelayUrl()` 只是拿設定檔組字串，不管中繼有沒有實際連上都回非空字串，
導致 `||` 後面的 tunnel／區網分支永遠走不到。改成 `getMobileStatus()` 在
中繼未啟用（`useTunnel===false`）或 tunnel 未就緒時，直接把 `relayUrl`
設成空字串，呼叫端不用自己判斷「這個值可不可信」。

**階段二（合併入口）**：電腦端 QR 入口從「擴充」搬到「關於」，改成先選用途
（複製資料／遙控同步）才出對應 QR——複製資料一律用區網位址（不牽涉中繼，
不依賴自動升級）；遙控同步沿用 relay→tunnel→區網 順位。手機端 `MainMenu.tsx`
的 `sync-import` 移除，`ModeSwitcher.tsx`（「關於」頁）新增「連接電腦」兩顆
選項按鈕取代原本「本機模式無條件顯示掃 QR」的邏輯。「走錯入口指路」這條沒做
嚴格版——評估後兩個 QR 本質上是同一個 `baseUrl+token`，既有訊息（金鑰有沒有
附／連不連得上）已經覆蓋大部分情境，先不做過度設計，真機測試如果 owner 還是
會走錯再回頭補。

**§2.4 APK 遙控中繼支援**：新增 `getTunnelWsUrl()`（讀 cloudflared 網址轉
`ws(s)://`），經 `/api/connection-info`／`/api/sync-init` 回傳給手機；
`connection.ts` 的 `resolveLiveRemote()`／`probeRemote()` 都會帶回它，
`wsUrlFor()` 在沒有網頁版才有的 `window.__tunnelWsUrl` 時改用它。
⚠️ trycloudflare 網址會變，故意不寫進 `ModePref`，每次 `App.tsx` 的 attach
effect 都用 `probeRemote()` 現問一次。`ModeSwitcher.tsx` 原本那句「這個版本
不支援中繼」的誤導訊息也一併改寫。

`npm run typecheck` 乾淨、`npm test` 80 檔 1049 項全過。**這輪沒有真機驗證**——
0.5.0 卡在這個入口合併上，owner 說要自己測過才發版（`TODO.md` §2.6）。

---

## 2026-08-24（續）｜`MobileST.bat` 補上正式簽章裝機選項

owner 實跑 `MobileST.bat [1]` 想裝上面那次改動測試，撞到
`INSTALL_FAILED_UPDATE_INCOMPATIBLE`——手機上裝的是正式簽章版（v0.5.0
release），這次打的是 debug 簽章，Android 不准跨簽章覆蓋安裝。這不是
bug，是預期中的行為，但沒有對應的裝機路徑：`npm run apk:release`
（`build-mobile-apk-release.mjs`）原本刻意不自動裝機（那支是給「拿去發布」
用的正式產物，不該被開發機的舊安裝記錄干擾），要測就得自己 `adb install -r`。

補上 `MobileST.bat` 的 `[4]`：打包正式簽章 APK，優先 USB 直裝（跟手機上的
簽章一致，能直接覆蓋、不必解除安裝清資料），裝不上才退回既有的區網 QR 下載
流程。跟 `[1]`（debug）是平行選項，不是取代——debug 版還是日常改版面最快
的路徑，只是這台手機現在裝著正式版，debug 簽章暫時裝不上去。

順手做了兩件事：
- `adb install` 那段邏輯原本在 `build-mobile-apk.mjs` 裡是寫死的一份，
  現在的 `[4]` 需要一模一樣的邏輯——抽成 `scripts/adbHelpers.mjs`
  共用。理由直接：上一輪才因為「同一段邏輯在三支腳本各抄一份」
  （`getLocalIp()` 的 Tailscale 排序問題）踩過坑，這裡不想再犯一次。
- `serve-apk.mjs` 原本把檔名 `DeST-debug.apk` 寫死在好幾處（下載路由、
  `Content-Disposition`、HTML 標題與按鈕），改成從 `DESTA_APK_PATH`
  環境變數（沒設就退回原本的 debug 路徑）動態算檔名，`[4]` 才能不複製
  改名檔案就重用同一支下載伺服器。

`node --check` 過四支改動的腳本、`npm run typecheck`／`npm test` 照跑
（純 `.mjs` 建置腳本不在那兩項檢查範圍內，純語法檢查）。這輪一樣沒有
真機驗證——下次 owner 用 `[4]` 裝機就是第一次真機驗證。

---

## 2026-08-24（續）｜S1 匯入沒帶 `llm.endpoints`，本機模型同步後端點消失

owner 手機用「複製電腦資料」把本機模型（Ollama）的設定拉過來後，回報
「設定同步過來、講一句話沒講完、然後設定不見了」。「講一句話沒講完」
owner 自己判斷可能是 Input Leap（KVM 軟體）切到跑 LLM 那台電腦分心誤觸，
不確定跟這次改動有沒有關係，先擱置；「設定不見了」查下去是真的 bug。

`src/main/mobileServer.ts` 的 `GET /api/sync-init` 原本只送 `llm.endpoint`
（單數，遺留欄位）,沒送 `llm.endpoints`（每家供應商各自的端點表，本機模型
真正吃的是這個）。`core/llm/index.ts` 的 `resolveEndpoint()` 自己就寫著
警告：`endpoints` 表**只要非空**、但缺當前這家的 key，就**不會**退回舊
欄位。手機那張表如果本來就不是空的（例如已經設過任一家的自訂端點），
匯入完 `provider` 換成 `local`、`endpoint` 舊欄位也對，但 `endpoints.local`
沒有——這時候端點就已經是空的，只是還沒被使用者發現；一旦手機這邊之後
任何一次改 provider（`localDataSource.ts` 的 `setLlmProvider` 沒有
fallback，直接 `llm.endpoint = llm.endpoints?.[provider]`），連舊欄位那份
備份也會被空值蓋掉，這才是使用者會實際看到「消失」的時間點。

同一個坑也波及 `llm.models`（每家的型號選擇）與 `llm.utilityModels`／
`utilityProvider`（輔助模型）——`applySettings()` 原本用
`s.llm = { ...s.llm, ...rest }` 整包蓋，`models`／`endpoints`／
`utilityModels` 這三張表只要電腦那邊有送（哪怕只有一個 key），就會把手機
自己填過的其他供應商的值一起洗掉，跟金鑰匯入不同步「只覆蓋電腦上有值的
那幾家」的規矩，是三處遺漏。

修法：`sync-init` 補上 `endpoints`／`utilityProvider`／`utilityModels`；
`applySettings()` 把 `models`／`endpoints`／`utilityModels` 從整包 spread
裡拆出來，新增 `mergeNonEmpty()` 逐 key 合併（跟 `apiKeys` 同一套邏輯：
電腦沒填值的 key 不覆蓋）。補了一個對稱的測試（`tests/mobile/syncImport.test.ts`
「本機模型的端點／型號逐 key 合併，不整包覆蓋掉手機自己填的其他家」）。

`npm run typecheck` 乾淨、`npm test` 80 檔 1050 項全過。**這輪沒有真機
驗證**——下次 owner 用本機模型跑一次 S1 匯入才是第一次真的測到。

---

## 2026-08-24（續）｜手機設定頁補上雲端供應商的「連線」按鈕

owner 順手回報：手機的 LLM 設定頁只有 provider 選 `local` 時才有「連線」
按鈕，OpenAI／Claude／Gemini／Grok 都沒有。查證後確認桌面版
（`SettingsWindow.tsx`）本來就有一顆通用的「連線」按鈕，不分供應商都能按；
手機這顆按鈕原本寫死只出現在 `localEndpointField`（`llm.provider === 'local'`
才渲染），沒有對應雲端供應商的版本——是漏做，不是刻意設計。

底層其實早就支援任何供應商：`session.testLlmConnection(provider, endpoint)`
本來就吃 `provider` 參數，金鑰也是它自己從已存設定讀，呼叫端不用另外傳；
遙控模式打的 `/api/settings/llm-test-connection` 一樣是通用端點。純粹是
`SettingsView.tsx` 沒把按鈕放出來。

補了一顆 `testCloudConnection()`，跟原本 `testConnection()`（本機專用）
分開一支——後者也被輔助模型的 local 分支共用（`llm.utilityProvider ===
'local'` 時同一個 `localEndpointField` 會再渲染一次），改成看
`llm.provider` 會在「主模型雲端、輔助模型 local」這個常見組合下測錯供應商。
新按鈕放在 API Key 欄位下方（`llm.provider !== 'local'` 才顯示，跟本機那顆
互斥不重複），成功只顯示「已驗證」（不像本機那樣有模型清單可秀）。順手在
`changeProvider()` 加了 `setTestMsg(null)`——原本切供應商後上一家的測試
結果會留著，容易誤以為是這家測過的。

`npm run typecheck` 乾淨、`npm test` 80 檔 1050 項全過（純 UI 改動，沒加
測試）。純程式碼審查沒有真機驗證——這輪嘗試用 Claude Browser 開手機網頁版
驗證畫面，但 `/` 本身也要求 token 驗證，沒有現成權杖就卡在
`{"error":"Unauthorized"}`，放棄用瀏覽器驗證，改以「跟桌面版、跟本機那顆
按鈕的既有寫法完全對齊」佐證正確性。owner 下次開手機設定頁確認一下畫面。

---

## 2026-08-24（續）｜手機按 Claude「連線」跳 `browser-like environment`

上面那顆新按鈕補完，owner 馬上實測：其他供應商都正常，Claude 按下去跳紅字
`browser-like environment`。查了一下，是 Anthropic SDK 自己的防呆機制——
偵測到 `window` 就拒跑（防的是「網站把金鑰發給瀏覽器、被同頁面第三方腳本
偷走」），要顯式帶 `dangerouslyAllowBrowser: true` 才會放行。手機獨立版的
WebView 有 `window`，這個檢查一定會觸發。

`chatWithClaude()`（`core/llm/claude.ts`）本來就有帶這個旗標、也有寫清楚
為什麼手機這樣做是安全的（金鑰只在使用者自己的裝置上，不是網站發給不特定
瀏覽器）。但 `core/llm/index.ts` 裡另外**四處**各自 `new Anthropic(...)`
的地方都漏了：`applyUtilitySettings()` 的情緒分類與新聞主觀度分類各一處
（輔助模型選 Claude 時就會炸，不只是這次新按鈕的 `testLLMConnection`／
`testLLMMessage` 那兩處）——同一支 SDK、同一份設定，四個呼叫點各自建立
client 而不是共用一個 helper，改一處漏三處的老問題又發生一次。

**這個坑其實比「連線按鈕」更嚴重**：只要手機獨立版的輔助模型（提醒發話、
情緒分類）選了 Claude，之前每一次分類都會用同一個錯誤炸掉，退化模式接手，
使用者未必看得出來是這個原因——沒去點「連線」按鈕的話這條路完全不會被
主動測到。

修法：四處都補 `dangerouslyAllowBrowser: true`，比照 `claude.ts` 與其他
`new OpenAI(...)` 呼叫點（那些原本就有帶）。沒有另外抽 helper——四個呼叫點
分散在不同函式、建構參數也不完全一樣（有沒有 `apiKeys` 對照表），硬抽的話
改動範圍更大，先用最小修法堵住，之後如果又漏第五處再考慮。

`npm run typecheck`／`npm test`（80 檔 1050 項）都過。**這條沒辦法自動測**
（要真的打 Anthropic API 或攔截 SDK 內部的環境偵測），純粹是讀 SDK 原始碼
＋比對 `claude.ts` 既有寫法确认。owner 下次用 Claude 當主模型或輔助模型
在手機獨立版測一次最準。

---

## 2026-08-24（續）｜S2 提醒同步（TODO §2.3，開工指令 `reminder-sync-kickoff.md`）

照開工指令做完提醒跨裝置同步：現有 M4 逐項比對（角色／人設／世界觀／
Lorebook／情境）加第六個 kind `reminders`，同樣走「id／名稱配對＋逐列選
手機／電腦／不動」。跟其他 kind 不一樣的地方是這次唯一的難點——提醒物件
裡 `notificationDevice`／`wakeMode`／`inactiveBehavior` 是裝置本地設定，
同步時不能整包覆蓋。

實作照 §3 開的清單，比照 `syncApply.ts` 情境案例（座標是電腦專屬，推送時
保留接收端原值）的做法：`pushOne`／`pullOne` 遇到 `reminders` 時，若接收端
已存在這筆（`row.remoteId`／`row.localId` 有值），先讀出接收端現有那筆，
把 `notificationDevice`／`wakeMode`／`inactiveBehavior`／`allowOfflineFallback`／
`lastTriggeredAt` 蓋回要送出的物件上，其餘欄位才用來源端的值；真的是新增
時才整包用來源端值當初始值。`allowOfflineFallback` 依開工指令先當裝置本地
處理（不進雜湊、不覆蓋），owner 之後若有不同意見這是最容易調的一個欄位。

`characterId`／`sceneId` 借用既有的 `maps.l2r`／`maps.r2l` 對照表，所以
`ORDER` 常數把 `'reminders'` 排在最後（等角色與情境都處理完才有對照表可用）；
翻不過去就整欄位不推，不留死參照。`conversationId` 完全沒有對照表（對話
同步是獨立的一套配對邏輯），這次同步當下一律不推，這是資料本質決定的
限制、不是要修的 bug。

內容雜湊 `reminderContentHash()`（`core/sync/contentHash.ts`）刻意排除上述
裝置本地欄位與兩個跨端 id 參照，理由同 `characterContentHash` 那套邏輯——
放進去的話每一筆永遠判定「不同」。手機／桌面共用同一份
`core/sync/manifestBuild.ts` 的 `buildManifest()`，不是各自抄一份（避免
`contentHash.ts` 檔頭警告過的「兩邊算法漂移」）。

順手發現並補上：`Reminder` 型別原本沒有 `updatedAt` 欄位，但手機端
`session.saveReminder()` 其實一直有在寫這個欄位（只是型別沒宣告），桌面端
`saveReminderDirect()`／`createReminderDirect()` 則完全沒寫過。這次補上型別
宣告，並讓桌面端也開始寫入（manifest 需要一個 `updatedAt` 顯示用，缺的話
退回 `createdAt`；內容是否相同只看 `contentHash`，不受這個欄位影響）。

新增測試 `tests/mobile/reminderSync.test.ts`（10 案例），涵蓋單邊獨有的
推/拉、裝置本地欄位在推送與帶回時都不被覆蓋、新增時才用來源值當初始值、
`characterId`/`sceneId` 翻譯成功與翻不過去兩種情況、`conversationId` 一律
不推、以及刪除的兩個方向。連帶更新既有的 `pair.ts`／`contentHash.ts`／
`manifestBuild.ts` 相關測試檔（`tests/core/sync/pair.test.ts`、
`tests/core/sync/diff.test.ts`、`tests/ui/syncDiffMessage.test.ts`、
`tests/mobile/syncApply.test.ts`）補上 `reminders` 欄位，否則 `KINDS`／
`Manifest` 多一個必填欄位會讓這些檔案的既有 fixture 型別對不起來。

`npm run typecheck`／`npm test`（81 檔、1060 項）皆過。**真機驗證留給
owner**，這裡只到自動測試通過為止，`docs/reminder-sync-kickoff.md` §7 步驟
10 講得很清楚不要自己假裝真機測過。

---

- [x] **飲食記錄 App：Health 寫營養（B9c 第一項）**（2026-08-25）。owner 決定
  「只補寫歷史（一次性）」＋「先只寫熱量」——外掛 `@capgo/capacitor-health`
  的 `saveSample`／`WriteSampleOptions` 只有單一 `value: number`，沒有蛋白質／
  脂肪／碳水對應欄位，即使 Health Connect 的 `NutritionRecord` 原生支援也一樣，
  這是外掛版本限制不是刻意省略。

  設計：`MealLog` 新增 `healthWrittenAt?: number`（`src/core/nutrition/types.ts`）
  標記「這筆熱量寫過 Health 了沒」——外掛沒有 update／delete API，一筆只能寫
  一次，編輯已寫過的記錄不會補推新數字（避免同一筆在 Health 端留下重複紀錄）。
  `NutritionHealthSettings` 新增開關 4 `writeCalories`（依賴 `connected`，跟
  既有三個開關同一套依賴關係）。`HealthAdapter` 介面新增
  `hasWritePermission`／`requestWritePermission`／`writeCalories`（獨立於既有
  讀取權限，Health Connect 的寫入是另一個授權範圍），`nutrition/mobile/src/health.ts`
  用 `Health.saveSample({ dataType: 'dietaryEnergyConsumed', ... })` 實作。

  補寫邏輯故意不做成獨立按鈕＋額外流程，改成復用既有的「所有存檔動作都推」
  哲學（`runAction` 裡本來就有「存檔後順手推小工具重算」這段，同一個理由：
  逐一分辨這次存檔動到哪幾筆 MealLog 比整批掃一遍貴，也容易漏）：新增
  `writeMealLogsToHealthIfNeeded()`，每次 `runAction` 結束都掃一遍
  `healthWrittenAt === undefined` 的記錄补推，開關關閉或沒有待寫記錄時是
  快速的 no-op。這支函式同時扮演兩個角色——①開關剛打開時，當下所有記錄都是
  「還沒寫過」，這次掃描本身就是一次性歷史補寫 ②之後每次存檔再掃一次，
  新記錄隨手補推——不用另外做「補寫」跟「增量同步」兩套邏輯。設定頁另外
  留一顆「手動補寫一次」按鈕，供沒有觸發任何存檔動作、純粹想立刻補的情境。

  `resolveMealLogKcal()` 從 `aggregation.ts` 的 `sumLogs()` 抽出來獨立匯出，
  單筆記錄的熱量換算（`override.kcal ?? foodItem.perServing.kcal` 乘
  `servings`）現在每日加總跟 Health 寫回共用同一份邏輯，不是各自算一次。

  `src/core/nutrition/storage.ts` 的 `normalizeSettings()` 補上
  `writeCalories: settings.health.writeCalories ?? false`——這正是
  `settingsSnapshot.ts`／M4 那次教訓的同一個錯誤類別（新增巢狀設定欄位時
  漏補正規化路徑），這次順手照著既有的三個欄位補齊，沒有踩坑。

  `npm run typecheck`／`npm test`（81 檔、1063 項）皆過。**真機驗證留給
  owner**——尤其是系統寫入權限對話框跳出、Health Connect 裡看得到熱量條目、
  以及「開關剛打開時一次補寫多筆舊記錄」這幾件事沒有自動測試能驗證。

  **2026-08-25 owner 真機回報：按了手動補寫，Health 完全沒看到資料。**
  排查後找到兩個坑，都已修正：
  1. **`writeCalories()` 的 `startDate`／`endDate` 給了同一個時間點**——
     Health Connect 的 `NutritionRecord` 是 `IntervalRecord`，原生端要求
     `endTime` 嚴格晚於 `startTime`，相等會直接丟
     `IllegalArgumentException`。錯開 1 秒解決。
  2. **失敗被吞得一乾二淨**：`saveSample()` 的 catch 只回傳 `{ ok: false }`，
     沒有印任何東西，也沒有讓使用者看到；`writeMealLogsToHealthIfNeeded()`
     在「沒有寫入權限」「偵測不到 Health Connect」「沒有待補寫記錄」這幾種
     情況也是直接 `return`，完全沒有訊息——使用者按下「手動補寫一次」按鈕後
     不管是哪種失敗都像沒反應一樣。補上：①`writeCalories()` 失敗時
     `console.error` 一份給 `adb logcat` 看 ②新增 `verbose` 參數，使用者主動
     觸發（開關打開／手動補寫按鈕）時才顯示這些「什麼都沒做」的原因，
     `runAction` 每次存檔自動觸發的背景掃描維持安靜（否則使用者做其他不相干
     操作也會無端跳字）③補上「補寫成功幾筆／失敗幾筆」的統計文字。
     `npm run typecheck`／`npm test`（81 檔、1063 項）皆過。**這輪修正
     同樣還沒真機覆驗**，下一步要請 owner 再測一次「手動補寫一次」。

## 2026-09-03｜天氣主動發話：地震欄位名稱真機炸開＋正式上線

延續前一台機器做的天氣主動發話功能（`docs/weather-proactive-speech-kickoff.md`，
`00f2c0d`／`9ae8fe8` 兩個 commit）。這台機器接手後 `npm run typecheck`／
`npm test`（84 檔、1120 項）都過，看起來沒問題，但那只證明邏輯自洽，
不代表接得住真實 CWA 回應——單元測試的 fixture 是照著（錯的）型別定義自己編的，
兩邊一起錯就測不出來。

**真機炸開**：owner 按「立即輪詢一次（debug）」，設定視窗跳
`Cannot read properties of undefined (reading 'replace')`。根因是
`CwaEqIntensity`（`core/weather/realtimeQuery.ts`）把地震 API
`E-A0016-001` 的 `Intensity.ShakingArea[]` 型別定義成 lowercase 的
`areaName`／`areaIntensity`，但 CWA 實際回傳的是 PascalCase 的
`CountyName`／`AreaDesc`／`AreaIntensity`。這個欄位名稱錯誤其實從
8/22 即時查詢地震功能上線那次就在，只是 `fetchEarthquake()` 那邊呼叫
`.find()` 前有 `county ?` 短路判斷，加上測試從沒餵過非空的
`ShakingArea` 陣列，一直僥倖沒被戳破；這次 `core/weather/proactive.ts`
的 `findIntensityForCounty()` 對非空陣列無條件呼叫 `.find()`，第一次
真的遇到有 `ShakingArea` 資料的地震就直接爆。

診斷方法：在 `observeWeather()` 裡暫時加一行
`console.error(JSON.stringify(areas[0]))`，請 owner 重跑一次 debug
按鈕、貼終端機輸出，才拿到真實欄位名稱——CWA 官方文件／schema
查不到這個細節，真機撞出來的資料最準。

**修法**：`CwaEqIntensity` 型別、`findIntensityForCounty()`、
`fetchEarthquake()` 的縣市比對全部改用 `CountyName`／`AreaIntensity`；
`normalizeCountyName()` 順手加上 `undefined`/`null` 防呆（外部 API
資料形狀不保證，這次就是教訓）；兩份測試 fixture
（`tests/weather/proactive.test.ts`、`tests/weather/realtimeQuery.test.ts`）
改用正確欄位名，之後才擋得住同一類回歸。`npm run typecheck`／
`npm test`（weather 分組 4 檔 73 項）皆過，真機覆驗通過（owner 貼出
debug 按鈕正常回應）。

順手加了一顆「開啟影子模式 log」按鈕（設定頁天氣主動發話區塊，跟
「立即輪詢一次」放一起），一鍵開啟
`%APPDATA%\DesktopST\weather-proactive-shadow.log`（實際路徑依使用者
自訂資料夾而定），不必自己去檔案總管找。

**設計釐清（owner 問「現在外面在下大雨，角色該不該講」）**：
不該講，這是刻意的，不是漏判。五種事件偵測的是**轉變**（地震／颱風
發布解除／明日降雨／明日變天／好天氣邀約），沒有「現在正在下雨」這種
**狀態**事件。理由：①這個資訊角色本來就有——每次聊天 `[Weather]`
都會把當下天氣塞進 context，角色接得到、能自然提起，不需要主動打斷
②「正在下雨」是持續狀態不是一次性事件，硬要對它開火容易變成每次輪詢
都重複判定，正是 kickoff §10.3 說的「前三天被吵到就整個關掉」死法
③「明日降雨提醒」已經涵蓋真正有主動告知價值的情境（要不要帶傘），
且用 `rainNotifiedDates` 卡著一天只發一次。

**正式上線**：owner 決定不等 kickoff §10.3／§10.4 建議的一到兩週影子
模式觀察期，直接把總開關／影子模式切成「真的發話」（設定頁手動關閉
「影子模式」checkbox，UI 已有，不需要改程式）。§10.4 的驗收條件
（連續 7 天主動發話總數 ≤10 則、每則都覺得「這則該講」）留著當事後
觀察標準，沒有達成也不是失敗，是提醒之後回頭看這幾天的發話紀錄、
覺得吵就把對應門檻（`earthquakeMinIntensity`／`rainThreshold`／
`tempSwingThreshold`／`dailyLimit`／`quietHours`）調高，不必等到影子
模式再驗一輪。
