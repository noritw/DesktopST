# 手機獨立版 —— 功能缺口盤點（2026-08-08）

> 對照基準：**行動版 UI（B3）已經做出來的畫面** vs **獨立模式（Capacitor／`LocalDataSource`）實際能不能用**。
> 只列「預定內、行動版有畫面、獨立版還沒接上」的項目。遙控電腦不在此列 —— 那是**永久**不支援。
>
> 判定方式：`src/mobile/data/localDataSource.ts` 裡 `pending(...)` 的方法即為缺口；
> `unsupported(...)` 則是永久不支援。

---

## 1. 一句話結論

獨立版目前**聊天主線是完整的**（角色、對話、預設組的持久化與 LLM 呼叫都在），
缺的全部集中在**「需要主機端長期跑著的東西」與「還沒補的編輯／匯出面」**兩類：

| 類別 | 缺什麼 |
|---|---|
| A. 需要背景執行 | 新聞報、提醒 |
| B. 還沒補的資料面 | 情境（scene）整組、Lorebook 編輯、角色卡／設定包**匯出** |
| C. 需要網路查詢 | 天氣定位與即時查詢 |
| D. 尚未開工 | 對話與電腦雙向同步（S2；S1 單向匯入已完成） |

---

## 2. 缺口總表

| # | 功能 | 行動版 UI | 獨立版狀態 | 卡在哪 | 建議順序 |
|---|---|---|---|---|---|
| ~~1~~ | ~~情境（scene）套用／存檔／擷取／刪除~~ | `PresetsView` 有完整清單與按鈕 | **2026-08-08 完成** | — | 已做 |
| 2 | **Lorebook（用語解說）編輯** | `LorebookEditor` 已存在 | `lorebooks.list` 回空陣列；`get`／`save`／`remove`／`create` pending | 純檔案讀寫，沒有平台阻礙 | ② |
| 3 | **角色卡／設定包匯出** | 角色編輯器有匯出入口 | `characters.exportCard`／`exportPack` pending（匯入**已可用**） | 需要 Capacitor Filesystem 寫檔 ＋ 分享 intent | ③ |
| 4 | **天氣定位／即時查詢** | 設定頁有天氣區塊，開關可存 | `detectWeatherLocation`／`geocodeWeatherLocation`／`fetchWeatherNow` pending | 要在手機端直接打第三方 API（桌面是主行程代打） | ④ |
| 5 | **提醒** | `RemindersView`／`ReminderEditor` 完整 | `reminders.list` 回空；`create`／`save`／`remove`／`toggle` pending | **不只是資料**：要排程與本機通知（Capacitor LocalNotifications），且 roadmap 已否決「Relay 代排程」「RTC 半夜喚醒」 | ⑤ |
| 6 | **個人新聞報** | `NewsView`／設定／關鍵字面板完整 | `news.*` 全 pending（15 支） | 抓 RSS／解析／配額／排程，量最大；還牽涉 CORS 與背景抓取 | ⑥ |
| 7 | **對話與電腦同步（S2）** | 只有 S1「從電腦匯入」 | 未開工 | roadmap §4.7 已定分層與星狀拓樸 | ⑦（獨立議題） |

**永久不支援（不是 bug，不要修）**：`remoteControl.*` 全部 —— 獨立模式沒有電腦可控。
Spotify／日曆授權同樣只在桌面。

---

## 3. 排序理由

2–3 是**純資料操作**，跟已完成的情境／persona／world 存檔走同一條路（讀寫 `adapters.storage` ＋
`events.push({ kind: 'state-invalidated' })`），做完就能用，風險最低。

4–6 每一項都要**引進新的平台能力**（網路／通知／排程），且 5 和 6 都碰到「手機不是常駐主機」
這個根本限制 —— 開工前先回頭讀 roadmap §2 的四大目標，別把已否決的方案再提一次。

---

## 4. 動手時的固定套路

改 `LocalDataSource` 的任一支 pending 方法時：

1. 業務邏輯寫在 `src/core/`，`LocalDataSource` 只做薄轉呼叫（與 `mobileServer` 同一原則）。
2. **改完資料一定要 `this.session.events.push({ kind: 'state-invalidated', reason: 'desktop' })`**，
   否則畫面停在舊資料，看起來像沒生效。
3. UI 端不要另寫一套 —— 行動版畫面已經在了，接上端點就會動。
4. 對應的 `tests/data/dataSource.test.ts` 有「這些方法必須 reject」的斷言，實作完記得一起改。

---

## 5. 2026-08-08 這一輪已完成（不在缺口內）

| 項目 | 說明 |
|---|---|
| 對話記錄顯示發話身分 | `Message.personaName` 發話當下快照式保存；開關 `ui.showPersonaName`（預設開）放在「情境與設定組 → 使用者設定」 |
| 訊息選單「顯示完整 Prompt」 | 只有 `hasDebugPrompt`／`hasNewsDebug` 為真的訊息才出現入口；排版與桌面共用 `core/prompt/debugPromptView`；含主模型／輔助／對話搜尋的 Token 數 |
| 點頭像 → 角色選單 | 聊天串的角色頭像 → `character-menu`（提及／說點什麼／禁言／編輯角色） |
| 獨立版不再送表情合約 | `ChatLLMParams.omitEmotionTag`；獨立版單張主圖用不到情緒標籤 |
| **缺口 #1 情境與設定組** | `applyScene`／`captureScene`／`saveScene`／`removeScene`／`removePersona`／`removeWorld` 全部接上；`activeSceneDirty` 也真的算了。設定層套用共用 `core/scene/apply` |
| **S1 對話匯入** | 掃 QR 時可勾選要帶哪幾則（全選／取消全選，**預設全不選**）；電腦端 `/api/sync-conversations`（只給清單）＋ `/api/sync-conversation`（逐則）。角色 id 靠名字重新對上，`Conversation.importedFrom` 留給 S2 |

細節見 `progress-log.md` 同日條目。
