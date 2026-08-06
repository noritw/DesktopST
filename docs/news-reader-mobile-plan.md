# 個人新聞報 — 手機版 實作規劃

> 狀態：**已實作完成**（階段 1–3；階段 4 匯出／匯入依 owner 決定不做）
> 基準版本：v0.3.8（`040b23c`）
> 相關：`docs/news-module-design.md`、`docs/remote-control-plan.md`
>
> ⚠️ **本檔描述的是舊版 `assets/mobile.html` 的新聞報**（規格與 UX 仍有效，
> React 版逐項沿用）。**React 版（`/?ui=app`）的落地說明在
> `docs/b3-mobile-ui-plan.md` §4.21**（B3 階段 6，2026-08-06）——
> 分欄／相對時間／併回釘選等規則已搬進 `src/core/news/reader.ts`，
> 而且 React 版**有**手機端的新聞設定（本檔 §6「刻意不做」那條已被推翻）。

## Owner 審閱決議

1. **狀態跨裝置共用**（方案 B），連桌面版一起改。實作時再細分：
   釘選 / 不看了＝內容狀態 → 主程序共用；顯示模式 / 目前分頁＝UI 偏好 → 各裝置本地。
   （若連分頁也共用，在手機點一下會讓桌機畫面跟著跳走。）
2. **抽出共用邏輯**（`readerFetch.ts`），方便後續維護。
3. **「聊這個」丟進手機自己的輸入框**，不動桌面行為。
4. **不做匯出／匯入**（階段 4 取消）。

---

## 1. 目標

讓 **個人新聞報**（桌面的 `NewsReaderWindow`）能在手機上使用：人在外面，用手機連回桌機，
批次瀏覽新聞、換一批、釘選、挑一則丟給角色聊。

桌機負責抓取（不吃手機流量），手機只負責顯示與操作。

### 形式

沿用手機版既有的圖層模式：header 一顆按鈕 → 覆蓋在聊天畫面上的全高圖層，關掉就回到聊天。

### 不做

- 不改桌面版 `NewsReaderWindow` 的行為
- 不做新聞內容全文閱讀（點原文照舊開手機瀏覽器）
- 新聞**陪聊設定**（關鍵字、黑名單、排程那些）不在這次範圍

---

## 2. 桌面版功能盤點

`NewsReaderWindow.tsx`(569) + `useNewsReaderStore.ts`(565) + `groupNewsItems.ts`(185)。

| # | 功能 | 資料來源 | 手機版處理 |
|---|---|---|---|
| 1 | 批次抓取（略過 seenIds，取前 N 則） | `news:fetch-batch` | 同 |
| 2 | 換一批（排除畫面上的 id，釘選保留） | `news:fetch-batch` + `excludeIds` | 同 |
| 3 | 單欄重抓 | `news:fetch-section` | 同（在欄標題列） |
| 4 | 報紙分欄（每個關鍵字一欄 + 熱門 + 地方 + 其他） | `groupNewsItems` | **改為分頁 chips**，見 §4.2 |
| 5 | 每欄抓取則數（配額）可直接改 | `source.readerQuota` / `readerPerKeyword` / `readerBreakoutQuota` | 同（欄標題列數字） |
| 6 | 關鍵字組多選（含「全部組」捷徑） | `readerKeywordGroupIds` | 同（頂端摺疊區） |
| 7 | 欄位拖曳排序 | `reorderSources` → 寫 `settings.sources` 順序 | **改為上移／下移按鈕**，見 §4.4 |
| 8 | 顯示模式：標題 / 標題＋摘要 | localStorage | 同（手機自己一份，見 §3）|
| 9 | 分頁篩選：全部 / 各欄 | localStorage | 同 |
| 10 | 釘選（換一批時保留） | localStorage | 同 |
| 11 | 這則不要看了（dismiss，上限 500） | localStorage | 同 |
| 12 | 開原文 | `window.open` + `news:mark-opened` | 同 |
| 13 | 把新聞丟進輸入框當話題 | `news:insert-to-input`（在桌機開發話視窗） | **改為插入手機自己的輸入框**，見 §4.5 |
| 14 | 新聞設定入口 | `news:open-settings-tab` | **不做**（手機沒有設定視窗，見 §6）|
| 15 | 匯出／匯入新聞報設定 | `news:export/import-reader-settings`（檔案對話框） | 選配，見 §7 |

---

## 3. 最重要的設計決策：狀態放哪裡

**釘選、不看了、顯示模式、目前分頁這四項，桌面版全部存在 renderer 的 `localStorage`。**

手機是另一個瀏覽器，localStorage 不共用。所以：

### 方案 A：手機自己一份（建議，階段 1 採用）

- 手機的釘選／已讀不看與桌機各自獨立
- **零風險**：完全不動桌面版程式碼
- 代價：「我在桌機釘的那則，手機上看不到釘選狀態」

### 方案 B：搬到主程序，兩邊共用

- 把這四項從 localStorage 搬到 `%APPDATA%\DesktopST\` 下的檔案，桌面走 IPC、手機走 HTTP
- 好處：真正的「同一份新聞報」
- 代價：**要改桌面版 `useNewsReaderStore.ts`**（既有功能），且 dismissedIds 跨裝置共用後，
  在手機上滑掉的那則桌機也會消失——這未必是你要的

**建議**：先做 A。文件在 `useNewsReaderStore.ts` 那層留註解說明「這四項若要跨裝置同步，
把 localStorage 讀寫換成 IPC 即可，介面已經是集中的」，之後你覺得需要再升級成 B。

> 這題請你決定，因為它決定手機版「像不像同一份新聞報」。

---

## 4. 手機版介面

### 4.1 進入點

`#header-actions` 加一顆 `📰`（新聞報），放在 `☰` 左邊。
模組停用時按鈕仍顯示，點開後圖層內顯示「新聞模組尚未啟用」＋說明（手機不提供開關，見 §6）。

### 4.2 版面：分欄 → 分頁

桌面是報紙式多欄並排；375px 寬放不下，所以把桌面的 `activeTab` 篩選升格為主要導覽：

```
┌──────────────────────────────┐
│ 📰 個人新聞報            ✕   │
├──────────────────────────────┤
│ [全部][獨立遊戲][AI][🔥熱門]…│ ← 橫向捲動 chips（沿用 .sheet-tabs）
├──────────────────────────────┤
│ ▸ 關鍵字組：全部組            │ ← 摺疊：組多選、顯示模式
├──────────────────────────────┤
│                              │
│  新聞卡片清單（單欄）          │
│  ┌────────────────────────┐  │
│  │ 標題                    │  │
│  │ 摘要（顯示模式開才有）    │  │
│  │ 來源 · 3 小時前          │  │
│  │ [↗][📌][💬][✕]         │  │
│  └────────────────────────┘  │
│                              │
├──────────────────────────────┤
│ [🔄 換一批]      更新於 14:32 │ ← 底部固定
└──────────────────────────────┘
```

- 選了單一欄時，該欄標題列出現「只重抓這一欄」與「則數」兩個控制項（對應桌面 #3 #5）
- 「全部」分頁時，卡片依欄分組，每組一條小標題（欄名 + 該欄則數）

### 4.3 卡片上的四個動作

| 按鈕 | 行為 |
|---|---|
| ↗ | 開原文（新分頁）＋ 送 `mark-opened` 加分 |
| 📌 | 釘選 / 取消（換一批時保留） |
| 💬 | 插入手機輸入框當話題（見 §4.5） |
| ✕ | 這則不要看了（進 dismissedIds） |

觸控目標一律 ≥ 44×44。

### 4.4 排序：拖曳 → 上移／下移

`mobile.html` 沒有拖放基礎建設，且觸控拖曳在捲動清單裡很容易誤觸。
改成欄位管理摺疊區內每欄兩顆 `▲▼`，一樣呼叫 `reorderSources`（寫回 `settings.sources` 順序，與桌面共用同一份資料）。

### 4.5 「丟進輸入框」在手機上的語意

桌面版 `news:insert-to-input` 是**在桌機開一個發話視窗**並帶入標題＋摘要。

手機上照搬沒有意義——人在外面，不會想讓家裡的桌機跳出視窗。手機版改為：
**把「標題\n摘要」塞進手機自己的 `#msg-input`，關閉圖層，游標停在輸入框**，讓你直接補一句話送出。

> 這樣同一顆按鈕在兩邊語意一致（「拿這則去跟角色聊」），但落點不同。

---

## 5. API 設計

新檔 `src/main/modules/news/mobileRoutes.ts`，在 `newsModule.activate()` 用既有的
`ctx.mobile.registerRoute` 註冊（核心零改動，remote-control 已是同樣做法）。

| Method | Path | 對應 IPC | 說明 |
|---|---|---|---|
| GET | `/api/news/reader/state` | — | `enabled`、`sources`、`keywordGroups`、`readerKeywordGroupIds`、三個則數設定 |
| POST | `/api/news/reader/batch` | `news:fetch-batch` | `{ maxItems?, excludeIds?, strictExclude? }` |
| POST | `/api/news/reader/section` | `news:fetch-section` | `{ sectionGroupId, excludeIds?, strictExclude? }` |
| POST | `/api/news/reader/quota` | store 內的 `setSectionQuota` | `{ sectionGroupId, quota }` |
| POST | `/api/news/reader/groups` | `setReaderKeywordGroups` | `{ ids: string[] }` |
| POST | `/api/news/reader/order` | `reorderSources` | `{ orderedSourceIds: string[] }` |
| POST | `/api/news/mark-opened` | `news:mark-opened` | 開原文加分 |

授權沿用既有 mobile token（同 `/api/scenes`）。這些只讀新聞、寫新聞設定，不碰電腦，
不納入 remote-control 的裝置白名單 / capability。

### 5.1 邏輯共用（重要）

`news:fetch-batch` / `fetch-section` 的組裝邏輯目前**寫在 `ipc.ts` 的 handler 裡**（約 140 行）。
手機路由若複製一份，兩邊遲早走鐘。

建議把這兩段純邏輯抽成 `src/main/modules/news/readerFetch.ts`：

```ts
export async function fetchReaderBatch(settings, req): Promise<ReaderResult>
export async function fetchReaderSection(settings, req): Promise<ReaderResult>
```

`ipc.ts` 的 handler 改成薄薄一層呼叫它，手機路由也呼叫它。

> ⚠️ 這會動到 `ipc.ts`。上次的教訓是這個檔案上游改很勤（一版就 +272 行），
> 大改容易在下次 pull 時撞車。所以**只搬這兩個 handler 的內部邏輯、不重排其他東西**，
> 讓 diff 集中在兩個 handler body。要不要這樣做請你決定，替代方案是手機路由自己組（會有兩份）。

### 5.2 逾時

`fetch-batch` 會同時打所有來源，桌面實測可能要 10～30 秒。手機端要：
- 顯示骨架 / 進度提示，不能只給一個轉圈
- `fetch` 不設短 timeout；WS 斷線時不影響這個 HTTP 請求
- 失敗要能重試，不要把畫面清空

### 5.3 模組停用

`fetch-batch` / `fetch-section` 在 `!settings.enabled` 時回 `{ ok:false, error:'新聞模組尚未啟用' }`。
手機端顯示這個訊息即可（不提供開關，見 §6）。

---

## 6. 刻意不做的事

- **手機不提供新聞模組總開關與設定入口**：這次範圍是「閱讀器」。設定要在桌機改。
  （若之後要做設定的手機版，那是另一份規劃。）
- **不做拖曳排序**：改上移／下移。
- **不同步 dismissedIds 到桌機**（方案 A 的必然結果）。

---

## 7. 實作階段

### 階段 0：共用狀態（方案 B）
- [x] `moduleSettings.ts` 加 `readModuleData` / `writeModuleData`（模組自有資料檔）
- [x] `readerState.ts`：釘選 / 不看了存 `modules/desktopst.news/reader-state.json`
- [x] IPC `news:reader-get-state` / `-set-pinned` / `-set-dismissed` / `-migrate-state`
- [x] 桌面 `useNewsReaderStore` 改走 IPC，加 `hydrateSharedState()`；舊 localStorage 自動搬移一次後清掉
- [x] `NewsReaderWindow` 先 hydrate 再 fetch（順序顛倒會用空清單覆寫主程序那份）

### 階段 1：能看（核心）
- [x] `readerFetch.ts` 抽出 batch / section 邏輯，`ipc.ts` 兩個 handler 改為薄層呼叫
- [x] `mobileRoutes.ts`：`reader/state`、`reader/batch`
- [x] `newsModule.activate()` 註冊路由
- [x] `mobile.html`：📰 按鈕、`#reader-overlay` 結構、分頁 chips、卡片清單、換一批
- [x] 顯示模式切換、載入骨架 / 錯誤重試 / 空狀態 / 模組停用提示

### 階段 2：能操作
- [x] 釘選（換一批保留）、這則不要看了 — 走共用狀態
- [x] ↗ 開原文 + `mark-opened`
- [x] 💬 插入手機輸入框並關閉圖層
- [x] 單欄重抓（`reader/section`）

### 階段 3：能調整
- [x] 每欄則數（`reader/quota`）
- [x] 關鍵字組多選（`reader/groups`）
- [x] 欄位上移／下移（`reader/order`）

### 階段 4
- 取消（owner 決定手機版不需要匯出／匯入）

---

## 7.1 實作時修掉的既有 bug

`news:save-settings` 原本把收到的 partial 直接丟給 `normalizeNewsModuleSettings()`，
而該函式是把輸入當「整份設定」正規化 —— 沒帶到的欄位一律回預設值。

新聞報視窗的 **欄位排序 / 每欄則數 / 關鍵字組多選** 共 5 個呼叫點都只送 partial
（`useNewsReaderStore.ts` 的 `reorderSources`、`setSectionQuota`、`setReaderKeywordGroups`），
所以在桌面新聞報拖一次欄位或改一次則數，就會把 `enabled`、關鍵字、黑名單、
地方新聞、破圈、定時排程全部清成預設。

修法：handler 先 `loadNewsModuleSettings()` 再淺層合併。
設定面板送整份的行為不受影響（每個 key 都有帶，合併等同覆寫）。

> ⚠️ **2026-08-06 更正**：上面「handler 先讀一次再合併」的修法本身沒錯，
> 但**做在了錯的層級**。`saveNewsModuleSettings()` 內部本來就會在寫入前
> 重新讀一次磁碟現況、跟傳進去的 partial 合併——handler 再自己讀一次
> `current` 並整包 spread 進去是多做的，而且會重新引入一個新問題：
> handler 讀到的 `current` 是「這個請求進來那一刻」的快照，若這段時間內
> 有另一個請求（B3 階段 6 之後，桌面與手機可能同時寫這份檔）搶先存檔，
> 這個請求事後才執行 `saveNewsModuleSettings` 時，會把它手上那份舊快照
> （包含沒被這次請求碰到的欄位）一起蓋回去，抵銷掉那個搶先寫入的請求。
> 已把 `ipc.ts` 與 `mobileRoutes.ts` 裡所有「先讀 current 再整包 spread」
> 的呼叫點改成只送真正改到的欄位，讓 `saveNewsModuleSettings` 自己的
> 那次讀取（緊貼在寫入之前）成為唯一權威來源。細節見 b3 計畫書 §4.21.2。

---

## 8. 工作量估計

| 檔案 | 估計 |
|---|---|
| `src/main/modules/news/readerFetch.ts` | 新增 ~160 行（多為從 ipc.ts 搬過來）|
| `src/main/modules/news/ipc.ts` | 兩個 handler 縮成薄層，淨減 ~100 行 |
| `src/main/modules/news/mobileRoutes.ts` | 新增 ~150 行 |
| `src/main/modules/news/index.ts` | +2 |
| `assets/mobile.html` | +~650 行（樣式／結構／邏輯，比照現有慣例用框線註解界定邊界，保留抽檔空間）|

桌面版 `NewsReaderWindow.tsx` / `useNewsReaderStore.ts` 不動（方案 A 前提下）。

---

## 9. 驗證與已知限制

### 驗證方式

以假 API（stub `fetch`）把 `mobile.html` 跑在本機 HTTP 伺服器上做煙霧測試，實測通過：
分頁篩選、顯示模式切換、釘選（含換一批後保留）、不看了、單欄重抓、每欄則數、
關鍵字組多選、欄位上下移、「聊這個」插入輸入框並關閉圖層、模組停用提示。

**尚未在真實手機與真實新聞來源上實測**，需要 owner 走一次。

### 已知限制

- **換一批的釘選併回較桌面簡化**：桌面版 `mergeKeepingPins` 會依每欄配額細部併回；
  手機版是「釘選一律保留，分欄時各自歸位、排在該欄最前」。行為好預測，也不必維護第二份配額演算法。
- **地方新聞 / 訂閱來源欄的則數**沒有獨立配額，改的是全域 `readerPerKeyword`（與桌面同行為）。
- 手機不提供新聞模組總開關與設定入口（見 §6），停用時只顯示提示。
