# Google 日曆驅動提醒 —— 開工指令

> **建立時間**：2026-08-25。
> **狀態**：設計已全部拍板（見 `docs/calendar-driven-reminders-design.md`），
> 這份是給接手 AI 的完整指令，照著這份就能開工，不必先讀設計文件全文。
> **前置**：`CLAUDE.md`（必讀，尤其 §5「進行中仍會踩的坑」）。
> **範圍**：本階段**只做桌面版**（owner 拍板：Google 日曆本來就只能桌面
> 同步，資料源頭在桌面）。手機版排在下一階段，等桌面版規則跑順了再原樣
> 搬過去，不在這份指令範圍內。

---

## 0. 一句話

Google Calendar 事件自帶的提醒設定（`reminders.overrides`）直接轉成 DeST
提醒（一個 override 建一筆，完全唯讀跟隨 Google 端）；桌面提醒清單分成
「日曆同步」／「手動建立」兩個分頁（沒開日曆同步就沒有前者）；日曆分頁
內依「已過期／本週（週一起）／下週／之後依月」分組；桌面開機掃一次＋
每 6–12 小時重掃＋手動「立即同步」按鈕；本機日曆有變動但還沒推到手機時，
角色每天提醒使用者去同步（可在日曆設定關掉）；「推到手機」按鈕視手機
在線與否，走即時同步（跳 toast）或退回 QR 掃碼觸發同步。

---

## 1. 先讀哪些（不要整份掃）

| 順序 | 讀什麼 | 為什麼 |
|---|---|---|
| 1 | `docs/calendar-driven-reminders-design.md` 全文 | 設計本體，所有分岔都已拍板，這份指令是把它落成步驟 |
| 2 | `src/main/calendar/index.ts`、`googleProvider.ts`、`types.ts` | 現有日曆讀取邏輯，本次要擴充的地方 |
| 3 | `src/core/types.ts` 的 `Reminder`／`ReminderSchedule`（約行 485–540） | 本次要加欄位的介面 |
| 4 | `src/core/sync/contentHash.ts` 的 `reminderContentHash()`（約行 113–134） | 本次要加欄位進雜湊 |
| 5 | `src/renderer/src/windows/RemindersManagerWindow.tsx` | 桌面提醒清單／編輯器，本次 UI 改動的主戰場 |
| 6 | `src/main/ipcHandlers.ts` 搜尋 `ReminderDirect`／`injectCalendar`（約行 2670–2720） | 現有提醒 CRUD 與觸發時的素材注入邏輯 |
| 7 | `docs/reminder-sync-kickoff.md` §2、§3 | 提醒同步的既有規則（裝置本地欄位不覆蓋），本次新欄位要遵守同一套原則 |

**不要讀**：`docs/mobile-mode-switch-sync.md` 整份、`docs/mobile-sync-m4-compare.md`
整份——本階段不碰同步邏輯本身（reminders 這個 kind 的同步已經做完），
只是幫日曆衍生提醒補上要進雜湊的新欄位。

---

## 2. 現況（已有的東西，不用重做）

- Google Calendar 讀取：`googleProvider.ts` 已能讀事件 id／標題／地點／
  起訖時間／Google Tasks 待辦，**完全沒有解析 `reminders` 欄位**——這是
  本次第一個要做的事。
- 提醒 CRUD＋原生通知：桌面／手機都已完成，不用碰。
- `injectCalendar` 素材開關：已存在，本次日曆衍生提醒可以直接沿用，
  不用新開關。
- **S2 提醒同步（含 `reminderContentHash()`）已完成**（`CLAUDE.md` 現況表：
  「S2 提醒同步（M4 第六個 kind）已實作，真機待驗」）——本次只需要
  幫這支雜湊函式加兩個新欄位，同步機制本身不用動。
- QR 產生：`ipcHandlers.ts:5991` 的 `mobile:generate-qr` 已經有現成的
  「網址 → QR dataURL」轉換，本次 §7 的 QR 推送可以直接用同一支。
- 即時事件通道：手機端 `RemoteEventSource`（`src/mobile/events/remoteEventSource.ts`）
  已經有 `state-invalidated` 這類事件的收發機制，本次 §7 情況 A 要新增
  一種事件種類走同一條通道，不是另開一條新通道。

---

## 3. 型別擴充

`src/core/types.ts` 的 `Reminder` 介面新增：

```ts
/** 這筆提醒的來源：手動建立，或某個日曆事件衍生。決定它出現在哪個分頁 */
source?: 'manual' | 'calendar'
/** source==='calendar' 時，對應的 Google 事件 id */
sourceEventId?: string
/** source==='calendar' 時，對應事件本身第幾筆 reminders.overrides（同一事件多筆時用來對應） */
sourceOverrideIndex?: number
```

未設定的既有提醒視同 `source: 'manual'`（不用寫遷移，`source !== 'calendar'`
的判斷式天然涵蓋 `undefined`）。

`src/core/sync/contentHash.ts` 的 `reminderContentHash()` 加入這兩個新欄位：

```ts
export function reminderContentHash(r: Reminder): string {
  return hash({
    // ...既有欄位
    source: r.source ?? 'manual',
    sourceEventId: r.sourceEventId ?? '',
    sourceOverrideIndex: r.sourceOverrideIndex ?? -1
  })
}
```

不放 `sourceOverrideIndex` 以外的任何時間戳當比對依據——沿用 CLAUDE.md
「跨裝置判斷『哪份比較新』永遠不能看 `updatedAt`」的原則。

---

## 4. 讀 Google 端提醒設定

`src/main/calendar/googleProvider.ts`：

1. `GoogleEventsResponse` 的事件項目型別加：
   ```ts
   reminders?: { useDefault?: boolean; overrides?: Array<{ method?: string; minutes?: number }> }
   ```
2. 事件若 `reminders.useDefault === true`（或整個 `reminders` 欄位缺失），
   額外打一次 `calendars.get`（`CALENDAR_API}/calendars/{calendarId}`）
   拿該日曆的 `defaultReminders`（同樣是 `[{method, minutes}]` 陣列）。
   **這支只需要打一次、快取起來**（日曆的預設提醒設定不常變，比照現有
   `CACHE_TTL` 10 分鐘的節奏即可，不用每個事件各打一次）。
3. `CalendarEvent`（`main/calendar/types.ts`）保持中性、不擴充——`reminders`
   相關的解析結果**不放進 `CalendarEvent`**，而是在 `googleProvider.ts`
   內部直接組出「事件 + 該用哪幾個 override 分鐘數」的中介資料，交給
   §5 的掃描器使用。理由：`CalendarEvent` 是給「顯示行程」用的既有型別
   （`buildCalendarBlock()` 等函式在用），日曆衍生提醒是另一條使用路徑，
   混進同一個型別會讓兩邊互相牽制。新增一個檔案內部型別（例如
   `CalendarEventWithReminders`）即可，不用動 `types.ts` 的公開介面。

---

## 5. 掃描器：Google 事件 → 衍生提醒

新檔案 `src/main/calendar/reminderScanner.ts`（或依現有慣例併入
`main/calendar/index.ts`，視程式碼量決定）：

### 5.1 核心邏輯

每次掃描：
1. 抓未來一段時間（沿用現有 `lookaheadHours` 設定，或另開一個較長的
   範圍——日曆提醒通常需要看比「注入 prompt 用的行程摘要」更遠的未來，
   例如未來 90 天，讓「兩天後上課」這種提前很多天的提醒也抓得到；
   這個範圍不等於 `CalendarSettings.lookaheadHours`，是掃描器自己的參數，
   建議新增 `CalendarSettings.reminderScanDays`，預設 90）。
2. 每個事件的每筆 `reminders.overrides`（含 §4.2 用日曆預設值展開後的），
   各自算出 `schedule.at = 事件開始時間 - override.minutes * 60000`。
3. 讀出本機現存 `source === 'calendar'` 的提醒，依 `sourceEventId` +
   `sourceOverrideIndex` 建索引，跟這次抓到的結果做三向比對：

| 情況 | 動作 |
|---|---|
| Google 有、本機沒有 | 新建（見 §5.2 模板 + 預設值） |
| 兩邊都有、`schedule.at`／事件標題／地點都沒變 | 不動 |
| 兩邊都有、任一項變了 | 更新 `label`／`prompt`／`schedule.at`，**保留** `notificationDevice`／`wakeMode`／`allowOfflineFallback`／`characterId`／`enabled`／其餘 inject* 開關（使用者可能手動調整過） |
| 本機有、Google 沒有了（事件刪除或 override 被移除） | **直接刪除**（呼叫既有 `deleteReminderDirect()`，不做停用、不留痕跡——owner 拍板：日曆分頁是唯讀鏡射，Google 端才是唯一真相） |

### 5.2 新建提醒的模板與預設值

> ⚠️ **2026-08-25 owner 實測後修訂**：下面的模板已經是修訂後的版本。
> 原設計是 `injectCalendar: true` ＋ prompt 帶 `地點`，實測結果是角色把整份
> 行程（連不相關的「澆花待辦」）跟完整郵遞區號地址一起唸出來。兩項都已改掉，
> 理由寫在 `reminderScanner.ts` 的註解裡。

```ts
{
  source: 'calendar',
  sourceEventId: event.id,
  sourceOverrideIndex: idx,
  label: event.title,   // 顯示用，跟 Google 事件標題一致
  // 不放地點：Google 的 location 多半是「場地名, 完整郵遞區號地址」
  // 日期用絕對日期，不用 dayLabel() 的相對標籤，見下方說明
  prompt: `提醒使用者：${event.title}，時間 ${M}月${D}日 ${hhmm}。`,
  schedule: { type: 'once', at: computedAtMs },
  enabled: true,
  injectCalendar: false,  // prompt 已含事件資訊，再灌整份行程是重複＋每則多花 200–400 token
  notificationDevice: 'both',
  wakeMode: 'always',
  characterId: undefined  // 沿用既有「未設定時觸發時隨機選桌面上的未靜音角色」
}
```

**日期一定要用絕對日期，不要用 `calendar/index.ts` 的 `dayLabel()`**：那支是以
**呼叫當下**為基準算「今天／明天／後天」，但提醒是之後才觸發，兩者對不上；
更麻煩的是它會隨日期漂移，讓 §5.1 拿 prompt 做的「有沒有變」比對每天都判定
有變 → 無謂更新 ＋ 每天觸發一次 §6 的「該同步到手機了」。`hhmm()` 可以用，
但為了讓 `reminderScanner.ts` 不必 import `calendar/index.ts`（那條路會連帶
拉進 electron，整支檔案就變成不可測），時間格式化直接在檔案內寫。

### 5.3 掃描時機

在 `main/index.ts`（app ready 之後）或既有的排程器初始化處，加：
- App 啟動時跑一次。
- 之後 `setInterval`，6–12 小時之間取一個值即可（例如 8 小時），
  不需要讓使用者調整這個間隔。
- IPC handler `calendar:scan-now`（或類似命名，比照現有 `mobile:generate-qr`
  的命名風格），供 §7 的「立即同步」按鈕呼叫，回傳這次掃描的結果摘要
  （新增幾筆／更新幾筆／刪除幾筆，UI 用來顯示「同步完成，新增 3 筆」
  之類的回饋）。
- 掃描只在 `settings.calendar.enabled && isCalendarAuthenticated()` 時執行，
  其餘情況直接跳過（沒開日曆同步的人完全不受影響）。

---

## 6. 「未推送到手機」的角色主動提醒

### 6.1 旗標

新增一個持久化的布林旗標（存哪裡：比照 `reminders.json` 同一層級新建
`calendarSyncFlag.json`，或塞進既有的某個設定檔——**兩者都可以，挑一個
跟現有存檔慣例最接近的**，這個旗標本身不需要進 S2 同步，是桌面本地狀態）：

- §5 的掃描器只要造成任何新增／更新／刪除，就把旗標設為 `true`。
- 使用者透過任何管道（模式切換的逐項比對、或本次新做的 §7 快速推送）
  成功完成一次涵蓋 `reminders` kind 的同步後，把旗標清為 `false`。
  **找到現有同步流程裡「這次同步完成」的那個時間點**（`syncApply.ts`
  的 push/pull 完成處，或 `main/mobileServer.ts` 對應端點回應成功處），
  掛上清除旗標的呼叫。

### 6.2 每天提醒一次

- 旗標為 `true` 期間，比照現有提醒排程器的方式，排一個**桌面限定**
  （`notificationDevice: 'desktop'`）的內部系統提醒，prompt 類似
  「跟使用者說：Google 日曆有更新，記得同步到手機才會收到最新提醒」，
  **每天固定時間觸發一次**（例如比照使用者開機後第一次可互動的時間，
  或簡單訂一個固定時刻如上午 10 點，避免半夜跳出來）。
- 這個系統提醒**不進 `reminders.json` 的日曆分頁**（不是 `source: 'calendar'`），
  也**不需要同步到手機**——它的受眾就是坐在桌面前的使用者。可以用一個
  獨立的排程（例如複用 `ReminderSchedule` 的 `daily` 型別但額外標記
  一個不對外顯示的內部旗標，或完全獨立於 `reminders.json` 之外用
  `setTimeout`/`setInterval` 實作，**不用勉強塞進既有的使用者可編輯提醒
  清單**——這是實作細節，怎麼順手怎麼做，只要滿足「桌面限定、每天一次、
  旗標清掉就停止」三個條件）。

### 6.3 全域開關

日曆設定頁（`CalendarSettingsWindow.tsx`）新增一個開關：
「行事曆有更新時提醒我同步到手機」（預設開）。關掉時：
- §6.2 的排程整個不啟用（旗標仍然可以繼續記錄，但不觸發提醒）。
- 這個設定存在 `CalendarSettings` 型別裡（`core/types.ts`），例如
  `notifyOnUnsyncedChanges?: boolean`（未設定＝預設開）。

---

## 7. 「推到手機」按鈕

日曆同步分頁最上面加一顆「推到手機」按鈕（見 §8 的 UI 位置）。點擊行為：

1. 判斷手機是否在線——**找到現有「模式切換」畫面判斷手機在線的邏輯**
   （搜尋 `ModeSwitcher.tsx` 或 `connection.ts` 裡判斷遙控/直連狀態的
   函式），直接複用同一個判斷，不要另外寫一套探測邏輯。
2. **在線**：透過既有即時事件通道（比照 `state-invalidated` 事件的發送
   方式，`main/index.ts:713` 附近；或 `mobileServer.ts` 的 broadcast 機制）
   送一個新事件種類（例如 `kind: 'reminders-sync-available'`），手機端
   `RemoteEventSource` 收到後自動跑一次 `reminders` 這個 kind 的
   push/pull（**直接複用 S2 M4 現有的比對/套用邏輯，只限定跑
   `reminders` 這個 kind，不用打開完整的比對 UI**——`syncApply.ts` 的
   `pushOne`/`pullOne` 應該已經支援單獨指定 kind 執行，確認一下呼叫
   介面）。完成後手機端跳一個 **toast**（「已同步最新提醒」之類），
   不用系統通知（見設計文件 §7 已拍板的理由：這個情況只會在 App
   開著時發生）。
3. **不在線**：呼叫既有 `mobile:generate-qr` 產生一個 QR，內容是一個
   帶特殊參數的 URL（比照現有 QR 連線／匯入用的 URL 格式，加一個
   query 參數例如 `?action=sync-reminders`），手機掃碼開啟 DeST App 後，
   **偵測到這個參數就直接跑一次 reminders 同步**（不停在某個畫面等
   使用者手動點，掃完就自動執行，執行完顯示結果，比照 S1 一次性匯入
   完成後的既有回饋樣式）。這一段要在手機端的 QR/深連結處理入口
   （搜尋現有 S1 匯入 QR 或模式切換 QR 的處理位置，例如
   `mobile/ui/sync/SyncImportView.tsx` 或啟動時解析 URL 參數的地方）
   加一個新分支。

---

## 8. UI：桌面提醒清單分頁化＋分組

`src/renderer/src/windows/RemindersManagerWindow.tsx`：

### 8.1 分頁

- 「日曆同步」分頁：僅 `settings.calendar.enabled && isCalendarAuthenticated()`
  為真時才渲染這個分頁 tab（不是渲染空分頁，是分頁列本身少一個選項）。
  分頁內容：
  - 頂部「立即同步」按鈕（呼叫 §5.3 的 `calendar:scan-now`）+「推到手機」
    按鈕（§7）。
  - 一行說明文字：「這裡的提醒跟著 Google 日曆走，要新增或取消請回
    Google 日曆設定」。
  - 下方依 §8.2 分組列表。
- 「手動建立」分頁：`reminders.filter(r => r.source !== 'calendar')`，
  維持現有清單樣式與互動（[RemindersManagerWindow.tsx:626](../src/renderer/src/windows/RemindersManagerWindow.tsx:626)
  附近的既有渲染邏輯，原樣搬過來這個分頁，不分組）。
- 只有 1 個分頁可顯示時（沒開日曆同步），**不畫分頁列**，直接顯示
  「手動建立」的內容——沒開日曆同步的使用者畫面應該跟現在完全一樣。

### 8.2 分組規則（僅日曆同步分頁）

`reminders.filter(r => r.source === 'calendar')` 依：

1. **已過期**：`schedule.type === 'once' && schedule.at < Date.now() && !lastTriggeredAt`
   （時間已過但從未觸發過——正常不該出現，離線太久才會有）。**不自動
   刪除**，只是分組顯示，使用者看到自己手動刪。
2. **本週**：週一為起始日（`getDay() === 0 ? 6 : getDay() - 1` 算出距週一
   天數，別用系統 locale 判斷）。
3. **下週**。
4. 之後依月分組（「9月」「10月」…）。

空分組不渲染。分組標頭是純文字，不可互動。

### 8.3 日曆衍生提醒的編輯器欄位鎖定

點進某筆日曆衍生提醒的編輯畫面（沿用現有編輯器元件，不用另開新元件）：

| 欄位 | 顯示狀態 |
|---|---|
| `label`／`prompt`／`schedule.at` | **唯讀**（disabled input 或直接用純文字顯示，不給輸入框） |
| `characterId`／各 `inject*` 開關／`sceneId`／`sceneConstraint` | 可編輯，同現有邏輯 |
| `notificationDevice`／`wakeMode`／`allowOfflineFallback` | 可編輯，預設值已是 `both`／`always` |
| `enabled` | 可編輯，但旁邊加一行小字提醒：「Google 端刪除這個行程時，這筆還是會被移除」 |

---

## 9. 實作步驟順序

1. `core/types.ts`：`Reminder` 加 `source`／`sourceEventId`／`sourceOverrideIndex`；
   `CalendarSettings` 加 `reminderScanDays`／`notifyOnUnsyncedChanges`。
2. `core/sync/contentHash.ts`：`reminderContentHash()` 加新欄位（§3）。
3. `main/calendar/googleProvider.ts`：解析 `reminders` 欄位＋日曆預設提醒
   查詢（§4）。
4. `main/calendar/reminderScanner.ts`（新檔）：掃描器核心邏輯（§5）。
5. `main/index.ts` 或既有排程初始化處：掛上開機掃描＋定時重掃（§5.3）。
6. `main/ipcHandlers.ts`：新增 `calendar:scan-now` handler；新增 §6 的
   旗標讀寫、§7 的「推到手機」相關 handler。
7. `main/windowManager.ts` / `CalendarSettingsWindow.tsx`：新增
   `notifyOnUnsyncedChanges` 開關 UI（§6.3）。
8. §6 的每日提醒排程實作（桌面限定的內部系統提醒）。
9. `RemindersManagerWindow.tsx`：分頁＋分組＋編輯器欄位鎖定（§8）。
10. 手機端：`RemoteEventSource` 加新事件種類的處理分支（§7 情況 A）；
    QR 深連結入口加 `action=sync-reminders` 分支（§7 情況 B）。
    **這兩處是本階段唯一需要碰手機端程式碼的地方**（因為推送機制的
    接收端必然在手機），其餘手機 UI 改動（分頁/分組本身）留到下一階段。
11. `npm run typecheck`／`npm test` 都要過。
12. 真機驗證留給 owner——這份文件寫到「自動測試通過」就算完工。

---

## 10. 已知風險 / 先寫起來，省得重踩

- **`CalendarEvent` 型別不要塞 `reminders` 資料進去**（§4 已說明）——
  它是既有「顯示行程摘要」用的型別，`buildCalendarBlock()` 等既有呼叫端
  不該因為這次改動而要處理新欄位。
- **`reminderContentHash()` 只有一份、直接 import**（不像手機提醒同步
  文件警告的「兩份雜湊邏輯」問題）——確認這次改動只碰 `core/sync/contentHash.ts`
  這一份，手機端如果有獨立複製一份要一起改（比照 `reminder-sync-kickoff.md`
  §8 的警告）。
- **掃描器的「刪除」動作要走既有 `deleteReminderDirect()`**，不要直接
  操作 `reminders.json`，否則會漏掉刪除時該連動清掉的東西（例如提醒
  紀錄關聯，如果有的話）。
- **§6 的每日系統提醒不要跟使用者的「手動建立」提醒混在同一個清單裡**——
  它是內部機制，出現在使用者可見的提醒清單會讓使用者以為自己何時建了
  一個奇怪的提醒。
- **`sourceOverrideIndex` 的順序穩定性**：如果 Google 回傳的 `overrides`
  陣列順序在兩次抓取之間變了（理論上不該變，但不保證），用 index 當
  身分鍵的比對可能誤判成「新增+刪除」而不是「不變」。若要更穩，可以
  改用 `minutes` 數值本身當身分鍵的一部分（同一事件的兩筆 override
  `minutes` 通常不會相同）——實作時視情況調整，不是硬性規定用 index。
- **「推到手機」情況 A 的單一 kind 同步**：確認 `syncApply.ts` 的
  `pushOne`/`pullOne` 是否已經支援「只跑 reminders 這個 kind」的呼叫
  介面；如果目前的介面是綁死跑完整個 `ORDER` 陣列，這裡需要先確認
  改動範圍會不會牽動到 M4 既有的比對流程，別為了這個小功能動到既有
  同步邏輯的穩定性。
