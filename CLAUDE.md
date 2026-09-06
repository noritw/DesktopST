# DesktopST — AI 接手說明（每次新對話只讀這份）

> **省 Token 硬規則**
> 1. 新對話**預設只讀本文件**，讀完即可開工。
> 2. **禁止**一開工就整份讀：`DesktopST-Spec.md`、`docs/multi-device-platform-roadmap.md`、
>    `docs/progress-log.md`、`docs/b3-mobile-ui-plan.md`、`docs/mobile-html-feature-inventory.md`、
>    `docs/pre-b3-work-assessment.md`。
> 3. 需要細節時依下方「依任務選讀」開**對應段落**；用 Grep 找關鍵字，不要從頭掃到尾。
> 4. `AGENTS.md` 只是薄轉址，**以本文件為準**。文件總索引：`docs/README.md`。

---

## 1. 專案是什麼

Windows 桌面 AI 角色扮演寵物（Electron）＋ 進行中的手機 UI（B3）。
角色站在桌面、點擊才叫出輸入；相容 SillyTavern 角色卡；多角色／群組。

定位擴張見 roadmap（選讀）：主線是「AI 角色聊天平台，有桌寵版與手機版」，
手機獨立版是一般使用者第一優先——但**不要為了定位去整份讀 roadmap**。

---

## 2. 技術棧與目錄

| 項目 | 選用 |
|---|---|
| 桌面 | Electron ＋ React ＋ TS ＋ Tailwind ＋ Zustand |
| 資料 | 本地 JSON（`%APPDATA%\DesktopST\`），API Key 走 `safeStorage` |
| 邏輯 | `src/core/` 純 TS（**禁** import electron／fs／path；**禁**被 `main/` 反向污染） |
| 共用 UI | `src/shared/`（目前只有 `MonoIcon`） |
| 手機 | `src/mobile/`（B3 React；單一入口 `/`） |

```
src/core/   純邏輯
src/shared/ 桌面＋手機共用呈現
src/main/   Electron 主行程
src/renderer/ 桌面 UI
src/mobile/ 手機 UI
```

---

## 3. 硬規則（永遠有效）

**產品／範圍**
- 不做規格外功能；有想法先跟 owner 討論
- 第一版排除：自動發話、TTS、Live2D、ST 對話記錄匯入
- Lorebook（用語解說）**要做**——桌面＋手機內容編輯已完成；規格 `docs/future-lorebook.md`（選讀）
- 桌面至少留一個角色；只剩一個時隱藏移除
- 解除安裝不刪使用者資料

**視覺（只改這些檔，勿動邏輯）**
- 扁平、圓潤；預設仍是春夏粉彩（主色薄荷／天藍；背景 `#F7FFFC`；文字 `#3D5A52`）
- 另有多組可選主題（含無彩度純白／黑白灰，以及森林、復古、賽博）；細節見 `docs/progress-log.md`「介面配色擴充」
- 禁止：厚重陰影、毛玻璃、純黑字、尖角；賽博主題亦避免霓虹 glow
- 檔案：`src/renderer/src/styles/theme.css`、`src/mobile/ui/theme.ts`、`tailwind.config.ts`、`src/renderer/src/styles/global.css`、`src/shared/MonoIcon.tsx`
- 加圖示只改 `src/shared/MonoIcon.tsx`，不要在桌面／手機各抄一份
- **12 組配色的色值真相是 `src/shared/colorThemes.ts`**（2026-08-23 從 `src/mobile/ui/theme.ts` 搬過去，因為飲食記錄 App 的小工具也要用，而它碰不到 `src/mobile/`；後者仍 re-export，既有 import 不用改）
- 新增／改主題時：`ColorTheme` union、**`src/shared/colorThemes.ts` 的色值與 `THEME_LABELS`**、桌面選色器、情境 `THEME_META`、**以及** `mobileServer` 的 `MOBILE_COLOR_THEMES` 白名單要一起改

**架構（手機／跨平台提案必過）**——濃縮自 roadmap §2／§8，細節選讀原文
- 四大目標：①裝置上可單機聊自己的角色 ②不另付費給作者（無須營運後端）
  ③敏感資料不放第三方（relay 是例外，須揭露＋可自架 Tunnel）④新手三步上手（分層，進階勿擠第一層）
- **已否決、不要重提**：雲端同步後端、React Native 重寫、手機重寫一份 prompt 邏輯、
  NAS 當 DeST host、付費模式、Relay 代排程、RTC 半夜喚醒、把 HTML 打包進遙控 APK、Spotify 自動選歌

---

## 4. 現況與下一步

| 區塊 | 狀態 |
|---|---|
| 桌面版 | MVP～進階大致完成（新聞、情境覆蓋、reaction、記憶摘要、日曆、Lorebook 桌面…） |
| B1／B2／B2.5–2.7 | 完成（`core/`、adapter、store、Lorebook） |
| **B3 手機 UI** | 階段 0–9 ＋ 資訊架構完成；`mobile.html` 已移除（單一入口 `/`） |
| **B6 遙控 UI** | 已完成（真機驗證通過） |
| **手機獨立版 W1–W3** | 完成。**debug APK 已在 Pixel 10a 實測通過**（聊天、落地、金鑰加密、重開保留）。建置流程與陷阱：`src/mobile/README.md` |
| **S1 初始化匯入** | 完成（掃 QR 單向拉角色／預設組／設定／**對話**；對話勾選匯入，預設全不選）。另有可重複執行的「從電腦重新拉設定」 |
| **獨立版天氣** | 完成（缺口 #4）。邏輯在 `core/weather/`，定位 GPS 優先退回 IP，聊天會帶 `[Weather]`。**地震／颱風／天氣預報關鍵詞即時查詢已完成，真機驗證通過**（2026-08-22 實作／2026-08-23 owner 手機實測正常結案，`core/weather/realtimeQuery.ts`）：手機聊天送出訊息前跑關鍵詞偵測，命中就打 CWA、注入 `[即時查詢：...]`；CWA API Key 走既有 S1 一次性匯入（不進 S2 M5 比對子集，那條子集永遠不放金鑰），手機天氣設定頁新增可自行填 Key／測試連線的區塊 |
| **獨立版 Lorebook 編輯** | 完成（缺口 #2，2026-08-09）。`StandaloneSession` 接上 CRUD＋參照清理；`chat.ts` 補了原本沒接的 `[Glossary]` 注入（桌面版本來就有，獨立版聊天管線之前完全沒有） |
| **獨立版提醒** | 完成（缺口 #5，2026-08-09～11）。CRUD＋排程器＋Capacitor 通知；原生層（AlarmManager＋headless WebView 現場生成台詞）也已完成，App 劃掉後仍會響；`screen_on_only`／`always` 兩種喚醒模式都在判斷 |
| **獨立版個人新聞報** | 完成（缺口 #6，2026-08-12）。`core/news/*` 15 支全部接上，桌面／遙控／獨立版共用同一份邏輯。手機額外補了：面板下緣安全區、重新摘要、清除摘要（只留 `[Shared News] 標題`）、原文連結、兩層導覽（關鍵字組→欄）、熱門話題開關。**不做**：背景定時抓新聞、搬家包（桌面獨有，刻意不搬）。**對話新聞搜尋原本也在這條「不做」裡，2026-08-21 owner 改變決定，08-22 已搬到手機並真機驗證通過**（見下方獨立列） |
| **地方新聞併回關鍵字組** | 完成（2026-08-12，`docs/news-local-merge-plan.md`）。縣市不再是系統特製欄位，變成一般關鍵字（「地方」組），手機現在也能編輯；情境切換會影響它（owner 拍板接受） |
| **APK 返回鍵修復** | 完成（2026-08-12）。Capacitor 8 的 `BridgeActivity` 不覆寫 `onBackPressed`，`popstate` 在 APK 裡從不觸發，返回鍵等於直接關 app。改用 `@capacitor/app` 的 `backButton` 事件，見 §5 |
| **獨立版角色卡／設定包匯出** | 完成（缺口 #3，2026-08-12）。`StandaloneSession.exportCard`／`exportPack` 接上，格式與桌面 `dstPack.ts`／`stCardMapper.ts` 相容（互通匯入）；PNG 無頭像時退回內建透明底圖。`fileTransfer.ts` 的 `downloadBytes` 改非同步、平台分流：網頁走 `<a download>`，APK 走新裝的 `@capacitor/share`＋既有的 `@capacitor/filesystem`（動態 `import()`）。**真機驗證通過**：Pixel 10a 上實際點過「匯出 PNG 卡」，系統分享面板正確跳出且圖片正確 |
| **S2 同步 M1（模式可切換）** | 完成（2026-08-12），穩定性已補驗證。App 內可直接切換本機／遙控，不用重開；`mobile/ui/stores/connectionStore.ts` 取代原本 `App.tsx` 的 `useMemo`；切換按鈕在「關於」頁（只有原生殼顯示）。**這階段完全不同步資料**，只是把「兩份資料分開存取」的入口做出來。owner 實機試切換時揪出兩個原生殼獨有的既存缺口並修掉：①掃到中繼 QR 時 WebSocket 路由是錯的（`resolveLiveRemote()` 會自動嘗試升級成區網直連，升不了就明講不支援）②`capacitor.config.ts` 的 `androidScheme` 是 `'https'` 導致 Mixed Content 政策擋掉角色頭像與遙控 WebSocket（改成 `'http'`，細節見 §5）。兩個修法 log 上都看得到效果（WS 首次 `open` 成功、Mixed Content 警告歸零）。**穩定性補驗證（同日稍後）**：手動延長螢幕逾時後，遙控·區網直連模式閒置 4 分鐘連線仍正常、`Mixed Content` 全程 0 筆——判定穩定收工。細節：`mobile-mode-switch-sync.md` §8.1 |
| **S2 同步 M2（差異預覽，唯讀不搬資料）** | 完成，**真機驗證通過**（2026-08-12）。新端點 `GET /api/sync-manifest`；純差異邏輯在 `core/sync/`（平台無關，`npm test` 涵蓋）；切換前用既有的 `ui.confirm` 對話框（沒有另做 Sheet）顯示差異摘要，`ModeSwitcher.tsx` 掛入。**這一版只讀不寫基準**（`sync-baseline.json` 目前不存在，還沒有人寫過），所以真機上看到的是「無基準」的中性統計訊息，逐筆差異／衝突要等 M3 第一次寫入基準才會被真機驗證到。細節與落地筆記：`mobile-mode-switch-sync.md` §8.2 |
| **S2 同步 M3（真的推／拉資料）** | ⚠️ **歷史紀錄，流程已被下一列的 M4 取代，勿當現況**。當時狀態：方向已修正、自動測試通過、真機實測揪出重複增生問題（因此才有 M4）。 獨立→遙控＝手機→電腦推送（`syncPush.ts`，角色／人設／世界觀／Lorebook／情境，逐項成功即寫回基準）；遙控→獨立＝電腦→手機拉取（新檔 `syncPull.ts`，直接複用 S1 `runSyncImport()`，`onConflict='overwrite'`，且會拔掉電腦附的 API Key，S2 不碰金鑰）。路由抽成純函式 `runtime/modeSwitchSync.ts`，可被單元測試直接驗證方向沒接錯（`tests/mobile/modeSwitchSync.test.ts`、`syncPull.test.ts`）。**設定推送仍是死碼**（`pushSettings()` 沒有呼叫端）；**對話同步是 M4，完全沒做**。`npm run typecheck`／`npm test` 皆過（47 檔、600 項）——只證明邏輯正確，不是真機驗證。真機待驗兩條路徑見 `docs/mobile-sync-m3-kickoff.md` §9 |
| **S2 同步 M4（逐項比對）** | **已完成，真機驗證通過**（2026-08-14 實作／2026-08-16 owner 於 Pixel 10a 實測 9 條，逐條結果見 `docs/handoff/real-device-checklist.md`；第 6 條也已於 2026-08-23 補驗通過）。⚠️ **情境切換後「使用者設定會換、對話不會換」是設計如此**：`lastActiveConversationId` 跟桌面視窗座標同一類屬裝置本地狀態，`syncApply.ts` 兩個方向都保留接收端原值，別當成漏翻譯去「修」。M3 真機實測發現「資料有過去但重複愈來愈多」——電腦端長出 23 個情境（真正 7 個）、各 10 份世界觀與使用者設定。根因是**基準表整份是假的**（推送時記 `remoteId: id`，但電腦端 `savePersonaPresetDirect` 會丟掉送來的 id 另發 uuid，手機從沒讀過回應）＋ diff 的名字後備配對讓同名資料永遠不推也永遠不收斂 ＋ 推情境沒翻譯交叉參照（電腦上留下 10 處死參照）＋ 取消被誤報成「連不上」。**改成每次切換當場逐項比對**（`core/sync/pair.ts`，身分＝id 相同 or 名稱相同，不依賴基準），左手機右電腦逐列選，含「全部用手機／全部用電腦／保留差異」；內容是否相同看 `contentHash`（**不能看 `updatedAt`**，推送會把接收端時間設成現在）。方向變成資料而非程式分支，M3「掛錯呼叫端就整個反了」的錯誤類別消失。電腦端資料已用一次性腳本清理完（備份 `Data.backup-2026-08-13T15-59-48`），手機端刻意留著當真機驗證素材。細節與待驗清單：`docs/mobile-sync-m4-compare.md` |
| **S2 M5（設定同步）** | **已完成，真機驗證通過**（2026-08-14 實作／2026-08-16 實測 6＋1 條）。M4 比對畫面加開「設定」分頁，逐欄位比對 LLM 供應商／各供應商模型／對話限制／記憶／配色主題／模組開關／天氣潤飾；不碰 API Key。跟資料比對是兩套獨立系統（`core/sync/settingsPair.ts`）——設定欄位兩邊永遠都有值，沒有「單邊獨有」，選項只有 本機／電腦／不動，預設一律不動。桌面／手機的設定子集定義統一到 `core/sync/settingsSnapshot.ts`（避免重蹈 M4 `contentHash.ts` 那次雙邊定義漂移的坑）；新增 `GET /api/settings/sync-snapshot`。**owner 2026-08-14 真機測出一個遺漏**：`weather.polish`（天氣輔助模型潤飾）是模組底下的子設定、不在原本沿用的舊子集裡，已補上（§8.5b）——這類「模組除了 enabled 還有自己的子設定」的遺漏還沒逐一排查完，之後如有人回報某模組的某個開關沒同步，大概率是同一類坑。細節：`docs/mobile-sync-m4-compare.md` §8 |
| **S2 對話同步** | **已完成，真機驗證通過**（2026-08-15 實作／2026-08-16 實測 8 條，最重要的「推兩次不能長出第二份」通過，M3 的重複增生沒重演；後續加的「整則對話刪除」也已驗過）。S2 同步的最後一塊；代號提醒：規劃書裡的「M4」本來指這個，但實際開發時 M4／M5 被拿去命名逐項比對與設定同步，**對話同步在此之前從未做過**。對話**不能套用 `pair.ts` 的三選一**——「兩邊都有對方沒有的訊息」是常態不是衝突，套下去等於逼使用者選一個必然丟資料的答案。所以另立 `core/sync/convPair.ts`：主控制是「合併（兩邊補齊）／不動」兩態，左右二選一只用在真的只能有一個答案的單值欄位（標題／摘要）。快捷鍵只有兩顆，**這個分頁不刪任何東西**。配對順序 id →`importedFrom.sourceId`→ 標題，第二步漏掉的話每則 S1 匯入過的對話都會被再推一份（M3 的失敗模式重演，有測試守）。只傳輸「對面缺的那幾則」（新增 `?idsOnly=1`），依累計位元組分批。細節與真機待驗八條：`docs/mobile-mode-switch-sync.md` §8.3／§8.4 |
| **本機 LLM 供應商（`local`）** | **已完成**（2026-08-15 實作／2026-08-23 owner 桌面版實測可用結案）。新增供應商 `local` = 任何 OpenAI 相容端點（Ollama／LM Studio／llama.cpp）。**主模型與輔助模型都能選**，可各自用不同端點——`llm.endpoint` 單一欄位拆成 per-provider 的 `llm.endpoints`（有遷移，會寫回磁碟），`applyUtilitySettings()` 換 provider 時端點跟著換，所以「主＝Claude 雲端／輔助＝本機 Qwen3」成立。**不必寫新 adapter**：實測 Ollama 支援 Responses API，沿用 `openai.ts`，只多送 `reasoning:{effort:'none'}`（思考模型會把 token 預算吃光、正文回空字串，情緒分類只有 20 tokens 必中）。金鑰選填。模型清單靠「測試連線」打 `GET /v1/models` 動態取得。順手修掉兩個既有 bug：輔助模型連線測試用錯端點、`httpAdapter` 的 30 秒天花板套在有 signal 的請求上（**這條影響所有手機請求，不只本機模型**）。細節：`docs/local-llm-provider-plan.md` §9 |
| **飲食記錄 App：桌面小工具（B9b 一部分）** | **已完成，真機驗證通過**（2026-08-21 實作／2026-08-23 結案）。`docs/nutrition-widget-plan.md` §9 七步全做完；Pixel 10a 裝機驗過 App 啟動、三個深連結（`daily`／`photo`／`quick-entry`）導覽、重新整理 broadcast 零實例不 crash，小工具本體 owner 已放上主畫面**正常使用中**。專案原本純 Java，這次補了 Kotlin 工具鏈，版本要對齊 `@capgo/capacitor-health` 已在用的 2.4.10（混版會炸 metadata 不相容）。點擊走 `@capacitor/app` 標準深連結模式（`custom_url_scheme` 資源＋`getLaunchUrl()`／`appUrlOpen`），存檔／App 離開前景觸發更新則靠新寫的最小外掛 `NutritionWidgetBridgePlugin`（JS 沒辦法直接發 Android broadcast）。細節見 `TODO.md` §3 對應條目。 |
| **飲食記錄 App：Health 讀（B9-Health-lite）** | **已完成，真機驗證通過**（2026-08-19）。手機端讀 Android Health Connect（`@capgo/capacitor-health`），三個開關（連接 Health／自動同步／手錶消耗熱量當日上限，見 kickoff §2.1）皆預設關；owner 用 Pixel Watch＋MovingLife 體重計真機實測，體重／體脂／今日動態熱量上限（含追加的「過去日期也顯示當日手錶總消耗」）都驗證正確。真機測出並修掉 3 個 bug：`minSdkVersion` 24 太低裝不動 Health Connect（改 26，Android 7.x 從此不支援）；`@capgo/capacitor-health` 的 `limit` 太小時原生分頁邏輯會抓到最舊而非最新的體重紀錄；Health Connect 的公斤數帶一長串小數沒 round。桌面完全沒碰、不含 Health 寫（維持排在 B9c）。細節：`docs/nutrition-health-lite-kickoff.md` §7／§8／§11 |
| **對話新聞搜尋（獨立版）** | **已實作，真機驗證通過**（2026-08-22，Pixel 10a）。聊天送出前判斷「是不是在問時事」並萃取查詢詞，命中就搜新聞注入 `charMsg`（`MessagePromptView.tsx` 的「對話搜尋」分頁本來就有）。開關＋觸發詞清單＋查詢時效（`maxAgeHours`，0＝不限）全部開放手機編輯。順手修掉一個坑：`NewsModuleSettings.conversationSearch` 是巢狀物件、`saveNewsModuleSettings` 對它整包取代，手機只送部分欄位會把桌面其他欄位重置成預設——存檔路徑改成先讀現況再合併。已知限制：判斷／萃取是輔助模型的一次分類任務，弱模型會誤判，非 bug。細節：`docs/news-conversation-search-spec.md`、`TODO.md` §3 |
| **手機對話記錄換表情／手動指定／新增表情圖** | **已實作，三輪修正後 owner 第四次實機驗證通過**（2026-08-23）。跨裝置同步後表情正常顯示。架構級成因是**訊息換一台裝置看會用該裝置自己的 `emotions`／`spriteIds` 反查，而自訂 id 是裝置本地產生的**——修法是訊息落地前就換算成 canonical key（`canonicalizeEmotionId()`，接在 `chatWithLLM()`／`classifyEmotionWithLLM()` 這兩個唯一產生 `message.emotion` 的入口）。⚠️ **修正前產生的舊訊息不會自動修好**，跨裝置看仍退回主圖，要手動「換表情」補一次。`EMOTION_OPTIONS` 已搬到 `core/character/emotionCatalog.ts`。細節：`docs/mobile-character-expression-plan.md` §9.1／§9.2 |
| **DeST Android 桌面小工具** | **已完成，真機驗證通過**（2026-08-23，owner 手機實測數輪正常結案）。小工具**不綁角色、跟著目前對話走**；可釘選訊息（`ui/stores/widgetStore.ts` 單一真相）、App 內有「桌面小工具」設定頁（預覽＋管理釘選＋頭像開關＋12 組配色＋底色透明度 0–100%）。JS：`core/character/widgetSnapshot.ts`、`mobile/runtime/widgetPins.ts`／`widgetBridge.ts`；原生：`android/.../widget/` 兩支 Kotlin。踩過三次同一條坑——**RemoteViews 不吃 CSS／不認裸 `<View>`／不能只改容器顏色**，按鈕、進度條、頭像底色圓都得整顆畫成 bitmap（頭像用 `BitmapShader`，**不能用 `SRC_IN`**，會把底色一起挖掉）。四個配色設定彼此獨立：DeST App／DeST 小工具／飲食 App／飲食小工具。真機待驗清單：計畫書 §12.7＋§13.5＋§14.4＋§15.4＋§16.3＋§17.1 |
| **S2 提醒同步（M4 第六個 kind）** | **已實作，真機待驗**（2026-08-24，`npm run typecheck`／`npm test` 皆過）。提醒清單同步走逐項比對，但 `notificationDevice`／`wakeMode`／`inactiveBehavior`／`allowOfflineFallback`／`lastTriggeredAt` 是裝置本地／衍生狀態，push/pull 時保留接收端原值、不整包覆蓋（比照情境案例）；`characterId`／`sceneId` 走既有 id 對照表，`conversationId` 沒有對照表可翻、一律不推。細節：`TODO.md` §2.3、`docs/reminder-sync-kickoff.md`（設計依據，已照做完成）。 |
| **Google 日曆驅動提醒** | **桌面已完成，owner 初步實測正常**（2026-08-25）。Google 事件自帶的提醒設定 → DeST 提醒（唯讀鏡射，Google 端是唯一真相）；提醒清單分「日曆同步／手動建立」兩分頁＋週月分組；開機＋每 8 小時＋手動掃描；日曆設定頁一進去就自動掃。**上線當天實測炸開，修掉 4 件事**，最重要的是 **`setTimeout` 24.85 天溢位**（既有 bug，見 §5 新條目）。**手機版還沒做** → `docs/calendar-reminders-mobile-kickoff.md` |
| **下一步** | **看根目錄的 [`TODO.md`](TODO.md)** —— 待辦的唯一入口，狀態以那份為準。**2026-08-24 現況**：飲食模組 B9a／Health 讀／拍照估價／桌面小工具皆已完成並實際使用中，剩**本機報表頁**（排最後，純唯讀）與 **B9c**（Health 寫、接 S2、角色偏好注入）。DeST 手機版近期的對話新聞搜尋、表情、桌面小工具、天氣即時查詢、**提醒同步**都已實作完成（提醒同步待真機驗證，其餘已真機驗證結案）；桌面版本機 LLM 也實測可用。剩下的主要是少數自動測試過但沒真機驗的同步項目（`llm.utility*` 設定同步、模組子設定遺漏排查、M4 第 6 條）。 |
| 延後／已排程 | 角色印象（B8）；系統通知（B5）；飲食熱量模組其餘分期（**B9b／B9c**，B9-Health-lite 已完成見上） |

獨立模式**尚未實作**（會誠實擲 `not-supported`，不是 bug）：
Spotify／日曆授權仍只在桌面。
遙控電腦（`remoteControl.*`）**永久不支援**——獨立模式沒有電腦可控，設計如此。
→ 缺口總表與建議順序：`docs/mobile-standalone-gap-inventory.md`（不長，可整份讀）。

分支：`feat/mobile-standalone`。

---

## 5. 進行中仍會踩的坑（寫手機相關時看這裡就夠）

- **`capacitor.config.ts` 的 `server.androidScheme` 一定是 `'http'`，不是 `'https'`**
  （S2 M1，2026-08-12 owner 實機回報）。改成 `'https'` 的話 App 自己的頁面來源會是
  `https://localhost`，瀏覽器的 Mixed Content 政策會把任何 `http://`／`ws://` 子資源
  當成「安全頁面偷載不安全內容」擋掉——**`android.allowMixedContent: true` 蓋不掉這個**
  （實測在這台裝置的 WebView 版本上完全沒用）。症狀很好認但很難聯想到 scheme：
  角色頭像／訊息圖片全部讀不到（`<img>` 直接被拒絕），遙控模式的 WebSocket
  連了又斷、畫面一直跳「連線中斷，正在重新連線」——但 HTTP API（送訊息、讀設定）
  完全正常，因為那些走 `CapacitorHttp` 外掛的原生請求橋接，不受 WebView 的
  Mixed Content 檢查管。`localhost` 不論哪個 scheme 都算瀏覽器規範裡的可信任來源，
  改成 `'http'` 不會少任何 secure-context 能力，只會讓區網直連的 `http://`／`ws://`
  不再被當成降級擋下——中繼走的是 `https://`／`wss://`，這條路是升級，本來就不受影響。
  診斷方法：`adb logcat | grep "Mixed Content"`，看到訊息就是這個。
- 選檔 `accept` **只給** `image/*` 大類，不要列副檔名（Android 相簿會空）
- 改 vite alias 或 tailwind `content` 後**一定重開** `dev:mobile`，否則圖示無聲消失
- relay 三約束（改連線／建置／QR 必守；細節 §4.20）：
  ①產物＝**單一自足 HTML**（`build:mobile` 含 inline）②`baseUrl` 相對路徑
  ③WebSocket 用注入的 `__tunnelWsUrl`
- 入口：`/` 一律走 B3 React；`DesktopST-dev.bat` 先建置手機（**無 HMR**）；
  邊改邊看用 `MobileST.bat` → `[3]`
- 業務邏輯寫在 `core/` 或既有 `*Direct`；手機／`mobileServer` 只做薄轉呼叫
- **獨立模式改完資料一定要 `events.push({ kind: 'state-invalidated', … })`**，
  否則畫面不會更新（漏推過一次：重新發送截斷後畫面停在舊清單）
- **Capacitor 外掛放 `dependencies`，不是 `devDependencies`**；打 APK 前先看
  `src/mobile/README.md` 的兩個陷阱（另一個是 `JAVA_HOME` 不能用 Android Studio 的 jbr）
- 手機版本資訊：`vite.mobile.config.ts` 的 `define` 注入，包裝在 `src/mobile/buildInfo.ts`；
  header 左上角兩字標籤（本機／區網／中繼）點進去「關於」。**要看「更新了沒」請看建置時間，不是版本號**
- 清單列慣例（角色／情境／使用者／世界觀／對話）：**點名稱編輯（小「編輯」在名稱下方）、右邊大標籤套用／加入**
- 加 Capacitor 外掛時：**權限不見得會自動合併**（`@capacitor/geolocation` 的
  AndroidManifest 是空的），要自己寫進 `android/app/src/main/AndroidManifest.xml`；
  外掛一律用**動態 `import()`** 載，否則瀏覽器煙測與 vitest 會在載入時就炸
- core 裡要打外部 API 就**注入 `HttpAdapter`**（比照 `core/llm`、`core/weather`），
  不要用全域 `fetch` —— 手機那邊要 CapacitorHttp patch 過才繞得過 CORS
- **CapacitorHttp 完全忽略 `init.signal`**：core 裡那些 `AbortController` ＋
  `setTimeout(abort)` 的逾時在手機上等於不存在，原生請求一慢就無限等
  （天氣「抓取位置」卡住就是這個）。`mobile/adapters/httpAdapter.ts` 已用
  `Promise.race` 把 signal 翻成 reject，**新的逾時邏輯照樣要走 signal，別自己 setTimeout**
- **CapacitorHttp 會把「宣稱是 JSON、內容卻不是合法 JSON」的回應多編碼一次**：
  原生層 `JSON.parse` 失敗後當字串留著，fetch patch 再 `JSON.stringify` 一次還給你 ——
  `res.text()` 拿到的換行是字面上的 `\n` 兩個字元、引號變 `\"`、原本的 `\"` 變 `\\\"`。
  **桌面走 Node fetch 不會這樣**，所以症狀是「只有手機壞、而且壞得很安靜」。
  踩過：Google 新聞 `batchexecute` 解原文連結（`core/news/enrich.ts` 的
  `normalizeRpcBody`），每一則都解不開但 log 只說「解析失敗」。
  **凡是要自己剖析非標準 JSON 回應（前綴 `)]}'`、分段格式、JSONP…）就要先還原**，
  而且解析用的 regex 別寫死反斜線層數
- **Capacitor plugin 的 `timeout` 選項不保證兌現**（`Geolocation.getCurrentPosition`
  沒權限時 Promise 可能永遠不 settle）。外面自己再包一層計時器
- **絕對不要讓 async function 直接 `return` Capacitor 的 plugin 物件**
  （`return mod.Geolocation`）。JS resolve 時會摸回傳值的 `.then` 判斷是不是
  thenable，而 plugin proxy **把任何屬性存取都當成原生方法呼叫**，就變成呼叫
  原生的 `Geolocation.then()`：原生沒這方法、不回呼 resolve／reject，
  **外面的 `await` 永遠卡住**（天氣「抓取位置」按了沒反應就是這個，
  錯誤只在 logcat 看得到：`"Geolocation.then()" is not implemented on android`）。
  要回傳就包一層：`return { plugin: mod.Geolocation }`
- **APK 的返回鍵不會變成 `popstate`**：Capacitor 8 的 `BridgeActivity` 沒有覆寫
  `onBackPressed`，返回鍵走 Activity 預設行為（直接 `finish()`），完全不碰 WebView
  歷史。所以**只靠 `history.pushState` ＋ `popstate` 的返回處理在 APK 裡等於沒有**——
  一按就結束 activity，使用者從最近使用回來時是全新啟動、停在聊天畫面，
  症狀是「操作到一半自己跳回首頁」。要用 `@capacitor/app` 的 `backButton` 事件
  （`ui/shell/useBackButton.ts`，瀏覽器仍走 popstate，兩條共用 `handleBack()`）
- **「網址固定、內容會變」的資源一定要送 `Cache-Control: no-cache`**
  （2026-08-13 owner 實機回報）。`GET /api/avatar/:id` 原本沒送任何快取標頭，
  瀏覽器就套用**啟發式快取**自己猜一段有效期，連問都不問就用舊圖 ——
  電腦端換了主圖，遙控版永遠停在舊那張。**症狀極容易誤判成同步壞掉**：
  同一張角色卡的**文字會即時更新**（那是 JSON，畫面一掛載就重抓），
  只有圖不動，看起來像「圖片同步沒做」。`no-cache` 不是「不要快取」，
  是「用之前先來問我」，配 ETag 時沒變就回 304、不傳位元組。
  ⚠️ 別照抄 `/api/message-image/` 的 `max-age=86400`：訊息圖片綁死在某一則
  訊息的某一張、內容永不變，可以長快取；頭像剛好相反，兩者要反過來處理。
  另一半在手機端：已經畫在畫面上的 `<img>` 就算 src 沒變也不會自己重抓，
  所以 `state-invalidated` 要順手 `invalidateAllAvatars()`
  （`ui/characters/useAvatarUrl.ts`，版本號故意全站共用一個——那個事件
  不會告訴你是哪一隻角色變了）
- **碰 settings 之前一定要 `await initCapacitorSecrets()`——漏了會安靜地毀掉 API Key**
  （2026-08-13 owner 回報「獨立版的 API Key 不見了」）。沒初始化時
  `capacitorSecrets` 退化成 `unavailableSecrets`：`decrypt()` 原樣回傳
  `enc:v1:…` 密文 → `hydrateSettings()` 判定「解不開」而把記憶體裡那把金鑰設成
  `''`（本意是別讓使用者看到亂碼）→ 之後**任何一次** `saveSettings()` 會
  `encrypt('')` 回傳 `''`，磁碟上的密文就被空字串覆蓋、**永久消失**。
  踩到的路徑：`ModeSwitcher` 在遙控模式下臨時 boot 一份 standalone session
  （`App.tsx` 只在獨立模式分支初始化 secrets），S2 M3 的「從電腦帶回資料」
  接著跑 `runSyncImport()` → `saveSettings()`。
  現在 `session.saveSettings()` 有保險絲（secrets 不可用 ＋ 磁碟是密文 ＋
  要寫入空字串 → 保留舊值，`tests/mobile/secretsFuse.test.ts`），
  但**呼叫端照樣要先初始化**，別依賴保險絲。
- **所有對電腦的 `fetch` 都要自己算逾時，一條都不能漏。** CapacitorHttp 忽略
  `signal`（見上面那條），電腦**整台關機**時封包沒人回應，TCP 逾時可能超過一分鐘。
  2026-08-13 一天內因為漏掉不同路徑踩了三次：①開機 `detectLanDirect()`
  → 停在「載入中⋯⋯」②切到遙控 `resolveLiveRemote()`→`fetchSyncInitInfo()`
  → 停在「連線中⋯⋯」③切換前預覽 `fetchRemoteManifest()`→`syncTransport.request()`
  → 一樣卡死。**修一處不等於修完**，改連線相關程式時把 `mobile/` 底下所有
  `await fetch(` 掃一遍（`connection.ts` 三支、`syncTransport.ts` 一支、
  `httpClient.ts` 一支）。目前的逾時：探測 6 秒、切換前 manifest 8 秒、
  `syncTransport` 預設 30 秒（要抓角色包，放寬）
- **開機走遙控模式時一定要先探測、而且探測要自己算逾時**
  （2026-08-13 owner 實機回報）。`fetch` 在 APK 上是 CapacitorHttp，`signal`
  無效（見上面那條），電腦**整台關機**時封包沒人回應，作業系統的 TCP 逾時
  可能超過一分鐘。`App.tsx` 的 attach effect 原本先 `await detectLanDirect()`
  才 `attach()`，於是那一等就把整個開機流程卡死：`ready` 永遠 false、
  `loadError` 永遠 null，畫面停在「載入中⋯⋯」，連既有的 `LoadFailed`
  重試畫面都出不來——症狀是「上次停在遙控版、電腦關掉後開 App 沒東西」。
  現在走 `connection.ts` 的 `probeRemote()`（`Promise.race` 自帶 6 秒逾時），
  連不上就**問使用者**要不要改用本機（不自動切：電腦只是還沒開機的人會
  莫名進到另一個資料庫，而兩邊對話是分開的，看起來像資料不見了），
  而且一次開機只問一次
- **資料遷移一定要「寫回磁碟」再看一次磁碟**：正規化／遷移若只寫在讀取路徑
  （純函式、作用在記憶體），磁碟要等下次有人存設定才會更新 ——
  在那之前每次讀都重跑遷移，**冪等旗標永遠不會生效**，使用者刪掉的東西會被建回來。
  症狀很隱蔽：畫面完全正常。驗收要用
  `adb shell run-as tw.nori.dest cat files/modules/<id>/settings.json` 看磁碟
  （踩過：地方新聞併關鍵字組，`core/news/settings.ts` 的 `needsMigrationWriteBack`）
- **`setTimeout` 的延遲上限是 24.85 天，超過會「立刻觸發」而不是等**
  （2026-08-25 日曆驅動提醒上線當天實測炸開）。延遲參數是 32-bit signed int
  （`2147483647` ms），超過就溢位。這個坑一直都在，只是以前沒人手動建一個
  超過 24 天的一次性提醒，所以從沒被踩到；日曆驅動提醒預設掃 **90 天**，
  一上線就整批中招 —— owner 的 29 筆日曆衍生提醒裡，**超過 24.8 天的 24 筆
  在開機後幾秒內全部觸發**，各打一次 LLM 刷了滿螢幕。
  **而且傷害不只是刷屏**：`once` 觸發後會自動 `enabled = false`，所以那 24 個
  行程真正到日期時反而**不會**提醒了 —— 症狀是「一開程式狂噴，然後該響的都不響」，
  兩個現象看起來無關，其實同一個成因。
  桌面已改成 `main/reminderScheduler.ts` 的 `scheduleAt()`：超過上限就先睡到上限、
  醒來再用**絕對目標時間**重算剩餘（不要用「剩餘時間相減」，會累積誤差）。
  ⚠️ **手機端 `mobile/runtime/reminderScheduler.ts` 還是舊寫法**，真正的觸發靠原生
  AlarmManager 所以影響較小，但日曆提醒搬到手機那一階段要一起改。
  診斷方法：看提醒的 `lastTriggeredAt < schedule.at`（觸發時間早於自己的排定時間，
  正常情況不可能發生）就是溢位誤觸。
- **手機通知一定要自己建 channel**：Capacitor 預設頻道 importance=3，
  只會安靜躺進通知欄、**不會有橫幅彈出**，手機又常在震動模式 ——
  看起來就像「時間到了什麼都沒發生」。用 importance 4（`reminderScheduler.ts` 的
  `dest-reminders-v1`）。**channel 建好後 importance 改不動**，要調就換 id
- **手機時間顯示一律走 `toLocaleTimeString()`**（`ui/settings/reminderFormat.ts`）：
  `<input type="time">`／`datetime-local` 是照裝置語系畫的（zh-TW ＝「下午4:43」），
  清單若自己 `padStart` 拼 24 小時制，同一則提醒兩邊長不一樣，使用者會以為存錯
- 真機除錯提醒／通知：`adb logcat | grep Reminder` 看排程；
  `adb shell run-as tw.nori.dest cat files/reminders.json` 直接讀資料（debug build 才行）；
  `adb shell dumpsys notification` 看通知有沒有真的送出。
  ⚠️ **配對的 Wear OS 手錶會把通知轉走並連帶清掉手機那則**（`WearNotifRemoval`），
  通知欄看不到不代表沒發出去
- **`llm.endpoint` 是遺留欄位，真正的來源是 `llm.endpoints[provider]`**
  （2026-08-15，本機 LLM 供應商）。舊欄位仍在、且會跟著目前 provider 同步更新，
  所以讀它多半「看起來對」——但主模型與輔助模型是不同供應商時就會拿到錯的那個。
  新程式一律用 `resolveEndpoint(settings, provider)`
- **改 `llm.provider` 的地方一定要順手更新 `llm.endpoint` 鏡像**
  （2026-08-15 owner 實機回報：手機獨立版切到本機模型、再切回雲端就連不上）。
  「`endpoints` 裡沒有這一家」是雲端供應商的**正常狀態**（用官方端點就不填），
  而舊欄位是個跟著目前 provider 更新的鏡像 —— 舊的 `resolveEndpoint` 只要查不到
  就退回鏡像，於是切去 local 時鏡像被寫成 `http://…:11434/v1`，切回 OpenAI 後
  雲端請求整個被送去本機那台。**症狀很難聯想到「切換」**：端點欄位看起來是空的
  （UI 讀的是 `endpoints`），設定畫面完全正常，只有送訊息會失敗。
  現在 `resolveEndpoint` 只在**整張表都是空的**（真的還沒遷移）時才退回舊欄位，
  但四個改 provider 的地方照樣都要同步鏡像：桌面 `setLlmProviderDirect`＋設定視窗的
  下拉、手機 `localDataSource.setLlmProvider`、`syncSettingsApply.setLocalProvider`
  （後兩個原本都漏了）
- **要擋「沒有 API Key」一律用 `hasUsableApiKey(settings)`**，不要手寫
  `settings.llm.apiKeys[settings.llm.provider]?.trim()`。本機供應商不需要金鑰，
  而這種手寫檢查原本散在桌面＋手機共 9 處（送訊息、群組、提醒、摘要…），
  漏掉任何一處就會在那條路徑回「尚未設定 API Key」——**而且訊息是錯的**，
  使用者根本不需要填。判斷來源只有 `providerNeedsApiKey()` 一支
- **接本機／自架 OpenAI 相容端點時一定要送 `reasoning:{effort:'none'}`**：
  思考模型（Qwen3 等）預設會把 `max_output_tokens` 全花在 reasoning 上、
  正文回空字串。情緒分類的預算只有 20 tokens、新聞主觀度 40，**必中**，
  而錯誤訊息是 `Empty response from model`，完全看不出根因。
  helper 在 `core/llm/index.ts` 的 `localReasoningParams()`，四個呼叫點都要帶
- **同步「聯集型」資料時不要沿用 `pair.ts` 的三選一**（2026-08-15，對話同步）。
  角色／情境那些是整份覆蓋，一邊贏另一邊；對話是 append-only 的訊息集合，
  **「兩邊都有對方沒有的訊息」是正常狀態，不是衝突**。套上「手機／電腦／不動」
  等於每次都逼使用者選一個必然丟資料的答案，而且他不會察覺——畫面看起來
  跟其他分頁一模一樣。對話走 `core/sync/convPair.ts`：主控制兩態（合併／不動），
  左右二選一只留給真的只能有一個答案的單值欄位（標題／摘要）
- **推送到電腦之後一定要讀回應裡的 id**（S2 M3 的死因，對話同步再次踩到同一個
  形狀）。電腦端收到沒見過的 id 時會**丟掉送來的、自己發一顆新 uuid**
  （`id: existing?.id ?? uuidv4()`／`createNewConversation()`），把手機自己的 id
  記成對應的話，下一趟配不起來、每推一次就多一份，而且**沒有任何自我修復路徑**。
  分批推送時第一塊就要接住 id，後續塊帶著它走
- **跨裝置判斷「哪份比較新」永遠不能看 `updatedAt`**：推送本身會把接收端設成
  現在，推完永遠是對面比較新。內容一不一樣看 contentHash；對話摘要看
  `summaryCoversTs`（那是從訊息時間戳推導的，跨裝置可比）
- 動 LLM 供應商設定時注意 `llm.model` 是早期單一供應商的遺留欄位，
  `resolveModel()` 仍會拿它墊底 —— 不同步會把 A 家型號送去 B 家

---

## 6. 依任務選讀（不要整份開）

| 你要做的事 | 讀這些 | 不要先讀 |
|---|---|---|
| 一般小修／問進度 | **本文件即可** | 一切長文 |
| **問「還剩什麼沒做」／挑下一項** | **`TODO.md`（根目錄，唯一入口，不長）** | 各設計文件的「待驗」章節 |
| B3 手機 UI（階段 7 等） | `b3-mobile-ui-plan.md` **文首＋§4.9**；該階段正文；對應落地筆記（如新聞→§4.21） | 整份計畫、舊階段筆記 |
| 改 QR／relay／手機建置 | 計畫書 **只讀 §4.20** | §4.10–4.18 |
| S1／S2 同步 | roadmap **§4.7**（模式、S1–S3 分層、API Key 判定、星狀拓樸） | 整份 roadmap |
| 手機模式切換／切換時帶資料走 | `mobile-mode-switch-sync.md`（整份，S2 第一階段的實作設計） | 整份 roadmap |
| **改／驗證切換模式的同步** | `mobile-sync-m4-compare.md`（整份，M4 逐項比對，**已取代 M3 流程**） | `mobile-sync-m3-kickoff.md`（只在追歷史時才讀） |
| **改／驗證對話同步** | `mobile-mode-switch-sync.md` **§3.1／§6.2 ②／§8.3／§8.4**；`core/sync/convPair.ts` 檔頭 | 整份 roadmap、M3 那幾份 |
| 打 APK／改 Capacitor | `src/mobile/README.md` | 一切長文 |
| 動天氣（兩邊共用，含地震／颱風／預報即時查詢） | `core/weather/`（五個小檔，直接讀原始碼；`realtimeQuery.ts` 是即時查詢）＋ `progress-log.md` 搜「獨立版天氣」 | 舊的 `weather-realtime-query-spec.md`（那是搬過去之前的桌面 CWA 規格，即時查詢邏輯現在兩邊共用） |
| 問「獨立版還缺什麼」／挑下一項做 | `mobile-standalone-gap-inventory.md`（整份，不長） | 舊的 `mobile-html-feature-inventory.md` |
| 實作手機獨立版精準鬧鐘／提醒 | `mobile-standalone-reminder-plan.md`（整份） | 一切長文 |
| **合併 QR 配對入口／出口（手機兩個入口＋電腦一張 QR 互相打架）** | `qr-entry-merge-plan.md`（整份，開工指令；§6 有 4 個開放問題要先問 owner） | 一切長文 |
| **實作提醒跨裝置同步（S2 新分類）** | `reminder-sync-kickoff.md`（整份，開工指令） | 一切長文 |
| **實作手機獨立版天氣主動發話＋今日初次問候（下一步）** | `weather-proactive-mobile-kickoff.md`（整份，開工指令；**§2 推播路線已否決別重提**、**§3 觸發模型是核心**） | `weather-proactive-speech-kickoff.md`／`morning-briefing-kickoff.md` 整份（只在查桌面現況時讀對應段落） |
| 查／改 Google 日曆驅動提醒（桌面，**已完成**） | `calendar-driven-reminders-kickoff.md`（§5.2 已依實測修訂）＋ `TODO.md` §2.7 | `calendar-driven-reminders-design.md`（產品決策過程，結論已進 kickoff） |
| **實作日曆驅動提醒的手機版（下一步）** | `calendar-reminders-mobile-kickoff.md`（整份，開工指令；**§3 那個分頁條件的坑一定要看**） | 一切長文 |
| **實作獨立版個人新聞報（缺口 #6）** | `news-standalone-kickoff.md`（整份，開工指令） | 一切長文 |
| 地方新聞為什麼不是獨立欄了 | `news-local-merge-plan.md`（已完成，看 §9） | 一切長文 |
| 查／改 Android 桌面小工具（DeST 主 App） | `mobile-android-widget-plan.md`（**已實作**，看 §11 落地筆記＋§12–§17 六輪修正與真機待驗清單） | 一切長文 |
| 查／改手機表情顯示（換表情／框選臉部／新增表情圖） | `mobile-character-expression-plan.md`（**已實作並真機驗證**，看 §9 落地筆記，尤其 §9.1／§9.2 跨裝置反查那段） | 一切長文 |
| 查／改對話新聞搜尋（聊天中即時查新聞） | `news-conversation-search-spec.md`（**已實作並真機驗證**，2026-08-22 搬到手機獨立版） | 一切長文 |
| 查／改飲食記錄 App 的桌面小工具 | `nutrition-widget-plan.md`（已實作，§7「已知風險」＋ `TODO.md` 的落地筆記） | `mobile-android-widget-plan.md`（**不同專案**的小工具，兩支 App 各自獨立，別互相套用） |
| 接本地 LLM（Ollama／LM Studio）當輔助模型 | `local-llm-provider-plan.md`（**已完成並實測**，2026-08-15／08-23，看 §9） | 一切長文 |
| 查「以前為什麼這樣做／已知坑」 | `progress-log.md` **Grep 關鍵字** | 整份 log |
| 實作某桌面／資料規格 | `DesktopST-Spec.md` **對應章節** | 整本 Spec |
| 提案跨平台／散布／同步架構 | roadmap **§2、§8**（必要時 §4.5–4.7） | 整份 roadmap、§10 舊順序敘事 |
| 對照舊 mobile.html 功能清單（歷史） | `mobile-html-feature-inventory.md` **§6／§7** | 整份 inventory |
| Lorebook 規格 | `future-lorebook.md` | — |
| **實作飲食熱量模組（B9a MVP，2026-08-17 起 owner 插隊自用優先）** | `nutrition-module-kickoff.md`（整份，開工指令）＋ `future-nutrition-module.md` **§8／§4／§6** | `future-nutrition-module.md` 其餘章節、§9（開工前可微調） |
| 查「Health 讀（B9-Health-lite）怎麼做的／改動它」 | `nutrition-health-lite-kickoff.md` **§7／§8／§11**（已完成，真機驗證通過，2026-08-19） | 舊的 Google Fit REST API 相關資料（已在關閉中，該文件 §1.1 已查證） |
| 飲食熱量模組規格（產品形狀細節） | `future-nutrition-module.md` | — |
| 新聞報 | `news-reader-mobile-plan.md`（舊版規格／UX）＋ b3 **§4.21**（React 版落地） | 所有 `news-future-*`（那是構想） |
| 新聞進 prompt 斷章／摘要設計 | `news-article-context-design.md` | — |
| 假伺服器怎麼驗 | `scripts/README-mobile-stub.md` | — |

文件夾總表與「必讀／選讀」標記：`docs/README.md`。

---

## 7. 開發指令

```bash
npm install
npm run dev          # 桌面；DesktopST-dev.bat 會先 build:mobile
npm run build
npm run typecheck
npm test             # 只測 src/core/，見 tests/README.md
npm run dev:mobile   # 手機 HMR（一般走 MobileST.bat [3]，它會順便起 stub 與 QR）
npm run build:mobile # 產出 out/mobile（含 inline，給 QR／relay）
```

**根目錄只有三個 `.bat`**（2026-08-08 從七個併過來，舊的 `MobileST-*.bat` 都已刪除）：

| 檔案 | 做什麼 |
|---|---|
| `DesktopST-dev.bat` | 日常開發：先 `build:mobile` 再開桌面 DeST |
| `MobileST.bat` | 手機全部：`[1]` 打包 debug APK 並裝機（含防火牆、桌面 DeST、區網 QR）`[2]` 只重開 QR `[3]` UI 即時預覽 `[4]` 打包**正式簽章** APK 並裝機（手機上已裝正式版時 debug 簽章蓋不上去，要用這個才能覆蓋安裝、不必先解除安裝清資料；需要 `android/keystore.properties`） |
| `release.bat` | 發布：升版 → build → zip →（可選）APK → commit／tag／push → GitHub Release |

選單邏輯在 `scripts/mobile-tool.mjs`；它只做編排，實際工作仍在
`build-mobile-apk.mjs`／`serve-apk.mjs`／`mobile-test-qr.mjs`。

授權：作者自訂條款 → https://nori.tw/DeST/license.html（repo 內 `docs/license.html`）。
