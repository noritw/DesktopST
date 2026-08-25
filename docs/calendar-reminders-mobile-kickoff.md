# Google 日曆驅動提醒：手機版 —— 開工指令

> **建立時間**：2026-08-25。
> **狀態**：桌面版已完成並由 owner 初步實測正常；這份是手機版（下一階段）的開工指令。
> **前置**：`CLAUDE.md`（必讀，尤其 §5「進行中仍會踩的坑」——本次要用到的
> 新條目是「`setTimeout` 的延遲上限是 24.85 天」那條）。
> **範圍**：手機端的**呈現**與**排程正確性**。**不做** Google OAuth，
> 不做掃描器——日曆提醒一律由桌面產生、經 S2 同步過來。

---

## 0. 一句話

手機的提醒清單比照桌面分成「日曆同步」／「手動建立」兩個分頁、日曆分頁內依
「已過期／本週／下週／之後依月」分組、日曆衍生提醒的名稱與時間唯讀；
另外把手機自己的 `setTimeout` 24.85 天溢位修掉。

---

## 1. 先讀哪些（不要整份掃）

| 順序 | 讀什麼 | 為什麼 |
|---|---|---|
| 1 | 本文件全文 | 分岔都已拍板，照做即可 |
| 2 | `docs/calendar-driven-reminders-kickoff.md` **§8**（桌面 UI 規則） | 分頁與分組規則的原始定義，手機照抄同一套 |
| 3 | `src/mobile/ui/settings/RemindersView.tsx`（只有 149 行，整份讀） | 本次 UI 改動的主戰場 |
| 4 | `src/mobile/runtime/reminderScheduler.ts` 的 `scheduleOne()`（約行 168–210） | 溢位要修的地方 |
| 5 | `src/renderer/src/windows/RemindersManagerWindow.tsx` 的 `groupCalendarReminders()` | 桌面已寫好的分組邏輯，本次要抽出來共用 |

**不要讀**：`docs/calendar-driven-reminders-design.md` 全文（那是桌面的產品決策
過程，結論已經濃縮進本文件）、`mobile-mode-switch-sync.md`／`mobile-sync-m4-compare.md`
整份（本階段**完全不碰同步邏輯**，reminders 這個 kind 早就同步好了）。

---

## 2. 現況：手機端已經做了什麼

桌面階段時，只有「接收端必然在手機」的那兩處先做了，其餘刻意留給這一階段：

- ✅ `src/mobile/events/remoteEventSource.ts`：認得 `reminders-sync-available`
  事件（桌面按「推到手機」且手機在線時送的）。
- ✅ `src/core/events/types.ts`：`AppEvent` 多一種 `reminders-sync-available`。
- ✅ `src/mobile/ui/stores/appStore.ts`：收到上面那個事件會自動跑一次
  只限 `reminders` 的同步，完成後跳 toast。
- ✅ `src/mobile/runtime/remindersQuickSync.ts`：只跑 `reminders` 這一個 kind
  的輕量同步（複用 M4 的 `pairManifests`／`applySync`，不開完整比對畫面）。
- ✅ `src/mobile/ui/App.tsx`：QR 深連結 `?action=sync-reminders` 的處理分支。

**還沒做的就是本文件 §4–§7。**

---

## 3. ⚠️ 最大的坑：分頁顯示條件不能照抄桌面

桌面的條件是：

```ts
settings.calendar.enabled && isCalendarAuthenticated()
```

**手機兩個條件都不成立，照抄的話分頁永遠不會出現**，同步過來的日曆提醒
會全部混進「手動建立」裡，或者更糟——被當成看不到的資料：

1. `isCalendarAuthenticated()` 住在 `src/main/calendar/googleProvider.ts`，
   是桌面主行程的東西，手機根本沒有（也不該有，日曆授權明確不做）。
2. `settings.calendar.enabled` 在手機上**永遠是 `false`**。這不是 bug 也不是
   漏同步——`TODO.md` §2.2 已經拍板「Spotify／日曆的 `enabled` 不進設定同步」，
   理由是「授權只接桌面，手機同步開了也沒有對應功能，容易讓人誤以為手機上能用」。

**手機要用的條件是「資料自己說了算」**：

```ts
const hasCalendarReminders = reminders.some(r => r.source === 'calendar')
```

有日曆衍生提醒就顯示分頁，沒有就整個分頁列不畫（跟桌面「只有一個分頁時
不畫分頁列」的行為一致）。這個條件不依賴任何授權或設定狀態，純手機使用者
天然看不到、同步過資料的人天然看得到，兩種情境都對。

---

## 4. UI：分頁 ＋ 分組

改 `src/mobile/ui/settings/RemindersView.tsx`。

### 4.1 分頁

- **「日曆同步」**：`r.source === 'calendar'`，依 §4.2 分組。
  分頁內加一行說明文字：
  > 這些提醒跟著電腦上的 Google 日曆走，要新增或取消請回 Google 日曆設定。

  ⚠️ 文案**不要寫「電腦桌面」以外的假設**，但這裡是少數**真的**必須提到電腦的
  地方（資料來源就在那裡）——寫「電腦上的 Google 日曆」是準確的，不違反
  `CLAUDE.md` 的手機文案獨立原則。
- **「手動建立」**：`r.source !== 'calendar'`，維持現有清單樣式與互動，**不分組**。
- 只有一個分頁可顯示時（沒有任何日曆提醒）**不畫分頁列**，畫面跟現在完全一樣。

### 4.2 分組規則（僅日曆同步分頁）

跟桌面同一套（`calendar-driven-reminders-kickoff.md` §8.2）：

1. **已過期**：`schedule.type === 'once' && schedule.at < Date.now() && !lastTriggeredAt`
   （時間過了但從沒觸發過）。**不自動刪除**，只是分組讓使用者看到「這筆本來
   該提醒但沒提醒到」，自己手動刪。
2. **本週**：**週一為起始日**（`getDay() === 0 ? 6 : getDay() - 1`，
   **不要用系統 locale 判斷**）。
3. **下週**。
4. 之後依月分組（「9月」「10月」…）。

空分組不渲染。分組標頭是純文字、不可互動。

### 4.3 分組邏輯要抽出來共用，不要各寫一份

桌面的 `groupCalendarReminders()` 目前**寫在 `RemindersManagerWindow.tsx` 裡面**。
手機**不要再抄一份**——這個專案已經被「同一套邏輯兩邊各寫一份然後漂移」燒過
不只一次（`contentHash.ts` 的 M4 雙邊定義漂移、`memory` 子集三欄對四欄）。

做法：把它搬到 **`src/core/reminder/calendarGroups.ts`**（純函式、不碰平台），
桌面改成 import 同一支，並補上單元測試（`tests/reminder/` 底下，比照
`tests/calendar/reminderScanner.test.ts` 的寫法）。至少要測：
- 週一起始日的邊界（週日晚上、週一凌晨）
- 已過期只認「沒觸發過」的（`lastTriggeredAt` 有值的不算）
- 空分組不出現
- 跨年時的月分組排序

### 4.4 不要出現在手機上的東西

- ❌ **「立即同步」按鈕**：那是「向 Google 抓取」，手機沒有授權也沒有掃描器。
- ❌ **「推到手機」按鈕**：那是桌面往手機推，手機上沒有意義。
- ❌ 任何 Google 日曆的設定入口。

手機端要更新日曆提醒，走的是既有的 S2 同步（模式切換時的逐項比對、
桌面按「推到手機」、或掃 `?action=sync-reminders` 的 QR）——**不需要新按鈕**。

---

## 5. 日曆衍生提醒的欄位鎖定

比照桌面 §8.3。手機的提醒編輯畫面裡，`r.source === 'calendar'` 時：

| 欄位 | 狀態 |
|---|---|
| `label`／`prompt`／`schedule` | **唯讀**（用純文字顯示，不要給輸入框） |
| `characterId`／各 `inject*`／`sceneId`／`sceneConstraint` | 可編輯 |
| `notificationDevice`／`wakeMode`／`allowOfflineFallback` | 可編輯 |
| `enabled` | 可編輯，但旁邊加小字：「電腦上的 Google 日曆刪掉這個行程時，這筆還是會被移除」 |

時間顯示**一律走 `toLocaleTimeString()`**（`ui/settings/reminderFormat.ts` 已有
`scheduleLabel()`，直接用）——`CLAUDE.md` §5 有這條：自己 `padStart` 拼 24 小時制
會讓同一則提醒在兩端長得不一樣。

---

## 6. ⚠️ 修掉手機自己的 `setTimeout` 溢位

`src/mobile/runtime/reminderScheduler.ts` 的 `scheduleOne()` 目前是：

```ts
const delay = nextFireDelayMs(r.schedule, r.lastTriggeredAt)
...
const t = setTimeout(() => { ... }, delay)   // ← 超過 24.85 天會立刻觸發
```

跟桌面原本一模一樣的寫法。桌面 2026-08-25 已經因此炸過一次（29 筆日曆提醒
裡超過上限的 24 筆開機幾秒內全部觸發、各打一次 LLM 刷滿螢幕，而且 `once`
觸發後自動停用，等於那些行程到日期時反而不會響）。

**手機一定會踩到**：日曆提醒預設 `notificationDevice: 'both'`，而 `scheduleAll()`
會排 `'mobile'` 與 `'both'`；桌面掃描範圍預設 90 天，同步過來就有一大批超過上限的。

### 6.1 修法

用桌面已經抽好的純函式（**已有測試，不要重寫**）：

```ts
import { nextTimeoutStep } from '@core/reminder/nextFire'
```

比照 `src/main/reminderScheduler.ts` 的 `scheduleAt()`：超過上限就先睡滿上限，
醒來用**絕對目標時間**重算剩餘（不要用「剩餘時間相減」，誤差會累積）。

### 6.2 這個症狀在手機上特別難聯想

**原生 AlarmManager 沒有這個問題**——`armNativeAlarm(r, fireAtMs)` 送的是絕對
時間戳，不受 32-bit 限制。壞的只有 JS 那條計時器。所以症狀是：

> **App 開著的時候會刷屏，App 關掉反而正常。**

正常人不會把這兩件事連在一起。真機驗證時**一定要把 App 開著**放一段時間，
只看通知欄是驗不出來的。

### 6.3 順帶確認

`scheduleOne()` 裡 `once` 觸發後是 `r.enabled = false`（只改記憶體）——
確認一下它有沒有真的寫回磁碟。如果有寫回，溢位誤觸會像桌面那樣**把提醒燒掉**
（那 24 筆桌面提醒就是這樣沒的，最後要用一次性腳本救回來）；如果沒寫回，
問題只在當次執行期間。兩種都要修溢位，但影響範圍差很多，值得先確認清楚。

---

## 7. 實作步驟順序

1. `core/reminder/calendarGroups.ts`（新檔）：把桌面的 `groupCalendarReminders()`
   搬過去，桌面 `RemindersManagerWindow.tsx` 改成 import 它（§4.3）。
2. `tests/reminder/calendarGroups.test.ts`（新檔）：補分組的單元測試。
3. `src/mobile/runtime/reminderScheduler.ts`：改用 `nextTimeoutStep()`（§6）。
4. `src/mobile/ui/settings/RemindersView.tsx`：分頁＋分組（§4）。
5. 手機提醒編輯畫面：日曆衍生提醒的欄位鎖定（§5）。
6. `npm run typecheck`／`npm test` 都要過。
7. `npm run build:mobile`，再用 `MobileST.bat [1]` 打包裝機。
8. 真機驗證見 §8。

---

## 8. 真機驗證清單（留給 owner）

1. 手機**沒有**任何日曆提醒時 → 提醒頁面跟現在完全一樣，**看不到分頁列**。
2. 從電腦同步一批日曆提醒過來 → 出現「日曆同步」分頁，分組正確
   （本週／下週／依月），空分組不出現。
3. 「手動建立」分頁只有手動提醒，樣式與互動跟以前一樣。
4. 點進日曆衍生提醒 → 名稱／時間唯讀，角色與裝置選項可改。
5. **把 App 開著放 10 分鐘以上**（§6.2：這是唯一能驗出 JS 計時器溢位的方式）
   → **不該**有任何提醒莫名其妙冒出來。
6. 設一個幾分鐘後的日曆提醒（在電腦的 Google 日曆建、同步過來）
   → 手機在正確時間響。
7. App 劃掉後同一則提醒仍會響（原生 AlarmManager 那條路徑沒被改壞）。

---

## 9. 已知風險 / 先寫起來，省得重踩

- **分頁條件用 `source === 'calendar'` 而不是設定旗標**（§3）——這是本階段
  最容易寫錯的一行，寫錯的症狀是「同步過去了但手機上看不到」，很容易被
  誤判成同步壞掉，然後去翻完全無關的 `syncApply.ts`。
- **分組邏輯不要抄第二份**（§4.3）。
- **溢位的症狀是「開著會刷屏、關掉反而正常」**（§6.2）。
- `source`／`sourceEventId`／`sourceOverrideIndex` 已經在 `reminderContentHash()`
  裡了（桌面階段加的），**本階段不用碰同步邏輯**。
- 手機**不要**有任何「向 Google 抓取」的路徑（§4.4）。掃描器是桌面獨有的，
  手機只是 S2 同步的接收端。
- 桌面那批 prompt 是**絕對日期**（`10月8日 15:45`），不是「今天／明天」——
  手機顯示時不要自作聰明把它轉成相對日期，兩端顯示不一致會讓人以為同步錯了。
