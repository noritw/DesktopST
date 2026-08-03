# 新聞模組 — 關鍵字分組 / 角色卡關鍵字（已實作）

> 狀態：**已實作（分支 `feat/news-keyword-groups`）。** 規格外功能，MVP 之後的第一個新聞演進。
> 提出日：2026-06-03（owner）；定案日：2026-06-05；實作日：2026-06-05。相關：`docs/news-module-design.md`。
> 後續再把摘要併入 `DesktopST-Spec.md` §15。
>
> **實作備註：**
> - 抽選脈絡用 `NewsSelectionContext`（`sceneGroupId` + `characterKeywords`）串接 `fetchAllSources` / `filterAndPick`，
>   在 `ipcHandlers.resolveNewsSelectionContext()` 依當前發話角色與 `settings.activeSceneId` 解析後傳入。
> - 「預設組」固定 id = `'default'`；關鍵字 `groupId` 為 `undefined` 或指向不存在的組 → 落回預設組。
> - 角色卡關鍵字以 `origin: 'character'`、`id: 'char-<kw>'`、普通權重的暫時來源加入抓取，不存進 sources。
> - 角色 `newsKeywords` 隨 `card.json` 進 DST 角色卡（自動）；ST PNG 匯出 / 匯入皆不帶（依設計）。
> - **尚未實作**：DST「使用者」搬家包帶整批關鍵字組（目前 DST pack 的 global partial 不含任何新聞設定，
>   屬另一條管線，先擱置；§4 表格此列待補）。
> - `news:preview`（試抓）目前以預設組脈絡測試（不帶情境組 / 角色關鍵字），為刻意取捨。

## 目標

目前新聞興趣關鍵字是**全域單一扁平清單**（`NewsModuleSettings.sources`）。本次擴充兩件事：

1. **角色卡自帶新聞關鍵字** — 角色的興趣隨角色走（疊加在當前興趣池上）。
2. **關鍵字分組綁情境** — 使用者把興趣關鍵字分成多個具名組，由 Scene preset 切換（取代式）。

兩者正交：分組決定「使用者這個情境想聊什麼」，角色卡決定「這個角色額外想聊什麼」。

---

## 1. 抽選池組成（核心模型）

每次要抽新聞時，興趣關鍵字池由兩層組成：

```
興趣池 = (當前 Scene 綁的關鍵字組  ‖  預設組)   ← 取代式，只取其一
        + (當前發話角色的 newsKeywords)         ← 疊加，普通權重
```

- **情境組是取代式**：切到「奇幻情境」就只用奇幻組的關鍵字，不混入日常組。情境沒綁組 → 用「預設組」。
  - 用途：桌面換成遊戲團隊角色時，切到「遊戲開發」情境，興趣池整批換成遊戲開發向關鍵字。
- **角色卡關鍵字是疊加式**：當前**輪到發話的那個角色**的 `newsKeywords` 併進池子，以**普通權重**參與既有的加權隨機，**不帶自己的權重、不做特別加成**。
  - 多角色同桌：只用**當前發話角色**的關鍵字，不合併全部桌面角色。
  - 角色沒設 `newsKeywords` → 池子就只有情境組（等同現狀行為）。

> 黑名單 / 來源排除 / 整類排除 / 語言模式 / 破圈 **維持全域**，不跟著情境或角色跑（避免「換個情境就解除政治封鎖」這種意外）。

---

## 2. 資料結構

### 角色卡

```ts
interface Character {
  ...
  newsKeywords?: string[]   // 角色自帶興趣，純關鍵字字串，不帶權重
}
```

純字串陣列，保持卡片乾淨、好匯出。

### 關鍵字分組（新聞模組設定內）

```ts
interface NewsKeywordGroup {
  id: string
  name: string        // 情境設定下拉只顯示這個名稱
}

interface NewsModuleSettings {
  ...
  keywordGroups: NewsKeywordGroup[]   // 含一個內建「預設組」
  // NewsSource 加上 groupId 標示歸屬哪個組
}

interface NewsSource {
  ...
  groupId?: string    // 興趣關鍵字所屬的組；未設視為預設組
}
```

- **rss / json 進階來源維持全域 always-on**（它們是「訂閱管線」而非興趣關鍵字，per-scene 切換少有需求）。分組只作用在 `type: 'keyword'` 的興趣標籤上。此為刻意取捨，日後若要 rss/json 也能分組再擴充。

### Scene preset

```ts
interface ScenePreset {
  ...
  newsKeywordGroupId?: string   // 綁定的關鍵字組；未綁 = 用預設組
}
```

---

## 3. UI

- **新聞設定面板**：興趣標籤區加上「組」的概念——可建立 / 重新命名 / 刪除組，標籤指派到組（極簡，沿用現有標籤框風格，別爆版面）。
- **情境設定（Scene 分頁）**：只放**一個下拉**「新聞關鍵字組：[現實 ▾]」，使用者只看到組名，不碰底下的關鍵字細節。
- **角色設定**：新增「新聞關鍵字」欄位（標籤框，沿用新聞設定的輸入手感）。

---

## 4. 匯入 / 匯出

| 形式 | 帶什麼 |
|---|---|
| **DST 角色卡** | **一定**帶該卡的 `newsKeywords` |
| **DST 使用者** | 帶**全部關鍵字組** + 各關鍵字來源的**喜好權重**（常聊/普通/偶爾）|
| **SillyTavern PNG** | **略過**。ST 卡規格無對應「新聞興趣」欄位（其 `tags` 語意不符），視為本程式原創欄位；匯入 ST 卡時 `newsKeywords` 留空 |

---

## 5. 遷移（現有使用者）

- 既有 `sources` 內的 keyword 標籤 → 全部歸入一個內建**「預設組」**。
- 既有 Scene preset 的 `newsKeywordGroupId` 留空 → 落回預設組 → 行為與現狀完全一致。

---

## 6. 預定影響檔案

- 型別：`src/main/types.ts`、`src/renderer/src/types/index.ts`（`Character.newsKeywords`、`ScenePreset.newsKeywordGroupId`）
- 新聞型別 / 設定：`src/main/modules/news/types.ts`（`NewsKeywordGroup`、`NewsSource.groupId`、`keywordGroups`）、`settings.ts`（遷移 + 預設組）
- 抽選：`src/main/modules/news/filter.ts` / `trigger.ts`（依當前 Scene 解析組、併入發話角色關鍵字）
- 注入點：`forceSpeakDirect`（`ipcHandlers.ts`）需知道當前發話角色 id（已有）
- UI：新聞 `SettingsPanel.tsx`（組管理）、`SettingsWindow.tsx`（Scene 分頁下拉）、角色設定（newsKeywords 欄位）
- 匯入匯出：`src/main/stCardMapper.ts`、`src/main/dstPack.ts`

---

## 7. 已定案、不再討論（原始）

- 情境組 = **取代**全域（非疊加）。
- 角色關鍵字 = **疊加**、**普通權重**、無加成、只取當前發話角色。
- 黑名單 / 排除 / 語言 / 破圈維持全域。
- ST 匯出不帶新聞關鍵字。

---

## 8. 待處理：組選擇器的 UI 語意容易被誤會（2026-08-03 提出，未實作）

> 狀態：**未實作。優先度「中低」**（見下方判斷理由）。
> 提出日：2026-08-03（owner 於 B1 續刀驗收時實際踩到）。
> **這是純 UI 表達問題，功能與資料結構都正確、不需更動**（§7 的定案全部維持）。

### 問題

設定 →擴充 → 新聞模組，最上方那排群組 chip
（`組： 預設組 新聞 政治 社會 產業 地方 ACG 親子 ＋組`）
實際語意是 **「我現在要編輯哪一組的關鍵字」**，
但它長得像**「目前使用中的組」**，而且點下去整個標籤區會跟著換——
視覺回饋與「切換」高度一致。

Owner 實際發生的誤會：點了「親子」，以為聊天就會改用親子組，
按「說點什麼」後 debug 面板卻顯示「情境組：預設組」，
因而懷疑是抽 core 造成的 regression。**實際上兩者無關。**

聊天實際用哪一組，唯一來源是
`resolveNewsSelectionContext()`（`ipcHandlers.ts`）讀
`activeScene.newsKeywordGroupId` —— 也就是**「情境」分頁綁的那一組**，
與這排 chip 完全無關。

現行說明文字已經有寫「在『情境』分頁可指定每個情境要用哪一組」，
但它在一長段操作說明的**最後一句**，實測會被略過。

同一畫面下方的「個人新聞報要看哪些組？」則是**第三個**語意
（只影響新聞報），該段說明有寫「聊天／說點什麼仍只用情境綁定的那一組，互不干擾」，
但三種語意擠在同一頁，整體仍然容易混淆。

### 可能的解法（未定案，擇一或組合）

1. **把 chip 那排的標題從「組：」改為明確的編輯語意**，
   例如「編輯哪一組：」——單字調整，成本最低
2. **在 chip 那排旁邊直接顯示「目前情境使用中：○○組」**（唯讀徽章），
   讓使用者當場看得到兩者是不同的東西。若能點擊直接跳到情境分頁更好
3. 把「情境綁定」的入口也做進新聞分頁（目前只在情境分頁），
   避免使用者要在兩個分頁之間來回推敲
4. 三個區塊各加一句一行的語意標示，取代目前藏在長段說明末尾的寫法

傾向 **1 ＋ 2**：成本低、不動資料結構、直接消滅誤會來源。
3 有重複入口的維護成本，4 只是把說明搬位置、效果不確定。

### 優先度判斷：中低

- **不是 bug**，功能完全正確，不影響資料
- 但**會讓人誤判成 bug** —— owner 自己就踩到一次，
  日後其他使用者（或接手的 AI）大機率也會重複這個懷疑，
  每次都要花時間查證「是不是壞了」，這是實際成本
- 修改成本很低（解法 1＋2 大約是文案 ＋ 一個唯讀徽章）
- 但它不擋任何事，也不影響手機版架構

**建議時機**：不必特地排一輪，等下次因為別的原因動到
新聞 `SettingsPanel.tsx` 時順手做掉。若一直沒有那個機會，
就在 B2 開工前跟 `docs/news-future-topic-in-chat.md` 那件事一起收掉
（兩者都是新聞模組的小型調整，可以同一輪處理）。

### 注意

視覺相關檔案的改動規則見 `CLAUDE.md`；
本項屬**文案與版面**調整，不得順手改動抽選邏輯
（`core/news/keywordGroups.ts`、`core/news/filter.ts` 皆已進 `core/`，不要動）。
