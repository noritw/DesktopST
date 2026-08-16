# DesktopST 待辦總表

> **這是待辦的唯一入口。** 以前散在 `CLAUDE.md` §4、`docs/handoff/README.md` §3、
> 各設計文件的「待驗」章節裡，要翻好幾份才知道還剩什麼——現在都收在這裡。
>
> 規則：**只有這份會被當成「還沒做的事」的真相來源**。各設計文件裡的「待驗」章節
> 仍然保留（那裡有完整的來龍去脈），但那些是**細節**，這裡是**索引與狀態**。
> 做完一項就把 `- [ ]` 改成 `- [x]`，不要刪掉——刪掉就看不出做過了。
>
> 最後更新：2026-08-16

---

## 1. 現在該做的

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

程式完成（2026-08-15），core 路徑端到端驗過，但這兩處沒驗：

- [ ] 桌面設定視窗實點（要跑得起來的 Electron）→ `docs/local-llm-provider-plan.md` §9.4
- [ ] 手機真機驗證，**特別看 30 秒逾時改動的副作用** → 同上 §9.2 第 2 點

> 第二條的範圍比看起來大：那個 `httpAdapter` 的 30 秒天花板修正**影響所有手機請求**，
> 不只本機模型。不是只測 Ollama 通不通就好。

### 1.3 v0.4.0 真機煙測

v0.4.0（2026-08-07 已發佈）這三塊改動比較大，發佈後沒在真機上逐項覆核過。
細節見 `docs/release-notes-0.4.0-draft.md`。

- [ ] 配色主題：12 組都能選、套用後即時生效；重點測**新增的三組**（森林／復古／賽博，
      賽博要確認是深色霓虹感但不刺眼）；「純白」「黑白灰」要是**無彩度**（不帶綠調）；
      手機上換主題後，桌面端要跟著變（配色與電腦同步，寫回電腦那一半）
- [ ] 新聞泡泡：個人新聞報「聊這個」之後，標題不會自動塞進輸入框，而是變成
      **輸入框上方的浮動泡泡**；點泡泡能看到摘要；泡泡在的狀態下可以直接送出
      （不打字）也可以先打幾句再送出
- [ ] 遙控：手機遙控畫面（準心、滾動提示、手勢說明）操作起來跟實機對齊，
      不是舊版 `mobile.html` 那套

---

## 2. 等你決定的（不是技術問題，是產品決定）

### 2.1 `llm.utility*` 要不要進設定同步 ← 建議優先決定

輔助模型設定（`utilityEnabled` / `utilityProvider` / `utilityModels`）**沒有在同步範圍內**。

- [ ] 決定要不要補

這一項跟 `weather.polish` 那次是**一模一樣的形狀**：手機 UI 已經做好了
（commit `ddd6ace`）、使用者兩邊都調得到、語意完全一致，就是沒被列進比對子集，
所以永遠不會同步，而且**不會有任何錯誤訊息**。而且它跟已經在同步的 `endpoints`
是同一張表的兩半，只同步一半特別容易讓人困惑。

是單值欄位，塞得進 M5 現有架構，補起來不難。

### 2.2 其餘模組子設定的同步範圍

完整盤點在 **[`docs/handoff/module-settings-audit.md`](docs/handoff/module-settings-audit.md)**，
標成「要 owner 決定」的有這幾組：

- [ ] 新聞的 `keywordGroups` / `sources`（清單型，可能要走 M4 逐項比對而不是 M5 三選一）
- [ ] 新聞的 `blacklist` / `excluded*` / `reducedSources`（聯集型，該走「合併／不動」）
- [ ] 新聞的 `readerKeywordGroupIds`（存的是 id，要先解決關鍵字組怎麼配對）
- [ ] 天氣的 `realtimeQuery.enabled`（功能桌面限定，同步過去手機沒有對應）
- [ ] 日曆的 `lookaheadHours` / `maxEvents` / `mentionWhenEmpty`（同上）
- [ ] `llm.temperature`、`ui.chatFontSize`（純偏好，但手機合適值可能本來就不同）
- [ ] Spotify／日曆的 `enabled` **現在就在同步範圍內**，但授權桌面限定——要不要排除？

### 2.3 提醒要不要同步

- [ ] 決定

`docs/mobile-mode-switch-sync.md` §9 原本寫「等缺口 #5」——**缺口 #5 已經做完了**，
所以這題可以重新開始討論。卡在「哪台裝置響」（`notificationDevice`）沒處理的話，
同步過去會變成兩台同時響。

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
- [ ] 飲食熱量模組（B9）→ `docs/future-nutrition-module.md`（你自用優先；含換機搬家包）
- [ ] Android 桌面小工具 → `docs/mobile-android-widget-plan.md`

---

## 4. 獨立版尚未實作（會誠實擲 `not-supported`，不是 bug）

- [ ] 天氣的地震／颱風關鍵詞查詢（目前桌面限定）
- [ ] Spotify 授權（目前桌面限定）
- [ ] 日曆授權（目前桌面限定）

缺口總表：`docs/mobile-standalone-gap-inventory.md`（不長，可整份讀）

---

## 5. 明確不做（不要重提）

**架構類**（roadmap §2／§8 已否決）：雲端同步後端、React Native 重寫、
手機重寫一份 prompt 邏輯、NAS 當 DeST host、付費模式、Relay 代排程、
RTC 半夜喚醒、把 HTML 打包進遙控 APK、Spotify 自動選歌。

**功能類**：第一版排除自動發話、TTS、Live2D、ST 對話記錄匯入。
手機不做背景定時抓新聞、對話新聞搜尋、新聞搬家包（皆桌面獨有，刻意不搬）。
獨立模式的遙控電腦（`remoteControl.*`）**永久不支援**——沒有電腦可控，設計如此。

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
