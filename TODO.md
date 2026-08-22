# DesktopST 待辦總表

> **這是待辦的唯一入口。** 以前散在 `CLAUDE.md` §4、`docs/handoff/README.md` §3、
> 各設計文件的「待驗」章節裡，要翻好幾份才知道還剩什麼——現在都收在這裡。
>
> 規則：**只有這份會被當成「還沒做的事」的真相來源**。各設計文件裡的「待驗」章節
> 仍然保留（那裡有完整的來龍去脈），但那些是**細節**，這裡是**索引與狀態**。
> 做完一項就把 `- [ ]` 改成 `- [x]`，不要刪掉——刪掉就看不出做過了。
>
> 最後更新：2026-08-17

---

## 0. 現在的第一順位（2026-08-17 owner 插隊）

- [ ] **飲食熱量模組 B9a MVP**——owner 自用優先，插隊到其餘 S2 待辦（§2.3 提醒同步等）
      之前。**尚未開工。** 開工指令：`docs/nutrition-module-kickoff.md`（整份，
      照著做就能開工，不必先讀長文）。規格定案在 `docs/future-nutrition-module.md`。

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
- [x] **B-2** 「保留差異」快捷鍵沒把各列切到「不動」——**已修正，自動測試通過，尚未真機驗證**
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
- [ ] M4 第 6 條補驗：實際打開電腦端 `scenes/*.json` 看 `activePersonaId`
      與 `desktopCharacters` 座標

> ⚠️ 清單第 7 條（刪除）**指的是資料分頁，不是對話分頁**。原本寫得不清楚，
> owner 測試時誤以為在講對話。**對話分頁本來就刻意沒有刪除語意**
> （`core/sync/convPair.ts` 檔頭），不是漏做——那是 B-1 的新需求。

### 1.2 本機 LLM 供應商：兩處未驗

程式完成（2026-08-15），core 路徑端到端驗過。

- [x] 手機真機驗證 → **通過**（2026-08-17，owner 用了幾天）。除了 owner 自己
      電腦規格導致回應速度慢之外沒有遇到問題；`httpAdapter` 30 秒天花板修正
      也沒有波及其他手機請求
- [ ] 桌面設定視窗實點（要跑得起來的 Electron）→ `docs/local-llm-provider-plan.md` §9.4
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

owner 決定：要。**已實作，自動測試（typecheck／819 項 test）通過，尚未真機驗證**。
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

### 2.3 提醒要不要同步 → 方向已決定，**尚未實作**（2026-08-17）

owner 決定：提醒資料本身要同步（整份清單，比照角色／情境走逐項比對），
但**「哪台裝置響」跟裝置本地的細節設定（例如螢幕關閉時要不要響）留在各自
裝置、不同步**。

這是一個新的同步類別（現有 M4 比對範圍只有角色／人設／世界觀／Lorebook／
情境，沒有提醒），工程量接近對話同步那次：要走逐項比對＋新增/刪除語意，
還要避免「兩台同時響」的 bug（沿用既有的 `notificationDevice` 欄位當本地
設定，不進同步子集）。列進下一步要做的，還沒動工。

### 2.5 資安／免責警語（2026-08-22 owner 決定：以警語為主，不做額外機制）

背景：討論桌面版＋飲食記錄模組的資安風險時發現兩點需要提醒使用者，owner
決定用警語處理，不做 token 輪替／撤銷、白名單、自動備份等額外工程：

- [ ] **配對／開啟手機同步時加警語**：說明 QR code／配對碼等同能連進這台電腦
      資料的憑證，請勿外流截圖或分享；並提醒 `mobile.useTunnel` 預設開啟，
      一開啟手機同步就會透過 `relay.nori.tw` 讓資料可從網際網路連入（有
      token 保護），只想區網使用要自己去關閉「使用中繼」選項。文案放在
      桌面設定視窗的手機配對區塊、以及手機端第一次顯示配對碼的畫面
- [ ] **資料無雲端備份的免責警語**：說明本機／手機本地資料沒有任何雲端副本，
      硬碟損毀、解除安裝清除資料、手機遺失或恢復原廠設定都會造成資料
      永久遺失；使用者需自行用既有的角色卡／設定包匯出功能定期備份；
      這是免費使用、資料不上雲換來的代價，作者不對資料遺失負責。文案
      建議放在：①設定視窗顯眼處（例如「資料」分頁）②首次啟動的
      onboarding ③解除安裝前如果有確認對話框，順便帶一句
- 兩則文案可以合併成同一份「免責聲明」在 onboarding 或設定頁一次呈現，
  不必分開做兩個彈窗——實作時再決定 UI 位置，這裡先只定範圍

### 2.4 S2 其他未決（沿用 `mobile-mode-switch-sync.md` §9，暫時不動）

- ~~刪除要不要同步 —— 這版一律不推，等實際用一陣子再決定~~
  → **2026-08-16 真機測試後 owner 決定要做**（整則對話刪不掉、同步後被補回來很困擾）。
  已移到 §1.1b B-1，分兩階段。**資料分頁的刪除本來就有且已驗證過**，
  這裡講的一直是**對話分頁**
- 多支手機 —— 理論上可行、未驗證，也不是你的情境
- 欄位級衝突合併 —— 不做，標為衝突讓使用者選
- 自動同步（S3）—— roadmap 已暫緩

---

## 3. 排程中／延後

- [ ] **B3 階段 7：正式 APK ／散布**（需要簽章金鑰）——S2 驗完後的下一站
- [ ] 角色印象（B8）
- [ ] 系統通知（B5）
- [x] 飲食記錄 App：Health 讀（B9-Health-lite）→ ✅ **已完成，真機驗證通過**
      （2026-08-19）。`docs/nutrition-health-lite-kickoff.md` §7／§8／§11。
      真機測出並修掉 3 個 bug：`minSdkVersion` 24→26、外掛 `limit` 太小抓到
      最舊體重紀錄、公斤數小數位過長
- [ ] 飲食熱量模組其餘分期（B9b：新食物拍照／標示 LLM、桌面小工具、本機
      報表頁；B9c：Health 寫、接 S2、角色偏好注入）→
      `docs/future-nutrition-module.md`。**B9b 內部順序**：LLM 拍照估價
      先做（入帳流程唯一剩下的手動摩擦點，且是 Widget「快速入帳」流程的
      前置依賴），桌面小工具其次（原生 Kotlin，這個專案原生層踩坑史長，
      且入帳前門最好等 LLM 那條路徑定案再蓋），本機報表頁最後（純唯讀，
      隨時能補）
- [ ] Android 桌面小工具（DeST 主 App）→ `docs/mobile-android-widget-plan.md`，尚未動工
- [x] 飲食記錄 App 的桌面小工具（B9b 一部分）→ ✅ **已實作，自動測試通過，
      真機驗證部分通過**（2026-08-21）。`docs/nutrition-widget-plan.md` §9 七步全做完；
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
- [ ] **CWA 地震／颱風即時查詢搬到手機獨立版**（2026-08-21 owner 排入，
      owner 自己要用）。原本標在 §4「獨立版尚未實作」，評估後技術上不難：
      `main/cwaService.ts` 的 `detectQueryType`／`fetchEarthquake`／
      `fetchTyphoon` 完全不碰 Electron API，只靠注入的 `HttpAdapter` 打
      CWA REST、純解析組字串，跟已經兩邊共用的 `core/weather/cwa.ts`
      背景天氣是同一個模式。要做的事：把這幾支移進 `core/weather/`（或原地
      留著讓手機 import），手機 `chat.ts` 送出使用者訊息前跑一次關鍵詞偵測，
      命中就打 CWA、注入 `[即時查詢：...]`——手機聊天管線已經有
      `[Weather]`／`[Glossary]` 注入的先例可以照抄。預估半天～一天
- [ ] **對話新聞搜尋搬到手機獨立版**（2026-08-21 owner 排入，owner 自己要
      用）。原本在 §5「明確不做」，重新評估後改排入。`main/modules/news/
      conversationSearch.ts`（關鍵詞前置過濾 → LLM 判斷要不要搜 → 打
      Google News RSS → 注入 prompt）本身也是平台無關邏輯，唯一的坑是用了
      `rss-parser`（Node 專用）——這個坑手機版**已經踩過也解過**：個人新聞報
      搬過去時就是同一個問題，換成瀏覽器原生 `DOMParser`
      （`mobile/adapters/rssParseAdapter.ts`，真機驗證過解析正確），
      這次直接複用即可。LLM 呼叫手機聊天本來就有自己的 client，不是問題。
      預估一到兩天（比地震颱風多一層關鍵詞＋LLM 意圖判斷）

---

## 4. 獨立版尚未實作（會誠實擲 `not-supported`，不是 bug）

- [ ] Spotify 授權（目前桌面限定）
- [ ] 日曆授權（目前桌面限定）

> 天氣的地震／颱風關鍵詞查詢原本列在這裡，2026-08-21 owner 排入排程，
> 移到 §3「排程中／延後」。

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
> §3「排程中／延後」，改成要做。

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
