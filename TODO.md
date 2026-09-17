# DesktopST 待辦總表

> **這是待辦的唯一入口。** 以前散在 `CLAUDE.md` §4、`docs/handoff/README.md` §3、
> 各設計文件的「待驗」章節裡，要翻好幾份才知道還剩什麼——現在都收在這裡。
>
> 規則：**只有這份會被當成「還沒做的事」的真相來源**。各設計文件裡的「待驗」章節
> 仍然保留（那裡有完整的來龍去脈），但那些是**細節**，這裡是**索引與狀態**。
> 做完一項就把 `- [ ]` 改成 `- [x]`，不要刪掉——刪掉就看不出做過了。
>
> 最後更新：2026-09-13

---

## 0. 現在的第一順位（2026-08-17 owner 插隊）→ ✅ B9a MVP 已完成

- [x] **飲食熱量模組 B9a MVP**——owner 自用優先，插隊到其餘 S2 待辦（§2.3 提醒同步等）
      之前。**已完成並實際使用**（2026-08-18 owner 已用過並回報 UI 微調，見
      `docs/progress-log.md` 該日條目）；本節與 `docs/nutrition-module-kickoff.md`
      文首的「待開工」字樣是文件沒同步更新，不代表沒做。開工指令：
      `docs/nutrition-module-kickoff.md`。規格定案在 `docs/future-nutrition-module.md`。

下面 §1／§2 的項目暫緩，等飲食模組告一段落再回頭。

---

## 1. 暫緩中（S2 相關，等飲食模組告一段落再回頭）

### 1.1 S2 同步真機驗證（23 條）→ ✅ 已完成（2026-08-16）

owner 在 Pixel 10a 實測完畢。清單與逐條結果在
**[`docs/handoff/real-device-checklist.md`](docs/handoff/real-device-checklist.md)**：

- [x] 一、S2 M4 比對畫面（9 條）—— 第 6 條的 `scenes/*.json` 欄位沒實際打開檔案看，標 `[?]`
- [x] 二、S2 M5 設定同步（6 條 ＋ `weather.polish` 補驗 1 條）
- [x] 三、對話同步（8 條）

**同步的核心行為沒有失敗**，最重要的那條（對話推兩次不能長出第二份）通過，
S2 M3 的重複增生沒有重演。

### 1.1b 真機測試揪出來的後續 → B-2／B-4／B-5／B-6 真機驗證通過，B-1 階段一也是（2026-08-16）

細節與判斷理由見上面那份清單的「本次測試結論」B-1～B-6。剩下沒動的只有
**B-3**（無法重現，先擱著）跟**M4 第 6 條補驗**（開電腦端檔案核對，非程式問題）。

- [ ] **B-1 對話刪除**（owner 想做，**建議先做第 1 階段就好**）
  - [x] 階段一：**整則對話**刪得掉——單邊獨有的列加第三個選項「刪除」，
        複用資料分頁已驗證過的警告色＋逐筆確認清單。**真機驗證通過**（2026-08-16）。
        `core/sync/convPair.ts` 的 `ConvChoice` 加 `'delete'`
        （只在單邊獨有時有效，兩邊都有的合併列不受影響）；執行端在
        `mobile/runtime/syncConversations.ts`（本機呼叫 `session.removeConversation`，
        電腦呼叫既有的 `/api/conversations/delete`）；UI 在
        `SyncComparePicker.tsx` 的 `ConvCompareRow`。
        ⚠️ 真機測出一個漏洞並已修掉：`ModeSwitcher.tsx` 判斷「這趟同步要不要真的
        跑」的加總式沒算進新加的 `convPlan.deleteLocal`／`deleteRemote`，
        導致只選了刪除、其他都不動時，畫面上確認流程都正常跑完，但實際的
        同步／刪除步驟被整個跳過——選了刪除、按了確認，電腦端卻什麼也沒發生。
        `npm run typecheck`／`npm test` 皆過
  - [ ] 階段二：**訊息層**刪除——先別做。`merge` 光看指紋分不出差異是「新的」
        還是「被刪的」，要墓碑紀錄或逐句確認清單，等階段一用一陣子再決定
- [x] **B-2** 「保留差異」快捷鍵沒把各列切到「不動」——**已修正，真機驗證通過**
      （2026-08-16）。原因：`core/sync/pair.ts` 的 `applyPreset(table, 'keep')` 對兩邊都有的列
      正確設成 `keep`，但單邊獨有的列會呼叫 `defaultChoice()` 判成 `local`／`remote`（照樣補到
      對面），跟按鈕字面上的「保留差異」不符。owner 決定：改成整批真的不動，要補齊單邊缺的
      資料改用「全部用手機／電腦」或逐列自己按。`npm run typecheck`／`npm test` 皆過
- [x] **B-4** 同步完馬上點設定／角色會顯示「載入失敗」——**真機驗證通過**
      （2026-08-16）。切換模式時 `App.tsx` 的 attach effect 先同步 `detach()` 舊的、再非同步
      `attach()` 新的，中間有一段 `deps === null` 的空窗，但 `ready` 沒有跟著歸零——`SettingsView`／
      `CharacterEditor` 的 `load()` 在這段空窗呼叫 `getData()` 會 throw，被當成真的失敗顯示
      「載入失敗」。新增 `appStore` 的 `attached` 欄位並在 detach 時把 `ready` 一起歸零；
      兩個畫面的 `load()` 改成「還沒接上就安靜放棄（不設 failed）＋ `attached` 變 true 時自動重試」，
      已有的 `if (!llm) 載入中⋯⋯`／`if (!draft) 載入中⋯⋯` 自然接手顯示，不會看起來像壞掉
- [x] **B-5** 手機上傳圖片送出後第一時間看不到縮圖——**真機驗證通過**
      （2026-08-16）。`appStore.ts` 的 `handleEvent` 對 `'message'` 事件原本直接
      `as MessageSnapshot` 硬轉型，但獨立模式送出的訊息回音其實是帶 `images` 沒有 `imageCount`
      的完整 `Message`；取代樂觀訊息時把原本正確的 `imageCount` 蓋成 `undefined`，
      `MessageList` 的縮圖判斷 `if (message.imageCount)` 就不渲染——圖確實送出去了，只是
      手機自己那則沒縮圖，要等下一次 `state-invalidated` 重抓才冒出來。新增
      `toEventMessageSnapshot()`，兩種形狀（獨立模式的 `images`／遙控模式已經算好的
      `imageCount`）都接得住
- [x] **B-6** 電腦上改對話名稱，上方標題列沒即時更新——**真機驗證通過**
      （2026-08-16）。遙控模式下切去獨立模式前，`ModeSwitcher.localSessionForSync()` 會自己
      boot 一份「拋棄式」session 來跑同步比對，同步把改動（例如對面改過的標題）寫進**這份**
      session，但緊接著的 `switchTo()` 觸發 `App.tsx` 重新 boot 又是**另一份**新 session——
      理論上兩份都讀同一份磁碟所以最終仍會收斂，但中間有雙重 boot 與時序造成的空窗，
      使用者會看到標題暫時沒更新。新增 `sessionHolder.ts` 的
      `setPendingStandaloneSession`／`takePendingStandaloneSession`（跟 `current` 完全獨立的
      另一個變數，繞開 `App.tsx` attach effect 的 cleanup 一定會 `setStandaloneSession(null)`
      這件事），讓 `App.tsx` 進入獨立模式時優先收下同步剛用過的那份 session，
      不再重複 boot。順手拿掉 `localSessionForSync()` 原本傳的 `skipPackFetch: true`——
      這份 session 現在真的會被拿來用，裝置角色庫全空時不該跳過抓預設角色包
- [ ] **B-3** 對話角色名稱多次同步後會掉 —— **目前無法重現，先擱著**。
      再遇到請記：①哪一則對話 ②哪個同步方向 ③該角色在另一邊存不存在
- [x] M4 第 6 條補驗 → ✅ **通過（2026-08-23）**：owner 實測情境切換後電腦端的
      使用者設定確實跟著換，`activePersonaId` 的跨裝置翻譯正確。
      同時釐清一件**容易誤判成 bug 的設計**：owner 觀察到「使用者有換、對話沒換」——
      這是刻意的。`lastActiveConversationId`（上次停在哪則對話）跟桌面視窗座標同一類，
      屬**裝置本地狀態**，`syncApply.ts` 兩個方向都保留接收端原值不搬（兩台的對話 id
      本來就不同，搬過去會指到不存在的對話）。S1 初次匯入是另一回事，那裡有 id
      對照表翻譯（`syncImport.ts:669`）。已把 `syncApply.ts` 那行誤導的註解
      （原寫「手機沒有對應概念」，實際上手機也有這欄位）一併修正。
      原本的 M4 第 6 條寫「實際打開電腦端 `scenes/*.json` 看 `activePersonaId`」
      與 `desktopCharacters` 座標

> ⚠️ 清單第 7 條（刪除）**指的是資料分頁，不是對話分頁**。原本寫得不清楚，
> owner 測試時誤以為在講對話。**對話分頁本來就刻意沒有刪除語意**
> （`core/sync/convPair.ts` 檔頭），不是漏做——那是 B-1 的新需求。

### 1.2 本機 LLM 供應商：兩處未驗

程式完成（2026-08-15），core 路徑端到端驗過。

- [x] 手機真機驗證 → **通過**（2026-08-17，owner 用了幾天）。除了 owner 自己
      電腦規格導致回應速度慢之外沒有遇到問題；`httpAdapter` 30 秒天花板修正
      也沒有波及其他手機請求
- [x] 桌面設定視窗實點（要跑得起來的 Electron）→ `docs/local-llm-provider-plan.md` §9.4
      → ✅ **2026-08-23 owner 桌面版實測本地 LLM 可使用，結案**
      仍未驗

### 1.3 v0.4.0 真機煙測 → ✅ 配色主題／遙控通過；新聞泡泡揪出 3 個 bug 已修（2026-08-16）

v0.4.0（2026-08-07 已發佈）這三塊改動比較大。細節見 `docs/release-notes-0.4.0-draft.md`。

- [x] 配色主題：owner 真機測過，12 組沒問題
- [x] 遙控：owner 真機測過，沒有太大問題
- [x] 新聞泡泡：owner 真機測出 3 個小 bug，**已修正，真機覆驗通過**（2026-08-25）
  - **摘要視窗下緣被系統手勢列擋住，按鈕點不到**：`Composer.tsx` 裡「點泡泡看摘要」
    那個 sheet 沒有安全區底部留白，跟 `NewsContextSheet.tsx` 已經修過的是同一個坑
    （見那份檔頭的說明）。補上 `paddingBottom: calc(var(--safe-bottom) + 16px)`，
    高度也比照改用 `dvh`
  - **不打字直接送新聞泡泡會誤報「送不出去：內容或圖片不符合限制」**：
    `main/mobileServer.ts` 的 `/api/send` 判斷「是不是空訊息」時漏算了 `newsLink`，
    只掛新聞標題、不打字不附圖的訊息被誤判成空訊息回 400。補上 `payload.newsLink`
    這個條件
  - **某幾組配色下新聞標題幾乎看不到**：`MessageList.tsx` 標題文字色用
    `--mint2`，但深色三組主題（深色／復古／賽博）`--mint2` 刻意調暗（原本是給
    邊框／強調色用），疊在同樣偏暗的 `--user-bubble` 上對比度趨近於零；淺色系
    粉彩主題也常是同色系深淺相近版本，一樣不夠清楚。改用泡泡本文本來就在用的
    `--text`，保證所有主題都讀得清楚

---

## 2. 等你決定的（不是技術問題，是產品決定）

### 2.1 `llm.utility*` 要不要進設定同步 → ✅ 已完成（2026-08-17）

owner 決定：要。**已完成，真機驗證通過**（2026-08-23 owner 實測，輔助模型設定確實跟著同步過去）。
`core/sync/settingsSnapshot.ts` 的 `LlmSyncSubset` 加 `utilityEnabled`／
`utilityProvider`／`utilityModels`，逐 provider 拆列（比照既有的 `models`），
執行端沿用既有的 `/api/settings/llm-utility-*` 三支端點（本來就是給手機 UI
自己調用的，不用新開）。

### 2.2 其餘模組子設定的同步範圍 → 部分完成（2026-08-17）

完整盤點在 **[`docs/handoff/module-settings-audit.md`](docs/handoff/module-settings-audit.md)**。
owner 決定「能同步的盡量同步」，逐項處理結果：

- [x] `ui.showLlmBadge` / `ui.showPersonaName`（顯示模型徽章／發話身分名稱）——
      **已同步**，跟 `colorTheme` 同一類，沿用既有的 `/api/settings/show-llm-badge`／
      `show-persona-name` 端點
- [x] 新聞的 `speakButton`（陪聊頻率）——**已同步**，沿用既有的
      `GET/POST /api/news/settings`。**其餘新聞子設定沒有一起補**：
      `langMode`／`replyModel`／`maxAgeDays`／`readerMaxItems` 等欄位手機端目前
      根本沒有讀寫路徑（`NewsApi.getSettings()/saveSettings()` 只認
      `enabled`／`sources`／`keywordGroups`／`blacklist`／`speakButton` 這五個
      欄位，桌面端 `/api/news/settings` 的白名單也是同一組）——要同步它們得先
      幫這兩層都開洞，範圍比「加一列比對」大，先不做
- [x] Spotify／日曆的 `enabled` → **已從比對範圍拿掉**（owner 決定）：授權只接
      桌面，手機同步開了也沒有對應功能，容易讓人誤以為手機上能用
- [x] **新聞的 `conversationSearch`（開關／觸發詞／時效）→ ✅ 已補**（2026-08-23）。
      這三欄 2026-08-22 就加進 `NewsEditableSettings` 而且**手機端本來就可編輯**，
      卻漏了進比對子集——跟 `weather.polish` 完全同一個錯誤類別（「模組除了
      `enabled` 還有自己的子設定」），症狀是兩台永遠各自為政、比對畫面連一列
      都不會出現。`NewsSyncSubset` 加三欄、兩端組裝對齊、`settingsPair` 加三列、
      `syncSettingsApply` 加套用邏輯（**逐欄分開送**，兩端存檔路徑都會先讀現況
      再疊 patch，所以不會把沒選到的另外兩欄重置掉）。觸發詞是陣列而
      `SettingsFieldRow` 只吃純量，串接一律走共用的 `joinTriggerWords()`／
      `splitTriggerWords()`。**尚未真機驗證。**
- [x] **`memory` 子集兩端漂移 → ✅ 已修**（2026-08-23）。手機
      `syncManifest.ts` 直接寫 `memory: session.settings.memory`（**四**欄，
      多一個桌面 Log 視窗專用的 `keepDebugPromptN`），桌面
      `getMemorySettingsDirect()` 只回**三**欄——`settingsSnapshotHash()`
      因此**永遠對不起來**，摘要一直說「設定不同步」但逐欄比對每列都相同，
      完全看不出原因。諷刺的是這正是 `settingsSnapshot.ts` 檔頭警告的
      那個錯誤類別（M4 的教訓），`memory` 這欄自己踩了。手機端改成明列三欄，
      並在 `MemorySyncSubset` 上加警語。**尚未真機驗證**（純雜湊行為，
      症狀是摘要那行不再誤報）。
- [ ] 新聞的 `keywordGroups` / `sources`（清單型）、`blacklist` / `excluded*` /
      `reducedSources`（聯集型）——**owner 決定先擱著**。這兩個不能套用簡單的
      「手機／電腦／不動」三選一（會讓某一邊辛苦調的組整包消失／被覆蓋），
      要另外做一套類似對話同步的逐項比對／合併畫面，工程量接近一個新功能
- [ ] 新聞的 `readerKeywordGroupIds`（存的是關鍵字組 id）——被上面那條卡住，
      keywordGroups 怎麼配對沒解決之前不能動
- 天氣的 `realtimeQuery.enabled`、日曆的 `lookaheadHours`／`maxEvents`／
  `mentionWhenEmpty` —— **建議照 Spotify／日曆 enabled 同一個邏輯不用同步**：
  這些功能本身就是桌面限定，手機沒有對應功能可以生效，不是新的決定，只是
  同一個判斷套用到底，沒有另外花時間做
- `llm.temperature`、`ui.chatFontSize` —— 手機 UI 目前**沒有**讓使用者調這兩個
  的地方，同步了也沒東西可看／可改，等手機哪天做出對應 UI 再一起補

### 2.3 提醒要不要同步 → ✅ **已完成**（2026-08-17 方向決定；開工指令 2026-08-22；實作 2026-08-24，`npm run typecheck`／`npm test` 皆過，真機待驗）

owner 決定：提醒資料本身要同步（整份清單，比照角色／情境走逐項比對），
但**「哪台裝置響」跟裝置本地的細節設定（例如螢幕關閉時要不要響）留在各自
裝置、不同步**。

新增為 M4 逐項比對的第六個 kind（現有範圍原本是角色／人設／世界觀／
Lorebook／情境）。`core/sync/pair.ts` 的 `KINDS` 加 `'reminders'`；內容雜湊
`core/sync/contentHash.ts` 的 `reminderContentHash()` 刻意排除
`notificationDevice`／`wakeMode`／`inactiveBehavior`／`allowOfflineFallback`／
`lastTriggeredAt`（裝置本地／衍生狀態）與 `characterId`／`conversationId`（跨端
id 參照）。`mobile/runtime/syncApply.ts` 的 `pushOne`／`pullOne` 比照情境案例：
有 `remoteId`／`localId` 時先讀接收端現有那筆，把裝置本地欄位蓋回去，只有
真的新增時才用來源端值當初始值；`characterId`／`sceneId` 走既有的 id 對照表
（`reminders` 排在 `ORDER` 最後，等角色與情境都推完才翻譯），`conversationId`
沒有對照表可翻、一律不推（避免死參照）。`docs/reminder-sync-kickoff.md`
留著當設計依據，不用再看，做法完全照那份走。新增測試
`tests/mobile/reminderSync.test.ts`（10 案例，含「裝置本地欄位不被覆蓋」與
「新增時才用來源值當初始值」兩個最容易漏測的情境）。**真機驗證留給
owner**，這裡只到自動測試通過。

### 2.5 資安／免責警語（2026-08-22 owner 決定：以警語為主，不做額外機制）→ ✅ 已完成（同日）

背景：討論桌面版＋飲食記錄模組的資安風險時發現兩點需要提醒使用者，owner
決定用警語處理，不做 token 輪替／撤銷、白名單、自動備份等額外工程：

- [x] **配對／開啟手機同步時加警語**：說明 QR code／配對碼等同能連進這台電腦
      資料的憑證，請勿外流截圖或分享；並提醒 `mobile.useTunnel` 預設開啟，
      一開啟手機同步就會透過 `relay.nori.tw` 讓資料可從網際網路連入（有
      token 保護），只想區網使用要自己去關閉「使用中繼」選項。文案放在：
      桌面 `SettingsPanel.tsx`（遙控設定的手機配對區塊）、`QRCodeWindow.tsx`
      （QR 實際顯示的畫面）、手機 `SyncImportView.tsx`（S1 掃碼匯入的 pair
      步驟）、`ModeSwitcher.tsx`（S2 切換遙控模式的掃碼區塊）
- [x] **資料無雲端備份的免責警語**：說明本機／手機本地資料沒有任何雲端副本，
      硬碟損毀、解除安裝清除資料、手機遺失或恢復原廠設定都會造成資料
      永久遺失；使用者需自行用既有的角色卡／設定包匯出功能定期備份；
      這是免費使用、資料不上雲換來的代價，作者不對資料遺失負責。文案放在
      桌面設定視窗「記憶」分頁（資料夾位置下方）、手機「關於」頁
      （`AboutView.tsx`）
- 沒有另外做 onboarding 彈窗或解除安裝前確認——兩則文案各自放在使用者
  本來就會去看資料位置／連線設定的地方，符合 owner 原本「合併成一份呈現」
  的精神但不強迫多一次跳出視窗。`npm run typecheck` 全過（純文案＋UI，
  沒有動邏輯，未特別加測試）

### 2.4 S2 其他未決（沿用 `mobile-mode-switch-sync.md` §9，暫時不動）

- ~~刪除要不要同步 —— 這版一律不推，等實際用一陣子再決定~~
  → **2026-08-16 真機測試後 owner 決定要做**（整則對話刪不掉、同步後被補回來很困擾）。
  已移到 §1.1b B-1，分兩階段。**資料分頁的刪除本來就有且已驗證過**，
  這裡講的一直是**對話分頁**
- 多支手機 —— 理論上可行、未驗證，也不是你的情境
- 欄位級衝突合併 —— 不做，標為衝突讓使用者選
- 自動同步（S3）—— roadmap 已暫緩

---

## 2.6 QR 配對入口／出口合併（2026-08-24 owner 指定方向，**已實作，待 owner 真機驗證**）

owner 換裝正式簽章 APK 後要匯回資料，連續撞到三件事：從「關於→切換模式」掃 QR
被擋（不支援中繼）→ 關掉電腦端中繼再掃 → Server Error → 改從「從電腦匯入」掃
成功但拿不到 API Key。owner 原話：「這連我都搞不清楚差別了，別人更會弄錯，應該要修。」

**開工指令已寫成 [`docs/qr-entry-merge-plan.md`](docs/qr-entry-merge-plan.md)**（整份可讀）。
§6 的 4 個開放問題 **owner 已於 2026-08-24 全部答完，可以直接動工**：
①電腦端 QR 從「擴充」整個搬到「關於」，不留捷徑 ②手機端掃 QR 入口也一律移到
「關於」，首頁選單的 `sync-import` 移除 ③APK 遙控要補中繼支援（修法是小改，見 §2.4）
④**不先出 patch 版——入口全部改完才發 0.5.0**。

> ✅ **0.5.0 發布卡點已解除**（2026-08-25 owner 真機驗證通過）。
> `package.json` 已經是 0.5.0，不要再升版。

- [x] **階段一：修硬缺陷** → ✅ **已實作**（2026-08-24）
  - [x] `QRCodeWindow.tsx` 的 `pickUrl()` 短路 bug 修掉，改成 `getMobileStatus()`
        在中繼未啟用／未連上時就把 `relayUrl` 回傳空字串（`src/main/index.ts`），
        不再依賴呼叫端自己判斷真值
  - [x] 查清「自動升級區網」為什麼沒生效——**真正原因不是 AP isolation**，
        是 `getLocalIp()`（`src/main/index.ts`）從 `os.networkInterfaces()`
        拿「第一個非內部 IPv4」，這台電腦裝了 Tailscale，它的虛擬網卡
        （100.64.0.0/10 CGNAT）排在真正的 Wi-Fi 網卡**前面**（已用
        `node -e "os.networkInterfaces()"` 實測確認順序）。QR 上的「區網位址」
        因此變成 Tailscale 位址，`isPrivateHost()` 判它不是 RFC1918 私有位址而
        直接拒絕升級——連網路請求都沒發生，跟 AP isolation 無關（已用 `adb shell`
        對電腦的 3721 port 直接發 raw TCP 請求驗證區網連線本身完全正常，
        且 `AndroidManifest.xml` 已有 `usesCleartextTraffic="true"`，cleartext
        也不是問題）。修法：新增 `isRfc1918()`，`getLocalIp()` 優先挑 RFC1918
        位址，真的沒有才退回舊行為
- [x] **階段二：合併入口／出口** → ✅ **已實作**（2026-08-24）
  - [x] 電腦端 QR **入口從「擴充」搬到「關於」**，「啟用手機連線」與
        「開啟 QR Code 視窗」都在那裡；`QRCodeWindow.tsx` 改成先選用途
        （複製資料／遙控同步）才出對應 QR——複製資料一律用區網位址，
        遙控同步沿用 relay→tunnel→區網 的順位。「擴充」頁的舊入口與
        遙控設定頁裡重複的「開啟 QR Code 視窗」按鈕都已移除
  - [x] 手機端 `MainMenu.tsx` 的 `sync-import` 項目移除；`ModeSwitcher.tsx`
        （「關於」頁）新增「連接電腦」兩顆選項按鈕（複製資料 → 轉場到
        `SyncImportView`；遙控／同步 → 展開既有掃 QR 流程），取代原本
        「本機模式就無條件顯示掃 QR」的舊邏輯
  - [x] 主要流程文案不出現「中繼」「區網」（僅保留在「關於」頁的連線細節與失敗訊息）
  - [ ] **走錯入口時的指路＋跳轉**：評估後認為現在兩個 QR 本質上都是同一個
        `baseUrl+token`，差別只在位址與金鑰有沒有附，兩邊既有訊息（S1 的
        「這條連線不會傳輸 API Key」、S2 的連不上訊息）已经能覆蓋大部分情境，
        沒有另外做嚴格的「偵測到用途不符就跳轉」邏輯——**owner 真機測試如果
        還是覺得會走錯，回報後再補**
- [x] **APK 遙控補上中繼支援**（§2.4）→ ✅ **已實作**（2026-08-24）。
      `getTunnelWsUrl()`（`src/main/index.ts`，讀 cloudflared 網址轉 `ws(s)://`）
      經 `bridge` 掛進 `/api/connection-info` 與 `/api/sync-init`；
      `connection.ts` 的 `resolveLiveRemote()`／`probeRemote()` 都會帶回它，
      `wsUrlFor()` 在沒有 `window.__tunnelWsUrl`（原生殼特徵）時改用它；
      `ModeSwitcher.tsx:261` 的誤導訊息已改寫（不再說「這個版本不支援中繼」）。
      ⚠️ **trycloudflare 網址會變**，所以故意不寫進 `ModePref`，每次
      `App.tsx` 的 attach effect 都用 `probeRemote()` 現問一次
- [x] **owner 真機驗證** → ✅ **通過**（2026-08-25），入口合併沒有問題，
      **0.5.0 發布卡點已解除**

---

## 2.7 Google 日曆驅動提醒（2026-08-25 實作，**桌面已完成並初步實測正常；手機版未做**）

Google Calendar 事件自帶的提醒設定（`reminders.overrides`）直接轉成 DeST 提醒，
一個 override 建一筆、完全唯讀跟隨 Google 端。設計 `docs/calendar-driven-reminders-design.md`，
開工指令 `docs/calendar-driven-reminders-kickoff.md`（§5.2 已依實測修訂過）。

**桌面已完成**：掃描器（開機＋每 8 小時＋手動）、提醒清單分頁化（日曆同步／手動建立）
＋週月分組、日曆衍生提醒的欄位鎖定、「未推送到手機」每日提醒＋全域開關、
「推到手機」（在線走 WS 事件、不在線退回 QR）。

**上線當天實測炸開，修掉的四件事**（細節見 `CLAUDE.md` §5 新增那條）：
1. **`setTimeout` 24.85 天溢位**——超過 32-bit 上限會**立刻觸發**而不是等。
   29 筆日曆提醒裡超過上限的 24 筆開機幾秒內全部觸發、各打一次 LLM 刷滿螢幕；
   而 `once` 觸發後自動 `enabled=false`，等於那 24 個行程真正到日期時反而不會響。
   **這是既有 bug**（以前沒人手動建超過 24 天的一次性提醒）。已抽成
   `core/reminder/nextFire.ts` 的 `nextTimeoutStep()`（純函式、有測試、桌面手機共用）。
2. `injectCalendar` 預設從 `true` 改成 **`false`**——prompt 已含事件資訊，
   再灌整份行程是重複＋每則多花 200–400 token，而且角色會把不相關的待辦一起唸出來。
3. prompt **不放地點**——Google 的 `location` 多半是「場地名, 完整郵遞區號地址」。
4. 日期改**絕對日期**——`dayLabel()` 的相對標籤會漂移，害每次掃描都誤判「有變動」。

**後續**：owner 2026-08-25 初步實測正常，但要**多用幾次**才能確認排程真的沒問題
（判斷方式：開機不再刷屏、且提醒真的在該響的時間響）。

### 2.7b 手機版 → ✅ **已完成**（2026-08-25 同日，`70a0a68`）

⚠️ **本節先前寫「還沒做」是文件沒同步更新，不是真的沒做**（2026-09-13 對帳時
發現）。owner 同日確認手機實際收得到日曆衍生的提醒。

做完的內容：

- [x] 「日曆同步／手動建立」分頁（`mobile/ui/settings/RemindersView.tsx`）
- [x] 手機端 `reminderScheduler.ts` 的 `setTimeout` 24.85 天溢位分段等待
      （跟桌面 `scheduleAt()` 同一套算法）
- [x] `RemoteEventSource` 的新事件種類、QR `action=sync-reminders` 深連結

⚠️ **那個最大的坑當時避開了，記著別改回去**：手機的分頁顯示條件**不能照抄桌面**的
`settings.calendar.enabled && isCalendarAuthenticated()`——§2.2 已決定
**日曆的 `enabled` 不進設定同步**（授權只接桌面），所以手機端它永遠是 `false`，
照抄的話同步過去的日曆提醒會**永遠看不到分頁**。實作改成**看資料自己說了算**
（有日曆衍生的提醒就顯示分頁），`RemindersView.tsx` 檔頭有註解。

---

## 2.8 天氣主動發話＋今日初次問候：手機獨立版（2026-09-04 owner 指定）→ ✅ 已實作，天氣主動發話真機驗證通過

**開工指令：`docs/weather-proactive-mobile-kickoff.md`（整份讀）**

⚠️ 本節標題曾長期停在「尚未動工」，那是文件沒同步更新——`cf57f85`
（2026-09-06）已經把兩個功能都搬到手機獨立版並附完整測試，這裡當時只是
忘記把狀態行改掉，不是沒做。owner 2026-09-06 實機確認角色主動講出了
變天的事，**天氣主動發話真機驗證通過**；早安簡報邏輯已落地但尚無獨立的
真機確認紀錄。

owner 已拍板的三件事（已照做）：

1. **不接推播**（kickoff §2）。NCDR 民生示警平台的訂閱推播只推到伺服器
   （Email／HTTPS callback／Atom），`:posup` 那類 App 是自建後端轉 FCM ——
   撞到 roadmap 目標②③，**已否決，不要重提**。國家級警報走細胞廣播，
   App 沒有 API 可接。
2. **觸發用小工具 `onUpdate`（主力）＋ App resume（後備）**，最小間隔預設 3 小時。
   ⚠️ Android **沒有**「小工具被看到」的回呼，別去找。`updatePeriodMillis`
   不會為它喚醒睡眠中的裝置，這正好等於 owner 要的「手機開著時才跑」。
3. **地震分級**：≤30 分＝警報語氣（不受靜音時段限制）；30 分～**6 小時**＝
   降級成閒聊（受靜音時段限制、佔每日額度）；超過就丟。
   **桌面預設也是 6 小時**（core 共用，桌面會一起變；實際效果是早上開電腦
   會提一下昨晚的地震）。

實作順序見 kickoff §8——**第 1～6 步完全不碰原生層**，第 7 步才需要打 APK。

**後續補漏（2026-09-06）**：`cf57f85` 把每日問候的設定欄位
（`morningBriefing.enabled`／`mode`／`dayBoundaryHour`）放進了 S2 設定
同步，卻沒有給手機自己的設定 UI——桌面版設定視窗那次是有補的，純粹手機
端漏做，owner 回報「不知道要去哪裡設定」才發現。已補上 `SettingsView.tsx`
的「每日問候」摺疊區塊（**手機上刻意不叫「早安簡報」**——owner 原話
「我很少早上醒來去開他」，這個名稱假設了「早上開機」的情境跟手機的實際
使用型態不符）。裝機實測又抓出兩層問題並修完：①下拉選單版面跑掉
（`.field` 樣式衝突）②`shouldTriggerMorningBriefingNow()` 從一開始就沒讀
`mode`／`dayBoundaryHour`，選了「每次開啟都問候」形同沒用；補上後裝機
又測出③記憶體旗標 `hasGreetedThisLaunch` 假設「行程重開」＝「模組重新
載入」，但 Android 滑掉工作清單不保證真的砍掉 WebView，導致問候完一次
之後旗標卡住，改成離開前景時主動歸零（`resetMorningBriefingLaunchFlag()`，
掛在 `session.onAppBackgrounded()`）。三層細節見
`docs/progress-log.md` 該日三筆條目。

**owner 2026-09-06 實機驗證**：✅ 「每次開啟都問候」通過（排除
`isConversationTooRecent()` 2 分鐘冷卻窗口的干擾後，切背景再切回來正常
再問候一次）。「一天一次」模式（含自訂 `dayBoundaryHour`）**owner 預計
隔天測**，還沒有結論。

---

## 2.9 連結閱讀：貼網址讓角色讀內文（2026-09-13 owner 指定）→ ✅ **已實作並實測可用，結案**

**細節：`docs/link-reader-plan.md`（不長，整份讀）**

使用者在訊息裡貼網址時，回應前先抓那一頁的正文注入 prompt。
桌面、手機獨立版、手機遙控三條路都接上了，`npm run typecheck`／`npm test` 皆過。

**owner 2026-09-13 實測**：桌面貼新聞連結角色講得出內容；手機獨立版
「能讀的連結和桌面版差不多」；**YouTube 說明欄也實測可讀**。主要路徑全部過關。
次要項目（模組開關關掉後不再抓、情境覆蓋、手機行動網路的流量與延遲）
沒有逐一驗，清單留在該文件 §7。

範圍**只做公開網頁**——需要登入才看得到的頁面一律讀不到，
而且是設計如此：抓取從主行程／原生層發出，那裡沒有使用者瀏覽器的 cookie。
要支援登入牆得走「App 內建瀏覽器登入」或「瀏覽器擴充功能」，
兩條都是獨立的大工程，**目前都沒做，要做之前先跟 owner 確認**。

⚠️ **這一條原本還寫「社群站連抓都不抓」，2026-09-18 已經不成立** ——
噗浪／FB／Threads 的**單篇公開貼文**現在讀得到了，見下面的 2.11。
登入牆的部分沒有改變（私密社團、個人動態消息仍然讀不到）。

已知刻意的取捨（別當成漏做）：

1. **不先用輔助模型判斷意圖**——貼網址本身就是最明確的意圖，
   所以一般聊天零額外成本（訊息沒有網址就立刻回 null）。
2. **讀不到的連結也會進 prompt**並明講讀不到。少了這句模型會照網址掰內容。
3. **一則訊息最多讀 2 個連結**，超過的忽略。
4. **只有一個設定欄位**（`linkReader.enabled`），開關走既有的「模組開關」清單
   `desktopst.link-reader`，S2 M5 同步與情境覆蓋因此不必另外接線。

順手做的重構：抓 HTML／抽正文從 `core/news/enrich.ts` 搬到
`core/util/htmlFetch.ts`，新聞與連結閱讀共用同一份（`enrich.ts` 仍 re-export
`extractArticleText`，既有 import 沒動）。

**上線當天修掉一個既有 bug**：斜線指令 `/news` 是無錨定全域取代，會把
`https://news.cnyes.com/news/id/…` 剝成 `https:/.cnyes.com/id/…`。症狀是角色回
「我看不懂這些網址」，看起來像模型太弱其實不是。已抽到
`core/prompt/slashCommands.ts` 並加 9 項回歸測試（CLAUDE.md §5 有條目）。

**同日追加 YouTube 說明欄**（`core/link/youtube.ts`）。字幕那條路 owner
在自己電腦上實測確認**不通**（`HTTP 200 長度 0`，PO Token），**而且不是
「沒登入」的問題、別去做 OAuth**——完整實測結論在 `docs/link-reader-plan.md` §9。
改成拿標題／頻道／說明欄，只抓開頭 256 KB（Range，watch 頁 1.2 MB 起跳），
注入時明講「這是說明欄不是影片內容」。官方 Data API 版刻意延後，理由見該文件 §9.8
（要動金鑰加解密路徑，風險不該跟新功能綁在一起）。

## 2.10 桌面版一鍵更新（2026-09-14 owner 指定）→ ✅ **已實作並實跑驗證，隨 v0.5.6 發布**

起因：每次更新都得自己下載 zip、解壓縮、覆蓋，owner 自己就蓋錯過一次
（把 release zip 解到 `D:\DesktopST` 工作資料夾，把 `docs/nutrition.html`
的下載連結整個蓋回舊版）。

**為什麼不用 electron-updater**：它只支援 nsis／dmg／AppImage，
**不支援 `portable` target**，而 `electron-builder.yml` 用的就是 portable
（免安裝是這個專案的定位，不打算改成安裝版）。所以自己寫，發布流程一行都不用改。

流程：既有的「檢查更新」對話框多一顆**「立即更新」**→ 開更新視窗（`w=updater`）
→ 顯示要下載哪個附件、多大、會覆蓋哪裡 → 下載（有進度條、可取消）
→ 解壓縮到暫存 → 驗證 → 產生 helper `.bat` → 關掉自己 → `.bat` 覆蓋並重新啟動。

- 兩種安裝型態都支援，執行時自動判斷：免安裝 zip 版覆蓋整個安裝資料夾
  （`DesktopST-vX.Y.Z-full.zip`），單檔 EXE 版換掉那一個 exe（`DesktopST X.Y.Z.exe`）。
  判斷靠 `process.env.PORTABLE_EXECUTABLE_FILE`（portable target 啟動時注入，
  值＝使用者實際點的 exe；`app.getPath('exe')` 在 portable 下指向 %TEMP%，不能用）。
- 三道安全閘（都在還沒動任何檔案前擋下，`buildUpdatePlan()`）：開發模式不做；
  **安裝目錄裡有 `.git` 或 `package.json` 就不做**（就是這次事故的翻版，只是變成程式自己去覆蓋）；
  資料資料夾在安裝目錄底下也不做。
- 覆蓋用 `robocopy /E`，**刻意不加 `/MIR`**：只覆蓋與新增，不刪使用者自己放進資料夾的東西。
- 檔案：`src/main/updater.ts`（流程）、`src/main/updaterScript.ts`（純函式：附件比對
  ＋ helper `.bat` 產生器，測得到）、`src/renderer/src/windows/UpdaterWindow.tsx`、
  `tests/main/updaterScript.test.ts`（19 項）。

### 實跑一次抓到的三個坑（自動測試看不出來，全部已修）

2026-09-15 用真的 GitHub Release 跑完整流程（下載 433 MB → 解壓縮 → 覆蓋 → 重啟）才發現：

1. **GitHub 上傳附件會把檔名的空白換成點**：本機是 `DesktopST 0.5.6.exe`，
   Release 上變成 `DesktopST.0.5.6.exe`。原本的比對只認空白／底線／連字號，
   單檔 EXE 版永遠配不到附件，而畫面還顯示「這版沒有附單檔 EXE」——訊息是錯的。
2. **helper `.bat` 裡不能用管線**：它是 `spawn(detached, stdio:'ignore')` 起來的，
   stdin ＝ NUL，`tasklist | find "PID"` 會讓 `find.exe` 永遠卡在等 stdin，
   更新完全不會開始（實測 cmd 掛在那裡十幾分鐘）。等 PID 本來只是輔助，
   真正的判斷是檔案鎖，整段管線已砍掉。`pause` 同理不可用（stdin 是 NUL 會直接跳過），
   失敗原因改成寫檔。
3. **`echo` 訊息裡不能有括號**：cmd 先 parse 完整個 `if errorlevel 8 ( ... )` 區塊才執行，
   訊息裡一個 `)` 就提前關掉區塊、後面的字變成指令 → 整支腳本中止。
   症狀極難認：**檔案已經覆蓋成功，但沒重新啟動、暫存也沒清掉**，
   主控台只吐一句「copying 這個時候不應該…」。錯誤處理已改成標籤跳轉。

另外順手：更新完會刪掉下載的 zip（400 MB 起跳，不刪每次更新都留一份）。

### 驗證狀態

**已實跑驗證**（`C:\Temp\DeST-test` 放一份假的 0.5.5 安裝，對真的 v0.5.6 Release）：
下載 → 解壓縮 → 驗證 → 覆蓋 → 自動重新啟動全程成功；自己放在安裝資料夾裡的檔案沒被刪；
暫存與 `.bat` 都自清。安裝型態判斷、附件挑選、`buildUpdatePlan` 三道閘也都跑過真的路徑。

**2026-09-16 owner 的正式安裝實際跑過一次完整自動更新**（`D:\DeST_exe`，v0.5.5 → v0.5.6）：
09:45:57 建暫存 → 09:46:28 覆蓋完成 → 自動重啟，暫存自清、無失敗 log，owner 回報「跑起來正常」。
**主要路徑到此結案**；前一天的極慢是 GitHub 端暫時性問題，不是程式（見 §5 那條）。

**還沒逐一驗的**（下次更新到 v0.5.8 時順手看）：

- [x] 「檢查更新」對話框有出現「立即更新」，按了會開更新視窗（2026-09-16 實際跑過）
- [ ] 進度條的即時速率／已用時間／預估剩餘（v0.5.7 才加的，owner 那次跑的是 v0.5.6 的舊視窗）
- [ ] 更新中按「取消」／關視窗，確認不會在背景偷偷更新完
- [ ] 單檔 EXE 版跑一次（exe 檔名會維持舊的那個，因為 Windows 啟動捷徑指著它）

⚠️ v0.5.6 曾經在 2026-09-15 發布過一次又刪掉重發：第一版的附件內含上述三個 bug 的更新器。
重發時 tag 已重新指向修正後的 commit（`92032bc`），舊附件唯一的一次下載是測試造成的。

## 2.11 社群貼文連結：噗浪／Facebook／Threads（2026-09-18 owner 指定）→ ✅ **已完成，桌面與手機獨立版皆真機驗證通過**

**細節：`docs/link-reader-plan.md` §10（含待驗清單 §10.6）**

owner 原本問的是「能不能做 FB／Threads 的機器人模組」，但釐清之後真正要的是
**貼一則貼文的網址讓角色讀得到那一篇**（而且大多是不認識的人的文章）。
所以這不是新模組，是既有連結閱讀（2.9）的擴充。

**關鍵發現**：2.9 當時判定「社群站是 SPA，抓了只有空殼」——那只對**瀏覽器 UA**
成立。這些站另外有一套給連結預覽／嵌入用的靜態輸出，換個非瀏覽器 UA 就拿得到。
FB 的貼文頁對瀏覽器 UA 甚至直接回 **HTTP 400**。不需要冒充
`facebookexternalhit`，實測連 `curl/8.4.0` 都可以，所以用具名的
`DesktopSTBot/1.0 (+https://nori.tw/DeST/)`。

**四種來源拿得到的東西差很多**（實測，2026-09-18）：

| 來源 | 主文 | 回應串 |
|---|---|---|
| 噗浪 | 全文 | ✅ **整串**（`POST /Responses/get`，免登入） |
| FB 粉專／個人公開貼文 | **全文**（官方嵌入 `plugins/post.php`） | ✗ |
| FB 社團貼文 | ⚠️ **只有 ~190 字摘要**（社團不支援嵌入） | ✗ |
| Threads | 全文（`/embed`） | ✗ |

FB 社團那個摘要會標成 `sourceKind: 'social-excerpt'`，注入時明講「這只是開頭
預覽、不是全文」——**這句是防止角色把腰斬的貼文當全文討論的唯一保險**，
跟 YouTube 那句「你沒有看過這支影片」是同一個機制。

**安全性**：走的全是免登入、不帶 cookie、與使用者帳號完全無關的公開端點
（就是你貼連結到 Discord 時對方伺服器抓的那個）。**沒有任何一條路會碰到
使用者的社群帳號**，所以 owner 最初擔心的「機器人被 Ban」在這條路上不存在。

**踩到的坑（都寫進 §10.3 了）**：
- ⚠️ Threads 嵌入頁**不可以拿第一個** `TextContentContainer` ——
  貼文是回覆時母貼文排在前面，拿錯的結果是「讀一則貼文卻回傳另一個人的貼文」，
  而且 status 是 ok、長度正常，**完全看不出錯**。認 class 裡的 `Full`。
- 正文容器要配對 div 深度（`sliceBalancedDiv`），非貪婪比對會把正文腰斬一半。
- 行內標籤要整個拿掉不留空白，否則 hashtag 會跟標點分家。
- `decodeHtmlEntities` 一定要處理數值實體（這三家把中文與 emoji 寫成 `&#x4e2d;`）。

**刻意沒做**：熱門話題來源（噗浪有免登入的 `Stats/topReplurks`，Threads 要建
Meta App 走 keyword search，FB 沒有）、FB／Threads 的回應串（沒有免登入端點）、
X／IG／TikTok（沒測過，別假設同一招通用）。詳見 §10.5。

**手機端踩到一個獨立的坑，已修並真機驗證**（2026-09-18 同日）：
owner 實測回報「桌面可以，手機只有噗浪成功、FB／Threads 都失敗」。
根因是 **Capacitor 的 fetch patch 對 GET 與非 GET 走兩條完全不同的路**——
非 GET 直接進原生 plugin、headers 原樣送出；**GET 卻改寫成 proxy 網址交回
WebView 自己的 fetch，而 Android WebView 會把 `User-Agent` 拔掉**
（Chromium bug 40450316；Capacitor 有還原機制但實機上沒生效）。
只有 FB／Threads 需要非瀏覽器 UA，所以症狀正好是「噗浪成功、另外兩家失敗」，
而桌面走 Node fetch 完全沒事——**很容易誤判成手機沒吃到新程式**。
修法：`mobile/adapters/httpAdapter.ts` 的 `shouldUseNativeFetch()`，UA 等於
`SOCIAL_BOT_USER_AGENT` 時改直接呼叫原生 `CapacitorHttp.request()`。
⚠️ 刻意**不**放寬成「有 UA 就走原生」——`fetchHtmlDoc` 對每個請求都設 UA，
放寬等於把新聞與一般連結閱讀整批改道（`tests/mobile/socialUserAgentRouting.test.ts` 守）。

**第二個手機端問題：「複製連結」給的是短網址**（2026-09-18 同日，owner 實測）。
在 Threads／FB App 裡點「複製連結」拿到的是 `threads.com/share/<code>` 與
`facebook.com/share/p/<code>`，**都不是** `/@user/post/<code>` 那種正規形式——
只認正規形式的話，**使用者最常用的那條路剛好全部讀不到**。
短網址是 302 轉正規網址，但 `/embed` 與 `plugins/post.php` 都不吃短網址
（前者 404、後者回「貼文已無法取得」），所以先抓那一頁、從 `og:url` 反推正規網址
（`canonicalFromSharePage()`，那一頁本來就要抓，沒有多花請求）。
⚠️ FB 不能直接用 og:url（它給的 slug 形式嵌入端點會拒），要挖出兩個數字 id
自己組 `permalink.php`。細節見 `docs/link-reader-plan.md` §10.3。

**驗證狀態**：`npm run typecheck` 過、`npm test` 全過（社群 47 項＋路由 6 項新測試）。
桌面：抽取邏輯對四個真實網址跑過端到端。
**手機：2026-09-18 於 Pixel 10a 真機實測通過**——FB 粉專貼文角色講得出 188 字摘要
之後的內容（證明官方嵌入的全文路徑有效）、Threads 回覆貼文角色談的是目標貼文
而不是母貼文（證明 `Full` 那個修正有效）、噗浪帶回整串回應。
**兩家的「複製連結」短網址也都在手機上實測通過**（Threads `/share/…` 讀到全文、
FB `/share/p/…` 讀到全文）。
只剩 FB 社團（摘要那條）沒在手機上試過，清單在 `docs/link-reader-plan.md` §10.6。

## 3. 排程中／延後

- [x] **B3 階段 7：正式 APK／散布** → ✅ **已完成**（2026-08-25）。owner 已
      產生 keystore（`android/keystore.properties`）並打出正式簽章 APK，
      DeST 與飲食記錄兩支 App 都已換裝正式簽章版實際使用中
- [ ] 角色印象（B8）
- [ ] 系統通知（B5）
- [x] 飲食記錄 App：Health 讀（B9-Health-lite）→ ✅ **已完成，真機驗證通過**
      （2026-08-19）。`docs/nutrition-health-lite-kickoff.md` §7／§8／§11。
      真機測出並修掉 3 個 bug：`minSdkVersion` 24→26、外掛 `limit` 太小抓到
      最舊體重紀錄、公斤數小數位過長
- [x] 飲食熱量模組 B9b／LLM 拍照估價 → **已大致完成，owner 決定先實際使用，
      等用出問題再回頭調**。細節見 `docs/nutrition-photo-estimate-plan.md`
      §6.5 實作對照表（`core/` 幾乎全做完，缺口多半是「UI 沒呼叫端」，已補齊）；
      落地筆記見 `docs/progress-log.md` 該系列條目（估算中動態／語音輸入補充
      說明／費用提示行／今日列表份量顯示）。
- [ ] 飲食熱量模組其餘分期 → `docs/future-nutrition-module.md` §6。
      桌面小工具已完成（見下方）；**本機報表頁（熱量統計頁）其實也已完成**
      （2026-08-20，見該文件 §6.1，這裡先前漏更新）。**只剩 B9c**：
      Health 寫營養、接 S2 同步（N3）、角色偏好注入（可選）。
      2026-08-23 owner 確認本機報表頁不用再動。
      **同日 owner 對 B9c 三項逐一定調，動工前先讀
      `docs/future-nutrition-module.md` §6.2**（優先度跟原規劃不一樣）：
      ① **Health 寫營養** → ✅ **已實作**（2026-08-25）。owner 決定「只補寫
      歷史（一次性）」＋「先只寫熱量」（外掛限制，寫不了蛋白質／脂肪／碳水）。
      落地筆記見 `docs/progress-log.md` 該日條目；`npm run typecheck`／
      `npm test`（81 檔、1063 項）皆過。**2026-09-13 owner 回報「用很久了」→ 實際使用驗證通過，結案**。
      ② **接 S2（N3）owner 傾向降級**，因為「用到現在從來沒開過
      桌面版」，甚至提到桌面版或許可以擱置封存——⚠️ **這是傾向不是決議**
      （用詞是「或許」「可考慮」），封存牽動既有程式無人維護＋飲食資料
      只存在手機且無雲端備份，要先確認強度再動。③ **角色偏好注入方向
      具體化成「話題」**（例：「昨天的壽司怎樣」「那間店好吃嗎」「你連吃
      好幾天一樣東西不膩嗎」），但 owner 說「怎麼做成 Prompt 要想想」，
      **還沒到能開工的程度**，要先做一輪 prompt 設計；界線不變：
      角色拿事實與偏好，**不拿熱量數字**
- [x] Android 桌面小工具（DeST 主 App）→ ✅ **已實作，自動測試通過（`npm run
      typecheck`／`npm test` 999 項全過），**真機驗證通過、已結案**（2026-08-23，owner 手機實測數輪正常；之後有問題再回頭調）。
      `docs/mobile-android-widget-plan.md` 整份＋§11 落地筆記。JS 端：
      `core/character/widgetSnapshot.ts`（純邏輯）、`mobile/runtime/widgetPins.ts`
      （釘選存取）、`mobile/runtime/widgetBridge.ts`（Bridge，`getData()` 版與
      `session.ts` 直用版兩種入口，見落地筆記）、`DataSource.widgetLatestMessages`
      新方法（`LocalDataSource` 委派 `session`；`RemoteDataSource` 打
      `GET /api/widget/latest-messages/:id`，`mobileServer.ts` 新端點）、
      `MessageMenu.tsx`「釘選到小工具」、`CharacterEditor.tsx`「小工具設定」
      區塊、`App.tsx` 深連結導覽、`MessageList.tsx` 捲到指定訊息（手動
      `scrollTop`，未用 `scrollIntoView()`）。原生：
      `android/app/src/main/java/tw/nori/dest/widget/`
      兩支 Kotlin（`DeSTWidgetProvider`／`DeSTWidgetBridgePlugin`）＋版面／
      manifest／build.gradle（比照飲食小工具補上 Kotlin 工具鏈）。
      **owner 第一次裝機回報六項，已全部處理**（同日，見計畫書 §12）：
      打包失敗（Kotlin 註解會巢狀，`/*` 寫在 KDoc 裡就編不過）、拉高到兩格
      顯示「無法載入小工具」（RemoteViews 不認得裸的 `<View>`，分隔線改
      `FrameLayout`）、**小工具改成不綁角色、跟著目前對話走**（三項回饋
      同一個成因，連帶拿掉 `DataSource.widgetLatestMessages()`／
      `/api/widget/latest-messages` 端點／ConfigureActivity）、新增 App 內
      「桌面小工具」設定頁（預覽＋管理釘選＋頭像開關）、釘選改用
      `ui/stores/widgetStore.ts` 當單一真相並加圖釘標示、表情選單補
      「使用預設圖片」。**owner 同日再追加一項**（計畫書 §13）：兩則對白是
      不同角色時各自顯示頭像與名字（推翻原 §5.2「頭像只有一張」的簡化，
      新增第三份版面 `widget_dest_character_2line_multi.xml`，頭像檔案
      拆成 `image1/2.png`）。**第三輪追加**（計畫書 §14）：自動顯示的那幾則
      改成「新的在下面」跟對話記錄一致（連帶讓 `limit` 不再是截斷關係，
      矮版要另算 `singleLine`）、小工具可選 DeST 的 12 組配色＋底色透明度
      0–100% 拉桿（色表搬到 `src/shared/colorThemes.ts` 當唯一真相，
      換算在 `src/shared/widgetAppearance.ts`）、**飲食記錄 App 的小工具
      也一併支援且與 DeST 各自獨立**。全部改完後 typecheck／test
      （80 檔 1035 項）／兩支 APK 的 `gradlew assembleDebug` 皆過。
      **第四輪追加**（計畫書 §15）：飲食小工具的按鈕／進度條沒跟著配色
      （成因與 §14.3 同一條 RemoteViews 限制，上一輪只修了容器；改成把
      「圓底＋圖示」整顆畫成 bitmap、進度條換 ImageView 自繪）、
      **飲食 App 本身也接上 12 組配色**（`styles.css` 全面改用 CSS 變數
      ＋新增 `nutrition/mobile/src/theme.ts`）。至此四個配色設定彼此獨立：
      DeST App／DeST 小工具／飲食 App／飲食小工具。全部改完後 typecheck／
      test（80 檔 1040 項）／兩支 APK 皆過。**第五輪追加**（計畫書 §16）：
      設定頁預覽的顏色／透明度全錯（`resolveWidgetColors()` 回 Android 的
      `#AARRGGBB`，CSS 八碼卻是 `#RRGGBBAA`，alpha 位置相反且兩者都合法
      所以安靜壞掉；新增 `toCssColor()`／`widgetColorsToCss()`）＋設定頁
      重排（配色／透明度／頭像開關全部搬到預覽正下方）。全部改完後
      typecheck／test（80 檔 1044 項）／兩支 APK 皆過。**第六輪追加**
      （計畫書 §17）：頭像的底色圓也要跟著配色——第三個踩到同一條
      RemoteViews 限制的地方，去背角色圖會露出寫死的綠圓；改用
      `BitmapShader` 把底色畫進 bitmap（**不能用原本的 `SRC_IN`，
      那會把底色一起挖掉**）。全部改完後 typecheck／test（80 檔 1044 項）／
      兩支 APK 皆過。**2026-08-23 owner 手機實測數輪正常，結案**（六輪修正的待驗清單不再逐條追），清單見計畫書
      §12.7 ＋ §13.5 ＋ §14.4 ＋ §15.4 ＋ §16.3 ＋ §17.1。
- [x] **手機版對話記錄換表情＋手動指定表情＋手機新增表情圖片** → ✅ **已實作，
      三輪修正後 owner 第四次實機驗證通過**（2026-08-23）：跨裝置同步後
      表情正常顯示。
      `docs/mobile-character-expression-plan.md`（整份＋§9 落地筆記，尤其
      §9.1／§9.2）。
      第一輪：聊天泡泡換圖、訊息選單「換表情」、角色編輯器「顯示設定」（框選
      臉部範圍＋新增表情圖片）都做出來了，owner 一次實機測出 5 個問題，4 個
      週邊問題（沒有框選預覽、表情圖數量統計錯誤、點頭像沒放大預覽、獨立版
      完全沒有情緒標籤）已修，唯獨核心的「AI 選的表情顯示不出來」沒解決。
      第二輪（§9.1）抓到 `resolveDisplayImagePath()` 沒有反查
      `buildEmotionContract()` 送給模型的自訂 id／檔名主幹，只查 canonical
      的 28 個情緒 key——只要角色卡有表情圖，合約 id 幾乎不可能等於 canonical
      key，這不是邊角案例，是主線路徑必然踩到的。補了 `buildSpriteIdMap()`
      反查，同一台裝置上確實修好了（owner 三次測試證實遙控版新發的訊息
      表情正常）。
      第三輪（§9.2）才是真正的架構級成因：**訊息透過 S2 對話同步換一台裝置
      看，會用那台裝置自己的 `emotions`／`spriteIds` 反查**，但自訂 id／
      檔名主幹是裝置本地產生的（各裝置存檔案的時間戳不同），跨裝置反查
      當然對不上。修法是**訊息落地前就換算成 canonical key**（不受裝置差異
      影響），新函式 `canonicalizeEmotionId()` 接進 `chatWithLLM()`／
      `classifyEmotionWithLLM()`——這是唯一兩個會產生 `message.emotion` 的
      入口，桌面／獨立版／遙控版全部共用。補了 4 條新測試。
      **這次修正之前已經生成的舊訊息不會自動修好**（`emotion` 欄位還是舊的
      裝置本地 id），跨裝置看仍會退回主圖，需要手動「換表情」補一次；
      之後新產生的訊息不受影響。
      `EMOTION_OPTIONS` 已搬到 `core/character/emotionCatalog.ts`，桌面
      `emotionUtils.ts` 改 re-export。`b3-mobile-ui-plan.md` §3.1／§5.1 的舊
      決議已被 owner 2026-08-22 推翻，見計畫書開頭說明。
- [x] 飲食記錄 App 的桌面小工具（B9b 一部分）→ ✅ **已實作，自動測試通過，
      **真機驗證通過、正常使用中**（2026-08-21 實作／2026-08-23 結案）。`docs/nutrition-widget-plan.md` §9 七步全做完；
      APK 在 Pixel 10a 上裝機驗證：App 啟動正常、三個深連結
      （`tw.nori.destnutrition://widget/{daily,photo,quick-entry}`）都正確導覽
      （拍照連結會自動開系統相機、取消後正確落回拍照記錄頁；快速入帳連結直接開
      入帳面板）、小工具的重新整理 broadcast 在沒有任何小工具實例時不會 crash。
      **沒驗到的**：實際把小工具拖進主畫面看三種尺寸排版（owner 的主畫面被
      KWGT 風格的自訂桌面塞滿，找不到空白處長按喚出小工具選單，怕誤觸動到
      既有排版沒硬點下去）——這步留給 owner 自己在方便的時候用「新增小工具」
      選單放一個上去看看。專案原本沒有 Kotlin 原生層（純 Java），這次新增：
      `android/build.gradle` 與 `app/build.gradle` 加了 Kotlin
      Gradle plugin（對齊 `@capgo/capacitor-health` 已在用的 2.4.10，混用不同版本
      會炸「compiled with an incompatible version of Kotlin」，`capacitor-filesystem`／
      `capacitor-camera` 讀的是 `kotlin_version`(底線) 這個 property，不是隨便取的
      `kotlinVersion`(駝峰) 名字，兩個都要設）。點擊行為沒有走另開一支 Bridge
      Activity，而是比照 `@capacitor/app` 標準模式：小工具的相機／鉛筆／其餘區域
      三顆都是帶自訂 scheme 深連結（沿用 Capacitor 產生的 `custom_url_scheme`
      字串資源）的 `ACTION_VIEW` PendingIntent 打進 MainActivity，JS 端用
      `getLaunchUrl()`／`appUrlOpen` 收下；小工具存檔／App 離開前景的更新
      觸發則反過來——JS 沒辦法直接發 Android broadcast，所以另外寫了一支最小
      Capacitor 外掛 `NutritionWidgetBridgePlugin`（`refresh()` 方法呼叫
      `NutritionWidgetProvider.updateAll()`），這是計畫書原本檔案結構沒列出來
      但必要的補充。
- [x] **CWA 地震／颱風即時查詢搬到手機獨立版** → ✅ **已實作，自動測試
      通過，真機驗證通過**（2026-08-22 實作／2026-08-23 owner 手機實測正常結案）。三種查詢（地震／颱風／天氣預報）
      全部搬進 `core/weather/realtimeQuery.ts`（原本只有地震／颱風排進
      排程，開工前重新確認後 owner 決定連天氣預報關鍵詞也一併搬，理由是
      手機背景 `[Weather]` 涵蓋的是「每次聊天都帶」，跟「使用者主動問明天
      天氣」語意不完全一樣）；`detectQueryType`／`fetchCwaData` 都改吃
      `deps: WeatherDeps`，桌面 `main/cwaService.ts`／`weatherService.ts`
      改成薄殼呼叫 core，手機 `mobile/runtime/chat.ts` 的
      `sendStandaloneMessage` 送出使用者訊息前跑一次偵測，命中就注入
      `[即時查詢：...]`，跟既有 `[Weather]`／`[Glossary]` 合併進
      `extraSystemContext`。CWA API Key 依 owner 決定走「跟桌面同步」而非
      手機自己填一把——但**沒有**把金鑰塞進 S2 M5 的比對子集（那條規矩
      `settingsSnapshot.ts` 明文禁止金鑰入子集），金鑰本身走既有的 S1
      一次性匯入（區網直連才附值）；M5 只新增了兩個非機密欄位
      `realtimeQueryEnabled`／`realtimeQueryForecastCounty` 進比對。另外
      補上手機自己編輯這組設定的管道（原本的 `WeatherSettingsSnapshot`
      明文排除 CWA Key，這次比照 `LlmSettingsSnapshot.hasApiKey` 的模式
      新增只寫不讀的 `setCwaApiKey`／`hasCwaApiKey`），手機天氣設定頁
      新增「即時氣象查詢」區塊（開關／API Key 輸入＋測試連線／預設縣市），
      拿掉舊的「地震與颱風查詢仍只在電腦版」提示文字。新增
      `tests/weather/realtimeQuery.test.ts`（17 項）。
      `npm run typecheck`／`npm test`（76 檔、974 項）／`npm run
      build:mobile`／`npm run build` 全過。**真機驗證通過**（owner 確認，
      2026-08-22）。
- [x] **對話新聞搜尋搬到手機獨立版** → ✅ **已實作，自動測試通過，尚未
      真機驗證**（2026-08-22）。整支邏輯搬進 `core/news/conversationSearch.ts`
      （逐字保留：觸發詞前置過濾 → 輔助模型判斷要不要搜／萃取查詢詞 →
      Google News RSS → 組注入字串），只換掉兩處平台耦合：`rss-parser`
      換成注入的 `RssParseAdapter`（手機沿用個人新聞報已驗證過的
      `mobile/adapters/rssParseAdapter.ts` 原生 `DOMParser`），LLM 呼叫
      換成 core 的 `chatWithLLM`／`applyUtilitySettings`。桌面
      `main/modules/news/conversationSearch.ts` 改薄殼，`ipcHandlers.ts`
      呼叫端與 `disasterNewsSupplement.ts` 用到的
      `searchGoogleNewsRss`／`buildConversationSearchInjection` 都維持能用，
      不用改。手機 `mobile/runtime/chat.ts` 的 `sendStandaloneMessage`
      送出使用者訊息前跑一次，命中就把 `[Conversation search: ...]` 併進
      `extraSystemContext`，debug prompt／token 數存回 `userMsg`／
      `charMsg`（`MessagePromptView.tsx` 本來就有「對話搜尋」這個分頁，
      直接生效）。開關新增到 `NewsEditableSettings.conversationSearch`，
      手機設定頁 `NewsSettingsView.tsx` 新增一個 Section，後續 owner 要求
      連觸發詞清單（加／刪標籤）與查詢時效（`maxAgeHours` 數字框，0＝不限制）
      也一併開放手機編輯，不再是桌面專屬進階項。**修了一個順手發現的
      坑**：`NewsModuleSettings.conversationSearch` 是巢狀物件、
      `saveNewsModuleSettings` 對它是整包取代不是逐欄合併，手機若只送
      部分欄位會把桌面設定的其他欄位一起重置成預設值——
      `mobileRoutes.ts`／`session.ts` 的存檔路徑改成先讀現況、沒送到的
      欄位帶著走。新增 `tests/news/conversationSearch.test.ts`（14 項）。
      `npm run typecheck`／`npm test`（77 檔、988 項）全過。**真機驗證通過**
      （2026-08-22，Pixel 10a，owner 實測開關、觸發詞編輯、對話觸發搜尋皆正常）。
      owner 觀察：查詢詞萃取／要不要搜的判斷是輔助模型（或無輔助模型時的主模型）
      做的一次分類任務，準確度跟模型能力有關——弱模型可能誤判「這是不是在問
      時事」或抽不出好查詢詞，屬於已知限制，不是這次改動的 bug；沒有另外調整
      prompt 或加驗證層，維持跟桌面同一份邏輯。

---

## 4. 獨立版尚未實作（會誠實擲 `not-supported`，不是 bug）

- [ ] Spotify 授權（目前桌面限定）
- [ ] 日曆授權（目前桌面限定）

> 天氣的地震／颱風／預報關鍵詞查詢原本列在這裡，2026-08-21 owner 排入排程，
> 移到 §3「排程中／延後」，2026-08-22 已實作完成，2026-08-23 真機驗證通過結案。

缺口總表：`docs/mobile-standalone-gap-inventory.md`（不長，可整份讀）

---

## 5. 明確不做（不要重提）

**架構類**（roadmap §2／§8 已否決）：雲端同步後端、React Native 重寫、
手機重寫一份 prompt 邏輯、NAS 當 DeST host、付費模式、Relay 代排程、
RTC 半夜喚醒、把 HTML 打包進遙控 APK、Spotify 自動選歌。

**功能類**：第一版排除自動發話、TTS、Live2D、ST 對話記錄匯入。
手機不做背景定時抓新聞、新聞搬家包（桌面獨有，刻意不搬）。
獨立模式的遙控電腦（`remoteControl.*`）**永久不支援**——沒有電腦可控，設計如此。

> 對話新聞搜尋原本也列在「刻意不搬」，2026-08-21 owner 重新評估後排入
> §3「排程中／延後」，改成要做；2026-08-22 已做完（見 §3 該條）。

---

## 6. 給 AI 的收尾規則

完成任何一項時：

1. 把這裡對應的 `- [ ]` 改成 `- [x]`（**不要刪行**）
2. 如果那項有對應的設計文件章節，去那邊補落地筆記
3. `docs/progress-log.md` 追加一筆
4. 收工前 `npm run typecheck` **與** `npm test` 都要跑，**兩個都過才算完成**
   > `tests/prompt/promptUtils.test.ts` 有 2 個時區 snapshot 在部分機器上本來就會失敗，
   > 那 2 個不算。
   >
   > ⚠️ **`npm test` 綠不等於 `typecheck` 綠**——vitest 不做型別檢查，而
   > `tsconfig.node.json` 有含 `tests/`。2026-08-15 就有一份測試是帶著 5 個
   > TS2740 被 commit 進來的，測試全綠所以沒人發現。兩個指令要分開跑、分開看。
