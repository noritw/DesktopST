# 手機獨立版 —— DeST 主 App Android 桌面小工具設計文件 (Android App Widget Plan)

> **建立時間**：2026-08-10（初版，雙模式：角色陪伴／便利貼）。
> **2026-08-22 owner 重新給出更具體的規格，整份改寫，取代初版。**
> **2026-08-22（續）owner 再追加兩項：拉大到 3x2／4x2 時顯示兩則對話
> （最新或釘選，最多釘兩則）、以及提醒也要能顯示在小工具上——已併入本版。**
> **2026-08-22（續二）owner 再追加三項：對白要顯示夠多字（20–50 字，
> 頭像固定佔一格寬，不隨 3x1/4x1 放大）、點某一句對白要能直接跳到對話裡
> 對應的那一則、以及手機端要能新增/指定表情圖片本身——前兩項併入本文件
> （§5／§6），第三項是聊天畫面的功能，併入 `mobile-character-expression-plan.md`。**
> **狀態**：規格已定案，待實作。
> **對象**：DeST 主 App（`appId: tw.nori.dest`，`src/mobile/`），**不是**
> 飲食記錄 App 的小工具（那份是 `docs/nutrition-widget-plan.md`，兩個原生
> 專案完全分開，但施工手法／踩過的坑可以互相參考——飲食那份**已經實作完成
> 並部分真機驗證過**，是目前這個專案唯一做過 Android Widget 的先例）。
>
> **前置依賴**：`docs/mobile-character-expression-plan.md`——框選臉部範圍、
> 表情圖解析（找不到對應表情退回主圖）這兩件事的設計搬去那份文件，因為
> 它們現在**同時服務小工具與聊天畫面本身**，不是小工具專屬。**這份文件
> 只保留「小工具怎麼用那份文件產出的結果」，不要在這裡重複設計裁切邏輯。**
> 建議實作順序：先做 `mobile-character-expression-plan.md`，再做這份小工具
> 文件（小工具的 Bridge 會直接呼叫前者的 `resolveDisplayImagePath()`）。
>
> **跟初版（2026-08-10）的差異**：拿掉「便利貼模式」與雙模式切換，
> 只做「角色陪伴」這一種；新增「框選臉部顯示範圍」（初版沒有這個概念，
> 現搬到 `mobile-character-expression-plan.md`）；尺寸從 2x2/4x2/4x3 改成
> 3x1／4x1（一句話）＋ 3x2／4x2（兩句話）；拿掉小工具內建的操作按鈕
> （初版有「對話」快捷按鈕，這版點哪裡都只開 App）；原生層資料來源從初版
> 設想的「SharedPreferences」改成「JS 端把要顯示的內容落地成檔案，原生層
> 直接讀檔」——這個決定是抄飲食小工具的做法，理由見 §2。

---

## 1. 需求（owner 原話，2026-08-22）

> 我希望可以沿用桌面版角色卡的表情圖，可以框選頭像範圍，小工具上面只顯示
> 使用者框選的角色臉部部位；小工具會有的欄位：角色頭像（有表情）、角色名稱、
> 一句話（可以是最新的發言，或者使用者自己點選一句過去發言釘到小工具）；
> 也可選擇不顯示角色頭像。大小大約 3x1 或 4x1，點小工具就直接開 DeST 主程式，
> 不需要在小工具回應。

拆解成具體規格：

1. **欄位**：角色頭像（依最新訊息的 `emotion` 換表情圖，找不到對應表情圖
   時退回主圖）、角色名稱、一句話。
2. **頭像來源**：直接沿用角色卡既有的 `avatar` 與 `emotions`／`spriteIds`
   （`core/types.ts` 的 `Character`），**不是**另外重新上傳一張小工具專用圖。
3. **框選臉部範圍**：使用者對**這個角色**框選一個矩形（例如臉部特寫），
   小工具上的頭像一律顯示這個框選範圍，而不是整張直幅角色圖縮小塞進一個
   小方塊裡看不清楚臉。**這個框選跟聊天畫面共用**——設計細節在
   `docs/mobile-character-expression-plan.md`。
4. **一句話**：預設是這個角色最新一則訊息的內容（含提醒觸發時角色說的話，
   見 §4.1）；使用者也可以從對話記錄裡挑一句過去的發言「釘」到小工具，
   這時改顯示被釘的那一句（不會被之後的新對話蓋過去，除非使用者自己
   取消釘選）。
5. **可選擇不顯示頭像**：整個頭像區塊可以關掉，只剩名字＋一句話（省空間）。
6. **尺寸**：3x1／4x1（一句話）＋ 3x2／4x2（**兩句話**：最新兩則，或使用者
   釘選最多兩則、沒釘的位置補最新一則，見 §5.2）。
7. **對白要顯示夠多字**（owner 追加）：目標 20–50 字，**不要一行就截斷**；
   頭像固定佔一格寬度，不隨 3x1 拉到 4x1 而變大，多出來的寬度全部給文字。
   見 §5.1。
8. **點擊行為**：小工具本身沒有按鈕，但**點某一句對白要能直接跳到對話裡
   對應的那一則**（owner 追加，因為現在可以釘選特定訊息，理所當然要能點
   回去看上下文）；點頭像／名字／背景空白處則跟原規格一樣，直接開 App
   到目前預設畫面。見 §6——這是這次修訂後**唯一**的例外，不算違背「不需要
   在小工具回應」，因為使用者體感上這仍然是「點了直接開 App」，只是
   多了「開到哪裡」的精準度。

---

## 2. 資料來源與核心架構決定

### 2.1 為什麼不能像飲食小工具一樣直接讀本機 JSON 檔

飲食記錄 App **沒有遙控模式**，資料永遠在本機檔案系統，原生層可以直接讀
`files/*.json`（見 `nutrition-widget-plan.md` §2）。**DeST 主 App 不一樣**：
手機有兩種資料來源模式（`docs/mobile-mode-switch-sync.md`）——

- **獨立模式**：角色／對話真的存在手機本機檔案（`characters/<id>/card.json`、
  `conversations/<id>.json`，見 `core/store/keys.ts`），原生層理論上可以直接讀。
- **遙控模式**：角色／對話其實存在**電腦上**，手機這邊只是透過 HTTP／WebSocket
  即時拉資料，本機完全沒有落地檔案——原生層這時候**沒有東西可以讀**。

**決定**：不要讓原生小工具去分辨「現在是哪個模式、該讀哪裡」。改成**不論
哪個模式，JS 端只要拿到角色的最新狀態（名字／要顯示的一句話／要顯示的
表情圖），就把它落地成原生層看得懂的檔案**——這樣原生層永遠只做一件事：
讀這幾個固定路徑的檔案。手機切換模式、或角色資料來源改變，都不影響小工具，
因為小工具跟「資料到底存在哪裡」完全解耦。

這比照飲食小工具「不需要 Bridge，直接讀本機檔案」的精神反過來用：
**這裡本來就需要一層 Bridge**（因為資料不保證在本機），但落地後的檔案格式
一樣是「原生層可以直接讀的平面檔案」，不是塞進 SharedPreferences 的字串
（圖片本來就不該塞 SharedPreferences，那是給小量字串用的，見 §2.3）。

### 2.2 三層儲存，各自負責不同的事

| 儲存 | 內容 | 誰寫、誰讀 | 要不要同步／搬家包 |
|---|---|---|---|
| **A. 角色小工具設定**（新，mobile-only）`widget-pin-config.json`（單一檔案，key 是 characterId） | 每個角色「目前釘選了哪些訊息」——`pinnedMessages: { messageId, text, emotion, pinnedAt }[]`，**最多 2 筆，陣列順序＝顯示順序**（第 0 筆＝小工具的第一句，第 1 筆＝第二句）。空陣列＝完全沒釘，兩格都顯示最新對話 | JS 寫（訊息選單的「釘選」動作）；JS 讀（Bridge 產生 §B 用）；原生層**不直接讀這份**，只透過 §B 間接生效 | **不同步、不進搬家包**。跟 `MODE_PREF_KEY`／`SYNC_HOST_KEY`（`core/store/keys.ts`）同一類裝置本地偏好——換一台手機本來就要重設，桌面版根本沒有這個小工具 |
| **B. 小工具渲染快照**（新，Bridge 產物）`widget-cache/<characterId>/state.json` ＋ `image.png` | `state.json`：`{ name, lines: [{ text, conversationId, messageId }, …]（1 或 2 筆） }`——**`conversationId`／`messageId` 是點擊跳轉用的**（§6），不是只有顯示文字；`image.png`：**已經套用框選裁切**的最終圖片位元組（永遠只準備一張，見 §5.2） | JS（Bridge）寫；**原生層直接讀** | 不同步、不進搬家包（衍生資料，刪掉／缺檔案時原生層退化成「沒有圖／沒有文字」，不會壞掉，下次 Bridge 跑一次就補回來） |
| **C. 小工具實例設定**（原生層自己的，標準 Android 做法） | 每個放在主畫面上的小工具實例：綁定哪個角色、要不要顯示頭像 | `DeSTWidgetConfigureActivity`（放置小工具時的設定畫面）寫進 Android `SharedPreferences`（key 用 `appWidgetId`）；`DeSTAppWidgetProvider` 讀 | 不適用（Android 系統機制，不是 App 自己的資料） |

**臉部框選範圍不在這份文件的儲存表裡**——它是
`docs/mobile-character-expression-plan.md` 的 `character-display-config.json`
（同一份設定被聊天畫面與這裡的小工具 Bridge 共用），不要在這份文件裡
重複定義一次。理由同樣寫在那份文件：這是裝置偏好，不進 `Character` 型別、
不跟著角色卡走同步／搬家包。

### 2.3 為什麼圖片走檔案不走 SharedPreferences

Android `SharedPreferences` 是給小量字串用的（XML 存底層實作），塞 base64
圖片位元組會很慢、很佔記憶體，而且 `RemoteViews.setImageViewBitmap()` 也不是
從 SharedPreferences 讀，還是要先解成 `Bitmap`。直接把裁切好的 PNG 寫進
`Directory.Data`（`files/widget-cache/<id>/image.png`，等同 `context.filesDir`，
見 `storageAdapter.ts`），原生層用 `BitmapFactory.decodeFile()` 讀，一步到位。

---

## 3. 框選臉部範圍與表情圖解析——見前置文件

框選 UI（重用 `AvatarCropView.tsx`／`avatarCropMath.ts`）、比例座標儲存格式、
「找不到對應表情圖時退回主圖」的降級規則，全部設計在
`docs/mobile-character-expression-plan.md` §3／§4（`character-display-config.json`
＋ `resolveDisplayImagePath()`）。**這裡不重複寫**——小工具的 Bridge（§4）
直接 import 那份文件產出的純函式，跟聊天畫面用同一份邏輯，避免兩邊各自
維護一份裁切數學而慢慢漂移。

---

## 4. Bridge：`src/mobile/runtime/widgetBridge.ts`（新檔）

負責把「某個角色現在該顯示什麼」算出來，寫進 §2.2 的 B 層檔案。

### 4.1 觸發時機（不做背景輪詢，比照飲食小工具與提醒模組的既有慣例）

1. **收到或送出訊息時**：`chat.ts`（獨立模式）／WebSocket 訊息事件
   （遙控模式，`appStore.ts` 的 `handleEvent`）處理完一則訊息後，若該訊息屬於
   某個「有小工具設定」的角色，呼叫 `refreshWidgetCache(characterId)`。
2. **提醒觸發、角色說話時**（`mobile/runtime/reminderSpeak.ts` 把生成的台詞
   `conv.messages.push(msg)` 之後）：**跟第 1 點是同一個觸發點**，不用另外
   設計——提醒觸發本來就是把一則帶 `emotion` 的訊息推進某個對話
   （`reminderSpeak.ts:360`），只要 §4.2 的「找這個角色最新一則訊息」是
   掃過**這個角色參與的所有對話**（不是只看使用者目前開著的那個對話），
   提醒說的話自然會被抓到，變成小工具的「最新一句」。**這就是「提醒顯示
   在小工具上」的完整實作**——不需要為提醒另外寫一條資料路徑，前提是
   `refreshWidgetCache()` 真的呼叫得到 `reminderSpeak.ts` 這個路徑（現有
   §4.1 第 1 點的「訊息事件」如果目前的實作只掛在 `chat.ts` 的使用者互動
   路徑上、沒有涵蓋 `reminderSpeak.ts` 這條背景路徑，**動工時要記得補上
   這個 hook 點**，這是這裡唯一需要留意的地方）。
3. **使用者釘選／取消釘選一句話時**：直接寫 A 層（`widget-pin-config.json`）
   ＋立刻呼叫 `refreshWidgetCache(characterId)`。
4. **App 離開前景時**（`appStateChange`，`isActive: false`，比照飲食小工具
   `nutrition-widget-plan.md` §3 第 2 點）：對「目前開著的那個對話所屬角色」
   跑一次，確保使用者剛聊完離開時小工具是新的。
5. 跑完後呼叫原生 Bridge（見 §7）觸發 `AppWidgetManager.updateAppWidget()`。

**不需要**像飲食小工具那樣加一顆「重新整理」按鈕——這版小工具本來就
「不需要在小工具回應」（owner 原話），沒有任何按鈕可以放這顆。

### 4.2 `refreshWidgetCache(characterId)` 做的事

1. 讀 A 層設定（`widget-pin-config.json[characterId]?.pinnedMessages`，
   0–2 筆）。
2. **組出最多兩則要顯示的「一句話」**（陣列，順序＝顯示順序），**每則都要
   帶著 `conversationId`／`messageId`**（點擊跳轉用，見 §6，不是只存
   顯示文字）：
   - 先放已釘選的（依 `pinnedMessages` 陣列順序，最多 2 筆）。
   - 陣列還沒滿 2 筆時，依「最新到最舊」補這個角色的訊息——**跳過已經
     被釘選過的那幾則**（不然釘選一則剛好是最新一則時，第二格會重複顯示
     同一句）。找「這個角色的訊息」要掃**這個角色參與的所有對話**（不限
     使用者目前開著的那個），這樣才會撈到 §4.1 第 2 點提到的提醒訊息。
   - 全部補完仍不足（例如角色完全沒聊過也沒被提醒觸發過）→ 該格留空，
     原生層顯示「還沒有對話」之類的預設文字（這格自然沒有
     `conversationId`／`messageId`，點下去退回開 App 到預設畫面）。
3. **決定頭像用哪張表情圖**：呼叫
   `mobile-character-expression-plan.md` 的 `resolveDisplayImagePath()`，
   `emotion` 參數用**陣列第 0 筆**那則訊息的
   `emotionOverride ?? emotion`（頭像永遠只跟著「第一句」走，3x2/4x2
   也不會有兩張頭像——見 §5.2 的版面說明，這是刻意的簡化）。
4. 拿到圖片位元組（獨立模式走 `session` 既有的圖片讀取邏輯，遙控模式走
   既有的 HTTP 抓圖路徑，不管哪個來源都是先拿到完整原圖）；若
   `character-display-config.json` 有這個角色的 `faceCrop`，用 canvas
   套用裁切；沒有就整張圖直接輸出。
5. 寫入 `widget-cache/<characterId>/state.json`
   （`{ name, lines: [{ text }, …]（1 或 2 筆） }`）與 `image.png`
   （除非「不顯示頭像」——見下方，那種情況不用產生圖片）。
6. 呼叫一個新的最小 Capacitor 外掛（比照飲食小工具的
   `NutritionWidgetBridgePlugin`）觸發 `DeSTAppWidgetProvider.updateAll()`
   ——**JS 沒辦法直接發 Android broadcast**，這是飲食小工具已經驗證過的做法，
   直接抄，不要重新設計一套。

**「不顯示頭像」是小工具實例設定（§2.2 C 層），不是這裡的事**：Bridge 永遠
把圖片準備好、寫進 `image.png`；原生層的 `DeSTAppWidgetProvider` 依實例的
`showAvatar` 決定要不要把 `ImageView` 設成 `GONE`，兩者職責分開，Bridge 不用
知道「哪個小工具實例想不想顯示頭像」（同一個角色可能同時有兩個小工具實例，
一個顯示頭像一個不顯示，圖片本身只需要準備一份）。

### 4.3 釘選 UI（多筆版）

`MessageMenu.tsx` 的「釘選到小工具」（見 §8）行為隨釘選數量改變：

- 目前不到 2 筆：直接加進 `pinnedMessages` 陣列尾端。
- 已經 2 筆：跳出選擇「要取代哪一則？」（顯示現有兩則的內容摘要各一個
  選項＋「取消」），選了哪則就整筆換掉，維持陣列順序（換掉第 0 筆的話，
  新釘的排到第 0 筆的位置，不是硬塞到尾端——使用者體感上「換掉第一句」
  就該顯示在原本第一句的位置）。
- 角色編輯器「小工具設定」區塊要能各別取消釘選（「取消第一句／取消第二句」
  兩個獨立按鈕，不是一次全清），清完那格自動退回顯示最新對話。

---

## 5. 小工具版面

### 5.0 版面總原則（owner 2026-08-22 追加：對白要多、頭像要固定）

- **頭像固定佔一格寬度**（約 1 個 Android 標準格 ≈ 70dp 見方，含 padding），
  **不論 3x1 還是 4x1／3x2 還是 4x2，頭像大小都一樣**——3x1 拉到 4x1 多出來
  的那一格寬度**全部給對白文字**，不是把頭像也放大。這跟 §5.1 舊版草圖
  暗示的「頭像跟著寬度變大」不一樣，這次要反過來：**頭像是唯一固定尺寸的
  元素，其餘空間都優先給文字**。
- **名字要小**：一行小字（例如 10–11sp），不是視覺重點。**對白才是重點**，
  字級要比名字大一階（例如 13–14sp），這樣使用者掃過去第一眼看到的是
  角色說了什麼，不是角色叫什麼名字。
- **對白目標顯示 20–50 個字，不要一行就截斷**：用多行（`maxLines`，不是
  單行 `ellipsize`）＋動態字級／行數（比照飲食小工具 `valueTextSizeSp()`
  依實際寬高算字級的做法，這裡改成「依實際寬高算能放幾行、每行多少字」）。
  只有真的超過可視行數才在最後一行 ellipsize——**跟舊版「單行省略號」
  完全不同**，舊版做法在矮長條上等於一句話只能看到前面幾個字，owner
  這次明確要求改掉。
- **具體抓法**：3x1（寬度扣掉頭像後約剩 2 格 ≈ 140dp、高度 1 格 ≈ 70dp）
  這種矮長條，靠字級夠小（例如 11–12sp）＋最多 2–3 行來湊出 20+ 字；
  4x1（扣頭像後約剩 3 格 ≈ 210dp）同樣高度但寬度更夠，字級可以稍大、
  同樣 2–3 行就能上看 40–50 字。3x2/4x2（§5.2）高度多一倍，兩句話各自
  的可視行數會比照對半分配（每句大約 1–2 行），實際行數/字級交給實作時
  用飲食小工具那套「先算可用 dp、反推字級」的方法微調，這裡給的是**目標
  字數**，不是精確到像素的規格書——**動工時如果 20–50 字在某個尺寸下
  會撐爆版面，寧可字級再小一點、行數再多一點，也不要走回單行截斷的老路**。

### 5.1 一句話版（3x1 / 4x1）

```
┌──────────────────────────────────────┐
│ ○      名稱（小字）                   │
│[頭像]   對白，可以換行顯示到二、三行， │
│(固定    盡量把 20~50 字都塞進來，只有  │
│ 大小)   真的太長才在最後一行加省略號   │
└──────────────────────────────────────┘
```

3x1 跟 4x1 共用一套 XML；差別純粹是對白區塊寬度不同（頭像不變），實際
能放幾個字由 §5.0 的動態字級決定，不必切換完全不同的排版結構。

### 5.2 兩句話版（3x2 / 4x2，owner 2026-08-22 追加）

```
┌──────────────────────────────────────┐
│ ○      名稱（小字）                   │
│[頭像]   對白 #1（可換行，字數目標同 5.0│
│(固定     的一半左右，畢竟要分空間給#2）│
│ 大小)   ─────────────────────────    │
│         對白 #2（同上）               │
└──────────────────────────────────────┘
```

- **頭像只有一張**，對應 §4.2 陣列**第 0 筆**（「對白 #1」）的表情——
  **不是**每一句話各配一張頭像。同一個角色同時擺兩張不同表情的臉在同一個
  小工具上，視覺上比較像故障而不是有兩則對話，這是刻意的簡化，不是漏做。
- 兩則對白的關係：**沒有標示哪句比較新／哪句是釘選的**——使用者自己知道
  他釘了什麼；沒釘的部分單純是「比 #1 更舊的下一則」，不特別強調來源。
- 兩則對白之間留一條細分隔線（或單純的間距），幫助辨認這是兩則獨立訊息，
  不是同一句話換行斷開。
- 每則對白各自是獨立的點擊區域（見 §6），中間的分隔線／間距不屬於任何一則，
  點下去退回開 App 到預設畫面。

### 5.3 尺寸判定（比照飲食小工具的既有做法）

`minSdkVersion` 是 26（見 `nutrition-health-lite-kickoff.md`），沒有 API 31+
的 `RemoteViews(Map<SizeF, …>)` 可用（飲食小工具已經在 §4 驗證過那支 API
「系統挑選規則不直覺」，**這次直接不用，省得重踩**）。用
`onAppWidgetOptionsChanged()` 讀 `OPTION_APPWIDGET_MIN_HEIGHT`
自己判斷：**高度只有一半格高左右（矮長條）→ 5.1 版面；高度夠兩格 → 5.2
版面**，寬度不影響選版面（只影響版面內部的字級/間距，跟飲食小工具的
`buttonSizeDp()` 那套做法一樣照抄）。

`AppWidgetProviderInfo`（`xml/widget_dest_character_info.xml`）用
`targetCellWidth="3" targetCellHeight="1"`、`minWidth`/`minHeight` 對應 3x1，
`resizeMode="vertical|horizontal"`（**這次要開放縱向調整**——3x1/4x1
拉高到 3x2/4x2 是使用者主動要求的功能，不能像上一版那樣鎖死只能橫向）。

版面共同規則：沒有任何按鈕、沒有進度條、沒有次要圖示——版面裡只有
「頭像 ImageView（可選）＋ 一或兩行文字」；`showAvatar = false` 時整個
`ImageView` 設 `visibility="gone"`，文字區塊的 `layout_weight` 自動撐滿；
遵守 CLAUDE.md §3 視覺硬規則：扁平圓潤、薄荷／天藍主色、無厚陰影／
毛玻璃／尖角。

---

## 6. 點擊行為（owner 2026-08-22 追加：點對白要能跳到對應那一則）

### 6.1 兩種點擊區域

- **對白文字區域**（§5.1 的一句話、§5.2 的對白 #1／#2）：**各自獨立的
  `PendingIntent`**，帶 extra：`conversationId`／`messageId`（來自 §4.2
  寫進 `state.json` 的那兩個欄位；若這格是「還沒有對話」的空白狀態，
  就沒有這兩個 extra，退化成跟下面「其餘區域」一樣的行為）。
- **其餘區域**（頭像、名字、背景空白、§5.2 的分隔線／間距）：**一個共用的
  `PendingIntent`**，不帶任何 extra，單純開 App 到目前預設畫面——這才是
  「點小工具就直接開 DeST 主程式，不需要在小工具回應」原話涵蓋的範圍，
  對白區域是 owner 追加的例外（見 §1 需求第 8 點的說明）。

兩種都是 `ACTION_VIEW` 開 `MainActivity`（沿用飲食小工具已驗證過的模式：
Capacitor 產生的 `custom_url_scheme` 字串資源 ＋ `@capacitor/app` 的
`getLaunchUrl()`／`appUrlOpen`，不用另外設計 intent scheme），差別只在
URL 有沒有帶 query（例如 `…?conversationId=xxx&messageId=yyy`）。

### 6.2 App 端收到後怎麼導覽

1. 冷啟動（`getLaunchUrl()`）／App 已在背景被喚醒（`appUrlOpen`）都要處理
   這兩個 extra（跟飲食小工具 §5 最後一條「兩條路徑都要處理」是同一個坑，
   照抄）。
2. 有 `conversationId`：呼叫既有的 `getData().conversations.load(conversationId)`
   （`ConversationsView.tsx:50` 已經在用的方法）→ `refresh()` → 導覽到
   聊天畫面（沿用 `ConversationsView.tsx` 的 `switchTo()` 那個順序，
   這支已經是「切換到指定對話」的標準做法，不需要另外發明）。
3. 有 `messageId`：訊息列表掛載後**捲動到該則訊息**（新功能，見 §6.3）。
4. 沒有這兩個 extra（其餘區域的點擊）：不做任何導覽，App 開到原本會開到的
   畫面即可。

### 6.3 捲動到指定訊息——新功能，注意既有的 WebView 踩坑

`src/mobile/ui/chat/MessageList.tsx` 檔頭已經有一條寫死的教訓：
「⚠️ 用容器自己的 `scrollTop`，不要 `scrollIntoView`。Capacitor WebView
裡 `scrollIntoView` 常去捲外層（整個視窗）」——**這條規則對「捲到指定
訊息」完全適用，是這次最容易踩的坑**：

- 不要呼叫目標訊息 DOM 元素的 `.scrollIntoView()`。
- 改成：訊息列表渲染完成後，用 `ref` 量出目標訊息元素相對於
  `containerRef`（`MessageList.tsx` 現有的容器 ref）的 `offsetTop`，
  手動設定 `containerRef.current.scrollTop = offsetTop - 一些留白`。
- 目標訊息可能因為記憶摘要（`summaryCoversTs`）被濃縮掉、或訊息本身被
  使用者事後刪除——這種情況捲動不到，**安靜地退回捲到底部**（`scrollToEnd()`
  現成就有），不要顯示錯誤或卡住。
- 建議捲到定位後給目標訊息一個短暫的高亮效果（例如背景色淡入淡出一次），
  幫助使用者在一串訊息裡找到「就是這一句」——這是體驗加分，不是硬性要求，
  時間不夠可以先跳過，捲動定位本身才是核心功能。

---

## 7. 原生元件與檔案結構

```
android/app/src/main/java/tw/nori/dest/widget/
  DeSTWidgetProvider.kt          # onUpdate：讀 widget-cache + widget-config，組 RemoteViews
  DeSTWidgetConfigureActivity.kt # 放置小工具時：選角色（讀 widget-character-list.json）、
                                 # 「顯示角色頭像」開關 → 寫 SharedPreferences
  DeSTWidgetBridgePlugin.kt      # 最小 Capacitor 外掛，refresh() 呼叫 DeSTWidgetProvider.updateAll()

android/app/src/main/res/
  layout/widget_dest_character_1line.xml   # 3x1 / 4x1（§5.1）
  layout/widget_dest_character_2line.xml   # 3x2 / 4x2（§5.2）
  xml/widget_dest_character_info.xml
```

`AndroidManifest.xml` 註冊 `DeSTWidgetProvider`（`<receiver>` +
`ACTION_APPWIDGET_UPDATE` intent-filter + `meta-data` 指到
`widget_dest_character_info.xml`）與 `DeSTWidgetConfigureActivity`
（`android:exported="false"`，只有系統放置小工具流程會啟動它）。

**`DeSTWidgetConfigureActivity` 選角色列表從哪來**：Bridge 額外維護一份
`widget-character-list.json`（`[{ id, name }, …]`，App 啟動或角色列表變動時
更新），原生層讀這份**不必逐一解析每隻角色的 `card.json`**——跟 §2.1
「原生層不用分辨資料來源模式」同一個精神，Configure 畫面要選角色時也不用
知道資料到底存在本機還是電腦上，JS 端已經先把「有哪些角色可以選」攤平好了。

---

## 8. 已知風險 / 之後會踩的坑（先寫起來，省得重踩）

- **遙控模式下角色被使用者在電腦上刪除／改名，Bridge 什麼時候才會發現**：
  跟畫面上其他地方一樣，靠既有的 `state-invalidated` 事件重新整理時順手更新
  快照，不用另外設計一套偵測機制。若小工具暫時顯示到刪除前的舊快照，
  等下一次事件觸發就會更新——這是可接受的最終一致性，不追求即時。
- **框選比例套用到不同構圖的表情圖會歪**（見 `mobile-character-expression-plan.md`
  §7，MVP 刻意接受）。
- **CapacitorHttp 相關的既有踩坑全部適用**（見 CLAUDE.md §5）：Bridge 若在
  遙控模式下需要抓圖片位元組，一樣要走注入的 `HttpAdapter`、一樣要小心
  `signal` 逾時失效的問題，不要在這裡另外寫一段裸 `fetch`。
- **`Directory.Data` 對應 `filesDir` 是 Capacitor Filesystem 現在的行為**
  （跟飲食小工具同一條風險），外掛版本更新要留意這個對應關係有沒有變。
- **多角色、多小工具實例**：同一個角色可以被放置成多個小工具實例（例如
  一個顯示頭像、一個不顯示），這沒問題——§2.2 B 層快照是以 characterId 為
  key，不是以 appWidgetId 為 key，多個實例讀同一份快照，各自套用自己的
  `showAvatar` 設定即可，不需要重複產生快照。
- **釘選功能的入口**：`src/mobile/ui/chat/MessageMenu.tsx`（訊息長按選單，
  已有「重新發送／編輯／刪除」）新增一項「釘選到小工具」，**只對
  `role === 'character'` 的訊息顯示**（跟現有「只有使用者訊息能重新發送」
  同一種角色限定寫法，抄同一個 if 判斷模式）。這支選單同時也要新增
  `mobile-character-expression-plan.md` 的「換表情」項——兩個都是加在
  同一支檔案的同一個選單裡，動工時一起做比較不會漏東漏西。
- **「找這個角色最新訊息」要掃全部對話，不是只看目前開著的那個**（§4.2）：
  這是這次多兩則、又要涵蓋提醒訊息之後才會出現的坑——舊版設計（只顯示
  一句話）時「目前對話」跟「這個角色最新訊息」多半是同一件事，容易讓人
  以為可以偷懶只看當前對話，扇到提醒訊息（可能發生在使用者根本沒開著的
  對話裡）或角色在別的對話裡的發言就會漏掉。
- **捲動到指定訊息一定要用 `scrollTop` 手動算，不要用 `scrollIntoView()`**
  （§6.3）——這是 `MessageList.tsx` 檔頭已經寫死的教訓，這次是第一個真的
  需要「捲到某一則」的功能，务必翻出那條註解照做，不要重新踩一次。
- **對話可能已經被刪除、或訊息已經被記憶摘要濃縮掉**：`state.json` 寫入時
  的 `conversationId`／`messageId` 是「當時」有效，使用者點小工具的當下
  這則對話／訊息可能已經不在了（尤其釘選的那幾則，時間差可能很長）。
  App 端 `conversations.load()` 失敗或訊息真的找不到時，安靜退回開到
  「聊天畫面」或「還原成沒有 extra 的行為」，不要顯示錯誤訊息卡住使用者。
- **對白字數目標（20–50 字）不是每種情境都保證達到**：角色如果本來就講
  很短的話（例如一句「嗯」），字數目標自然就是「有多少顯示多少」，不需要
  為了湊字數做任何奇怪的事（例如硬把下一句接進來）；目標只約束「不要
  不必要地截斷」，不是「保證每次都顯示滿 20 字」。
- **提醒訊息要真的掛得到 §4.1 的觸發鏈**：`reminderSpeak.ts` 是背景路徑，
  跟使用者主動聊天的 `chat.ts` 是不同程式路徑，動工時務必確認兩條路徑
  都會呼叫到 `refreshWidgetCache()`，不要只掛在 `chat.ts` 就以為做完了
  （這是本文件在 §4.1 特別強調的原因）。

---

## 9. 這次刻意不做

- 便利貼模式（初版 2026-08-10 的雙模式設計）——owner 這次的規格只要角色
  陪伴這一種，便利貼模式整個拿掉，不是排入下一期，是這份文件不再涵蓋它；
  如果之後 owner 想要，屬於全新的規格討論，不要照抄初版草稿。
- 小工具內建操作按鈕（相機／對話／重新整理等）——owner 明講「不需要在
  小工具回應」。
- 每張表情圖各自獨立框選——見 `mobile-character-expression-plan.md` §7
  已知限制，接受同一組比例套用全部表情圖。
- 3x2/4x2 每則各自配一張頭像——見 §5.2，頭像只跟著第一句走。
- 捲到指定訊息時的高亮動畫——見 §6.3，體驗加分項，時間不夠可以先跳過，
  核心是捲動定位本身。
- 對白字數保證下限——見 §8，角色講短話時目標字數本來就達不到，不強求。

---

## 10. 接手 AI 實作步驟順序

> **前置**：`docs/mobile-character-expression-plan.md` 的 §8 步驟 1–6
> （`character-display-config.json`、`resolveDisplayImagePath()`、框選 UI）
> 要先做完，這裡的 Bridge 才有東西可以呼叫。

1. **釘選 UI**：`MessageMenu.tsx` 加「釘選到小工具」（§4.3 的多筆版行為：
   未滿 2 筆直接加入、已滿 2 筆問要取代哪一則）；角色編輯器「小工具設定」
   區塊加「目前釘選：第一句『⋯⋯』／第二句『⋯⋯』」與各自的「取消」按鈕。
2. **Bridge**：`src/mobile/runtime/widgetBridge.ts`（§4），含
   `widget-cache/<id>/state.json`／`image.png`／`widget-character-list.json`
   三種輸出，掛上 §4.1 的觸發時機——**特別確認 `reminderSpeak.ts` 那條
   背景路徑也有掛到**，不是只掛 `chat.ts`。
3. **最小 Capacitor 外掛** `DeSTWidgetBridgePlugin`：`refresh()` 呼叫
   `DeSTWidgetProvider.updateAll()`（照抄飲食小工具 `NutritionWidgetBridgePlugin`
   的寫法，這是唯一需要新寫原生橋接的地方）。
4. **Android 版面**：`widget_dest_character_1line.xml` ＋
   `widget_dest_character_2line.xml` ＋ `widget_dest_character_info.xml`（§5）。
5. **`DeSTWidgetProvider.kt`**：讀 `widget-cache` 三個檔案、依 §5.3 的高度
   判斷挑版面、依 §5.0 動態算對白字級/行數、組 `RemoteViews`（圖片已經是
   Bridge 裁好的，原生層只需要單純 `decodeFile` 讀圖，不要在 Kotlin side
   重寫一次裁切數學）、**每則對白各自的 `PendingIntent`（帶 `conversationId`／
   `messageId`）＋其餘區域共用的 `PendingIntent`（不帶 extra）**（§6.1）。
6. **`DeSTWidgetConfigureActivity.kt`**：選角色（讀
   `widget-character-list.json`）＋「顯示角色頭像」開關 → 寫
   `SharedPreferences`（§2.2 C 層）。
7. **`AndroidManifest.xml`** 註冊 Provider 與 ConfigureActivity。
8. **App 端深連結導覽**（§6.2）：`App.tsx`（或既有處理 `getLaunchUrl`／
   `appUrlOpen` 的地方）解析 `conversationId`／`messageId` extra，呼叫
   `conversations.load()` 後導覽到聊天畫面。
9. **捲動到指定訊息**（§6.3）：`MessageList.tsx` 新增「捲到指定
   messageId」的能力，用手動 `scrollTop` 計算，**不要用 `scrollIntoView()`**。
10. **真機測試**：放置小工具（含拉大到 3x2/4x2）、選角色、切換顯示/隱藏
    頭像、框選臉部範圍後小工具圖片是否正確裁切、聊天後小工具是否更新、
    提醒觸發後小工具是否顯示提醒的台詞、釘選一或兩句話後是否固定顯示、
    取消單一釘選後是否恢復顯示最新對話、**點對白是否正確跳到對應對話與
    訊息位置**、**對白在 3x1/4x1/3x2/4x2 各尺寸下是否確實顯示到接近
    20–50 字而不是只有幾個字**、遙控模式下是否一樣能正常顯示（重點驗證項，
    因為這是跟飲食小工具最大的架構差異）。
