# 手機獨立版 —— 功能缺口盤點（2026-08-08，2026-08-09 排序更新）

> 對照基準：**行動版 UI（B3）已經做出來的畫面** vs **獨立模式（Capacitor／`LocalDataSource`）實際能不能用**。
> 只列「預定內、行動版有畫面、獨立版還沒接上」的項目。遙控電腦不在此列 —— 那是**永久**不支援。
>
> 判定方式：`src/mobile/data/localDataSource.ts` 裡 `pending(...)` 的方法即為缺口；
> `unsupported(...)` 則是永久不支援。

---

## 1. 一句話結論

獨立版目前**聊天主線是完整的**（角色、對話、預設組的持久化與 LLM 呼叫都在），
缺的全部集中在**「需要主機端長期跑著的東西」與「還沒補的編輯／匯出面」**兩類：

| 類別 | 缺什麼 |
|---|---|
| A. 需要背景執行 | 新聞報、提醒 |
| B. 還沒補的資料面 | Lorebook 編輯、角色卡／設定包**匯出** |
| C. 尚未開工 | 對話與電腦雙向同步（S2；S1 單向匯入與「重新拉設定」已完成） |

情境整組、天氣（含定位與 CWA）2026-08-08 已補上。

> **2026-08-09 owner 重新排序**：獨立版是最大宗使用情境（帶出門／躺著用），
> 遙控版需要電腦開著、不一定隨時能用。因此**優先把獨立版功能補完整**，
> 模式切換／S2 同步（`mobile-mode-switch-sync.md`）排到這批之後。
> 提醒被拉到新聞報前面：owner 當初切獨立版的主因就是主動提醒，先做這個才驗證得到獨立版的核心價值。

---

## 0. 額外發現：Persona 清單分頁切換 bug（非缺口，是既有 bug）

**現象**：在「情境與設定組」展開「使用者設定」分頁、編輯或刪除一筆 persona 後，
畫面會跳回「情境」分頁，而不是留在「使用者設定」。

**根因**：[`ViewStack.tsx:65-79`](../src/mobile/ui/shell/ViewStack.tsx) 只渲染堆疊最上層的
`<Sheet key={top.id}>`。推入 `PresetEditor` 時 `PresetsView` 整棵被卸載（不是疊在上層），
返回時用新的 `top.id` **重新掛載**，而「目前展開哪一分頁」是
[`PresetsView.tsx:63-65`](../src/mobile/ui/presets/PresetsView.tsx) 的 component-local `useState`
（`KINDS.includes(openParam as Kind) ? openParam : 'scene'`），重新掛載就重置回預設值 `'scene'`。

**修法方向**：`open` 不能留在 local state，要在使用者切換分頁時同步寫回
`uiStore` 堆疊裡 `presets` 那個 entry 的 `param`（`openParam` 機制本來就有，
目前只在「進入時讀一次」，缺「離開時寫回」那一半）。

---

## 2. 缺口總表

| # | 功能 | 行動版 UI | 獨立版狀態 | 卡在哪 | 建議順序 |
|---|---|---|---|---|---|
| ~~1~~ | ~~情境（scene）套用／存檔／擷取／刪除~~ | `PresetsView` 有完整清單與按鈕 | **2026-08-08 完成** | — | 已做 |
| ~~2~~ | ~~Lorebook（用語解說）編輯~~ | `LorebookEditor` 已存在 | **2026-08-09 完成**：CRUD 接上 `StandaloneSession`；另外把 `[Glossary]` 注入也接進 `chat.ts`（原本連桌面都沒有的那段獨立版聊天管線，光有編輯 UI 不會影響對話） | — | 已做 |
| 3 | **角色卡／設定包匯出** | 角色編輯器有匯出入口 | `characters.exportCard`／`exportPack` pending（匯入**已可用**） | 需要 Capacitor Filesystem 寫檔 ＋ 分享 intent | ④（owner 這輪未特別點名，暫緩後排） |
| ~~4~~ | ~~天氣定位／即時查詢~~ | 設定頁有天氣區塊 | **2026-08-08 完成**（背景 `[Weather]` 含 CWA；地震／颱風關鍵詞查詢仍桌面限定） | — | 已做 |
| ~~5~~ | ~~**提醒**~~ | `RemindersView`／`ReminderEditor` 完整 | **2026-08-09 完成**：CRUD 接上 `StandaloneSession`；手機端排程器（`reminderScheduler.ts`）與 Capacitor LocalNotifications；新增 `notificationDevice` 欄位（desktop/mobile/both，預設 mobile）；測試通過 13/13 排程邏輯。**2026-08-10 補齊**：① `startup` 排程在手機版靜默失效（`nextFireDelayMs` 明確不處理 startup，手機 `scheduleOne` 補對應分支）；② `ReminderEditor` 補 `notificationDevice` 選擇 UI（獨立模式才顯示）| — | 已做 |
| 6 | **個人新聞報** | `NewsView`／設定／關鍵字面板完整 | `news.*` 全 pending（15 支） | 抓 RSS／解析／配額／排程，量最大；還牽涉 CORS 與背景抓取。**開工指令見 `news-standalone-kickoff.md`** | **③**（owner：外出時常用；提醒已於 2026-08-11 完成，輪到這項） |
| 7 | **對話與電腦同步（S2）** | 只有 S1「從電腦匯入」 | 未開工 | roadmap §4.7 已定分層與星狀拓樸；**實作設計見 `mobile-mode-switch-sync.md`**（改成「切換模式時帶資料走」） | ⑤（owner 2026-08-09：排在獨立版功能補完之後） |

> **2026-08-11 提醒補強（缺口 #5 的延伸，非新缺口）**：台詞生成策略定案為
> 「現場生成為主、快取為底」（`mobile-standalone-reminder-plan.md` §2.1），
> 並完成 TS 部分——進階選項（喚醒模式／情境綁定／對話綁定／離線沉浸開關）、
> 觸發歷史紀錄畫面、`core/reminder/{gate,cache,history}.ts`。
> **Android 原生層（AlarmManager ＋ headless WebView）尚未開工**，
> 所以 App 被劃掉後仍然不會響，`screen_on_only` 目前也等同 `always`。

**永久不支援（不是 bug，不要修）**：`remoteControl.*` 全部 —— 獨立模式沒有電腦可控。
Spotify／日曆授權同樣只在桌面。

---

## 3. 排序理由

2 是**純資料操作**，跟已完成的情境／persona／world 存檔走同一條路（讀寫 `adapters.storage` ＋
`events.push({ kind: 'state-invalidated' })`），做完就能用，風險最低，且用語解說是 owner
日常聊天實際在用、每次都得跟角色重講一次的痛點，排第一。

5–6 都要**引進新的平台能力**（通知／排程），且兩者都碰到「手機不是常駐主機」
這個根本限制 —— 開工前先回頭讀 roadmap §2 的四大目標，別把已否決的方案再提一次。
提醒排在新聞報前面是 owner 明確排序（見文首），不是難度或風險考量。

3（角色卡匯出）與 7（S2 同步）這輪都沒被 owner 點名重新排序，
暫時維持在補完獨立版功能之後；下一輪對話若要調整順序可以再確認。

### 3.1 提醒要連同步一起做（owner 2026-08-08 決議）

owner：「天氣和提醒希望也可以和電腦同步，這樣我不用設定兩次。」

天氣已照這個做完了。提醒**刻意還沒動**，因為它不像天氣那樣「同步設定」就結案：

| 問題 | 說明 |
|---|---|
| 同步了但不會響 | 缺口 #5 沒做之前，帶過去的提醒在手機上只是一排看得到的字。比現在誠實失敗更糟 —— 使用者會以為它會響，然後錯過 |
| **兩邊都響** | 早上八點的「吃藥」電腦響一次、手機再響一次。使用者要的是不用設定兩次，不是被提醒兩次 |
| `lastTriggeredAt` 是狀態不是設定 | 兩邊各自觸發、各自往裡面寫，而 `interval` 型排程完全依賴它。這已經是雙向合併，屬於 S2 |

**決議：`Reminder` 要加「哪台裝置響」的欄位**（桌面／手機／兩者），
**預設只在原本建立的那台響**。做缺口 #5 時一起加，不要等到同步才回頭改資料結構。

---

## 4. 動手時的固定套路

改 `LocalDataSource` 的任一支 pending 方法時：

1. 業務邏輯寫在 `src/core/`，`LocalDataSource` 只做薄轉呼叫（與 `mobileServer` 同一原則）。
2. **改完資料一定要 `this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })`**，
   否則畫面停在舊資料，看起來像沒生效。
3. UI 端不要另寫一套 —— 行動版畫面已經在了，接上端點就會動。
4. 對應的 `tests/data/dataSource.test.ts` 有「這些方法必須 reject」的斷言，實作完記得一起改。

---

## 5. 2026-08-09 這一輪已完成

| 項目 | 說明 |
|---|---|
| Persona 清單分頁切換 bug（§0） | `open` 改寫回 `uiStore` 堆疊 entry 的 `param`（`setEntryParam`），重新掛載時讀回，不再跳回「情境」 |
| **缺口 #2 用語解說編輯** | `StandaloneSession` 加 `listLorebooks`／`getLorebook`／`createLorebook`／`saveLorebook`／`removeLorebook`（刪除時清角色卡／世界觀／情境的參照）；`LocalDataSource.lorebooks` 接上。**另外補了原本完全沒接的一段**：`chat.ts` 新增 `buildLoreBlockFor()`，解析角色／世界觀／情境的 `lorebookIds`（情境取代式、其餘疊加）、掃描近期訊息、組出 `[Glossary]` 區塊餵給 `chatWithLLM` 的 `loreBlock` 參數——這段桌面版原本就有（`ipcHandlers.ts` 的 `buildLoreBlockFor`），獨立版聊天管線（`chat.ts`）之前完全沒有，只做 CRUD 的話編輯了也不會影響對話 |
| **缺口 #5 提醒** | `StandaloneSession` 加 `listReminders`／`createReminder`／`saveReminder`／`removeReminder`／`toggleReminder`；`LocalDataSource.reminders` 接上。手機端排程器 `reminderScheduler.ts` 用 Capacitor LocalNotifications 發送本機通知；新增 `Reminder.notificationDevice` 欄位（値：desktop/mobile/both，預設新建時為 mobile）；測試通過 13/13 排程邏輯（詳見 `tests/mobile/reminderScheduling.test.ts`）。見 `docs/reminder-testing-plan.md` 測試計劃。**後續補強**：提醒觸發改走 LLM 由角色發話（`reminderSpeak.ts`），不再照搬 `reminder.prompt` 原文；提醒通知改用專屬高重要性頻道；時間顯示統一走 `toLocaleTimeString()`；便利貼／新聞／日曆三個獨立版沒接的注入選項灰掉並寫明原因 |
| **手機端輔助模型設定**（不在缺口清單內，owner 2026-08-09 追問後補） | 桌面「輔助模型」（提醒發話、情緒分類、天氣潤飾走另一組模型）原本只能在電腦設定，手機只有唯讀提示。補齊兩種模式：`core/data/types.ts` 的 `LlmSettingsSnapshot`／`SettingsApi` 加 `utilityEnabled`／`utilityProvider`／`utilityModel(s)` 與三個 setter；獨立模式 `StandaloneSession.llmSnapshot()` ＋ `LocalDataSource`；遙控模式 `ipcHandlers.ts` 三個新 `*Direct` 函式（`setLlmUtilityEnabledDirect`／`ProviderDirect`／`ModelDirect`，換供應商時仿桌面補目錄預設模型）＋ `mobileServer.ts` 三支新路由＋ `remoteDataSource.ts`；手機 UI 在「設定」新增「輔助模型」摺疊區（供應商／模型／API Key，API Key 沿用主模型同一個 `setLlmApiKey`，同供應商時金鑰共用不必重填）。天氣區塊的唯讀提示字樣同步更新。`scripts/mobile-stub-server.mjs` 也補了對應假資料與端點，煙測時「設定→輔助模型」可正常操作 |

## 5.1 2026-08-08 這一輪已完成（不在缺口內）

| 項目 | 說明 |
|---|---|
| 對話記錄顯示發話身分 | `Message.personaName` 發話當下快照式保存；開關 `ui.showPersonaName`（預設開）放在「情境與設定組 → 使用者設定」 |
| 訊息選單「顯示完整 Prompt」 | 只有 `hasDebugPrompt`／`hasNewsDebug` 為真的訊息才出現入口；排版與桌面共用 `core/prompt/debugPromptView`；含主模型／輔助／對話搜尋的 Token 數 |
| 點頭像 → 角色選單 | 聊天串的角色頭像 → `character-menu`（提及／說點什麼／禁言／編輯角色） |
| 獨立版不再送表情合約 | `ChatLLMParams.omitEmotionTag`；獨立版單張主圖用不到情緒標籤 |
| **缺口 #1 情境與設定組** | `applyScene`／`captureScene`／`saveScene`／`removeScene`／`removePersona`／`removeWorld` 全部接上；`activeSceneDirty` 也真的算了。設定層套用共用 `core/scene/apply` |
| **S1 對話匯入** | 掃 QR 時可勾選要帶哪幾則（全選／取消全選，**預設全不選**）；電腦端 `/api/sync-conversations`（只給清單）＋ `/api/sync-conversation`（逐則）。角色 id 靠名字重新對上，`Conversation.importedFrom` 留給 S2 |
| **缺口 #4 天氣** | 邏輯抽到 `core/weather/`（兩邊共用）；獨立版定位 **GPS 優先、退回 IP**，聊天會帶 `[Weather]`。CWA 背景預報也共用了 |
| **從電腦重新拉設定** | 設定頁「與電腦同步」，可重複按。單向覆蓋，不碰角色／預設組／對話／天氣地點 |

細節見 `progress-log.md` 同日條目。
