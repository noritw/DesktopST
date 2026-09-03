# 早安簡報（天氣 → 行程 → 熱搜）— 開工指令

> 狀態：**未實作，設計中**。這份是開工指令，實作時照這份走。
> 前置閱讀：`CLAUDE.md`（必讀）＋ 本文件 ＋ 已完成的
> `docs/weather-proactive-speech-kickoff.md`（同一套發話管線與剎車哲學，這份不重複解釋）。
> 相關程式：`main/index.ts`（`browser-window-focus`）、
> `mobile/runtime/session.ts`（`onAppResumed()`）、
> `main/calendar/index.ts`（`getCalendarContextString`）、
> `core/news/sources.ts`（`fetchBreakoutItems`）、`core/news/filter.ts`（`filterAndPick`）、
> `main/ipcHandlers.ts`（`triggerReminderSpeak`，桌面發話管線終點，天氣模組已在用）。

---

## 1. 這是什麼、不是什麼

**是**：使用者今天**第一次真的理這個 App**（點開視窗／回到前景）時，角色主動打一聲招呼，
帶一句當下最有價值的資訊——天氣、接下來的行程、或今天的熱搜話題，三選一，依優先序，
**有什麼講什麼，沒有就不硬湊**。

**不是**：
- 不是「開機時講」。桌面版是常駐系統匣的（`window-all-closed` 什麼都不做），
  行程可能從昨天就一直活著，開機時間不是好訊號。
- 不是每次視窗聚焦都講。一天只講一次，用日期旗標卡住。
- 不是新資料源。天氣走 `weather-proactive-speech-kickoff.md` 已完成的觀測邏輯；
  行程走桌面既有的 `getCalendarContextString()`；熱搜走新聞模組既有的
  `fetchBreakoutItems()`（Google Trends 台灣熱搜 RSS，新聞報「破圈」分類本來就有）。
- 不是新發話管線。沿用天氣模組已經驗證過的做法：合成虛擬 `Reminder`，
  丟給 `triggerReminderSpeak()`。

---

## 2. 觸發時機：不是開機，是「今天第一次理我」

天氣模組是輪詢觸發（時間到就查一次）；這個是**互動觸發**（使用者做了某個動作才查）。
兩個平台都已經有現成的鉤子，不用新接監聽：

### 2.1 桌面

`main/index.ts` 的 `app.on('browser-window-focus', ...)`（目前用來還原輔助視窗、
廣播 `ui:app-focus`）。這個事件一天會觸發很多次（開聊天視窗、切換視窗都算），
所以邏輯是：

```
每次觸發時檢查「今天講過早安了嗎」（日期旗標，比照天氣模組 rainNotifiedDates 那套）
沒講過 → 講一次，把旗標蓋成今天
講過 → 什麼都不做
```

⚠️ **不要在這個 handler 裡做任何慢動作**（打 API、等 LLM）。現有的
`browser-window-focus` handler 是同步的，混進去會拖慢視窗聚焦的手感。
正確做法：這裡只做旗標檢查（同步、快），符合條件才 `void triggerMorningBriefing()`
丟到背景，不 `await`。

### 2.2 手機

`mobile/runtime/session.ts` 的 `onAppResumed()`（目前用來重讀對話、
補發押後的提醒 `flushDeferredReminders()`）。同一個位置加日期旗標檢查即可，
不用另外接 Capacitor `App.addListener('appStateChange', ...)`——這支已經是
「回到前景」的入口了。

⚠️ **手機的行程資料來源不同**（見 §3.2）：讀本機已同步的日曆衍生提醒，
不是即時查 API，但三層都做得到。

### 2.3 為什麼不是「開機時間」

上面 §1 已經講過理由。多補一句：如果硬要用「開機時間」，最貼近的訊號是
`powerMonitor` 的 `resume`／`unlock-screen` 事件（`reminderScheduler.ts` 已經在用
`powerMonitor.getSystemIdleTime()`，同一個模組），但這個訊號的語意是「電腦醒了」，
不是「使用者理我了」——螢幕鎖著時背景排程任務也會讓系統看起來「有活動」。
`browser-window-focus`／`onAppResumed` 是使用者**主動**跟 App 互動的訊號，更準。

---

## 3. 內容優先序：天氣 → 行程 → 熱搜

依序嘗試，**撈到第一個有內容的就停，不三個都塞**。理由跟天氣模組的
「事件本身放在 ctxParts 最後」是同一個哲學——早安簡報要像一句話，不是三則簡報疊起來。

### 3.1 天氣

複用 `core/weather` 現有的 `getWeatherContextString()`（背景天氣，不是主動發話那條
`observeWeather()`）。有位置設定就有內容，這層幾乎不會落空。

### 3.2 行程（兩平台資料來源不同，但都做得到）

**桌面**：`getCalendarContextString(settings)`——已經處理好「未授權／未連結回
null」、快取、`mentionWhenEmpty` 語意。**直接呼叫既有函式，不用重寫**。

**手機**：手機獨立版沒有 Google OAuth（`docs/calendar-reminders-mobile-kickoff.md`
開頭就寫明「不做 Google OAuth」），**不能**直接呼叫 `getCalendarContextString()`
那條路——但這不代表手機拿不到行程。日曆驅動提醒本來就會經 S2 同步，把桌面
`main/calendar/reminderScanner.ts` 掃出來的行程轉成一則則 `source: 'calendar'`
的 `Reminder` 物件推到手機，手機自己存了一份（`mobile-standalone-reminder-plan.md`
那條同步管線）。行程這一層在手機端改成：

```
篩選本機提醒清單裡 source === 'calendar' 且 schedule.at 落在今天（台北時區）的筆數，
取 schedule.at 最早的一筆當「最早的行程」，label 當標題。
```

⚠️ `schedule.at` 是「事件開始時間 − 提前量」（`reminderScanner.ts` 第 58 行：
`at = ev.start - minutes * 60000`），**不是**事件本身的開始時間，會早個幾分鐘到
幾十分鐘不等。早安簡報這種「隨口提一下」的場合誤差無所謂，但寫 prompt 時
措辭要留餘地（「差不多 10 點有個會議」而不是「10:00 整」），別暗示精確到分鐘。



### 3.3 熱搜（黑名單自動套用，不用另建）

`fetchBreakoutItems(deps, weight)` 拿到熱搜清單（已經照 Google Trends 排序，
第一名＝當下討論度最高），丟進既有的 `filterAndPick(items, newsModuleSettings)`
走一輪——**黑名單、來源排除、語言限制全部沿用**，不用寫新的過濾邏輯
（owner 已確認：黑名單是整個新聞池共用的關卡，破圈項目一樣要過這關，見
`core/news/filter.ts` 第 192 行）。

⚠️ 這一層要求新聞模組本身是啟用的（`isModuleEffectivelyEnabled(NEWS_MODULE_ID, ...)`）。
新聞模組沒開，這層直接跳過，不要另外接一條「早安簡報專用」的新聞抓取路徑。

**如果 `filterAndPick` 選出來的東西經過使用者黑名單、又被 `seenIds` 排除掉，
剩空池**：就當這層沒有內容，早安簡報自然沉默（三層都沒有的話——理論上不會發生，
天氣幾乎必中，但邏輯上仍要處理「三層都空」的情況：直接不觸發、不留旗標，
下次互動再試一次）。

---

## 4. 資料形狀

新檔 `src/core/greeting/morningBriefing.ts`（純邏輯，可測）：

```ts
export interface MorningBriefingSnapshot {
  /** 上次講過早安的日期（YYYY-MM-DD，台北時區） */
  lastGreetedDate: string
}

export type BriefingSource = 'weather' | 'calendar' | 'trending'

export interface MorningBriefingContent {
  source: BriefingSource
  injectionText: string
}

/** 今天是否已經講過（純比對，不碰時間 API，方便測） */
export function shouldGreetToday(snapshot: MorningBriefingSnapshot, todayDate: string): boolean {
  return snapshot.lastGreetedDate !== todayDate
}
```

三層內容的抓取（天氣／行程／熱搜）都要打 API或讀設定，**不適合寫成純函式**，
留在平台層（`main/morningBriefing.ts`）逐層 try、有內容就回傳、都沒有就回 null，
跟 `diffWeatherEvents()` 那種「餵資料進純函式」的形狀不同——這裡沒有好的辦法把
「三個外部依賴的第一個非空結果」硬包成純函式，不用勉強，平台層寫清楚順序即可。

快照持久化：新 key `MORNING_BRIEFING_KEY = 'morning-briefing.json'`
（`core/store/keys.ts`），存讀比照 `weather-watch-snapshot.json` 那組
（`loadMorningBriefingSnapshot`／`saveMorningBriefingSnapshot`，`fileStore.ts`）。

---

## 5. 發話走哪條路

跟天氣模組一模一樣：合成虛擬 `Reminder`，丟給 `triggerReminderSpeak()`。

```ts
const virtual: Reminder = {
  id: `morning-briefing:${Date.now()}`,
  label: '早安簡報',
  prompt: content.injectionText,
  enabled: true,
  schedule: { type: 'once', at: Date.now() },
  createdAt: Date.now(),
  sceneConstraint: 'any_scene',
  injectWeather: false,   // 天氣已經在 injectionText 裡了，不要重複注入
  injectCalendar: false,  // 同理
  injectNews: false,      // 同理
  injectPinnedNotes: false,
  injectConversationContext: true
}
await triggerReminderSpeak(virtual)
```

⚠️ 三個 `inject*` 旗標都要關——`triggerReminderSpeak()` 本身也有天氣／行程／新聞的
自動注入邏輯（`reminder.injectWeather` 等），這裡內容已經在 `prompt` 里手動組好了，
兩邊都開會重複兩份天氣。

`prompt` 的措辭要交代清楚「這是打招呼」，不要讓角色複誦數據：

```
[早安簡報：天氣]
今天台北：多雲，24°C。這是使用者今天第一次跟你互動，用你的角色語氣打聲招呼，
自然帶到天氣就好，不要條列數據。
```

```
[早安簡報：行程]
使用者今天有 3 個行程，最早的是 10:00 的「產品會議」。這是使用者今天第一次
跟你互動，打聲招呼，可以自然提到今天行程比較滿／很空，不用整份唸出來。
```

```
[早安簡報：熱搜]
今天台灣熱搜第一名是「XXX」。這是使用者今天第一次跟你互動，打聲招呼之餘
可以隨口提一下這個話題，但不用假裝很懂，也可以直接問使用者有沒有在關注。
```

三種措辭不同，因為「講天氣」「講行程」「聊熱搜」該有的語氣不一樣——
天氣是背景訊息，行程是提醒，熱搜是話題邀請,別用同一套模板硬套。

---

## 6. 剎車（比天氣模組簡單很多）

早安簡報天生就是稀有事件（一天最多一次），不需要天氣模組那套每日額度／
靜音時段機制。只需要：

1. **一天一次**：靠 §4 的 `shouldGreetToday()`。
2. **對話進行中不插話**：跟天氣模組共用同一個判斷
   （使用者最後一則訊息在 2 分鐘內 → 不觸發，這次互動的「聚焦」本身
   可能就是使用者剛發完訊息切到別的視窗又切回來，不是「使用者剛打開 App」）。
3. **總開關**：預設關閉，比照天氣模組——這是會讓角色主動說話的功能，
   使用者要自己打開。

不需要影子模式——早安簡報不像天氣事件有「誤判會很尷尬」的風險
（叫錯颱風很怪，講錯天氣預報也很怪；早安簡報就算內容普通，最多就是句廢話，
不影響信任感），而且一天最多觸發一次，就算真的講得不好，隔天調整門檻也來得及。

---

## 7. 設定欄位

新的獨立模組設定（不掛在 `weather.proactive` 底下，因為這是跨模組的功能，
不屬於天氣）：

```ts
export interface MorningBriefingSettings {
  enabled: boolean   // 預設 false
}
```

先只有一個總開關就好，**不要一次做太多可調參數**——這個功能唯一會出錯的地方是
「內容選得好不好」，那個由 §3 的優先序決定，不是使用者調得出來的旋鈕。
等實際用過一陣子、發現有具體想調的（比如「不要熱搜這層」），再回來加開關，
不要先猜。

---

## 8. 實作順序

1. `core/greeting/morningBriefing.ts` 的 `shouldGreetToday()` ＋ 單元測試
2. `core/store/keys.ts` 加 `MORNING_BRIEFING_KEY`；`fileStore.ts` 讀寫快照
3. `main/morningBriefing.ts`：三層內容抓取（天氣→行程→熱搜，逐層 try）
4. 接上 `triggerReminderSpeak()`（比照天氣模組的虛擬 Reminder 寫法）
5. 桌面：`browser-window-focus` handler 裡加旗標檢查 + 觸發
6. 手機：`session.ts` 的 `onAppResumed()` 裡加同樣的檢查
   （手機讀本機同步的日曆衍生提醒，見 §3.2；不是即時查 API）
7. 設定 UI：一個開關就好，放在「一般」或「角色」分頁，不需要獨立收合區塊
8. `npm run typecheck` ／ `npm test`

---

## 9. 怎麼驗

用不到天氣模組那套錄回放／影子模式（風險小、頻率天生就低，沒必要）。
直接測：

1. 打開總開關，關掉 App 或至少讓它閒置到隔天（或手動改快照檔案裡的
   `lastGreetedDate` 往回撥一天，跳過等待）
2. 點開 DeST 視窗／手機回到前景，看有沒有講話、講的內容對不對
3. 同一天內再切換幾次視窗焦點，確認**不會**講第二次
4. 分別測三層：故意不設行程（跳過行程只講天氣或熱搜）、故意設一個行程
   （驗證行程優先於熱搜）

驗收條件：一天只講一次，內容跟當下天氣／行程／熱搜對得上，語氣像打招呼
不像報告。
