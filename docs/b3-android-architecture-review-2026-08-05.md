# B3 Android 版架構審查報告

> **日期**：2026-08-05
> **版號**：v1.0
> **審查人**：Kiro（AI Code Reviewer）
> **審查基準**：`feat/mobile-ui` 分支，B3 階段 3b 完成狀態
> **審查範圍**：手機版架構設計、與規格書的對齊程度、潛在邏輯漏洞、後續開發建議
>
> 相關文件：
> - `docs/b3-mobile-ui-plan.md`（B3 實作計畫）
> - `docs/multi-device-platform-roadmap.md`（多裝置架構決策）
> - `docs/mobile-html-feature-inventory.md`（49 項功能清單）
> - `docs/pre-b3-work-assessment.md`（B3 開工前評估）

---

## 0. 總結（先讀這裡）

**整體架構判斷：良好。** DataSource / EventSource 的抽象層設計正確，`core/` 抽取完整，文件與實作的主要路徑高度對齊。B3 目前進度（階段 0–3b 完成）沒有系統性的設計債。

**需要關注的三件優先事項**：

| 優先度 | 問題 | 影響 |
|---|---|---|
| 🔴 擋路 | `connection.ts` 沒有路徑進入獨立模式 | LocalDataSource 填完也永遠不被啟動 |
| 🔴 擋路 | `StorageAdapter` 呼叫端仍是 0 | 獨立模式無法存任何資料 |
| 🟡 安全 | `/api/characters/avatar` 的 `ext` 參數缺乏白名單 | 潛在路徑穿越風險 |

---

## 一、已完成架構的評估

### 1.1 核心抽象層（DataSource / EventSource）— ✅ 設計正確

這是整個 B3 最關鍵的決策，執行得相當乾淨。

```
UI 元件
  → useAppStore（唯一資料入口）
      → DataSource 介面（拉取）
      → EventSource 介面（推播）
          ↓ 實作分岔
LocalDataSource / RemoteDataSource
LocalEventSource / RemoteEventSource
```

**亮點**：
- `App.tsx` 是**唯一**知道「現在用哪種資料來源」的地方。元件完全不需要 `if (mode === 'remote')`，完全符合計畫書的設計目標（roadmap §4.5）
- `Capabilities` 介面刻意保持短小（只有 3 個旗標），防止 UI 邏輯被模式差異汙染
- `RemoteEventSource` 的逾時保險改成 `Map<characterId, timer>`，正確處理了群組多角色同時思考的場景（比計畫書草圖更好）

**架構隱患**：`connection.ts` 的 `resolveConnection()` 目前**永遠回傳 `mode: 'remote'`**：

```typescript
// connection.ts — 目前的實作
return { mode: 'remote', baseUrl, token }
```

`LocalDataSource` 沒有任何入口能被啟動。計畫書說「B3 後段處理」，但**沒有明確記錄何時補、補在哪**。→ 見建議 §4.1。

---

### 1.2 DataSource 介面設計 — ✅ 整體正確，一處型別語意不精確

`core/data/types.ts` 的設計乾淨，`list` / `get` 分層的決策正確（對應計畫書中 `worldSetting` 被截成 100 字的記錄）。

**型別語意問題**：`RemoteDataSource.fetchPresets()` 的回傳型別包含 `worlds: PresetListItem[]`，但 `/api/presets` 實際上還附帶了 `worldSetting`（雖然截斷的）。若有呼叫端依賴 `PresetListItem` 的型別定義認為「只有 id 和 name」，然後 `worlds[n].worldSetting` 在 JS 層存在卻在 TS 層不可見，可能導致靜默的 undefined 存取。

目前呼叫端只有 `listWorlds()` 用在下拉選單（只需 id/name），風險低，但值得留意。

---

### 1.3 appStore 的狀態管理 — ✅ 設計周到，一個潛在競態

`appStore.ts` 的樂觀渲染邏輯設計細心：
- `localImages` 記錄剛送出的圖片 data URI，防止空框閃爍
- `findOptimisticMatch()` 抽成獨立函式，訊息合併和 `localImages` key 搬移共用同一套判斷（計畫書 §4.11 明確要求此做法）

**潛在競態**：

```typescript
refresh: async () => {
  try {
    const snapshot = await deps.data.getState()
    set({ snapshot, messages, ... })  // 整串覆蓋
  } catch (e) {
    if (get().ready) return  // ← 已載入過就靜默忽略
    set({ loadError: ... })
  }
}
```

若使用者聊天中斷線，`state-invalidated` 觸發 `refresh()` 失敗後靜默忽略。此時若有 WS `message` 事件推來，該則訊息會被加進 `messages`；但下次重連成功的 `refresh()` 會用伺服器快照整串覆蓋，若快照的時間點早於這則 WS 訊息，訊息會閃現後消失。

這是刻意設計（保留畫面讓使用者繼續讀），但文件裡沒有明確記錄這個取捨。後續接手的 AI 不要誤判為 bug 而試圖「修復」。

---

### 1.4 mobileServer.ts 的信任邊界處理 — ✅ 正確，一個小洞

`mergeCharacterFromRemote()` 正確拒絕手機端指定 `avatar` / `emotions` / `spriteIds`（本機檔案路徑），只接受文字欄位。

**小洞**：`/api/characters/avatar` 端點的 `ext` 參數：

```typescript
// mobileServer.ts — 目前
const r = bridge.saveCharacterAvatar(payload.id, bytes, String(payload.ext ?? '.png'))
```

`ext` 由手機端提供，只做 `String()` 轉換。若手機端送 `ext: '../../../../evil'`，影響程度取決於 `saveCharacterAvatar` 的落地實作如何使用 `ext`。→ 建議加白名單（見 §4.1）。

---

## 二、文件與實作的對齊程度

### 2.1 對齊良好

| 文件規劃 | 實作狀態 |
|---|---|
| DataSource 兩個實作骨架 | ✅ 介面完整，遠端實作完整，本機空殼合理 |
| 不用 `mode === 'remote'`，改用 Capabilities | ✅ 元件裡確實找不到模式判斷 |
| 樂觀渲染 + 圖片本機記憶（`localImages`） | ✅ 機制完整 |
| thinking 逾時保險（per-character `Map`） | ✅ 比計畫書草圖更完善 |
| 圖片去 base64（`MessageSnapshot.imageCount`）| ✅ `sanitizeMessage()` 正確實作 |
| 信任邊界：角色卡只收文字欄位 | ✅ `mergeCharacterFromRemote()` |
| 角色庫 + 角色卡編輯 UI（階段 3b）| ✅ 行為已驗（待 owner 看畫面） |
| `crypto.randomUUID` 改用 `getRandomValues` | ✅ `deviceIdentity.ts` 已處理 |
| 隨機工具統一走 `core/random/dice.ts` | ✅ 三份實作已整合（計畫書 §4 記錄） |

### 2.2 文件記錄但實作尚待完成（正常，非問題）

| 項目 | 預計階段 |
|---|---|
| LocalDataSource 填入實作 | B3 階段 2–5（逐段填入） |
| Capacitor StorageAdapter 接上 | B3 前（B2.7 留的尾巴） |
| API Key 區網直連 IP 判定（電腦端） | 階段 4 |
| 設定 UI（API Key / 模型 / 記憶 / 模組開關）| 階段 4 |
| 預設組 CRUD（Scene / Persona / World）| 階段 5 |
| 個人新聞報（F1–F13）| 階段 6 |

### 2.3 文件與實作有落差（需關注）

**落差 1：StorageAdapter 呼叫端仍是 0**

`pre-b3-work-assessment.md` 的 B2.7 條目明確寫：「呼叫端仍是 0，要接上需先反轉依賴方向，留給 B3」。但 `b3-mobile-ui-plan.md` 的所有階段描述中，**沒有任何一個階段明確列出「接上 StorageAdapter」為交付物**。

若進行到獨立模式的聊天流程卻跳過這步，資料不會被存到任何地方，且不一定有錯誤訊息（取決於 `not-supported` 是否被 UI 正確攔截）。

**落差 2：`LocalEventSource.push()` 沒有呼叫端**

`push()` 是給本機聊天流程發事件用的，但獨立模式的 LLM 呼叫路徑尚未實作，導致：
- 思考動畫在獨立模式下永遠不會啟動
- LLM 回覆在獨立模式下不會觸發訊息串更新

這不是 bug（空殼是刻意的），但代表「獨立模式從未有任何事件被發出過」，測試若只跑遙控模式，整條路徑的正確性無法被驗證。

**落差 3：`connection.ts` 硬寫 `mode: 'remote'`**

架構圖顯示 APK 應能進入獨立模式，但 `resolveConnection()` 完全沒有這條路徑。這不是 bug，但「何時補、補在哪」沒有明確記錄。

---

## 三、邏輯漏洞與潛在 Bug

### Bug 1（高）：`presets.getPersona/getWorld/getScene` 擲例外，但 UI 尚無 fallback

```typescript
// remoteDataSource.ts
getPersona: async (): Promise<PersonaPreset> => { throw notYet('presets.getPersona', 5) },
```

這是刻意設計（誠實擲錯誤）。但**階段 4 的設定 UI 和階段 5 的預設組編輯 UI 都需要呼叫這些方法**。若 UI 沒有為 `DataError('not-supported')` 準備降級處理，會直接崩潰到 React 錯誤邊界，導致畫面空白。

**建議**：在實作這幾個 UI 頁面之前，先確認 `useAppStore` 或元件層有捕捉 `not-supported` 的通用處理，並顯示「此版本不支援此功能」而非崩潰。

---

### Bug 2（中）：`useAvatarUrl` 快取清除計數器可能在重連後歸零

計畫書 §4.14 記錄了「換了主圖畫面卻沒變」的 bug，用 `v=` 遞增數字解決：

```
/api/avatar/:id?v=3
```

若這個遞增計數器存在 React state 或 module 變數，**App 重新掛載（斷線重連 / 頁面重新整理）後計數器歸零**，瀏覽器快取的舊圖又回來了。

**建議**：改用 `Date.now()` 當 cache-buster：

```typescript
// 不需要持久化，每次 saveAvatar 都能保證不重複
invalidateAvatar: (id) => setVersion(id, Date.now())
```

---

### Bug 3（中）：`Composer` 圖片回填（B5）依賴 throw，但靜默失敗路徑存在

```typescript
// appStore.ts
} catch (e) {
  set({ ... 把樂觀訊息換成系統錯誤 ... })
  throw e  // ← 重新拋出，讓呼叫端回填圖片
}
```

`appStore.send()` 失敗時重新 throw，讓 `Composer` 的 catch 攔住並回填圖片。但若 `Composer` 呼叫端用的是 `.then()/.catch()` 鏈而非 `await/try-catch`，或者某個中間層吃掉了例外，圖片回填就永遠不執行，且**不會有任何錯誤訊息**（因為 appStore 的 catch 已經把使用者看得見的錯誤訊息放進去了）。

**建議**：在 `Composer.tsx` 的送出邏輯加一條測試，確認「送失敗後圖片確實回到附件列」。

---

### Bug 4（低）：`findOptimisticMatch()` 不含圖片比對

```typescript
const hit = list.find(
  (m) => isOptimistic(m) && m.role === 'user' && m.content === incoming.content
)
```

若使用者快速連送兩則內容完全相同的訊息（例如因網路慢誤以為沒送出而連按兩次），第二則的樂觀訊息可能被第一則的伺服器回音錯誤取代，導致訊息串少一則。

低機率，但計畫書裡沒有說明這個 edge case 的處理方式。若要防禦，可加時間戳容忍範圍（`Math.abs(m.timestamp - incoming.timestamp) < 2000`）。

---

## 四、後續開發建議

### 4.1 最高優先（開始填 LocalDataSource 之前必做）

**補 `connection.ts` 的獨立模式入口**

```typescript
// 建議方向（具體實作等 Capacitor 層確定後填）
export function resolveConnection(loc: Location = location): Connection {
  // APK 環境（Capacitor）：讀本機設定決定模式
  if (typeof Capacitor !== 'undefined' && Capacitor.isNativePlatform()) {
    const savedServerUrl = loadSavedServerUrl()  // 從本機儲存讀
    if (!savedServerUrl) {
      return { mode: 'standalone', baseUrl: '', token: '' }
    }
    const token = loadSavedToken()
    return { mode: 'remote', baseUrl: savedServerUrl, token }
  }
  // 網頁環境：永遠是遙控（物理限制，roadmap §4.5）
  const params = new URLSearchParams(loc.search)
  const token = window.__mobileToken || params.get('token') || ''
  const serverOverride = params.get('server')
  const baseUrl = (serverOverride || loc.origin).replace(/\/$/, '')
  return { mode: 'remote', baseUrl, token }
}
```

**加 `ext` 白名單到 `/api/characters/avatar`**

```typescript
// mobileServer.ts
const ALLOWED_AVATAR_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp']
const safeExt = ALLOWED_AVATAR_EXT.includes(
  String(payload.ext ?? '').toLowerCase()
) ? String(payload.ext) : '.png'
const r = bridge.saveCharacterAvatar(payload.id, bytes, safeExt)
```

---

### 4.2 高優先（階段 4 開始前）

**確認 `StorageAdapter` 呼叫端接上的時機**

`b3-mobile-ui-plan.md` 裡沒有明確標示哪個階段負責「反轉 `storageAdapter → fileStore` 依賴方向」。這是獨立模式能存資料的前提，需要在進入任何涉及獨立模式儲存的實作前完成。

建議在計畫書 §4.9 的進度表裡補一行：
```
| 0-④ StorageAdapter 呼叫端接上 | ⬜ LocalDataSource 實作開始前 |
```

**確認 `useAvatarUrl` 的 cache-buster 實作**

改用 `Date.now()` 而非遞增計數器，避免重連後快取問題。

---

### 4.3 中優先（階段 4 設定 UI）

**`not-supported` DataError 的通用 fallback**

建議在實作設定 UI 前，先在 `describeError()` 或元件層加入 `not-supported` 的通用處理：

```typescript
// appStore.ts describeError()
case 'not-supported':
  return '這個功能在目前的連線方式下還不支援。'
  // 已有！只要呼叫端有 catch 就能顯示
```

問題是設定 UI 的呼叫端是否都有 `try/catch`。建議制定一個「所有 DataSource 呼叫點」的 catch 慣例並在計畫書裡記錄。

**階段 4 需要補的 mobileServer 端點清單（預估）**

目前 `mobileServer.ts` 完全沒有設定讀寫端點，除了 `/api/settings/color-theme`（已有）。預計需要：

| 端點 | 用途 |
|---|---|
| `GET /api/settings` | 讀取完整設定（含 provider / model / memory 參數）|
| `POST /api/settings/llm-provider` | 切換供應商 |
| `POST /api/settings/llm-model` | 設定模型 |
| `POST /api/settings/llm-endpoint` | 設定自訂端點 |
| `POST /api/settings/llm-apikey` | 設定 API Key（僅區網直連，需加 IP 檢查）|
| `POST /api/settings/memory` | 記憶參數（keepRecentN / autoSummarize）|
| `GET /api/modules` | 模組清單（含啟用狀態）|
| `POST /api/modules/:id/toggle` | 模組開關 |

---

### 4.4 低優先但建議提早留紀錄：獨立模式的事件流骨架

目前 `LocalEventSource.push()` 完全沒有呼叫端。獨立模式完整事件流：

```
UI.send()
  → LocalDataSource.sendMessage()
    → core.chatWithLLM(deps)
      → LocalEventSource.push({ kind: 'thinking', characterId })
      → LLM 回覆完成
      → LocalEventSource.push({ kind: 'message', message })
      → LocalEventSource.push({ kind: 'thinking-done', characterId })
```

建議在開始實作 LocalDataSource 的 `sendMessage()` 時，把這個流程的骨架（即使 LLM 呼叫還沒接上）先寫進去，避免思考動畫在獨立模式下永遠不停或不啟動。

---

## 五、不需要改的地方（給接手 AI 的說明）

以下幾個看起來像問題但**刻意如此**的設計，不要試圖「修正」：

| 現象 | 原因 | 文件位置 |
|---|---|---|
| `LocalDataSource` 所有方法都 throw | Capacitor adapter 未實作前先寫是白寫，等接上再填 | `mobile/data/localDataSource.ts` 檔頭、計畫書 §4.1 |
| `connection.ts` 永遠回傳 `mode: 'remote'` | 網頁環境物理上只有遙控；APK 入口待補 | roadmap §4.5、本報告 §1.1 |
| `refresh()` 斷線後靜默忽略錯誤 | 刻意保留畫面讓使用者繼續讀，不是漏接 | `appStore.ts` 註解、本報告 §1.3 |
| `presets.get*()` 擲 `notYet(method, 5)` | 端點未建，誠實告知而非假裝成功 | `remoteDataSource.ts` 檔頭、計畫書 §4.0 |
| `mobile.html` 裡的機率表沒有刪掉 | 純 vanilla HTML 不能 import TS，等 B6 整份替換 | `mobile-html-feature-inventory.md` §4 |

---

*審查完成時間：2026-08-05*
*下次建議審查時機：B3 階段 4（設定 UI）完成後*
