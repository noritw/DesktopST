# 手機「模式切換 ＋ 帶著資料走」設計（2026-08-09）

> **這份文件是 roadmap §4.7 的 S2 的實作細化**，不是新的架構提案。
> S2 原本設計成「設定頁裡的推送／拉取按鈕」；owner 2026-08-09 指出真正的觸發時機是
> **切換模式的那一刻**，本文據此把 S2 的第一階段重新定義成「切換時帶資料走」。
>
> 讀這份之前**不需要**整份讀 roadmap，只要看過 §4.7 的三層分工（S1／S2／S3）
> 與「API Key 永不參與 S2」「星狀拓樸」兩條硬規則即可。

---

## 1. 為什麼是「切換時」而不是「按鈕」

owner 的實際使用形態（2026-08-09）：

> 「這 App 最大宗使用情境還是和手機一起帶出去用，或者在家裡躺著用。
> 如果要開遙控版我電腦就得開著，但有時候不一定會開電腦。」

也就是說**獨立模式才是常態**，遙控是「人在電腦前」時的加值，不是主線。
這推翻了一個隱含假設：先前 S2 想像的是「兩份資料長期並行、偶爾對帳」，
但實際上使用者是**交替使用**——這段時間都在手機、下一段時間都在電腦。

交替使用有一個對合併非常有利的性質：

> **任一時刻只有一邊在被寫入。**

不是並發衝突，是**接力**。所以第一階段不需要三方合併、不需要 CRDT、
不需要逐欄位 diff——只要在**交棒的那一刻**問一句「要不要把剛才那一段帶過去」。

而交棒的那一刻，就是**切換模式**。

---

## 2. 核心決議：方向由「你剛離開的模式」決定

owner 2026-08-09：

> 「應該要以我前一個使用的模式為主。
> 獨立→遙控的話，應該要問手機資料要不要同步到電腦；
> 遙控→獨立的話，就是反過來問電腦資料要不要同步到手機。」

| 切換方向 | 剛才在寫哪一份 | 問什麼 | 資料流 |
|---|---|---|---|
| 獨立 → 遙控 | 手機 | 「手機上有 N 項變動，要帶到電腦嗎？」 | 手機 → 電腦 |
| 遙控 → 獨立 | 電腦 | 「電腦上有 N 項變動，要帶到手機嗎？」 | 電腦 → 手機 |

**每次切換只有單一方向**，這是本設計成立的關鍵。雙向合併的難度幾乎全部來自
「兩邊同時改了同一筆」，而按離開方向單向推，這個情況在正常使用下不會發生
（真的發生時的處理見 §7.3）。

> ⚠️ **不要把它做成「自動雙向對帳」。** 那是 S3，roadmap §4.7 已明確暫緩，
> 理由是靜默合併出錯時使用者只會發現對話少了幾則。本設計的每一次資料移動
> 都由使用者在切換當下按下確認，且看得到清單。

---

## 3. 範圍：這一版做什麼、不做什麼

### 3.1 會同步

| 資料 | 規則 | 備註 |
|---|---|---|
| 角色卡（含圖檔、Lorebook） | 以 `updatedAt` 判斷變動，整隻覆蓋 | 走既有 `.dstpack`，**一隻一包** |
| Persona／World | 同上 | |
| 情境 Scene | 同上，但**保留目的端的桌寵欄位** | 見 §7.4 |
| 對話訊息 | 以 message id **聯集追加**（append-only） | 見 §6.2 ② |
| `conv.summary`／`summaryCoversTs` | 隨所屬對話走，取 `summaryCoversTs` 較大者 | 見 §6.2 ② |
| Lorebook | 以 `updatedAt` 判斷，整本覆蓋 | 獨立版編輯尚未實作（缺口 #2），做完才有意義 |
| LLM 模型／endpoint／記憶參數／主題 | 整組覆蓋 | 已有 `/api/sync-init` 的既有邏輯 |

### 3.2 明確不同步（每一條都有理由，不要「順手加上去」）

| 不同步的東西 | 為什麼 |
|---|---|
| **API Key** | roadmap §4.7 硬規則：僅 S1 初始化、且僅區網直連。S2 任何情況都不碰 |
| **天氣地點** | 手機會移動且有 GPS。同步座標只會讓你出門在外看到家裡的天氣（2026-08-08 已決） |
| **桌寵座標／大小／翻面** | 手機沒有桌面，推過去等於把電腦上排好的位置洗掉。見 §7.4 |
| **提醒（Reminder）** | 缺口 #5 未實作，且有「哪台裝置響」未決。**這一版完全排除**，見 §7.5 |
| **新聞模組狀態**（seenIds、readerState） | 獨立版新聞（缺口 #6）未實作 |
| `lastTriggeredAt` 這類執行期狀態 | 是狀態不是設定，兩邊各自寫，屬於真正的 S3 |

---

## 4. 先決條件：模式要能在 App 內切換

目前模式在**啟動時就定死**：`src/mobile/ui/connection.ts` 的 `resolveConnection()`
只看 `location.search` 與注入的 `window.__mobileToken`，
而 `App.tsx` 用 `useMemo(() => resolveConnection(), [])` 取一次就不再變。

### 4.1 好消息：`App.tsx` 已經是可切換的形狀

`App.tsx:70-112` 那個 effect 的相依是 `[conn, attach]`，而且 cleanup 完整——
`detach()`、`events.stop()`、`setStandaloneSession(null)` 都有做。

> **只要讓 `conn` 從「`useMemo` 的常數」變成「store 裡的狀態」，
> 整個掛載／卸載循環就已經是對的**，不需要重寫連線層。

因此**不要**用「帶 `?mode=remote&token=…` 重新載入頁面」那條路：
它會把權杖寫進 webview 的網址、整個 App 冷啟動、
還得處理 `StandaloneSession` 尚未落地的寫入。狀態化才是正解。

### 4.2 要加的東西

| 項目 | 說明 |
|---|---|
| `useConnectionStore`（新） | 持有目前 `Connection`；提供 `switchTo(mode)` |
| `mode-pref.json`（新 key） | 記住上次用哪個模式，重開 App 回到同一個 |
| `resolveConnection()` 改簽名 | 接受「已記住的偏好」作為參數，URL 參數仍優先 |

> ⚠️ **網頁版永遠是遙控模式**（roadmap §4.5 的拓樸限制）。
> 偏好設定只在 `Capacitor.isNativePlatform()` 為真時才有作用，
> 否則瀏覽器開的頁面會被記住的偏好切成獨立模式，然後對著空資料庫發呆。

### 4.3 切換當下的守門

切換前必須擋掉的狀態：

- **正在生成**（`useAppStore.sending` 或 `thinkingIds` 非空）→ 先請使用者停止或等完成。
  切模式等於 `detach()`，正在跑的請求會變成孤兒。
- **遙控模式且連不上電腦** → 切到獨立是安全的（本機資料一直都在），
  但**不能同步**，要明講「電腦連不上，這次不帶資料過來」而不是報錯擋住切換。
- **獨立→遙控但沒有記住的主機** → 引導掃 QR（沿用 `DesktopPullSection` 既有流程）。

---

## 5. 同步基準（baseline）：怎麼知道「有什麼變動」

### 5.1 基準只存在手機上

電腦端**不需要**記任何同步狀態。理由：星狀拓樸下手機只綁一台同步主機
（roadmap §4.7），而且每次同步都由手機發起。
把基準放在手機＝電腦端改動最小，也不必處理「多支手機各自的基準」。

### 5.2 資料結構

新 key：`sync-baseline.json`（`core/store/keys.ts` 加一條）。

```ts
/** 上次同步完成當下的兩邊狀態。用來算「之後誰改了什麼」。 */
interface SyncBaseline {
  /** 綁定的同步主機。換主機時整份基準作廢，見 §7.6 */
  hostBaseUrl: string
  syncedAt: number

  characters: Record<string, EntityBaseline>
  personas: Record<string, EntityBaseline>
  worlds: Record<string, EntityBaseline>
  scenes: Record<string, EntityBaseline>
  lorebooks: Record<string, EntityBaseline>
  conversations: Record<string, ConversationBaseline>

  /** 設定沒有 updatedAt，用同步當下的內容雜湊代替 */
  settingsHash: string
}

interface EntityBaseline {
  /** 電腦端的 id。這張表就是 id 對應表，見 §5.3 */
  remoteId: string
  /** 同步完成當下，手機那份的 updatedAt */
  localUpdatedAt: number
  /** 同步完成當下，電腦那份的 updatedAt */
  remoteUpdatedAt: number
}

interface ConversationBaseline extends EntityBaseline {
  /** 同步完成當下兩邊各有幾則。訊息是 append-only，則數是最便宜的變動訊號 */
  localMessageCount: number
  remoteMessageCount: number
}
```

### 5.3 基準就是 id 對應表——**不要再靠名字猜**

S1 匯入時角色是以**新 id** 落地、**靠名字**跟電腦端對上
（`syncImport.ts` 的 `characterIdRemap`）。一次性匯入這樣沒問題，
但反覆來回切換時靠名字是會出事的：改個名字就變成兩隻。

> **決議：第一次同步時把 `localId ↔ remoteId` 寫進基準，之後一律查表。**
> 名字比對只在「基準裡查不到」時當後備（等同第一次配對）。

`Conversation.importedFrom.sourceId`（`core/types.ts:135`）已經是這個概念，
而且註解裡明講了是留給 S2 的——本設計把它推廣到所有實體，統一收在基準裡。

### 5.4 變動判定

| 情況 | 判定 |
|---|---|
| 手機新增 | 本地有這個 id，基準裡沒有 |
| 手機修改 | 本地 `updatedAt` > `baseline.localUpdatedAt` |
| 手機刪除 | 基準裡有，本地查不到 |
| 電腦新增／修改／刪除 | 同上三條，換成 remote 側 |
| 設定變動 | 目前內容雜湊 ≠ `settingsHash` |

**刪除的預設行為是「不推」**：這一版把刪除一律降級成「不同步這一筆」，
清單上標示為「僅在手機／僅在電腦」。理由——刪除是不可逆的，
而「我在手機刪掉，結果電腦上也不見了」這種驚嚇比多一筆殘留嚴重得多。
真的要同步刪除，等第一版跑順了再說（見 §9 未決）。

---

## 6. 需要的端點

### 6.1 已經有、直接用

| 端點 | 用途 |
|---|---|
| `GET /api/sync-init` | 電腦端設定與預設組（含金鑰判定） |
| `GET /api/sync-pack?id=` | 電腦 → 手機：角色本體（`.dstpack`，一隻一包） |
| `GET /api/sync-conversation?id=` | 電腦 → 手機：一則對話完整內容 |
| `POST /api/characters/import-pack` | 手機 → 電腦：角色本體（同一種格式，反向） |
| `POST /api/presets/{persona\|world\|scene}/save` | 手機 → 電腦：預設組（regex 路由，`mobileServer.ts:871`） |
| `POST /api/lorebooks/save` | 手機 → 電腦：Lorebook |
| `POST /api/settings/*` | 手機 → 電腦：各項設定 |

> 反向推送的端點**幾乎都已經存在**了——它們本來就是遙控模式在用的寫入端點。
> 這是本設計成本低於原始 S2 估時（2–3 週）的主要原因。

### 6.2 要新增（只有兩支）

**① `GET /api/sync-manifest` —— 差異預覽用的輕量清單**

回傳電腦端每一筆實體的 `{ id, name, updatedAt }`，**不含任何內容**。
手機拿它跟基準對一次就知道電腦側改了什麼，不必先把幾十 MB 拉下來。

```
{
  characters:    [{ id, name, updatedAt }],
  personas:      [{ id, name, updatedAt }],
  worlds:        [{ id, name, updatedAt }],
  scenes:        [{ id, name, updatedAt }],
  lorebooks:     [{ id, name, updatedAt }],
  conversations: [{ id, title, updatedAt, messageCount }],
  settingsHash:  string
}
```

**② `POST /api/sync-conversation-merge` —— 手機 → 電腦的對話追加**

現有的 `/api/conversations/*` 只有 `new`／`rename`／`delete`／`load`，
**沒有「把一批訊息寫進某則對話」**——這是推送方向唯一真正缺的能力。

```
{
  targetId?: string,        // 有＝併進電腦既有那則；無＝在電腦上新建
  title: string,
  participantIds: string[], // 以電腦端的角色 id 表示（切換當下即時配對，不查基準）
  messages: Message[],      // 只送電腦沒有的那些
  summary?: string,
  summaryCoversTs?: number,
  chunkIndex?: number,      // 分批用，見下面的 ⚠️
  chunkTotal?: number
}
```

回傳 `{ id, written, skipped }`。**`id` 是電腦端實際落地的那顆**——新建時電腦會
自己發 uuid，手機一定要讀回應並記下來，否則下一趟配不起來、每次切換都多一份
（S2 M3 就是死在「推完不讀回應」，見 `mobile-sync-m4-compare.md` §1.1）。

**合併規則（本節是唯一定義處）**

1. **訊息以 message id 聯集追加**，已存在的 id 直接略過（roadmap §4.7）。
   略過的計進 `skipped` 回報，不靜默。
2. **同一個 id 兩邊內容不同**（在某一邊編輯過）＝接收端保留自己那份。
   不做欄位級合併、不做逐則挑選——那會炸出無限的 UI，而且沒有正確答案。
   完成訊息要誠實講「N 則兩邊都改過，各自保留原本的版本」。
3. **合併後按 `timestamp` 重排**，相同時用 message id 當穩定 tiebreak。
   少了 tiebreak 的話兩台裝置排出來的順序會不一樣，下一趟指紋又對不上。
4. **`summary`／`summaryCoversTs` 取 `summaryCoversTs` 較大者。**
   ⚠️ **不能用 `updatedAt` 判斷**：那是寫檔時間，推送本身就會把接收端設成現在
   （M4 §2.2）。`summaryCoversTs` 是從訊息時間戳推導的，跨裝置可比。
5. **刪除不同步**：這一版只補、不刪。某一邊少了幾則訊息一律當成「還沒收到」。

> ⚠️ 訊息帶圖片 data URI，整批送會在 CapacitorHttp 的 base64 bridge 上爆掉
> （`mobileServer.ts:1443` 已經為了這個把讀取拆成一則一支）。
> **推送同樣要分批**，一次一則對話、單則內**依累計位元組**切塊
> （不是依則數：單則帶三張圖就可能自己超過上限）。
> `targetId` 沒有值時**只有第一塊**會建新對話，後續塊要帶著回應給的 `id` 進來。
> 同一塊重送兩次必須是冪等的（靠規則 1 自然成立）。

---

## 7. 流程與邊界情況

### 7.1 切換流程

```
使用者按「切換到遙控 / 切換到本機」
  │
  ├─ 守門檢查（§4.3）：正在生成？沒有主機？
  │
  ├─ 取得對面的 manifest（GET /api/sync-manifest）
  │     連不上 → 只在「切到獨立」時放行，並說明「這次不帶資料」
  │
  ├─ 跟基準對一次，算出「剛才那一邊」的變動清單
  │
  ├─ 沒有變動 → 不問，直接切（不要為了儀式感彈一個空對話框）
  │
  ├─ 有變動 → 顯示清單：
  │     「手機上有 3 隻角色、1 則對話（12 則訊息）、模型設定有變動」
  │     [ 帶過去並切換 ]  [ 直接切換，不帶 ]  [ 取消 ]
  │
  ├─ 選「帶過去」→ 逐項推送 → 更新基準 → 切換
  └─ 選「直接切」→ 切換，**基準不動**（見 §7.2）
```

### 7.2 「直接切、不帶」時基準不能動

很容易寫錯的一步：使用者選了不同步，如果順手把基準更新成「現在」，
那些變動就**永遠不會再被偵測到**——下次切換時它們已經被視為「同步過了」。

> **基準只有在資料真的移動過去之後才更新。**

### 7.3 兩邊都改了同一筆

正常交替使用不會發生，但會有例外：使用者在電腦前同時開著手機。

這一版的處理是**保守的**：偵測到同一筆兩邊都動過時，
**不自動覆蓋，在清單上標為「衝突」並預設不勾**，附一行
「電腦上這隻角色你也改過（8/9 14:30），帶過去會蓋掉」。

不做欄位級合併——那是 roadmap 明列的 S2 完整版，
而且角色卡的欄位合併（description 兩邊都改）本來就沒有正確答案。

### 7.4 情境（Scene）推送要保留目的端的桌寵欄位

`ScenePreset` 帶著 `desktopCharacters`（座標／大小／翻面／zIndex）、
`inputWindowBounds`、`logWindowBounds`——這些**只有桌面有意義**。

手機那份的 `desktopCharacters` 只用到 `characterId` 與 `muted`
（`session.ts:320` 的 `getState()` 只讀這兩個欄位）。
整份推過去會把電腦上排好的桌寵位置洗成預設值。

> **手機 → 電腦推送情境時，`desktopCharacters` 只帶「有誰在場、誰被禁言」，
> 座標／大小／翻面／視窗位置一律沿用電腦上原本那份。**
> 反向（電腦 → 手機）則整份收下即可，手機用不到的欄位留著不礙事，
> 之後推回去還原得回來。

### 7.5 提醒不進這一版

缺口清單 §3.1 已經記了決議：`Reminder` 要先加「哪台裝置響」的欄位，
且獨立版排程（缺口 #5）沒做之前，同步過去的提醒只是「看得到但不會響」——
**比誠實失敗更糟，使用者會以為它會響然後錯過**。

> 做缺口 #5 時再把提醒加進本文件 §3.1 的表，不要提前。

### 7.6 換同步主機＝基準作廢

星狀拓樸只認一台同步主機。若 `hostBaseUrl` 與基準裡的不同：

- 整份基準作廢（id 對應表對不上另一台電腦）
- 退化成一次 S1 式的初始化匯入
- **切換前要明確警告**，不能安靜地重來

### 7.7 權杖過期是最常見的失敗，不是異常

`DesktopPullSection.tsx:61` 的註解已經講過：電腦重開「手機連線」時權杖就換新。
切換流程遇到 401 要走**重掃 QR**，而且——

> **不可以因為同步失敗就把使用者卡在原模式。**
> 切到獨立永遠要能成功（本機資料一直都在），同步只是加值。

### 7.8 每次寫完本地資料都要推 `state-invalidated`

CLAUDE.md §5 已列為常踩的坑，同步流程一次寫很多筆，**批次結束後推一次**即可，
但不要漏——漏了畫面會停在同步前的清單，看起來像整個功能沒生效。

---

## 8. 分階段實作

刻意把「能切換」與「會同步」拆開：切換本身就有價值（電腦沒開時能用），
而且先讓差異偵測**只顯示不動手**，可以在真的搬資料之前驗證合併規則。

| 階段 | 內容 | 產出 |
|---|---|---|
| **M1**（2026-08-12 完成） | 模式可在 App 內切換（§4），記住偏好；**完全不同步** | 兩份資料明確分開，UI 要講清楚 |
| **M2**（2026-08-12 完成） | `GET /api/sync-manifest` ＋ 基準 ＋ 差異偵測，**唯讀預覽** | 切換時顯示「有什麼不一樣」但不搬 |
| **M3** | 真的推／拉：角色、預設組、情境、Lorebook、設定 | 對話還不動 |
| **M4** | 對話訊息層聯集合併（含新端點 ②） | 完整的「帶著走」 |
| **M5**（可選） | 設定頁的「立即同步」按鈕，不切模式也能同步 | 補齊「我就想備份一下」 |

M2 是**真正的安全閥**：roadmap §4.7 說「差異預覽讓錯誤在發生前就能被看見」，
在這裡就是讓 owner 自己盯著清單跑幾天，確認偵測結果符合直覺，再讓它動手。

依賴關係：M3 的 Lorebook 部分要等**缺口 #2（獨立版 Lorebook 編輯）**做完才有意義；
其餘不依賴任何未完成的缺口。

### 8.1 M1 落地筆記（2026-08-12）

- `core/store/keys.ts`：新增 `MODE_PREF_KEY`（`mode-pref.json`）。
- `mobile/ui/connection.ts`：`resolveConnection()` 加 `pref?: ModePref` 參數——
  **只在原生殼、且沒有任何 URL／relay 訊號時**才參考，外部訊號（`?server=`／
  `?mode=`／relay 注入）一律優先。
- `mobile/ui/stores/connectionStore.ts`（新）：`conn` 從 `App.tsx` 原本的
  `useMemo` 常數變成 store 狀態；`switchTo()` 切換後**只在原生殼**寫回偏好。
  ⚠️ 切回獨立時**不能把記住的 `remote` 洗掉**——寫偏好時要跟舊值合併，
  只有切到遙控成功時才更新 `remote` 欄位，否則每次「切換到遙控」都要重新掃 QR。
- `mobile/ui/App.tsx`：`conn` 改讀 store；`attach` effect 的 `[conn, attach]`
  依賴不用改，null 時直接 return（沿用既有的「還沒 ready 就顯示載入中」畫面，
  不需要額外的載入態）。
- `mobile/ui/shell/ModeSwitcher.tsx`（新）：切換按鈕**放進「關於」頁**
  （不是新開主選單項目）——那裡本來就在講「目前連線」。**只在
  `Capacitor.isNativePlatform()` 顯示**，網頁版永遠遙控，給按鈕沒有意義。
  切到遙控會先試記住的主機，連不上才落回掃 QR／手動貼網址（沿用
  `SyncImportView.tsx` 同一套 `scannerAdapter`）。切到獨立前用
  `useAppStore.sending` 擋「正在生成」。
- `@capacitor/share` 那顆之前已經是 `dependencies`（缺口 #3 裝的），這次沒有再加新外掛。

#### 8.1.1 owner 實機試切換揪出的兩個既存缺口

M1 是**第一次**有原生殼在 App 內建立「即時遙控連線」（不是掃 QR 開網頁，也不是
S1 那種一次性 HTTP 拉資料）——兩個問題都是這條路徑本來就有、只是之前沒人踩過：

**① 掃到中繼 QR，WebSocket 永遠連不上（HTTP 正常）**

`wsUrlFor()` 拿 `conn.baseUrl` 字串代換 `http→ws`；這對一般伺服器位址沒問題，
但中繼的即時通道只有**中繼自己託管網頁**載入時才會被注入正確位址
（`window.__tunnelWsUrl`，`main/cloudflare-worker.js`）。原生殼是自己組網址連過去，
繞過了那層注入，組出來的路由對中繼是錯的。

修法：`connection.ts` 新增 `resolveLiveRemote(baseUrl, token)`，切換前先問一次
`/api/sync-init` 拿 `lanDirect`／`lanUrl`，中繼就比照 S1 的 `upgradeToLan` 試著
換成區網直連；換不了就回 `relayOnly: true`，`ModeSwitcher` 據此明講「這個版本
還不支援用中繼建立即時遙控」，不切換（不要讓使用者切過去卡在假連線）。
`tests/mobile/connection.test.ts` 有 6 個測試釘住這幾種情況。

**② `androidScheme: 'https'` 讓 Mixed Content 政策擋掉頭像圖片與 WebSocket**

即使①修好、真的换成區網直連，`ws://192.168.x.x:port` 與角色頭像的
`<img src="http://192.168.x.x:port/api/avatar/...">` 還是會被瀏覽器的 Mixed
Content 政策當成「安全頁面（`https://localhost`）偷載不安全內容」擋掉——
`android.allowMixedContent: true` 在實測的 WebView 版本上**沒有**完全蓋掉這個檢查。
HTTP JSON API（送訊息、讀設定）不受影響，因為那些走 `CapacitorHttp` 外掛的原生
橋接，不經過 WebView 自己的網路堆疊。

修法：`capacitor.config.ts` 的 `server.androidScheme` 改成 `'http'`——
`localhost` 不論哪個 scheme 都是瀏覽器規範裡的可信任來源，不會少掉任何
secure-context 能力，但頁面來源不再是 https，區網的 `http://`／`ws://` 就不算
「降級」，不會被擋。中繼走 `https://`／`wss://`，這條路是升級，本來就不受影響。
細節與診斷方法（`adb logcat | grep "Mixed Content"`）見 `CLAUDE.md` §5。

**已驗證**：真機（Pixel 10a）裝新 APK、實際掃「手機連線」QR（走中繼）成功升級成
區網直連並切換過去、傳訊息角色正常回應。兩個修法在 log 上都看得到效果
（WebSocket 第一次真的 `open`、Mixed Content 警告從每次都有變成歸零）。

**穩定性補驗證（2026-08-12，同日稍後）**：先前因手機螢幕一直自動鎖定干擾測試，
沒拿到「切過去之後穩定不斷線」的最終確認。這次先手動把螢幕逾時延長到 30 分鐘，
確認 App 在遙控·區網直連模式下閒置放置 4 分鐘（22:58→23:02，中間完全沒有互動）
連線狀態仍顯示「正常」，`adb logcat` 全程搜尋 `Mixed Content` 是 0 筆，角色頭像
全程正常顯示。M1 判定為穩定收工。

### 8.2 M2 落地筆記（2026-08-12）

- 桌面端新增 `GET /api/sync-manifest`（`main/mobileServer.ts`，緊接在
  `/api/sync-conversation` 之後），回傳 §6.2 定義的輕量清單。`settingsHash`
  用 `core/util/sha1.ts` 的 `sha1Hex()` 對 `core/util/stableJson.ts`（新，
  key 排序後才序列化，讓雙邊算出同一個雜湊不受物件寫法差異影響）算出的
  子集雜湊——子集範圍刻意跟 `/api/sync-init` 已經在同步的那些欄位對齊
  （llm 除 apiKeys、memory、colorTheme、modules）。
- Lorebook 沒有現成的「輕量清單＋updatedAt」getter（`listLorebooks()` 只給
  `{id,name}`，且 S1 既有呼叫方依賴這個形狀）——桌面與手機都各自**新開一個
  方法**（`getLorebookManifestDirect()` / `StandaloneSession.listLorebooksManifest()`），
  不改舊方法。
- 純差異邏輯放在 `core/sync/`（`types.ts` + `diff.ts`），平台無關、`npm test`
  涵蓋（`tests/core/sync/diff.test.ts`）——這樣未來要在 M3 桌面端也做「反向
  比對」或寫其他工具時可以直接重用，不綁死在手機的 React 元件裡。
- `syncImport.ts`（S1）裡原本沒有匯出的 `getJson`／`request`／`authHeaders`／
  `SyncError`／`SyncSource` 抽到新檔 `mobile/runtime/syncTransport.ts` 並匯出，
  `syncImport.ts` 改成從那裡 re-export，呼叫端（`DesktopPullSection.tsx`、
  `SyncImportView.tsx`）完全不用改。純搬移，`tests/mobile/syncImport.test.ts`
  36 個既有測試原封不動全過。
- **M2 刻意不做 Sheet 元件**：一開始規劃是仿照「關於」頁的 `Sheet`
  另做一個 `SyncDiffPreview.tsx`，落地時發現手機 UI 早就有一個通用的
  `ui.confirm({title, message, confirmLabel})`（`DialogHost.tsx`／`uiStore.ts`）
  ——文字訊息＋確認／取消，剛好就是「看一段差異摘要，決定要不要繼續切換」
  這個互動，而且已經接好返回鍵深度計算（`useBackButton.ts` 的
  `s.dialog ? 1 : 0`）。改用它，差異摘要用純文字函式
  （`ui/shell/syncDiffMessage.ts`，`formatFirstRunMessage` / `formatDiffMessage`）
  組字串塞進 `message`，比另起一個 Sheet 元件少一層、也更符合「不要重造
  已有的輪子」。
- 掛入點在 `ModeSwitcher.tsx` 的 `goStandalone()`／`tryConnect()`，`switchTo`
  呼叫之前先跑 `previewBeforeSwitch()`：讀基準、建本地清單（獨立模式下直接
  用當前 `getStandaloneSession()`；遙控模式下本機沒有活著的 session，臨時
  `bootStandaloneSession()` 一份唯讀讀本地檔案，不寫回 `sessionHolder`）、
  抓遠端清單、`computeDiff`。任何一步失敗（電腦連不上、本地讀取出錯）都
  **直接放行不擋切換**，呼應 §7.7「不可以因為同步失敗就把使用者卡在原模式」。
- **首次執行決議**：`SyncBaseline` 在這版之前完全不存在，所以每個使用者
  第一次切換都是 `baseline === null`。`computeDiff` 對此回傳
  `hasBaseline: false` 加全空差異，UI 層改顯示雙邊「目前各有幾筆」的中性
  統計（`formatFirstRunMessage`），不逐筆貼「新增」標籤——這才不會讓第一次
  切換就跳出一份嚇人的「全部都是新增」清單。**這也表示 (c)(d) 兩種真正的
  差異／衝突狀態要等 M3 第一次寫入基準之後才會被真實使用者看到**——
  這一版已經照 §5.3／§5.4／§7.3 的規則做對（`tests/core/sync/diff.test.ts`
  逐條釘住），但目前沒有基準存在，邏輯上不可能被觸發，等 M3 落地後才能在
  真機上實際觀察。
- 基準本身這一版**只讀不寫**（`mobile/runtime/syncBaseline.ts` 只有
  `readBaseline()`，故意沒有 `writeBaseline()`）——§7.2 明講基準只在資料
  真的搬過去後才更新，M2 完全不搬資料。

**驗證**：`npm test`（新增 `core/sync/diff.test.ts` 10 例、
`mobile/syncManifest.test.ts` 4 例、`mobile/syncBaseline.test.ts` 2 例、
`ui/syncDiffMessage.test.ts` 3 例，加上既有 36 例 `syncImport.test.ts`
全過）、`npm run typecheck`、`npm run build:mobile` 皆過。**還沒做**：真機
上實際跑一次模式切換確認 `ui.confirm` 對話框正常彈出——目前沒有基準，
能驗證到的只有「無基準」這條路徑（中性統計訊息），(c)(d) 兩種狀態要等
M3 寫入基準後才有東西可以真機驗證。

---

## 9. 未決 / 之後再說

| 題目 | 現況 |
|---|---|
| 刪除要不要同步 | 這一版一律不推（§5.4）。等實際用一陣子再決定 |
| 欄位級衝突合併 | 不做，標為衝突讓使用者選（§7.3） |
| 自動同步（S3） | roadmap 已暫緩，本設計不改變該結論 |
| 多支手機 | 星狀拓樸下電腦不記基準，理論上可行；未驗證，也不是 owner 的情境 |
| 提醒 | 等缺口 #5，且要連「哪台裝置響」一起做 |

---

## 10. 相關文件

- `multi-device-platform-roadmap.md` **§4.7** —— 模式定義、S1/S2/S3 分層、API Key 判定、星狀拓樸（**本文的上位規格**）
- `mobile-standalone-gap-inventory.md` —— 缺口 #7 就是這件事；#2／#5 是本文的依賴
- `src/mobile/runtime/syncImport.ts` —— S1 既有實作，本文的 id 對應與衝突處理是它的推廣
- `src/mobile/ui/settings/DesktopPullSection.tsx` —— 既有的「從電腦重新拉設定」，M5 可能與它合併
