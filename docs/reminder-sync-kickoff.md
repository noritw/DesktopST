# 提醒同步（S2 新分類）—— 開工指令

> **建立時間**：2026-08-22。
> **狀態**：待開工，尚未寫過一行程式碼。owner 方向已拍板（見 `TODO.md` §2.3），
> 這份文件把方向落成可以直接照做的步驟。
> **這份是給接手 AI 的完整指令，照著這份就能開工，不必先讀長文。**
> **前置**：`CLAUDE.md`（必讀，尤其 §5「進行中仍會踩的坑」）。

---

## 0. 一句話

現有 S2 M4「逐項比對」（角色／人設／世界觀／Lorebook／情境）加一個新分類
**提醒（reminders）**，同樣走「id／名稱配對＋使用者逐列選手機／電腦／不動」。
跟角色那些**不一樣的地方**：提醒物件裡有幾個欄位是「裝置本地設定」，
同步時**不能整包覆蓋**，這是這次工程的核心難點，不是把 `characters` 換成
`reminders` 這麼單純。

---

## 1. 先讀哪些（不要整份掃）

| 順序 | 讀什麼 | 為什麼 |
|---|---|---|
| 1 | `src/core/sync/pair.ts` 全文（不長） | 逐項比對的核心演算法：`KINDS`／`PairTable`／`PairChoice`／`actionFor`／`defaultChoice`。這次要加的東西幾乎都是「在既有結構裡多一個 kind」 |
| 2 | `src/core/sync/contentHash.ts` 的 `characterContentHash()` | 內容雜湊怎麼寫的範本——**只挑會影響「內容是否相同」的欄位**，刻意排除裝置專屬／不重要的欄位 |
| 3 | `src/mobile/runtime/syncApply.ts` 的 `pushOne()`／`pullOne()` 裡 **`scenes` 那個 case**（約行 245–360） | **這是這次最重要的參考範例**：情境的 `desktopCharacters` 座標/大小/翻面「是電腦專屬的，一律沿用電腦上原本那份，不要用手機的值覆蓋」——提醒的 `notificationDevice`／`wakeMode`／`inactiveBehavior` 要套用一模一樣的手法 |
| 4 | `src/core/types.ts` 的 `Reminder` 介面（約行 488–535） | 看清楚哪些欄位是「內容」、哪些是「裝置本地」，見 §3 |
| 5 | `src/mobile/ui/shell/SyncComparePicker.tsx` | 確認它是不是真的用 `KINDS.map()` 泛用渲染（目前看起來是，line ~266），只要加標籤字串多半就會自動出現分頁 |
| 6 | `docs/mobile-sync-m4-compare.md` | M4 逐項比對整體設計的來龍去脈（為什麼不用基準表、配對規則怎麼定案），加新 kind 之前建立正確的心智模型 |

**不要讀**：`docs/mobile-sync-m3-kickoff.md`（M3 已被 M4 取代，只在追歷史才看）；
`docs/mobile-mode-switch-sync.md` 整份（對話同步走完全不同的模型，見 §2，
只需要知道「提醒不是那種」，不必研究它怎麼做的）。

---

## 2. 現況（已經有的東西，不用重做）

- **桌面／手機都已經有完整的提醒 CRUD**，不是新功能：
  - 桌面：`main/ipcHandlers.ts` 的 `listRemindersDirect()`／`createReminderDirect()`／
    `saveReminderDirect()`／`deleteReminderDirect()`，資料存 `fileStore.ts` 的
    `loadReminders()`/`saveReminders()`（`reminders.json`）。
  - 遙控 HTTP 端點也已經有：`main/mobileServer.ts` 的
    `GET /api/reminders`、`POST /api/reminders/create`、`/save`、`/delete`、`/toggle`
    ——這些是給「手機遙控操作電腦提醒」用的即時 CRUD，**這次同步可以直接借它們
    當 push 的執行端點**，不用另開新 API。
  - 手機獨立版：`mobile/runtime/session.ts` 的 `createReminder()`／`saveReminder()`／
    `removeReminder()`（約行 1907–1970），資料存本機 `reminders.json`
    （`core/store/keys.ts` 的 `REMINDERS_KEY`）。
- **提醒歷史紀錄不在這次範圍內**：`ReminderHistoryItem`／`reminder-history.json`
  是衍生資料（觸發後的紀錄），跟 `REMINDER_CACHE_KEY` 一樣**不進同步**，不用管它。

---

## 3. 這次唯一的難點：哪些欄位不能被覆蓋

owner 拍板（`TODO.md` §2.3）：**提醒清單本身要同步**，但
**「哪台裝置響」跟「裝置本地的細節設定」留在各自裝置、不同步**。
對照 `Reminder` 介面（`core/types.ts`），這句話具體指：

| 欄位 | 分類 | 同步時怎麼處理 |
|---|---|---|
| `label`／`prompt`／`schedule`／`enabled`／`injectPinnedNotes`／`injectConversationContext`／`injectWeather`／`injectNews`／`injectCalendar`／`sceneId`／`sceneConstraint` | **內容**，兩邊該一致 | 進 `reminderContentHash()`，正常比對／覆蓋 |
| `notificationDevice` | **裝置本地**（字面上就是「哪台裝置響」） | **不進雜湊，push/pull 時保留接收端原值**（新增時才用來源端值當初始值） |
| `wakeMode`／`inactiveBehavior` | **裝置本地**（手機限定概念，桌面沒有對應行為） | 同上 |
| `allowOfflineFallback` | ⚠️ **待你判斷／或問 owner** | 語意是「連不上網時要不要用快取台詞」，比較像手機端的容錯行為而非「內容」，先當裝置本地處理（不進雜湊、保留接收端值），若 owner 有不同意見再調整 |
| `conversationId` | **內容裡的參照，但跨端 id 對應可能解不開** | 見 §5 的說明，不要整包死參照推過去 |
| `characterId`／`sceneId` | **內容裡的參照，本身就有現成的 id 對應表可以用** | 見 §5 |
| `lastTriggeredAt` | **衍生狀態，跟裝置本地一樣處理** | 不進雜湊，保留接收端原值（不是「哪邊比較新就用哪邊」——見 CLAUDE.md §5「跨裝置判斷『哪份比較新』永遠不能看 `updatedAt`」那條的同類提醒） |

**核心規則**：push／pull 提醒物件時，**不能整包覆蓋接收端原本的紀錄**。
做法比照 `syncApply.ts` 的情境案例：

1. 若這筆在接收端已存在（`row.remoteId` 或 `row.localId` 有值），**先讀接收端現有的那筆**
   （push 時用 `GET /api/reminders` 找到對應 id 的那筆；pull 時直接讀
   `session.reminders` 裡對應的那筆）。
2. 把接收端原有的 `notificationDevice`／`wakeMode`／`inactiveBehavior`／
   `allowOfflineFallback`／`lastTriggeredAt` 蓋回要送出的物件上，其餘欄位才用
   來源端的值。
3. 若接收端本來沒有這筆（新增），才整包直接用來源端的值（此時沒有「接收端原值」
   可以保留）。

---

## 4. 內容雜湊（`reminderContentHash()`）

比照 `contentHash.ts` 現有的 `characterContentHash()` 寫法，新增一支：

```ts
export function reminderContentHash(r: Reminder): string {
  return hash({
    label: r.label,
    prompt: r.prompt,
    schedule: r.schedule,
    enabled: r.enabled,
    injectPinnedNotes: !!r.injectPinnedNotes,
    injectConversationContext: !!r.injectConversationContext,
    injectWeather: !!r.injectWeather,
    injectNews: !!r.injectNews,
    injectCalendar: !!r.injectCalendar,
    sceneId: r.sceneId ?? '',
    sceneConstraint: r.sceneConstraint ?? 'any_scene'
    // 刻意不放：notificationDevice / wakeMode / inactiveBehavior /
    // allowOfflineFallback / lastTriggeredAt / characterId / conversationId
    // （後兩個是 id 參照，兩端 id 本來就不同，放進雜湊只會讓每一筆永遠判定「不同」）
  })
}
```

⚠️ **這支函式的手機端複本**（`mobile/runtime/syncManifest.ts` 的
`buildLocalManifest()` 目前怎麼幫角色算 hash，就是照抄 `characterContentHash`
——如果桌面端 manifest 端點是各自維護一份邏輯而不是 import 同一份 `core/`
函式，兩邊都要改，且欄位順序/選取要完全一致。動工前先確認桌面端 manifest
端點的實作方式（見 §6）。

---

## 5. id 參照：`characterId` / `sceneId` / `conversationId`

`syncApply.ts` 已經有 `maps.l2r.characters`／`maps.l2r.scenes`（`Maps` 型別，
push/pull 過程中累積的「這次同步下，手機 id ↔ 電腦 id」對照表）——**提醒的
`characterId`／`sceneId` 可以直接借這個對照表轉換**，前提是 reminders 這個 kind
要排在 `characters`／`scenes` **之後**執行（`syncApply.ts` 的 `ORDER` 常數
目前是 `['lorebooks', 'characters', 'personas', 'worlds', 'scenes']`，
把 `'reminders'` 加在最後面）。

`conversationId` **沒有對應的 id 對照表**——對話同步（`convPair.ts`）是完全
獨立的一套配對邏輯，不在 `Maps` 型別涵蓋範圍內，而且對話同步跟這次的
逐項比對可能不是同一次操作觸發。**這裡直接比照 `syncApply.ts` 裡角色參照解不開
時的做法**（`syncApply.ts:266-268` 那段「對不到電腦上的角色就整項不推」的注解）：
`conversationId` 對不到就整欄位不推（設為 `undefined`），**不要推一個死參照過去**
——死參照比「這筆提醒暫時沒綁對話」的體驗損失小很多。這點**先照這個做，
不用等 owner 拍板**，是延續既有慣例、不是新決定。

---

## 6. 桌面端 manifest 從哪來（動工前先找到這個位置）

`GET /api/sync-manifest`（M2 就有的端點）目前回傳角色／人設／世界觀／
情境／Lorebook 的清單＋雜湊。找到它在 `main/` 底下的實作位置（搜尋
`sync-manifest` 或 `buildManifest`），照現有角色/情境那組的寫法加一組
`reminders`：讀 `listRemindersDirect()`，每筆算 `reminderContentHash()`
組成 `PairEntity[]`。

---

## 7. 實作步驟順序

1. `core/sync/pair.ts`：`KINDS` 陣列加 `'reminders'`（`PairKind` 型別自動跟著長出來，
   TypeScript 會在所有沒處理到這個 kind 的 `Record<PairKind, …>` 用法報錯——
   **這是好事**，順著錯誤訊息把每個地方補齊，不會漏掉）。
2. `core/sync/contentHash.ts`：新增 `reminderContentHash()`（§4）。
3. `core/sync/types.ts`：`Manifest` 型別加 `reminders: PairEntity[]`。
4. 桌面端 manifest 端點：加 `reminders` 區塊（§6）。
5. `mobile/runtime/syncManifest.ts`：`buildLocalManifest()` 加讀本機
   `session.reminders`、算 hash、組陣列。
6. `mobile/runtime/syncApply.ts`：
   - `ORDER` 常數加 `'reminders'`（排最後）。
   - `KIND_LABEL` 加 `reminders: '提醒'`。
   - `pushOne()` 加 `reminders` case：組出待推送物件（含 §3 的欄位保留邏輯、
     §5 的 id 轉換），呼叫 `POST /api/reminders/save`（`row.remoteId` 有值時
     帶上那個 id 做覆蓋，比照現有 `personas`/`worlds` case 的寫法）。
   - `pullOne()` 加 `reminders` case：呼叫 `GET /api/reminders` 或桌面端能不能
     單筆查（沒有的話用列表裡挑出對應 id 那筆），組出物件後呼叫本機
     `session.saveReminder()`。
   - `deleteLocal()`／`deleteRemote()` 加 `reminders` case：本機呼叫
     `session.removeReminder(id)`；電腦端呼叫 `/api/reminders/delete`。
7. `mobile/ui/shell/SyncComparePicker.tsx`：確認 `KINDS.map()` 迴圈能不能直接
   吃到新 kind；`KIND_LABEL`（或這支檔案自己那份標籤映射，可能跟
   `syncApply.ts` 裡那份是分開維護的兩份，都要補）加 `reminders: '提醒'`。
8. 新增測試：仿 `tests/mobile/modeSwitchSync.test.ts`／既有 M4 比對的測試檔，
   至少涵蓋：
   - 新增（單邊獨有）能正確推/拉。
   - 兩邊都有、內容不同時能正確判定 `differs`。
   - **裝置本地欄位不會被覆蓋**（這是這次最容易漏測的地方——寫一個案例：
     手機這筆 `notificationDevice: 'mobile'`，電腦那筆同 id 但
     `notificationDevice: 'desktop'`，選「以手機為準」推過去後，電腦端的
     `notificationDevice` 必須還是 `'desktop'`，其餘欄位才套用手機的值）。
   - `conversationId` 對不到對面時整欄位不推（不產生死參照）。
9. `npm run typecheck`／`npm test` 兩個都要過（`CLAUDE.md` §6 收尾規則）。
10. 真機驗證留給 owner——這份文件寫到「自動測試通過」就算完工，
    不要自己假裝真機測過。

---

## 8. 已知風險 / 先寫起來，省得重踩

- **兩份 hash 邏輯要同時改**：`contentHash.ts` 檔頭已經警告過這件事
  （`characterContentHash` 那段註解），提醒這支也一樣——如果手機端
  `syncManifest.ts` 是自己複製一份邏輯而不是 import `core/sync/contentHash.ts`，
  兩邊都要改到，欄位順序都要完全一致，否則整批提醒會被誤判成「內容不同」。
- **`SyncComparePicker.tsx` 跟 `syncApply.ts` 可能各自維護一份 `KIND_LABEL`**——
  兩份都搜一次，不要只改一邊。
- **`ORDER` 常數決定執行順序，reminders 一定要排在 characters/scenes 之後**，
  否則 `maps.l2r.characters`／`maps.l2r.scenes` 還沒填好，`characterId`／
  `sceneId` 的參照轉換會找不到對應。
- **`allowOfflineFallback` 怎麼分類是這份文件唯一沒有 owner 明確拍板的地方**
  ——先當裝置本地處理（不同步），如果做完 owner 覺得不對，這是最容易事後
  調整的一個欄位（改雜湊清單就好，不影響整體架構）。
- **提醒同步跟對話同步是兩次不同的操作**，`conversationId` 這個參照
  「這次同步當下」多半解不開（除非剛好在同一輪也做了對話同步且對話已經配對過）。
  這不是 bug，是資料本質決定的限制，不用想辦法「修好」。
