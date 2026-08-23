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

---

## 11. 落地筆記（2026-08-23，實作完成，真機驗證前）

**狀態**：`npm run typecheck`／`npm test`（999 項）全過，**真機測試清單一項
都還沒跑**——這是原生 Android／Capacitor 外掛工作，自動測試測不到原生層。

### 11.1 跟原設計不同的地方

- **`PinnedWidgetMessage` 多存了 `conversationId`**（§2.2 A 層原表只列
  `{messageId, text, emotion, pinnedAt}`）。點對白要跳轉（§6）勢必要知道
  對話 id，釘選當下（`MessageMenu.tsx`）剛好就在那個對話裡，存起來比
  之後在 B 層重新反查便宜。
- **觸發時機（§4.1）沒有分散掛在 `chat.ts`／`reminderSpeak.ts` 每個
  `conv.messages.push()` 呼叫點**，改成集中在兩處：
  1. `mobile/ui/stores/appStore.ts` 的 `handleEvent()`「`message`」分支——
     不管獨立或遙控模式，角色訊息進來都會經過這裡（`LocalEventSource`／
     `RemoteEventSource` 都推同一種事件），前景／背景但 JS 還活著的情境
     全部涵蓋，不用逐一在 chat.ts 埋 hook。
  2. `session.ts` 的 `runReminderHeadless()`——這支**本來就是**「前景排程
     與原生 headless WebView 共用的同一條路徑」（檔頭原有註解已經這樣
     設計），是唯一一條可能在 `appStore` 從未 `attach()` 過的情況下執行的
     路徑（App 被完全劃掉、原生層叫起 headless WebView 現場生成台詞），
     所以另外用 `refreshWidgetCacheWith()`（不經過 `getData()`）在這裡
     單獨 hook 一次。
  這樣兩個 hook 點就涵蓋了 §4.1 列的四種觸發時機（送出／收到訊息、提醒
  發話、釘選變動另外掛在 `MessageMenu.tsx`／`CharacterEditor.tsx`、App
  離開前景掛在 `App.tsx` 的 `visibilitychange`），**不用改 `chat.ts`／
  `reminderSpeak.ts` 一行**。
- **`widgetBridge.ts` 因此拆成兩個入口**（不是原本設想的單一
  `refreshWidgetCache(characterId)`）：
  - `refreshWidgetCache(characterId)`——前景呼叫，內部用 `getData()`
    （`DataSource`），兩種模式都能用；`getData()` 需要 `appStore` 已
    `attach()`，沒 attach 就安靜跳過。
  - `refreshWidgetCacheWith(provider, storage, characterId)`——不吃
    `getData()`，直接吃一個最小 `WidgetDataProvider` 介面。`session.ts`
    的 `runReminderHeadless()` 直接呼叫這支，用 `this.characters`／
    `this.conversationIndex`／`this.adapters` 組出 provider，不管
    `appStore` 有沒有 attach 都能跑。
  兩支共用同一段「決定顯示哪兩句、寫 `state.json`／`image.png`、觸發原生」
  邏輯，差別只在資料怎麼餵進來。
- **`DataSource.widgetLatestMessages()` 是新加的介面方法**，不是走既有的
  `conversations.list()`／`load()`：那兩支會**切換使用者正在看的對話**
  （`load()` 有這個副作用），拿來背景掃描不安全。獨立模式（`LocalDataSource`）
  委派給 `session.widgetLatestMessages()`（直接掃 `this.conversationIndex`，
  這是私有欄位，本來就只有 session 自己碰得到）；遙控模式
  （`RemoteDataSource`）打新端點 `GET /api/widget/latest-messages/:id`。
- **`mobileServer.ts` 新端點沒有改 `MobileBridge` 介面／`src/main/index.ts`**：
  `bridge.getConversationList()`／`bridge.getConversationForSync(id)`
  兩支既有方法（S1/S2 同步已經在用）剛好就是「不切換使用者正在看的對話、
  給完整訊息」，直接組出結果，比原規劃省了一輪主行程改動。掃描邏輯本身
  （`collectLatestCharacterMessages()`）放在 `core/character/widgetSnapshot.ts`，
  平台無關，`mobileServer.ts`（Node 主行程）與 `session.ts`（手機）共用同一份，
  不是各自維護一份會漂移的邏輯。
- **頭像圖片的裁切／表情解析完全沒有重寫**：Bridge 直接呼叫既有的
  `characterDisplayImageUrl(characterId, emotion)`（`session.ts`／
  `remoteDataSource.ts` 早就實作好，含 `resolveDisplayImagePath()` 與
  `cropImageToFace()`），拿到 `data:`／`blob:` URL 後轉成位元組寫檔——
  `imageUrlToBytes()` 因此要同時認得這兩種 URL（獨立模式一律回
  `data:`；遙控模式沒設定框選臉部範圍時回 `blob:`）。
- **§5.0 的動態字級／行數演算法簡化了**：`DeSTWidgetProvider.kt` 目前是
  「依寬度分三段給固定字級（12/13/14sp）」，不是計畫書描述的「先算可用
  dp、反推字級與行數」那套精確算法（飲食小工具 `valueTextSizeSp()` 的
  程度）。**這是刻意先求「功能正確、對白不會被單行截斷」再談像素級微調**
  ——`maxLines` 已設 2–3、`ellipsize="end"` 只在真的超過才生效，符合
  §5.0「不要走回單行截斷的老路」的核心要求；如果真機測出某個尺寸字級
  太大/太小，回來調 `lineSizeSp` 那三個數字或加更多分段即可，不用重新設計。
- **頭像裁成圓形是在 Kotlin 端用 Canvas＋`PorterDuff.Mode.SRC_IN`做的**
  （`readCircularAvatar()`），不是在 XML 或 `image.png` 寫入前就裁好——
  `image.png` 保持方形（跟聊天泡泡看到的圖一致），原生層顯示時才裁圓，
  這樣同一份 `image.png` 未來如果有別的用途（例如非圓形版面）不用重存。
- **`AppWidgetProviderInfo` 的 `android:configure` 指到
  `DeSTWidgetConfigureActivity`**：計畫書 §7 原本沒有明講要不要標準的
  「放置時開設定畫面」流程，但選角色本來就需要一個畫面，所以直接照
  Android 標準模式做（`ACTION_APPWIDGET_CONFIGURE`，`setResult`
  CANCELED/OK），沒有另外設計。

### 11.2 真機測試清單（一項都還沒驗證，逐項列出方便之後對照）

- [ ] 打包 debug APK 成功（Kotlin 工具鏈：`android/build.gradle`／
      `android/app/build.gradle` 比照飲食小工具補的 `kotlin-android` plugin
      與 `kotlin-stdlib`，DeST 這個專案原本純 Java，第一次加 Kotlin 编譯，
      版本相容性沒驗證過）
- [ ] 主畫面長按放置小工具，`DeSTWidgetConfigureActivity` 正常彈出、能選到
      角色清單（`widget-character-list.json` 有沒有正確攤平寫出）
- [ ] 選完角色後小工具正確顯示在主畫面（3x1 尺寸）
- [ ] 拉大到 4x1／3x2／4x2，版面與字級是否合理（尤其 §5.0 的簡化字級是否
      在極端尺寸下太大/太小、被裁切）
- [ ] 切換「顯示角色頭像」開關，頭像 ImageView 是否正確顯示/隱藏
- [ ] 已框選臉部範圍的角色，小工具頭像是否顯示裁切後的臉部特寫（不是整張
      直幅圖縮小）
- [ ] 聊天送出訊息後，小工具是否即時更新成最新一句（不用手動重開 App）
- [ ] 提醒觸發後，小工具是否顯示提醒時角色說的話（**含 App 被完全劃掉、
      靠原生 AlarmManager／headless WebView 觸發的情境**——這是 §4.1
      特別強調要驗證的路徑，`runReminderHeadless()` 的 hook 是否真的在
      這條路徑下也能寫檔＋觸發小工具重繪）
- [ ] 訊息選單「釘選到小工具」：未滿 2 筆直接釘上；已滿 2 筆跳出「取代
      哪一則」的選擇，取代後位置是否正確（換第一句留在第一格）
- [ ] 角色編輯器「小工具設定」區塊：顯示目前釘選內容、各自「取消」是否
      正確生效、清完是否恢復顯示最新對話
- [ ] **點小工具上的對白，是否正確開 App 並跳到對應對話、捲動到對應
      訊息位置**（`MessageList.tsx` 的手動 `scrollTop` 定位）
- [ ] 點頭像／名字／背景空白處，是否單純開 App（不做額外導覽）
- [ ] 對話／訊息已被刪除或記憶摘要濃縮掉時，點小工具對白是否安靜退回
      開到聊天畫面（不顯示錯誤、不卡住）
- [ ] **遙控模式下小工具是否一樣能正常顯示與更新**（跟飲食小工具最大的
      架構差異：資料在電腦上，Bridge 要打 `mobileServer.ts` 新端點
      `GET /api/widget/latest-messages/:id`）
- [ ] 同一個角色放兩個小工具實例（一個顯示頭像、一個不顯示），兩個是否
      都正確更新、互不干擾
- [ ] `adb logcat` 確認沒有原生層 crash（尤其 `readCircularAvatar()` 的
      Bitmap 處理、`JSONObject`／`JSONArray` 解析異常路徑）

---

## 12. 第一次真機測試的回饋與改版（2026-08-23，owner 實機）

owner 裝上第一版 APK 後回報六項，其中三項指向**同一個設計問題**：小工具
不該綁角色。整批改完後 `npm run typecheck`／`npm test`（1014 項）與
`gradlew assembleDebug` 皆過，**真機仍待驗證**。

### 12.1 打包失敗：Kotlin 的區塊註解會巢狀

第一版連編譯都沒過：`DeSTWidgetBridgePlugin.kt` 的 KDoc 裡寫了
`` `widget-cache/*` ``，而 **Kotlin 的 `/* */` 是可以巢狀的**（跟 Java／
TypeScript 不同），註解裡的 `/*` 被當成又開了一層，整份檔案於是
「Unclosed comment」。錯誤訊息指向檔案最後一行，完全看不出是註解裡的字串。
**寫 Kotlin 註解時不要出現 `/*` 或 `*/` 這兩個字元序列**，路徑萬用字元改用
文字描述。（`docs/nutrition-widget-plan.md` 那邊沒踩到純屬運氣。）

### 12.2 拉高到兩格就「無法載入小工具」——RemoteViews 不認得 `<View>`

兩則對白版的分隔線原本用 `<View android:layout_height="1dp">`。
**`RemoteViews` 只認得一份白名單類別**（`FrameLayout`／`LinearLayout`／
`RelativeLayout`／`GridLayout`／`TextView`／`ImageView`／`ProgressBar`／
`Button`⋯⋯，都帶 `@RemoteView` 註解），**裸的 `View` 不在裡面**，inflate
當場丟例外，launcher 顯示「無法載入小工具」。改用 `FrameLayout` 當分隔線。

⚠️ 這個坑的症狀完全不會指向分隔線——只會看到「某個尺寸壞掉」，而且
**只有那個尺寸壞**（一行版沒有分隔線所以正常），很容易誤判成尺寸判定寫錯。
之後在小工具版面裡加任何新元素，先確認那個類別在白名單上。

### 12.3 小工具改成「跟著目前對話走」，不再綁角色（架構改版）

owner 三項回饋其實是同一件事：
> 「我並沒有想要先設定角色，本來預期是在沒設定釘選對話的情況下，就直接用
> 當前對話的最新一則（或兩則）去顯示」
> 「完全不知道要怎麼把設定好的訊息改掉，也不知道為什麼會顯示那一則」
> 「釘選功能不正常，選了之後沒有反應在小工具上」

第三項的成因正是第一項：小工具實例綁在角色 A 上，釘選的卻可能是角色 B 的
發言，於是「釘了但小工具沒反應」——而使用者根本不知道有「綁定角色」這回事，
因為那是放置小工具時點過一次就再也看不到的設定。

**所以資料模型從「每個角色一份快照」改成「全域一份快照，內容跟著目前這個
對話走」**：

| | 改版前（§2.2） | 改版後 |
|---|---|---|
| 設定檔 | `widget-pin-config.json`，key 是 characterId | `widget-config.json`，全域一份（釘選＋`showAvatar`） |
| 快照 | `widget-cache/<characterId>/state.json`＋`image.png` | `widget-cache/state.json`＋`image.png`（固定路徑） |
| 顯示什麼 | 綁定角色的最新訊息（掃全部對話） | **目前這個對話**最新的一兩則角色發言 |
| 釘選 | 每個角色各自最多 2 則 | 全域最多 2 則（可跨對話） |
| 放置流程 | ConfigureActivity 選角色＋頭像開關 | **沒有 Configure 畫面**，放上去就能用 |
| 頭像開關 | 每個實例的 SharedPreferences | 全域設定，在 App 內的設定頁改 |

連帶的簡化：
- **`DataSource.widgetLatestMessages()` 整支拿掉**，`mobileServer.ts` 的
  `GET /api/widget/latest-messages/:id` 端點也拿掉。既然只要「目前這個對話」，
  `getState()` 回傳的 `AppStateSnapshot.conversation.messages` 本來就有——
  遙控模式不必再多打一支 API，電腦端也不必動。`WidgetDataProvider` 縮成
  `{ getState, characterDisplayImageUrl }`，`StandaloneSession` 本身就符合
  這個形狀，`session.ts` 直接傳 `this`。
- **`widget-character-list.json` 與 `DeSTWidgetConfigureActivity` 一起刪掉**
  （那份清單只有 Configure 畫面在用）。
- 核心演算法改名 `collectLatestCharacterMessages()` → `buildWidgetLines()`，
  **把「釘選優先、剩下的用最新對話補滿」整段收進 core 並補測試**——這樣
  App 內設定頁的預覽跟小工具實際顯示保證是同一份結果（見下）。

### 12.4 新增 App 內的「桌面小工具」設定頁

`src/mobile/ui/settings/WidgetSettingsView.tsx`，從 ☰ 主選單進去
（**只有原生殼看得到**，網頁版沒有小工具可設定）。內容：

- **預覽**：直接呼叫 `computeWidgetLines()`，跟小工具實際顯示的是同一份
  計算結果。⚠️ 之後改這一頁時**不要在這裡重寫一份挑選規則**，否則預覽會
  慢慢跟實際顯示漂移，而使用者只會覺得「預覽騙人」。
- **顯示哪幾則**：逐則列出，釘選的標圖釘＋「在對話中查看」（沿用小工具
  點對白那條捲動定位路徑）與「取消釘選」；沒釘滿的格子明講「自動顯示目前
  這個對話最新的發言」，並告訴使用者要去哪裡釘。這一段就是 owner
  「不知道為什麼會顯示那一則」的答案。
- **顯示角色頭像**開關（原本在 ConfigureActivity）。
- 頂部說明主畫面上目前放了幾個小工具（原生 `DeSTWidgetBridgePlugin.count()`）。

### 12.5 釘選狀態要有單一真相：`ui/stores/widgetStore.ts`

釘選狀態要**同時**反映在三個地方（聊天泡泡的圖釘、訊息選單的
「釘選／取消釘選」、設定頁），各元件自己讀檔的話改了其中一個、另外兩個
要等重新掛載才更新——這也是 owner「釘選了沒有反應」體感的一半。
改成一個 zustand store，每支 action 都包好「寫檔 → 更新 state →
`refreshWidgetCache()`」，呼叫端不必自己記得刷。

其餘配合的改動：
- 訊息選單那一項變成**切換**（已釘選 → 顯示「取消釘選」）。
- 聊天泡泡上釘選過的訊息顯示「📌 已釘選到小工具」，
  小工具上釘選的那幾則也加 `📌 ` 前綴（owner 要求的圖釘圖示）。
- 角色編輯器的「小工具設定」區塊移除（那是角色綁定時代的產物）。

### 12.6 表情選單補「使用預設圖片」

owner：「換表情之後換不回去了」。原本只有「跟隨 AI 判斷」一顆——那是把
選擇權交回 AI，AI 判出什麼表情就顯示什麼，**不等於顯示主圖**。
新增哨符 `DEFAULT_IMAGE_EMOTION`（`core/character/displayImage.ts`）：
存進 `emotionOverride` 就跟一般表情 key 走同一條儲存路徑（桌面／手機的
`setEmotionOverride` 都不驗證值），`resolveDisplayImagePath()` 看到它就
直接回主圖、不往下查 `emotions`／`spriteIds`。所以三種狀態齊全了：
跟隨 AI 判斷／使用預設圖片／指定某張表情圖。

### 12.7 §11.2 真機測試清單的修訂

下列項目因為改版而**作廢**：「`DeSTWidgetConfigureActivity` 正常彈出」、
「能選到角色清單」、「選完角色後小工具正確顯示」、「切換顯示頭像開關
（改在 App 內設定頁）」。其餘全部仍待驗證，另外新增：

- [ ] 放上小工具**不需要任何設定**就直接顯示目前對話最新的一兩則
- [ ] 拉高到 3x2／4x2 **不再顯示「無法載入小工具」**（§12.2 的修法）
- [ ] 釘選一則之後**小工具立刻反映**，且該則前面有 📌
- [ ] 已釘選的訊息在聊天畫面顯示「📌 已釘選到小工具」，選單變成「取消釘選」
- [ ] 釘滿兩則後再釘第三則，會問「要換掉哪一則」且換掉的位置正確
- [ ] ☰ →「桌面小工具」設定頁：預覽內容跟主畫面上的小工具一致
- [ ] 設定頁「在對話中查看」能跳到並捲動到那則訊息
- [ ] 設定頁關掉「顯示角色頭像」後小工具真的不顯示頭像
- [ ] 設定頁顯示的「主畫面上有 N 個小工具」數字正確
- [ ] 切換對話後小工具跟著換成新對話的最新發言
- [ ] 訊息選單「換表情」→「使用預設圖片」後泡泡確實顯示主圖，且**換得回去**

---

## 13. 兩則不同角色時各自顯示頭像與名字（2026-08-23，owner 追加）

> 「小工具顯示兩則對話的時候，如果兩則是不同角色，希望兩則都能顯示各自的
> 頭像和名字。」

**推翻 §5.2 的「頭像只有一張」那條刻意簡化。** 原本的理由是「同一個角色同時
擺兩張不同表情的臉在同一個小工具上，視覺上比較像故障」——那個理由在**同一個
角色**連講兩句時仍然成立，但群組聊天裡兩則來自不同角色時，只掛一張臉等於
讓人分不出哪句是誰說的。所以規則變成：

| 情況 | 版面 |
|---|---|
| 只有一則（3x1／4x1，或 3x2 只找得到一則） | 一張頭像＋一個名字 |
| 兩則、**同一個角色** | 一張頭像＋一個名字（§5.2 原設計不變） |
| 兩則、**不同角色** | **每則各自一張頭像＋各自的名字**（本節新增） |

### 13.1 判斷放在 JS，原生層只讀結果

`hasDistinctSpeakers()`（`core/character/widgetSnapshot.ts`，有測試）算出布林值
寫進 `state.json` 的 `perLineSpeaker`，`DeSTWidgetProvider` 照著挑版面、**不重算**
——比照 §2.1「原生層不做決策」的一貫做法。任一則沒有 `characterId` 就回 false：
沒有身分可標示的話，分成兩欄只會多一塊空白。

### 13.2 三份版面，不是靠 visibility 切換

新增 `widget_dest_character_2line_multi.xml`（兩列各自完整：頭像／名字／對白），
與既有的 `widget_dest_character_2line.xml`（一張頭像＋一欄文字）**分開兩份**。
兩者的結構本來就不一樣，硬塞進同一份會變成一堆互相牴觸的 margin，而且
RemoteViews 能改的屬性有限，靠 visibility 兜出來的版面很難維護。
`widget_line1`／`widget_line2`／`widget_root` 的 id 在三份版面裡共用，
所以 `applyLine()` 與背景點擊那段完全不用分支。

### 13.3 兩張頭像 → 兩個檔案

`widget-cache/image.png` 改成 `image1.png`／`image2.png`。只有「兩則不同角色」
時才會產生第二張；同一個角色或關掉頭像時，多出來的檔案會被**刪掉**——
抓不到圖時一定要刪舊檔，否則角色換了、頭像卻停在上一位的臉。
舊的 `image.png` 在每次寫入時順手清掉（只是為了 `adb shell ls` 時不困惑）。

### 13.4 其他連帶調整

- `state.json` 的 `name` 從頂層移到**每一則**（`lines[].name`），JS 端就把
  `resolveCharacterName()` 解析完的結果寫好；原生層不再需要知道
  `presentCharacters` 這種東西。一則版與共用版都直接用 `lines[0].name`。
- 兩則各自帶頭像時文字欄更窄，字級再降一階（§5.0 那組 12/13/14sp 減 1），
  免得每則都只剩幾個字。
- App 內設定頁的預覽跟著分兩種畫法——**一樣走同一支 `computeWidgetLines()`**，
  預覽與實際顯示不會漂移（§12.4 的規則繼續適用）。

### 13.5 追加的真機待驗項

- [ ] 群組對話裡最新兩則來自**不同角色**時，小工具兩則各自顯示正確的頭像與名字
- [ ] 兩則是**同一個角色**時仍然只顯示一張臉（沒有變成兩張一樣的臉）
- [ ] 釘選一則 A 角色的話、另一格自動補 B 角色的最新發言 → 兩張臉都正確
- [ ] 關掉「顯示角色頭像」時，不同角色的兩則**仍然各自顯示名字**（只是沒有臉）
- [ ] 兩則不同角色時字級仍然讀得下去（沒有被擠成只剩幾個字）
- [ ] App 內設定頁的預覽跟主畫面上的小工具長得一樣（含兩張頭像的情況）

---

## 14. 顯示順序與配色／透明度（2026-08-23，owner 追加第三輪）

### 14.1 自動顯示的那幾則要「新的在下面」

> 「自動顯示新對話的情況，新的應該要在下面，和對話記錄一致」

`buildWidgetLines()` 取到最新的 N 則之後**再反轉成時間由舊到新**才放進陣列。
釘選的不受影響——那是使用者自己指定的順序，不是時間序。

⚠️ **這件事害 `limit` 不再是單純的截斷關係**，而且踩點很隱蔽：
`limit=1` 拿到的是「最新那則」，`limit=2` 的第 0 則卻是**比較舊**的那則。
所以矮版小工具（3x1／4x1）**不能拿 `limit=2` 的結果取第一個來用**，
否則群組聊天時會顯示 A 的舊發言配 B 的頭像。做法是 `widgetBridge.ts` 用
`limit=1` 另外算一份寫進 `state.json` 的 `singleLine`，原生層矮版直接讀它。
有測試守著這條（「limit=1 拿到的是最新那則——不是 limit=2 的第 0 則」）。

連帶：**每一則顯示出來的對白都各自準備一張頭像**（最多兩張），不再只在
`perLineSpeaker` 時才產第二張——因為 `singleLine` 可能是 `lines[1]`。
每則各自帶 `avatarIndex` 指向要用哪一張 `imageN.png`，原生層照著取。

### 14.2 12 組配色 ＋ 底色透明度（兩個 App 各自獨立）

> 「小工具配色希望同步程式內的 12 組配色設定，底版透明度希望可用拉 bar
> 自行調整（0~100%）⋯⋯另外飲食小工具也希望可以調整配色和透明度，
> 同樣用 DeST 的 12 組配色，但和 DeST 兩邊可以設定不同顏色」

**色表搬到 `src/shared/colorThemes.ts` 當唯一真相。** 原本住在
`src/mobile/ui/theme.ts`，但飲食記錄 App 只吃得到 `@core` 與 `@shared`
兩個 alias（見 `nutrition/mobile/vite.config.ts`），碰不到 `src/mobile/`。
抄一份過去就是這個專案已經踩過好幾次的雙邊定義漂移（`contentHash.ts`／
`settingsSnapshot.ts`），所以改成搬到共用層；`src/mobile/ui/theme.ts`
re-export，既有的 import 全部不用動。

⚠️ **CLAUDE.md §3 那條「新增／改主題時要一起改的清單」現在多一項**：
色值本身改 `src/shared/colorThemes.ts`（不再是 `src/mobile/ui/theme.ts`）。

**換算邏輯也共用**：`src/shared/widgetAppearance.ts` 的
`resolveWidgetColors()` 把主題色 ＋ 透明度算成 `#AARRGGBB` 交給原生層。
為什麼要在 JS 端算完：
- 原生層讀不到 TS 的色表；
- Android 的 `Color.parseColor()` **不吃 CSS 的 `rgba(...)`**，而色表裡的
  `border` 剛好就是那個格式（`rgba(0,0,0,0.08)`），一定要先換算；
- 延續「原生層只讀檔案、不做決策」的一貫做法。

**兩個 App 各存各的**：DeST 存在 `widget-config.json` 的 `appearance`；
飲食記錄存在它自己的 `NutritionAppSettings.widgetAppearance`，並由
`writeWidgetTheme()` 落地成 `widget-theme.json` 給原生層讀。
差別只有一個：DeST 多一個「跟隨 App 配色」的選項（預設值），因為它的
App 本體有配色概念且會被情境切換改動；飲食記錄 App 的 UI 有自己一套 CSS，
沒有這個概念，所以一律明確指定，預設 `mint`（跟改版前寫死的色值一致，
升級上來的人不會突然變色）。

### 14.3 圓角底板為什麼是一張 ImageView

底色要能換配色**還要能調透明度**，但 RemoteViews 在 minSdk 26 上：
- `setInt(root, "setBackgroundColor", …)` → **會失去圓角**（CLAUDE.md §3
  的視覺硬規則明訂不要尖角）；
- `setColorStateList(…, "setBackgroundTintList", …)` → **API 31 才有**。

所以四份 DeST 版面與四份飲食版面的 root 都改成 `FrameLayout`，裡面第一層
放一個 `ImageView`（`widget_bg`，`scaleType="fitXY"`），由 Provider 依實際
尺寸畫一張圓角矩形 bitmap 塞進去——圓角與透明度就都拿得回來了。
`android:src` 留一張靜態底板，讓小工具選單裡的預覽圖不是空白。

⚠️ **`widget_bg` 不可以設 `android:background`**：那層會蓋在透明的 bitmap
底下，透明度就完全失效了。

飲食小工具的**語意色刻意不跟著配色跑**：熱量超標的紅字與蛋白質達標的綠字
是警示語意，跟著配色變會把意思洗掉。但「正常」那一側的大數字改用配色的
文字色——否則挑深色配色時會是深綠字配深底，整個看不到。

### 14.4 追加的真機待驗項

- [ ] 自動顯示兩則時，**新的那則在下面**（跟聊天記錄同方向）
- [ ] 矮版（3x1／4x1）顯示的是**最新那則**，不是上面那則
- [ ] 群組聊天時矮版的頭像跟它顯示的那則是同一個人（`singleLine` 的 avatarIndex）
- [ ] DeST：12 組配色都能選，套用後小工具立刻變色
- [ ] DeST：「跟隨 App 配色」會跟著 App 的配色（含情境切換）一起變
- [ ] DeST：透明度拉桿 0%／50%／100% 都正確，0% 時只剩文字浮在桌布上
- [ ] DeST：底板在各透明度下**仍然是圓角**（不是直角方塊）
- [ ] 深色配色（黑白灰／復古／賽博）下文字讀得清楚
- [ ] 飲食小工具：12 組配色 ＋ 透明度同樣可用，四種尺寸都正確
- [ ] 飲食小工具：熱量超標的紅字／蛋白質達標的綠字**沒有**被配色洗掉
- [ ] 飲食小工具的配色**跟 DeST 各自獨立**（改一邊不會動到另一邊）
- [ ] 兩個 App 的設定頁預覽都跟主畫面上的小工具一致

---

## 15. 按鈕／進度條沒跟著配色，以及飲食 App 本身也要能換色（2026-08-23 第四輪）

> 「忘記說了，飲食 App 本身配色也是要可以設定那 12 組」
> 「我改了飲食小工具配色，結果按鈕還是原本的淺綠色很奇怪」

### 15.1 為什麼按鈕沒跟著變色

相機／鉛筆／重新整理三顆是 `ImageView`，圓底靠
`android:background="@drawable/bg_widget_button_circle"`（裡面寫死
`@color/widget_mint`）。§14.3 已經記過同一個限制：RemoteViews 在 minSdk 26
上**不能 tint 背景 drawable**（`setBackgroundTintList` 要 API 31），
`setBackgroundColor` 又只會得到方形。所以 §14 那一輪只換掉了容器底板，
按鈕整個被漏掉。

修法：**把「圓底＋圖示」整顆畫成一張 bitmap 當 `src`**，再用
`setInt(id, "setBackgroundResource", 0)` 把原本那顆綠圓底拿掉。
圖示是向量圖、線條色也寫死在 XML（`strokeColor="@color/widget_text"`），
用 `drawable.setTint()` 蓋一層 color filter 連筆畫一起換掉。

⚠️ **內距要一起歸零**：XML 原本的 `padding` 是給「背景是圓、src 是圖示」
那套用的；現在圖示的留白已經畫進 bitmap 裡了，不歸零會連圓底一起被縮小。

⚠️ **按鈕的顏色不套用底色透明度**。底板調到 0% 時整排按鈕會跟著消失，
但按鈕要按得到就要看得見——所以 `WidgetColors.accent`／`accentStrong`
一律不透明，只有 `bg` 吃透明度。有測試守著這條。

### 15.2 進度條也是同一個坑，順手一起修

`android:progressTint` 同樣只能在 XML 寫死（`setProgressTintList` 要 API 31），
所以熱量／蛋白質那兩條也會永遠停在原本的淺綠。把版面裡那四個
`ProgressBar` 換成 `ImageView`，由 Provider 畫圓角長條 bitmap。

⚠️ **換成 ImageView 之後絕對不能再呼叫 `views.setProgressBar()`**：
那支會對 ImageView 呼叫不存在的 `setMax`／`setProgress`，套用時直接丟例外，
症狀又是「無法載入小工具」（跟 §12.2 同一種死法，不同原因）。

### 15.3 飲食 App 本身的 12 組配色

`styles.css` 原本 21 個寫死的色值，全部換成 CSS 變數，由新的
`nutrition/mobile/src/theme.ts` 的 `applyNutritionTheme()` 依主題塞進
`<html>` 的 inline style（做法比照 DeST 手機端的 `applyTheme()`，
但**變數名各自獨立**——兩個 App 的 CSS 本來就分開，共用的是色值不是命名）。

幾個對應上的決定：
- `--tint`＝主題的 `mint`、`--accent`＝`mint2`。
- `--accent-strong`（小字連結／圖示／統計長條）色表裡沒有對應的顏色，
  改成由 `mint2` 混 45% 的 `text` 算出來——淺色主題混出中調、深色主題
  反方向也是中調，兩邊都讀得清楚。
- **原本「accent 底＋白字」的主按鈕改成「accent 底＋主題文字色」**
  （主按鈕、加食物、選中的標籤三處）。12 組配色的 `mint2` 多半是淺色，
  白字會整個看不到；這也剛好跟 DeST 手機端主按鈕的慣例一致。
- **輸入框一定要明確給 `background`**：原本靠瀏覽器預設的白底，
  深色主題下會變成白底配淺色文字，等於看不到自己在打什麼。
- `#d8a86a`／`#a06f2c`（未分類標籤）與 `#d94f4f`（錄音中）**刻意保持寫死**
  ——語意色，跟著配色跑會把意思洗掉。`--over`／`--good`（超標／達標）
  同理不從主題推導，但備了淺色／深色兩版，因為深色底上那組深紅深綠會糊掉
  （`isDarkTheme()`，`src/shared/colorThemes.ts`）。

**三個配色設定彼此獨立**：DeST App／DeST 小工具／飲食 App／飲食小工具。
（DeST 小工具預設是「跟隨 App 配色」，其餘都是明確指定。）

### 15.4 追加的真機待驗項

- [ ] 飲食小工具換配色後，**相機／鉛筆／重新整理三顆按鈕跟著變色**
- [ ] 按鈕圖示在深色配色下看得清楚（`setTint` 有蓋到向量圖的筆畫）
- [ ] 底色透明度調到 0% 時，**按鈕仍然看得見**（沒有跟著淡掉）
- [ ] 熱量／蛋白質進度條跟著配色變，且百分比正確（換成自繪 bitmap 之後）
- [ ] 進度條換 ImageView 之後**沒有出現「無法載入小工具」**（§15.2 的坑）
- [ ] 飲食 App 本身 12 組配色都能選、切換後整個介面即時變色
- [ ] 深色配色下：輸入框、下拉選單、主按鈕文字都讀得清楚
- [ ] 深色配色下「超標紅字／達標綠字」仍然分辨得出來
- [ ] 未分類標籤的橘色、錄音中的紅色**沒有**被配色洗掉
- [ ] 飲食 App 配色與飲食小工具配色**各自獨立**（改一個不會動到另一個）

---

## 16. 設定頁的預覽壞掉 ＋ 版面重排（2026-08-23 第五輪）

> 「DeST 小工具的設定頁，改顏色和透明度沒有正確在上面的預覽顯示，
> 而且我覺得色彩和透明度調整應該放在預覽旁邊，才不用一直上下來回拉看結果」

### 16.1 `#AARRGGBB` vs `#RRGGBBAA`——安靜壞掉的那種錯

設定頁把 `resolveWidgetColors()` 的結果直接塞進 CSS 的 `style`。但那支回的是
**Android 格式 `#AARRGGBB`（alpha 在最前面）**，而 **CSS 的八碼十六進位是
`#RRGGBBAA`（alpha 在最後面）**。

⚠️ **兩種都是合法的八碼十六進位，所以塞錯不會噴任何錯誤**——瀏覽器照樣畫，
只是把 alpha 當成紅色、藍色當成 alpha。結果就是顏色與透明度雙雙錯掉，
而且錯得「看起來像有反應但反應不對」，比整個不動更難聯想到成因。

修法：`shared/widgetAppearance.ts` 新增 `toCssColor()`／`widgetColorsToCss()`，
設定頁的預覽一律走這支。**不要另外算一份 CSS 色票**——那樣預覽與小工具
實際顏色就會各自漂移，跟 §12.4「預覽走同一支計算」是同一個理由。
有測試守著（含一條「轉兩次不等於原值」，把這個格式陷阱釘在測試裡）。

### 16.2 會改變預覽的控制項全部搬到預覽正下方

原本的順序是「預覽 → 顯示哪幾則 → 顯示設定 → 小工具配色」，於是每調一次
顏色都要捲回最上面看效果，預覽等於白做。改成一段「外觀」：

```
外觀
  [預覽（棋盤格底）]
  說明文字
  [12＋1 組配色色票（四欄，13 個只佔四列）]
  [底色透明度拉桿 ─────●── 60%]
  [顯示角色頭像 ✓]
顯示哪幾則
  ⋯⋯
```

三個控制項都會改變預覽（頭像開關也會），所以全部收在同一段裡。
「顯示哪幾則」留在後面——那改的是內容不是外觀，而且點「在對話中查看」
會離開這一頁，本來就不是邊看邊調的東西。

配色格從三欄改四欄，13 個選項從五列縮成四列，讓預覽與控制項在一般手機上
能同框。透明度拉桿吃的是拖曳中的 `opacityDraft`，所以**拖的當下預覽就跟著
變**，不必等放開（放開才寫檔＋叫原生重繪，避免每動一格就灌一次重繪）。

### 16.3 追加的真機待驗項

- [ ] 選配色後**預覽立刻變成那組顏色**（不是變成別的奇怪顏色）
- [ ] 拖透明度時預覽同步變淡，0% 時預覽只剩文字浮在棋盤格上
- [ ] 預覽的顏色跟主畫面上小工具實際的顏色一致
- [ ] 配色／透明度／頭像開關都在預覽底下，調整時不需要捲動

---

## 17. 頭像的底色圓也要跟著配色（2026-08-23 第六輪）

> 「DeST 小工具的頭像背景要跟著顏色設定跑」

**第三個踩到同一條 RemoteViews 限制的地方**（前兩個是容器底板 §14.3、
飲食小工具的按鈕與進度條 §15.1／§15.2）：頭像的圓形底色是
`android:background="@drawable/bg_dest_widget_avatar"`，裡面寫死
`@color/widget_mint2`，而 minSdk 26 的 RemoteViews 不能 tint 背景 drawable。

**這一顆特別容易被忽略，因為它多數時候被頭像蓋住**——但角色圖多半是
**去背 PNG**，透明的地方就會直接露出那顆綠圓。所以換配色時，
使用者看到的是「臉的周圍還是一圈原本的綠」。

修法跟按鈕一樣：**把底色圓畫進 bitmap 裡**，再 `setBackgroundResource(0)`
拿掉 XML 那顆。實作上用 `BitmapShader` 一次畫完：

1. 先用 `accentStrong`（主題的 `mint2`）填一個圓；
2. 再把頭像當成 shader 畫同一個圓——透明的地方自然疊在底色上。

⚠️ **不要沿用原本的「先畫遮罩 → `PorterDuff.SRC_IN`」寫法**：那個模式會
把來源的 alpha 直接套到整層，連剛畫好的底色圓一起挖掉，等於白畫。
改用 shader 也順便少一張暫存 bitmap。

⚠️ **底色圓不吃底板的透明度**，理由同按鈕（§15.1）：臉要看得清楚就得有個
穩定的背景。底板調到全透明時，頭像仍然是一顆看得見的圓形徽章。

`bg_dest_widget_avatar.xml` 留著沒刪——它還是小工具選單裡預覽圖的底色，
但檔案裡已經加註「改這裡不會改變實機顏色」，免得之後有人在那邊白改。
設定頁的預覽也跟著改吃 `colors.accentStrong`（原本吃 App 的 `--mint2`，
換配色後預覽會跟實機對不上）。

### 17.1 追加的真機待驗項

- [ ] 換配色後，**頭像周圍的圓底跟著變色**（去背角色圖最容易看出來）
- [ ] 底板透明度調到 0% 時，頭像底色圓**仍然是不透明的**
- [ ] 頭像本身沒有被底色蓋掉（shader 的疊法正確，不是整顆變色塊）
- [ ] 設定頁預覽的頭像底色跟實機一致
