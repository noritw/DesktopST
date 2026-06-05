# 新聞模組 — 關鍵字分組 / 角色卡關鍵字（定案待實作）

> 狀態：**設計已定案，待開分支實作。** 規格外功能，MVP 之後的第一個新聞演進。
> 提出日：2026-06-03（owner）；定案日：2026-06-05。相關：`docs/news-module-design.md`。
> 實作時再把摘要併入 `DesktopST-Spec.md` §15。

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

## 7. 已定案、不再討論

- 情境組 = **取代**全域（非疊加）。
- 角色關鍵字 = **疊加**、**普通權重**、無加成、只取當前發話角色。
- 黑名單 / 排除 / 語言 / 破圈維持全域。
- ST 匯出不帶新聞關鍵字。
