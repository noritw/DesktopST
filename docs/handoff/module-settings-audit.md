# 模組子設定同步範圍盤點（T8，2026-08-15）

> **這是盤點，不是實作。** 要不要同步是 owner 的產品決定，這份只負責把選項攤開。
> 「建議」欄只有三種值：`建議同步`／`建議不同步`／`要 owner 決定`。
>
> 起因：S2 M5 第一版比對範圍沿用 M2 的舊子集，漏了 `weather.polish`
> （owner 2026-08-14 真機揪出來，見 `mobile-sync-m4-compare.md` §8.5b）。
> 當時只比對了「模組開關 `enabled`」，沒注意到模組底下還各自帶著自己的子設定。
> 這份就是把「其餘模組尚未逐一檢查」補上。
>
> 目前的同步範圍唯一定義在 `src/core/sync/settingsSnapshot.ts`（`SettingsSnapshot`）。

---

## 0. 先講四類「已有結論、不要再建議同步」的東西

這幾類在 `mobile-mode-switch-sync.md` §3.2 與 CLAUDE.md §4 已經定調，
下表遇到直接標理由，不進「要 owner 決定」：

| 類別 | 為什麼不同步 |
|---|---|
| **API Key** | S2 任何情況都不碰金鑰（roadmap §4.7）。子集裡連欄位都不能出現——出現了就有機會被寫進磁碟或 log |
| **天氣的地點座標／地名／定位來源** | 手機會移動而且自己有 GPS。同步座標只會讓使用者出門在外看到家裡的天氣。S1 初始化匯入就是這條規則，沒有理由破例 |
| **桌寵座標／大小／翻面** | 手機沒有桌面。推過去會把電腦上排好的位置洗掉，而且手機那邊的值是憑空捏的 |
| **`lastTriggeredAt`／`seenIds`／`migratedAt` 這類執行期狀態** | 那是**狀態**不是設定。兩台裝置各自累積各自的，合併沒有正確答案 |

---

## 1. 盤點表

### 1.1 天氣模組（`WeatherSettings`，`core/types.ts:253`）

| 模組 | 子設定欄位 | 型別 | 目前有沒有在同步範圍 | 建議 | 理由 |
|---|---|---|---|---|---|
| 天氣 | `enabled` | `boolean` | ✅ 有（走 `modules` 開關列） | 建議同步 | 已在範圍內，維持 |
| 天氣 | `polish` | `boolean` | ✅ 有（§8.5b 補的 `weather.polish`） | 建議同步 | 已在範圍內，維持。這是純偏好、與裝置無關 |
| 天氣 | `locationName` | `string` | ❌ 沒有 | 建議不同步 | 地點類，見 §0 第 2 條 |
| 天氣 | `latitude` / `longitude` | `number` | ❌ 沒有 | 建議不同步 | 同上 |
| 天氣 | `locationSource` | `WeatherLocationSource` | ❌ 沒有 | 建議不同步 | 同上。而且兩邊可用的來源本來就不一樣（手機有 GPS、電腦沒有） |
| 天氣 | `realtimeQuery.enabled` | `boolean` | ❌ 沒有 | **要 owner 決定** | 卡在：地震／颱風關鍵詞查詢**目前是桌面限定**（CLAUDE.md §4），手機同步過去這個開關也沒有功能對應。等獨立版補上再談，或現在就同步、讓它先當「記著使用者的偏好」 |
| 天氣 | `realtimeQuery.cwaApiKey` | `string` | ❌ 沒有 | 建議不同步 | 是金鑰，見 §0 第 1 條 |
| 天氣 | `realtimeQuery.forecastCounty` | `string` | ❌ 沒有 | 建議不同步 | 地點類，見 §0 第 2 條 |

### 1.2 新聞模組（`NewsModuleSettings`，`core/news/types.ts:80`）

新聞是子設定最多的模組，也是最可能讓使用者感覺「同步了但沒完全同步」的地方。

| 模組 | 子設定欄位 | 型別 | 目前有沒有在同步範圍 | 建議 | 理由 |
|---|---|---|---|---|---|
| 新聞 | `enabled` | `boolean` | ✅ 有（走 `modules` 開關列） | 建議同步 | 已在範圍內 |
| 新聞 | `keywordGroups` | `NewsKeywordGroup[]` | ❌ 沒有 | **要 owner 決定** | **這是本表最重要的一列。** 關鍵字組是使用者真正花時間養出來的東西，兩邊不一致最有感。但它**體積大、結構複雜、而且情境切換會動到它**（`docs/news-local-merge-plan.md`），三選一整份覆蓋可能會讓另一邊辛苦調的組整包消失。卡在：要嘛當「資料」走 M4 逐項比對（像角色／情境那樣一組一列），要嘛不同步。**不建議塞進 M5 設定分頁的單值三選一** |
| 新聞 | `sources` | `NewsSource[]` | ❌ 沒有 | **要 owner 決定** | 同上，是清單不是單值。RSS／JSON 來源可能含只有內網連得到的位址 |
| 新聞 | `blacklist` | `string[]` | ❌ 沒有 | **要 owner 決定** | 語意上是「兩邊聯集」比較合理，而不是二選一——跟對話同步是同一類問題（見 §3） |
| 新聞 | `excludedCategories` / `excludedSources` / `reducedSources` | `string[]` | ❌ 沒有 | **要 owner 決定** | 同上，聯集型 |
| 新聞 | `langMode` | `LangMode` | ❌ 沒有 | 建議同步 | 單值、純偏好、與裝置無關 |
| 新聞 | `speakButton` | `SpeakMode` | ❌ 沒有 | 建議同步 | 同上 |
| 新聞 | `replyModel` | `NewsReplyModel` | ❌ 沒有 | 建議同步 | 同上 |
| 新聞 | `maxAgeDays` | `number` | ❌ 沒有 | 建議同步 | 單值數字、純偏好 |
| 新聞 | `readerMaxItems` / `readerPerKeyword` / `readerBreakoutQuota` | `number?` | ❌ 沒有 | 建議同步 | 同上。⚠️ 三欄要比照「對話限制」處理，**只改一欄時不能把另外兩欄一起送過去覆蓋**（見 §3） |
| 新聞 | `readerKeywordGroupIds` | `string[]?` | ❌ 沒有 | **要 owner 決定** | 存的是**關鍵字組的 id**，而 id 在兩台裝置上不保證一致。同步它之前得先解決 `keywordGroups` 怎麼配對，否則會變成一串死參照（M4 推情境時踩過同一個坑） |
| 新聞 | `enrichForChat` | `boolean?` | ❌ 沒有 | 建議同步 | 單值、純偏好 |
| 新聞 | `breakout.enabled` / `.weight` / `.zhOnly` | `boolean` / `NewsWeight` | ❌ 沒有 | 建議同步 | 單值、純偏好 |
| 新聞 | `conversationSearch.*` | `object?` | ❌ 沒有 | 建議不同步 | 對話新聞搜尋是**桌面獨有、刻意不搬到手機**的功能（CLAUDE.md §4 新聞報那列）。同步一個手機上不存在的功能只會製造困惑 |
| 新聞 | `reminder.enabled` / `.schedule` | `object` | ❌ 沒有 | 建議不同步 | 「背景定時抓新聞」是桌面獨有、刻意不做在手機上的。同上 |
| 新聞 | `localNews.*` | `object` | ❌ 沒有 | 建議不同步 | **已退場的殘骸**，只剩遷移用。`migratedAt` 是冪等旗標（執行期狀態，見 §0 第 4 條），同步過去會讓某一邊的遷移狀態錯亂、把使用者刪掉的縣市關鍵字建回來 |
| 新聞 | `feedback.adjustments` | `Record<string, number>` | ❌ 沒有 | 建議不同步 | 是各裝置自己學到的權重微調，屬執行期狀態。而且它可以一鍵重置，同步的價值低 |
| 新聞 | `seenIds` | `string[]` | ❌ 沒有 | 建議不同步 | 執行期狀態，見 §0 第 4 條。且會無限成長，塞進每次比對的快照裡代價太高 |

### 1.3 提醒（`Reminder`，`core/types.ts:449`）

⚠️ **提醒本身是「資料」不是「設定」**——它是一份清單，該走 M4 逐項比對那條路，
不是 M5 設定分頁。但它現在**兩條路都沒走**（M4 的比對範圍是角色／人設／世界觀／
Lorebook／情境，沒有提醒）。

| 模組 | 子設定欄位 | 型別 | 目前有沒有在同步範圍 | 建議 | 理由 |
|---|---|---|---|---|---|
| 提醒 | 提醒清單整體 | `Reminder[]` | ❌ 沒有（M4／M5 都沒有） | **要 owner 決定** | 卡在「哪台裝置響」這個問題還沒答案。`mobile-mode-switch-sync.md` §9 已經把它列為未決事項：「等缺口 #5，且要連『哪台裝置響』一起做」。缺口 #5 現在做完了，所以**這一項可以重新開始討論** |
| 提醒 | `notificationDevice` | `'desktop'\|'mobile'\|'both'` | ❌ 沒有 | **要 owner 決定** | 就是上面那個問題的核心欄位。同步提醒清單卻不處理這欄，會變成兩台裝置同時響 |
| 提醒 | `wakeMode` / `inactiveBehavior` | union | ❌ 沒有 | 建議不同步 | **手機限定**欄位，電腦上沒有對應概念 |
| 提醒 | `lastTriggeredAt` 一類 | `number` | ❌ 沒有 | 建議不同步 | 執行期狀態，見 §0 第 4 條 |
| 提醒 | `ui.reminderIdleSkipMinutes` | `number?` | ❌ 沒有 | **要 owner 決定** | 「閒置超過幾分鐘略過提醒」在手機上的語意跟電腦不一樣（手機的「閒置」＝螢幕暗，已經有 `wakeMode` 在管）。同步過去可能兩套機制打架 |
| 提醒 | `ui.reminderNotificationSound.*` | `object?` | ❌ 沒有 | 建議不同步 | `customSoundPath` 是**電腦本機檔案路徑**，推到手機必然是死路徑。音量／開關單獨同步的價值不高 |

### 1.4 其餘模組

| 模組 | 子設定欄位 | 型別 | 目前有沒有在同步範圍 | 建議 | 理由 |
|---|---|---|---|---|---|
| Spotify | `enabled` | `boolean` | ✅ 有（`modules` 開關列） | 建議不同步 | ⚠️ 現況就有疑慮：**Spotify 授權只在桌面**，手機同步到 `enabled: true` 也用不了。建議 owner 確認要不要把它從 `modules` 比對列中排除 |
| Spotify | `clientId` | `string` | ❌ 沒有 | 建議不同步 | 等同憑證。且授權桌面限定 |
| Spotify | `displayName` | `string?` | ❌ 沒有 | 建議不同步 | 是授權結果（狀態），不是設定 |
| 日曆 | `enabled` | `boolean` | ✅ 有（`modules` 開關列） | 建議不同步 | 同 Spotify：**日曆授權只在桌面**，同理 |
| 日曆 | `clientId` / `clientSecret` | `string` | ❌ 沒有 | 建議不同步 | `clientSecret` 是以 `safeStorage` 加密存放的**密鑰**，見 §0 第 1 條。絕對不進同步 |
| 日曆 | `displayName` | `string?` | ❌ 沒有 | 建議不同步 | 已連結帳號，是狀態 |
| 日曆 | `lookaheadHours` / `maxEvents` / `mentionWhenEmpty` | `number` / `boolean` | ❌ 沒有 | **要 owner 決定** | 這三個是純偏好、同步沒有技術障礙。但功能桌面限定，同步過去手機也用不到。取決於「獨立版要不要補日曆」 |
| 行動版伺服器 | `MobileSettings.*`（`port`／`useTunnel`／`relay.*`） | 各式 | ❌ 沒有 | 建議不同步 | 這是**電腦端當 host 的設定**，手機沒有對應概念。`relay.deviceId` 更是裝置身分，同步等於身分錯亂 |
| 遙控 | `RemoteControlSettings.*` | 各式 | ❌ 沒有 | 建議不同步 | `remoteControl.*` 對獨立模式是**永久不支援**（CLAUDE.md §4）。而且 `allowedDevices`／`allowedCapabilities` 是安全邊界，同步＝把授權決定自動搬到另一台，這是安全風險不是便利 |

### 1.5 不屬於模組、但同屬「可能漏掉」的一般設定

順手列出來，因為它們跟模組子設定是同一類遺漏風險。

| 區塊 | 欄位 | 目前有沒有在同步範圍 | 建議 | 理由 |
|---|---|---|---|---|
| LLM | `provider`／`models`／`endpoints`／`extraInstruction`／`maxResponseTokens`／`maxGroupRounds`／`maxImagesPerMessage` | ✅ 有 | 建議同步 | 已在範圍內 |
| LLM | `apiKeys` | ❌ 沒有 | 建議不同步 | 見 §0 第 1 條 |
| LLM | `temperature` | ❌ 沒有 | **要 owner 決定** | 純偏好、無技術障礙，看起來就是單純漏掉。卡在：手機 UI 目前有沒有讓使用者調它？沒有的話同步過去也看不到 |
| LLM | `utilityEnabled` / `utilityProvider` / `utilityModels` | ❌ 沒有 | **建議同步（優先）** | **這一組最像下一個 `weather.polish`。** 輔助模型設定手機版已經做出來了（commit `ddd6ace`「輔助模型設定手機也能開」），使用者兩邊都調得到、卻不會同步。而且它跟已經在同步的 `endpoints` 是同一張表的兩半（`applyUtilitySettings()` 換 provider 時端點查同一張表），只同步一半特別容易讓人困惑 |
| LLM | `model`／`endpoint`（無 `s`） | ❌ 沒有 | 建議不同步 | **遺留欄位**（CLAUDE.md §5）。真正來源是 `models`／`endpoints`，同步遺留鏡像只會製造第二個真相來源 |
| 記憶 | `keepRecentN`／`autoSummarizeAfter`／`autoSummarizeEnabled` | ✅ 有 | 建議同步 | 已在範圍內 |
| 記憶 | `keepDebugPromptN` | ❌ 沒有 | 建議不同步 | 是 debug 用量控制，跟裝置的儲存空間有關，兩邊本來就該不一樣 |
| 外觀 | `ui.colorTheme` | ✅ 有 | 建議同步 | 已在範圍內 |
| 外觀 | `ui.chatFontSize` | ❌ 沒有 | **要 owner 決定** | 純偏好、無障礙相關。但手機與電腦的合適字級本來就不同（螢幕距離差很多），同步可能反而礙事 |
| 外觀 | `ui.showLlmBadge` / `ui.showPersonaName` | ❌ 沒有 | 建議同步 | 純偏好、兩邊都有這個功能、語意完全一致。跟已經在同步的 `colorTheme` 是同一類 |
| 外觀 | `ui.desktopCharacters` / `inputWindowPosition` / 各 `WindowBounds` | ❌ 沒有 | 建議不同步 | 桌寵座標類，見 §0 第 3 條 |
| 外觀 | `ui.lowPerformanceMode` / `eventDrivenHitTest` / `alwaysOnTop` / `hoverMenuOnHover` | ❌ 沒有 | 建議不同步 | 全是桌面視窗行為，手機沒有對應概念 |
| 其他 | `injectSystemTime` | ❌ 沒有 | 建議同步 | 純偏好、影響 prompt、兩邊語意一致 |
| 其他 | `ui.speakUsePinnedNotes` / `chatUsePinnedNotes` | ❌ 沒有 | 建議不同步 | 便利貼是桌面功能 |
| 其他 | `updates.*` | ❌ 沒有 | 建議不同步 | `dismissedVersion` 是各裝置各自的「我已經按過不再提醒」，屬狀態 |

---

## 2. 如果 owner 只想先補一項

**`llm.utilityEnabled` / `utilityProvider` / `utilityModels`。**

理由：它是這張表裡唯一同時滿足這四點的——手機 UI 已經做好了（使用者調得到）、
語意兩邊完全一致（沒有「桌面限定」問題）、是單值欄位（塞得進 M5 現有的三選一架構）、
而且跟已經在同步的 `endpoints` 是同一張表的兩半。

這正是 `weather.polish` 那次的形狀：**功能兩邊都有、使用者兩邊都調得到、
就是沒被列進比對子集**，所以永遠不會同步，而且沒有任何錯誤訊息。

---

## 3. 寫回時的合併陷阱（實作時必看）

### 3.1 子設定物件不能整個覆蓋

寫回模組子設定時**一定要跟預設值合併**，不能整個物件覆蓋。範本是
`src/mobile/data/localDataSource.ts` 的 `setWeather()`：

```ts
this.session.settings.weather = {
  enabled: false,
  polish: false,
  locationName: '',
  latitude: 0,
  longitude: 0,
  locationSource: '',
  ...this.session.settings.weather,   // 先鋪現有值
  ...patch                            // 再蓋這次真的要改的
}
```

順序是**預設值 → 現有值 → patch**，三層。

**整個覆蓋會怎樣**：同步只送了 `polish`，結果 `locationName`／`latitude`／
`longitude` 被清成空字串與 0 ——使用者的天氣地點無聲消失，下次聊天的 `[Weather]`
變成沒有地點或指到經緯度 (0,0)（幾內亞灣外海）。**畫面上不會有任何錯誤**，
只有訊息內容變得莫名其妙，非常難聯想到是同步造成的。

### 3.2 多欄位一起送的請求會覆蓋沒選中的欄位

已知案例是「對話限制」三欄（`maxResponseTokens`／`maxGroupRounds`／
`maxImagesPerMessage`）走同一支 `/api/settings/llm-chat-limits`，一次送三個值。
使用者只選了其中一欄用手機的值，另外兩欄卻被手機的值一起送過去覆蓋掉
（`mobile-sync-m4-compare.md` §8.3，真機驗證清單第一節第 9 條就在驗這個）。

**新聞的 `readerMaxItems`／`readerPerKeyword`／`readerBreakoutQuota` 是同一個形狀**，
如果決定同步，實作時要先確認寫回端點是不是也一次吃三個值。

### 3.3 聯集型欄位不要套三選一

`blacklist`／`excludedSources` 這類清單，「兩邊都有對方沒有的項目」是常態不是衝突。
套上「手機／電腦／不動」等於每次都逼使用者選一個必然丟資料的答案，而且他不會察覺
——這正是對話同步另立 `core/sync/convPair.ts` 的原因（CLAUDE.md §5 最後幾條）。
要同步就走「合併／不動」兩態，不要走 `pair.ts`。

### 3.4 存 id 的欄位要先解決 id 怎麼配對

`readerKeywordGroupIds` 存的是關鍵字組 id，兩台裝置上不保證一致。
M4 推情境時就踩過：沒翻譯交叉參照，電腦上留下 10 處死參照。
同步任何「存著別的東西的 id」的欄位之前，先確定那個東西本身已經有配對機制。

---

## 4. owner 2026-08-17 決定與後續處理（實作結果見 `TODO.md` §2.1／§2.2／§2.3）

- **`llm.utility*`**：要同步。已實作（逐 provider 拆列，沿用既有的
  `/api/settings/llm-utility-*` 三支端點）。
- **其餘模組子設定**：能同步的盡量同步。逐項結果：
  - `ui.showLlmBadge` / `ui.showPersonaName`：已同步（沿用既有端點）。
  - 新聞 `speakButton`：已同步（沿用既有的 `/api/news/settings`）。
  - 新聞其餘欄位（`langMode`／`replyModel`／`maxAgeDays`／`readerMaxItems` 等）：
    **手機端目前沒有讀寫路徑**（`NewsApi.getSettings()/saveSettings()` 與桌面
    `/api/news/settings` 的白名單都只認 5 個欄位），要同步得先幫兩層都開洞，
    範圍比想像中大，這次沒有一起做。
  - 新聞 `keywordGroups`／`sources`（清單型）、`blacklist`／`excluded*`（聯集型）：
    **owner 決定先擱著**，要另外做一套逐項比對／合併畫面，工程量接近新功能。
  - `readerKeywordGroupIds`：被上面那條卡住，還沒動。
  - 天氣 `realtimeQuery.enabled`、日曆 `lookaheadHours`／`maxEvents`／
    `mentionWhenEmpty`：套用跟 Spotify／日曆 `enabled` 同一個判斷——功能本身
    桌面限定，手機沒有對應功能可以生效，不需要同步，沒有另外實作。
  - `llm.temperature`、`ui.chatFontSize`：手機目前沒有 UI 讓使用者調，
    同步了也沒東西可看，等手機做出對應 UI 再一起補。
- **Spotify／日曆的 `enabled`**：**已從比對範圍拿掉**。授權只接桌面，手機
  同步開了也用不了，容易誤導使用者。
- **提醒**：要同步（整份清單走逐項比對），但「哪台裝置響」跟裝置本地細節
  設定（例如螢幕關閉時要不要響）留在各自裝置、不進同步子集。**方向已定，
  尚未實作**——這是新的同步類別，工程量接近對話同步，列進 `TODO.md` §2.3
  待動工。
