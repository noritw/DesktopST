# DesktopST 待辦總表

> **這是待辦的唯一入口。** 以前散在 `CLAUDE.md` §4、`docs/handoff/README.md` §3、
> 各設計文件的「待驗」章節裡，要翻好幾份才知道還剩什麼——現在都收在這裡。
>
> 規則：**只有這份會被當成「還沒做的事」的真相來源**。各設計文件裡的「待驗」章節
> 仍然保留（那裡有完整的來龍去脈），但那些是**細節**，這裡是**索引與狀態**。
> 做完一項就把 `- [ ]` 改成 `- [x]`，不要刪掉——刪掉就看不出做過了。
>
> 最後更新：2026-08-23

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
- [x] 新聞泡泡：owner 真機測出 3 個小 bug，**已修正，自動測試（typecheck／810 項 test）通過，
      尚未真機覆驗**
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

### 2.3 提醒要不要同步 → 方向已決定，**開工指令已寫好，尚未實作**（2026-08-17；開工指令 2026-08-22）

owner 決定：提醒資料本身要同步（整份清單，比照角色／情境走逐項比對），
但**「哪台裝置響」跟裝置本地的細節設定（例如螢幕關閉時要不要響）留在各自
裝置、不同步**。

這是一個新的同步類別（現有 M4 比對範圍只有角色／人設／世界觀／Lorebook／
情境，沒有提醒）。**開工指令已寫成 `docs/reminder-sync-kickoff.md`**（整份，
照著做就能開工）：核心難點不是「多加一個 kind」，而是提醒物件裡
`notificationDevice`／`wakeMode`／`inactiveBehavior` 這幾個欄位是裝置本地
設定，同步時不能整包覆蓋，要比照 `syncApply.ts` 情境案例的「座標是電腦專屬，
推送時保留接收端原值」做法。

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

## 2.6 QR 配對入口／出口合併（2026-08-24 owner 指定方向，尚未動工）

owner 換裝正式簽章 APK 後要匯回資料，連續撞到三件事：從「關於→切換模式」掃 QR
被擋（不支援中繼）→ 關掉電腦端中繼再掃 → Server Error → 改從「從電腦匯入」掃
成功但拿不到 API Key。owner 原話：「這連我都搞不清楚差別了，別人更會弄錯，應該要修。」

**開工指令已寫成 [`docs/qr-entry-merge-plan.md`](docs/qr-entry-merge-plan.md)**（整份可讀）。
內含三個已查證的缺陷、owner 指定的方向、建議設計、分兩階段的實作步驟，
以及 **4 個必須先問 owner 的開放問題**（動工前先問，別自己假設）。

- [ ] **階段一：修硬缺陷**（風險低，做完 owner 就能完成卡住的匯入）
  - [ ] `QRCodeWindow.tsx:20` 的 `pickUrl()` 短路 bug——`s.relayUrl` 永遠是非空字串
        （`relayService.getRelayUrl()` 無條件組網址），導致 `||` 後面兩條路永遠走不到，
        **關掉中繼後 QR 仍指向中繼 → 503 → Server Error**（已實測驗證）
  - [ ] 查清「自動升級區網」為什麼沒生效——機制本來就有（`upgradeToLan()`／
        `resolveLiveRemote()`），但 owner 實測顯示「這條連線不會傳輸 API Key」，
        代表升級回了 null。已排除：同網段（實測）、電腦端回應正確（實測）、
        位址格式正確。**尚未查清**，可能是 AP isolation／CapacitorHttp 行為／
        `catch` 把錯誤吃掉沒日誌。⚠️ 這條的結論會決定階段二能不能依賴自動升級
- [ ] **階段二：合併入口／出口**（UI 改動）
  - [ ] 電腦端 QR **入口從「擴充」搬到「關於」**（owner 2026-08-24 指定），
        「要不要開放遙控」的設定一併整併過去，並改成「先問用途 → 出對應 QR」
  - [ ] 手機端「從電腦匯入」與「切換模式」合併成單一「連接電腦」流程
  - [ ] 走錯入口時要指路＋可直接跳過去，不要只報錯
  - [ ] 主要流程文案不出現「中繼」「區網」
- [ ] **APK 遙控補上中繼支援**（§2.4，owner 質疑後查證補的一節）——
      ⚠️ **「遙控不支援中繼」只對 APK 成立，網頁版一直都能用**（owner 在外面
      用的就是網頁版）。成因：WebSocket 位址靠中繼 Worker 注入 `__tunnelWsUrl`，
      APK 頁面是本地載入的拿不到，落到字串代換 → 錯的路由。修法預估是小改
      （`/api/connection-info` 加欄位回傳電腦的 tunnel 網址 + `wsUrlFor()` 加分支），
      **不需要做 WebSocket 經中繼代理**。順帶要修 `ModeSwitcher.tsx:261` 那句
      會誤導的訊息

---

## 3. 排程中／延後

- [ ] **B3 階段 7：正式 APK／散布**——**repo 端自動化已就緒**（2026-08-23），
      卡點只剩 owner 自己產生 keystore 這一步（AI 不會、也不該代勞，見
      `docs/pre-b3-work-assessment.md` §9）。放好 `android/keystore.properties`
      後 `npm run apk:release` 就能出正式簽章 APK；之前用 `npm run build:apk`
      裝過的 debug 版**升級不了**（簽章不同），第一次發正式版時使用者要先
      解除安裝（會清資料，記得先在發布頁提醒），之後才能正常覆蓋更新
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
      ① **Health 寫營養拉到第一順位**——owner 改用本 App 後就不再往 Health
      記營養，那邊已缺好幾天資料；⚠️ 要不要**補寫歷史區間**必須先問，
      別自己假設。② **接 S2（N3）owner 傾向降級**，因為「用到現在從來沒開過
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
