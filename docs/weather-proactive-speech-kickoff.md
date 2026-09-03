# 天氣主動發話（地震／颱風／變天）— 開工指令

> 狀態：**未實作，設計中**。這份是開工指令，實作時照這份走。
> 前置閱讀：`CLAUDE.md`（必讀）＋ 本文件。其餘長文都不用開。
> 相關程式：`core/weather/realtimeQuery.ts`、`main/reminderScheduler.ts`、
> `main/ipcHandlers.ts` 的 `triggerReminderSpeak()`、`core/reminder/gate.ts`。

---

## 1. 這是什麼、不是什麼

**是**：角色在使用者**沒有開口**的情況下，因為外界天氣事件而主動說一句話。
「剛剛有地震你還好嗎」「明天會下雨記得帶傘」「颱風好像要來了」。

**不是**：
- 不是「隨機閒聊」。沒有事件就永遠不說話。
- 不是新的資料來源。CWA 三支 API（預報 `F-C0032-001`、地震 `E-A0016-001`、
  颱風 `W-C0034-005`）`core/weather/realtimeQuery.ts` 已經在打了，**資料通道是通的**。
- 不是新的發話管線。發話沿用提醒既有那條（見 §5）。

⚠️ **這會解除 `CLAUDE.md` §3「第一版排除：自動發話」那條**。這份文件本身就是
owner 的決策紀錄；實作完成後要回頭改 `CLAUDE.md` 的那一行，改成
「自動發話：僅限事件驅動，見 `weather-proactive-speech-kickoff.md`」。

---

## 2. 核心設計：偵測「轉變」，不是偵測「狀態」

這是整份文件最重要的一句話。

現有的即時查詢是**問答式**的：使用者問「有颱風嗎」，就去看現在有沒有颱風，
回答當下狀態。主動發話不能這樣做——「現在有颱風」這件事會連續成立好幾天，
每次輪詢都會成立，於是角色每 15 分鐘講一次颱風。

主動發話要偵測的是 **`false → true` 的那一瞬間**：

| 事件 | 觸發條件（轉變） | 不觸發（狀態） |
|---|---|---|
| 地震 | 出現一筆 `EarthquakeNo` 是我沒看過的 | 「最近有地震」 |
| 颱風發布 | 上次快照沒有颱風、這次有 | 「現在有颱風」 |
| 颱風解除 | 上次有、這次沒有 | — |
| 明日降雨 | 明日 PoP 跨過門檻，且今天還沒講過 | 「明天會下雨」 |
| 溫差變天 | 明日最高溫與今日差 ≥ 5°C，且今天還沒講過 | — |
| 好天氣邀約 | （**唯一例外**，見 §2.1） | — |

所以**必須有一份持久化的快照**（上一次看到的世界長什麼樣），
比對用的是「這次 vs 上次」，不是「這次 vs 門檻」。

### 2.1 好天氣邀約是唯一的例外

「明天天氣很好，要不要出去走走」跟上面五種**性質不同**：它不是在報告一個
事件，而是**看到一段舒服的狀態時提出邀約**。沒有「轉變」可以偵測——連續三天
好天氣，第二天照樣值得約，這跟颱風連續三天不該重複講剛好相反。

所以它不走快照比對，走**節流**：條件成立就觸發，但有硬性最小間隔
（預設 7 天最多 1 次）。這是整份設計裡唯一一個「狀態式」觸發，
也因此**是最容易變吵的一個**，門檻要設得比直覺更嚴。

還有一個判斷上的陷阱：**天氣好本身不稀奇**。台北五月可以連著兩週都很好，
每天都符合「好天氣」。真正值得講的是「**一段陰雨之後，明天終於放晴**」——
這樣就又回到轉變了，而且體感對得多。所以條件裡要加一條
「過去 3 天當中至少有 1 天下過雨」，把它從「報天氣」變成「久違的好天氣」。

---

## 3. 資料形狀

新檔 `src/core/weather/proactive.ts`（純邏輯，**不碰 fs／electron**，`npm test` 要涵蓋）。

```ts
/** 上一次觀測到的世界狀態，持久化到磁碟 */
export interface WeatherWatchSnapshot {
  /** 已經講過的地震編號（CWA 的 EarthquakeNo），只留最近 20 筆 */
  seenEarthquakeNos: number[]
  /** 上次觀測到的颱風中文名清單；空陣列＝當時無颱風 */
  activeTyphoonNames: string[]
  /** 已經發過「明日降雨」的日期（YYYY-MM-DD，台北時區），只留最近 7 筆 */
  rainNotifiedDates: string[]
  /** 已經發過「變天」的日期，同上 */
  tempSwingNotifiedDates: string[]
  /** 上次發出好天氣邀約的時間戳；0＝從未。節流用，見 §2.1 */
  lastNiceDayAt: number
  /** 過去幾天的天氣概況（判斷「久違的放晴」用），只留最近 5 天 */
  recentDaySummaries: Array<{ date: string; rainy: boolean }>
  /** 上次成功輪詢的時間戳；用於判斷是否錯過太久 */
  lastPolledAt: number
}

export type WeatherEventKind =
  | 'earthquake'
  | 'typhoon_appear'
  | 'typhoon_clear'
  | 'rain_tomorrow'
  | 'temp_swing'
  | 'nice_day'

export interface WeatherEvent {
  kind: WeatherEventKind
  /** 注入給 LLM 的事實描述，格式比照 `[即時查詢：...]` */
  injectionText: string
  /** 事件發生時間（地震＝發震時間；其餘＝觀測時間） */
  occurredAt: number
}
```

**核心純函式**（這支是測試的重點）：

```ts
export function diffWeatherEvents(
  prev: WeatherWatchSnapshot,
  observed: ObservedWeather,   // 三支 API 解析後的當下狀態
  now: number
): { events: WeatherEvent[]; next: WeatherWatchSnapshot }
```

輸入輸出都是純資料，方向明確，好測。**不要把「要不要發話」的判斷寫進呼叫端的
if/else**——M4 同步那次的教訓是「方向變成資料而非程式分支，錯誤類別就消失」，
同一個道理。

---

## 4. 門檻（全部可在設定調整，但預設值要保守）

| 事件 | 預設門檻 | 理由 |
|---|---|---|
| 地震 | 使用者所在縣市震度 **≥ 3 級**，且發震在 **30 分鐘內** | 震度 1–2 級多數人沒感覺，講了很怪。超過 30 分鐘才講會像事後諸葛 |
| 颱風 | 有／無的轉變，不設強度門檻 | CWA 有列出來就代表在影響台灣 |
| 明日降雨 | 明日白天 PoP **≥ 60%** | 低於這個「帶傘」的建議會常常落空，角色會失去可信度 |
| 溫差變天 | 明日最高溫 − 今日最高溫的**絕對值 ≥ 5°C** | 升溫降溫都算 |
| 好天氣邀約 | 下列**全部**成立：明日白天 `Wx` 屬晴／多雲、PoP **≤ 20%**、最高溫 **20–29°C**、**過去 3 天內至少 1 天下過雨**、距上次邀約 **≥ 7 天** | 見 §2.1。溫度上限比體感嚴，32 度的大晴天沒人想出門 |

**震度是字串不是數字**（CWA 回 `"3級"`、`"4級"`、`"5弱"`、`"5強"`）。
要寫一支 `parseIntensity(s: string): number`，`5弱`→5、`5強`→5.5。
**不要用 `parseInt` 了事**，`"5弱"` 會變 5 剛好對，但 `"6強"` 的排序會錯。

**震度取哪個地區**：`Intensity.ShakingArea[].areaName` 要對上使用者設定的縣市。
`realtimeQuery.ts` 現在寫死找「臺北／台北」（見 `fetchEarthquake`），
**這是既有的硬編碼，這次要一起改成讀天氣設定的縣市**，兩處共用一支
`findIntensityForCounty()`。注意 CWA 的 `areaName` 有「臺／台」兩種寫法，
比對前要正規化。

---

## 5. 發話走哪條路

**不要新寫發話管線。** 桌面已經有一條完整的「系統決定要說話 → 挑角色 → 組
context → 打 LLM → 冒泡泡」，就是 `ipcHandlers.ts` 的 `triggerReminderSpeak()`。

做法：合成一個**虛擬 Reminder**餵給它。

```ts
const virtual: Reminder = {
  id: `weather:${event.kind}:${event.occurredAt}`,
  label: '天氣主動發話',
  prompt: event.injectionText,
  characterId: undefined,        // 讓既有邏輯隨機挑桌面上沒靜音的角色
  enabled: true,
  schedule: { type: 'once', at: Date.now() },
  // ...其餘欄位比照既有預設
}
await triggerReminderSpeak(virtual)
```

**這樣白撿到的東西**（全部不用重做）：
- 角色不在桌面時自動叫回來、角色已刪除時的替補訊息
- 空對話時注入角色開場白
- `core/reminder/gate.ts` 的情境比對（TRPG 跑團中不該跳天氣，這個很重要）
- 桌面的 `powerMonitor` 閒置跳過（`setIdleSkipMinutes`）
- 手機端的 `screen_on_only`／通知 channel

**但要注意**：`triggerReminderSpeak()` 會寫 `lastTriggeredAt` 回 `reminders.json`。
虛擬提醒不在那份清單裡，`findIndex` 會回 -1，這條路徑走得通（現有程式碼有
`if (idx >= 0)` 的保護），但**實作時要親自確認一次**，不要假設。
如果會髒到檔案，就把發話那段從 `triggerReminderSpeak()` 抽成一支
`speakAsCharacter(ctxParts, options)`，兩邊共用。

### 5.1 上下文要放多少（owner 提問）

**要放，但只放摘要 ＋ 少量近期訊息，而且一定要配壓制句。**

「放全文容易把提醒內容洗掉」這個觀察是對的，而且**日曆提醒那次已經踩過並修好**：
`triggerReminderSpeak()` 裡那句「天氣／便利貼／新聞／行程如果有，只是順帶提及、
別喧賓奪主，尤其不要把行程表整串列出來」就是那次補的，起因正是角色會把整份
行程唸出來，而不是講該提醒的那一件事。

天氣主動發話沿用同一套：

- 對話紀錄走既有的 `contextMessages(conv.messages, settings.memory.keepRecentN)`，
  **不要放全文**。這已經被 `injectConversationContext` 旗標控制著，
  虛擬提醒把該旗標設 true 即可，不用新寫。
- 記憶摘要**要放**。「你上禮拜說想找地方走走」這種連結正是主動發話的價值所在，
  而摘要是壓縮過的，不會把事件洗掉——會洗掉事件的是**大量原始訊息**，不是摘要。
- **事件本身放在 `ctxParts` 最後、緊鄰 `[發話重點]`**。最靠近生成位置的內容
  權重最高，這是實測出來的。
- `[發話重點]` 要為天氣**改寫一句專屬的**，不要沿用提醒那句——那句提到
  「提醒指令」，但天氣路徑沒有那個區塊，模型會找不到指涉對象而自由發揮。

好天氣邀約是唯一一個**應該**多放一點上下文的：它要能接到「你之前說想去哪」，
摘要在這裡不是雜訊而是主料。

### 5.2 prompt 措辭

不要只丟事實，要指示語氣：

```
[天氣事件：地震]
剛剛發生地震（14:23，規模 M5.2，震央宜蘭外海），使用者所在的台北市震度 3 級。
請以你的角色語氣，簡短地關心使用者是否安好。不要複述完整的數據，像朋友一樣講一句話就好。
```

---

## 6. 輪詢：多久一次、誰在跑

### 6.1 桌面

新檔 `src/main/weatherWatcher.ts`（平台層，比照 `reminderScheduler.ts`）。

- 間隔：**地震 5 分鐘、颱風 30 分鐘、預報類 1 小時**。三個獨立計時器。
  地震要密是因為「剛剛有地震你還好嗎」有時效性，隔 30 分鐘問就沒意義了。
- 預報類（降雨／變天）**不要在半夜輪詢就發話**——見 §7 的靜音時段。
- 開機後延遲 30 秒才第一次輪詢（避開啟動尖峰）。
- **一定要用 `scheduleAt()` 的絕對時間寫法，不要裸 `setTimeout(delay)`**。
  這裡的間隔都遠小於 24.8 天，不會溢位，但保持一致；日後有人改成「每週摘要」
  才不會重演日曆提醒那次的翻車（`CLAUDE.md` §5 有記）。
- 電腦休眠醒來後，`lastPolledAt` 距今超過 2 小時 → 立刻補跑一次，
  但**地震事件要重新套 30 分鐘時效**，過期的不補講。

### 6.2 手機

**這一階先不做手機。** 理由：手機要走 AlarmManager 才能在背景輪詢，而
每 5 分鐘喚醒一次會被 Doze 打回票，也很耗電。手機版的正解大概率是
**接 CWA 的推播或改用地震速報 App 的既有通知**，那是另一個設計題。

桌面先做完、跑順、確認發話頻率不煩人，再談手機。

---

## 7. 剎車（這節不能省）

主動發話的預設答案是「不講」。每個事件都要通過：

1. **每日總量上限**：預設一天最多 3 則主動天氣發話。超過就丟棄
   （不排隊，隔天不補）。
2. **靜音時段**：預設 23:00–08:00 不發話。**地震是唯一例外**——半夜地震
   本來就會把人搖醒，這時候角色說話是合理的。
3. **同事件去重**：靠 §3 的快照。同一顆地震、同一個颱風、同一天的降雨，
   只講一次。
4. **總開關 + 逐事件開關**：五種事件各自可關。天氣設定頁新增一區。
   **全部預設關閉**——比照 Health 那次的做法，主動發話是有侵入性的功能，
   使用者要自己打開。
5. **對話進行中不插話**：使用者最後一則訊息在 2 分鐘內 → 延後 5 分鐘再試。
6. **好天氣邀約另有一套**（它不受 §3 快照去重保護，見 §2.1）：
   - 最小間隔 7 天，**且不共用每日額度**——它應該是稀有事件，
     不是「今天額度還沒用完就補一則」。
   - 發話時段限白天 09:00–18:00。晚上十點說「明天天氣很好要不要出去走走」
     語氣是對的，但那個時間講會變成打擾。
   - 即使總開關開了，`niceDay` 仍預設 false，要再打開一次。

---

## 8. 設定欄位

加在既有的 `WeatherSettings` 底下（`getWeatherSettingsDirect` 那一組）：

```ts
proactive: {
  enabled: boolean              // 總開關，預設 false
  earthquake: boolean           // 預設 true（總開關開了之後）
  earthquakeMinIntensity: number // 預設 3
  typhoon: boolean              // 預設 true
  rainTomorrow: boolean         // 預設 true
  rainThreshold: number         // 預設 60
  tempSwing: boolean            // 預設 false（比較吵，預設關）
  tempSwingThreshold: number    // 預設 5
  niceDay: boolean              // 預設 false（見 §7.6）
  niceDayMinIntervalDays: number // 預設 7
  shadowMode: boolean           // 預設 true，見 §10.3
  dailyLimit: number            // 預設 3
  quietHours: { start: number; end: number }  // 預設 23 / 8
}
```

⚠️ **這是「模組底下的子設定」**，S2 M5 的設定同步子集
（`core/sync/settingsSnapshot.ts`）要記得一起加——`weather.polish` 那次
就是漏在這裡，`CLAUDE.md` 的 S2 M5 那列有記。**這次別再漏**。

---

## 9. 實作順序

1. `core/weather/proactive.ts` 的 `diffWeatherEvents()` ＋ 單元測試
   （**先寫這個**。前五種事件各兩條測試：轉變時觸發、狀態持續時不觸發。
   好天氣邀約另外測：節流未到期不觸發、過去三天沒下過雨不觸發）
2. `parseIntensity()` ＋ `findIntensityForCounty()`，順手修掉
   `realtimeQuery.ts` 寫死台北那處
3. 快照的讀寫（`fileStore`，新檔 `weather-watch.json`）
4. `main/weatherWatcher.ts` 三個計時器
5. 接上 `triggerReminderSpeak()`（先確認 §5 那個 `lastTriggeredAt` 的疑慮）
6. §7 的剎車
7. 設定 UI ＋ §8 的同步子集
8. `npm run typecheck` ／ `npm test`

---

## 10. 怎麼驗

owner 提到「這個可能不太好測」——對，而且難的不是正確性，是**頻率**。
分三層，第三層才是真正的答案。

### 10.1 錄回放（驗正確性）

把真實的 CWA 回應存成 fixture 進 `tests/fixtures/cwa/`：一次有感地震、
一次颱風從發布到解除的**完整序列**、幾天份的預報。`diffWeatherEvents()`
是純函式，餵 fixture 就能跑完整劇本，不必等真的地震。
颱風那組序列一定要錄，「發布 → 持續三天 → 解除」是最容易寫錯的一段。

### 10.2 模擬按鈕（驗語氣）

天氣設定頁加一顆隱藏的「模擬事件」按鈕（debug build 才顯示），
可以手動觸發六種事件各一次，看角色講出來的話像不像樣。

### 10.3 影子模式（驗頻率——最重要的一層）

加一個 `proactive.shadowMode` 開關，**預設開啟**：所有判斷照跑、事件照算，
**但不發話**，只把「本來會在這個時間講這件事」寫進一份 log
（`%APPDATA%\DesktopST\weather-proactive-shadow.log`）。

先讓它影子跑一到兩週，然後回頭讀那份 log：如果「本來會講」的次數和時機
你看了覺得舒服，再關掉影子模式讓它真的說話。

這一層的成本極低（發話那行換成寫 log），但它是**唯一能在不打擾自己的前提下
驗證頻率的方法**。主動發話的功能死因幾乎都是「前三天被吵到就整個關掉」，
影子模式正是為了避開那個死法。**實作時一起做，不要當 nice-to-have。**

### 10.4 真機觀察

地震不能點餐，所以還是要有：

- 天氣設定頁加一顆隱藏的「模擬事件」按鈕（debug build 才顯示），
  可以手動觸發五種事件各一次，看角色講出來的話像不像樣。
- 真的地震來的時候記下感受：太快？太慢？講得太細？
- **跑一週再判斷**。主動發話的問題幾乎都是「頻率」，而頻率要時間才看得出來。

驗收條件：連續 7 天，主動發話總數 ≤ 10 則，且每一則你回頭看都覺得
「這則該講」。有任何一則讓你覺得吵，就把對應門檻調高。
