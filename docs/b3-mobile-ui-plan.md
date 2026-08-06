# B3 手機 UI 實作計畫

> 日期：2026-08-04｜分支 `feat/mobile-ui`（自 `099b80a`）
> 範圍定義：`docs/mobile-html-feature-inventory.md`（49 項獨立版必做 ＋ §6.1 的 10 項設定 UI）
> 設計約束：`docs/multi-device-platform-roadmap.md` §2（四大目標）、§3.3、§4.5、§4.7、§8
>
> ### 📖 閱讀方式（省 Token）——**不要整份讀**
> - 查進度／下一步 → **本文首** ＋ **§4.9**
> - 做某階段 → 只開該階段正文 ＋ 對應落地筆記（§4.1x）
> - 改 QR／relay／手機建置 → **只開 §4.20**（relay 硬約束仍有效；雙入口已結束）
> - 懷疑踩已知坑 → Grep §4.10–§4.16；資訊架構 → §4.19
> - 新對話預設讀 [`CLAUDE.md`](../CLAUDE.md)，本檔屬選讀（見 [`docs/README.md`](README.md)）
>
> **狀態：階段 0–6、8、9 程式與契約測試完成（0-③／1／2a–2d／3a／3b／4／5／6／8／9）；
> 另含資訊架構重整（§4.19）與 relay 硬約束（§4.20）。**
> 階段 5／6／8／9 與 §4.19 畫面尚待 owner 真機確認。
>
> **下一步：階段 7（收尾／APK）。**
> 執行順序曾改為 8 → 9 → 6 → 7（2026-08-05），現在只剩 7。
> `mobile.html` 與舊版 QR 已於 2026-08-07（B6 真機驗證通過後）依 §4.23 移除；
> 手機遠端為**單一入口 `/`**。
> 沒開 DeST 時的驗證方式見 §4.9 與 `scripts/README-mobile-stub.md`。
>
> **B6（遙控 UI 搬新版）已完成**：程式／stub／真機驗證均通過 —— 落地筆記見 §4.22。

---

## 0. 一句話

寫一份 React 手機 UI，跑在兩種資料來源（本機 core／遠端 relay）與兩種散布（APK／掃 QR 網頁）上。
**新程式碼幾乎都是 UI 與資料來源接線，業務邏輯一行都不該新寫** —— 要新寫時就是 core 沒抽乾淨，去修 core。

---

## 1. 兩個抽象層（**這是整個 B3 的骨架，先立這個**）

階段 0-② 已經給了一半：`EventSource` 管「事情發生了」（推播方向）。
還缺另一半：「我要讀資料／我要下指令」（拉取方向）。

```
        ┌──────── 手機 UI（React，一份）────────┐
        │  元件只認識這兩個介面，不知道自己在哪種模式  │
        └───────┬──────────────────┬───────────┘
                │                  │
        EventSource            DataSource        ← 新增（本計畫的第一項產出）
        （已完成）              （階段 0-③）
                │                  │
        ┌───────┴──────┐   ┌───────┴──────────┐
   local│         remote│  local│           remote│
  本機發事件      WebSocket   直接呼叫 core    HTTP /api/*
```

### 1.1 `DataSource`（`src/core/data/types.ts`）

介面放 core（純型別、零 UI 文案），實作放 `src/mobile/data/`：

| 檔 | 內容 |
|---|---|
| `core/data/types.ts` | `DataSource` 介面 ＋ `Capabilities` |
| `mobile/data/localDataSource.ts` | 獨立模式：呼叫 `core/` ＋ Capacitor adapter |
| `mobile/data/remoteDataSource.ts` | 遙控模式：打 `mobileServer` 的 `/api/*`（29 個端點已存在） |

**全部方法為 `async`**，即使獨立模式手上是同步資料也一樣 —— 否則遙控實作接不上，
而且 UI 會被迫寫兩種寫法（正是 §4.1 要防的東西）。

方法分組（對照清單分類）：
`getState` / `sendMessage` / `messages.*`（A6）/ `characters.*`（D）/ `conversations.*`（E1–E2）/
`presets.*`（E3–E5 讀＋寫）/ `settings.*` / `news.*`（F）/ `reminders.*`。

### 1.2 模式差異一律用 `Capabilities` 表達，不用 `if (mode)`

```ts
interface Capabilities {
  /** 可讀寫 API Key。**條件是「是否區網直連」，不是「哪種模式」**（roadmap §4.7）。 */
  apiKeyAccess: boolean
  remoteControl: boolean    // H1–H11，B6 才實作，先留旗標
  screenshot: boolean       // 遙控專屬（決議 ②）
}
```

UI 讀旗標決定「顯示／隱藏」，**元件裡不得出現 `mode === 'remote'`**。
`EventSource.getStatus()` 那條規則（獨立模式永遠 `'online'`）延伸到這裡。

> **編輯功能（角色卡／預設組／設定）兩種模式都有，不設旗標。**
>
> 曾經考慮過遙控模式隱藏編輯，理由是「兩份入口會有同步問題」—— **那是錯的**。
> 遙控模式下手機**沒有自己那份資料**，編輯就是一次 RPC，改的是電腦上的唯一一份，
> 不可能分歧。真正的同步問題是「獨立模式的本機資料 ↔ 電腦」，
> 那是 S1／S2（roadmap §4.7，B5 之後），與遙控編輯無關。
>
> 統一之後 `DataSource` 兩個實作的介面完全相同，編輯類元件一個分支都不必寫。
>
> ⚠️ **代價（工作量，非架構債）**：`mobileServer` 現有 29 個端點全是讀取與「套用」，
> **沒有任何寫入端點**。遙控模式要能編輯，得在階段 3／4／5 各自補上對應的
> `/api/*` 寫入端點。這部分寫在各階段的範圍裡。
>
> **唯一的例外是 API Key** —— 它從來就不是模式問題，而是傳輸安全邊界：
> 只在區網直連時可讀寫，由**電腦端檢查來源 IP** 判定（不可信任手機端自稱），
> 且永不參與同步。UI 直接顯示連線狀態，不要求使用者判斷，不提供覆寫選項。

### 1.3 差異清單（哪些畫面兩種模式不同）

| 畫面 | 獨立 | 遙控 | 藏在哪 |
|---|---|---|---|
| 聊天主畫面 | ✅ | ✅ | 完全相同 |
| 角色頭像列 / 說點什麼 / 禁言 | ✅ | ✅ | 相同 |
| 「誰在場」管理（D4） | 本機清單 | 對應桌面角色，位置由電腦端補（決議 ①） | DataSource |
| 對話 CRUD、情境／Persona／World **切換** | ✅ | ✅ | 相同 |
| 角色卡編輯、預設組編輯、設定 | ✅ 寫本機 | ✅ 寫電腦（RPC） | DataSource，**介面全等、UI 零分支** |
| 設定裡的 API Key 欄位 | ✅ | 僅區網直連時 | `Capabilities.apiKeyAccess`（依連線方式，非模式） |
| 新聞報 | 本機 `readerFetch` | `/api/news/reader/*` | DataSource |
| 連線狀態列 | 永不顯示 | 斷線／重連中 | `getStatus()` |
| 遙控面板（H） | 模組關閉時隱藏 | ✅（B6） | `Capabilities.remoteControl` |

---

## 2. UI 骨架決定

| 項目 | 決定 | 理由 |
|---|---|---|
| **框架** | React 18 + TS + Tailwind（與 renderer 同一套） | §4.3；桌面元件與樣式可參考移植 |
| **建置** | 新增 `vite.mobile.config.ts` → `out/mobile`（`capacitor.config.ts` 已指這裡） | 與 electron-vite 分離，網頁版與 APK 吃同一份輸出 |
| **路由** | **不裝 router**，自寫 `useView()` 狀態機 | 手機只有一個主畫面 ＋ 疊上去的 sheet／overlay。裝 react-router 只為了兩層導航不划算，且 APK 內 history API 行為與網頁不同 |
| **狀態管理** | Zustand（與桌面同一套） | 一個 `useAppStore`（state 快照 ＋ 訊息串）＋ 一個 `useUiStore`（sheet 堆疊、toast、主題） |
| **導航模型** | **overlay 堆疊**：`push(view)` / `pop()`，Android 實體返回鍵 ＝ `pop()`（Capacitor `App.backButton`），空堆疊才退出 | G3。這是手機 UI 的核心互動，階段 1 就要做對 |
| **底部 sheet** | 統一元件 `<Sheet>`：拖曳把手、背景遮罩點擊關閉、`env(safe-area-inset-bottom)` 內距 | G3 ＋ G4 |
| **主題** | 沿用 `ui.colorTheme` 9 種，CSS 變數照抄 `mobile.html:817-840` | G1；不重新設計色票 |
| **Toast** | `useUiStore` 佇列 ＋ 單一 `<ToastHost>` | G2 |
| **對話框** | 自寫 `<Prompt>` / `<Confirm>`（回傳 Promise），**不用瀏覽器 `prompt()`** | E2 備註明列 |

### 2.1 目錄配置

```
src/mobile/
  data/           localDataSource.ts / remoteDataSource.ts / index.ts（依模式挑一個）
  events/         已存在
  adapters/       Capacitor 版五個 adapter（用到哪個做哪個）
  ui/
    App.tsx
    stores/       appStore.ts / uiStore.ts
    shell/        Sheet / Toast / Dialog / ThemeProvider / SafeArea / ViewStack
    chat/         MessageList / Composer / Attachments / RandomToolPanel
    characters/   AvatarBar / PresenceSheet / CharacterEditor
    presets/      Scene / Persona / World 編輯器
    settings/     ApiKey / Model / Memory / Modules / Reminders / News
    news/         Reader（維持 mobile.html 檔頭那個「對外只 5 個函式」的邊界）
    index.html, main.tsx   ← 在 ui/ 底下，vite 的 root 就指這裡
```

> `adapters/`、`characters/`、`presets/`、`settings/`、`news/` **尚未建立**，
> 到該階段再開。目前只有 `data/`、`events/`、`ui/{shell,chat,stores}`。

**`src/mobile/ui/` 不得 import `src/main/`**，與 core 同級的紀律。
UI 文案全部在這裡，core 一個字都不加（roadmap §3.3）。

---

## 3. 網頁版與 APK 的共用邊界

**共用：`src/mobile/ui/` 與 `src/mobile/data/remoteDataSource.ts` 全部。**
差別只有兩處，各一個檔案：

| | APK | 網頁版（掃 QR） |
|---|---|---|
| 進入點 | `main.tsx` → 讀本機設定決定模式 | 同一個 `main.tsx`，偵測到由 mobileServer 提供 → 強制遙控 |
| 可用 DataSource | local ＋ remote | **只有 remote**（物理限制，§4.5） |
| adapters | Capacitor | 不需要 |
| 前景事件 | Capacitor `App.appStateChange` | `visibilitychange` |

落地方式：`mobile/data/index.ts` 的 `createDataSource(mode)` 與
`mobile/platform/` 兩個薄檔（`platform.capacitor.ts` / `platform.web.ts`），
由 Vite 的 build target 決定打包哪一個。**Tree-shaking 會讓網頁版不含 Capacitor 程式碼。**

`mobileServer` 從 `assets/mobile.html` 改為提供 `out/mobile/` 是**階段 7 才做的一行改動**，
在那之前 `mobile.html` 照常服役，新 UI 走 `vite dev` 開發（打電腦的 `/api/*`）。

---

## 4. 階段拆分

每階段可獨立驗收、獨立 commit，且**做完就跑 `npm run typecheck` ＋ `npm test`**。

### 階段 0-③ ── `DataSource` 介面 ＋ 兩個實作骨架（無 UI）

- 產出：`core/data/types.ts`、`mobile/data/{local,remote}DataSource.ts`、`Capabilities`
- remote 實作把 `mobile.html` 那 29 個 `/api/*` 呼叫收斂成一支型別化 client。
  **介面同時定義編輯類方法**（現有端點不足，缺的在階段 3／4／5 補齊）——
  介面先完整、實作分階段填，比事後回頭改介面形狀好
- local 實作先做 read-only 那半（`getState` / `conversations` / `presets`），寫入側隨階段推進補
- **驗收**：typecheck 過；`tests/data/` 用假 adapter 驗證兩個實作對同一組操作回傳同形資料
- 硬性：階段 0-③ 完成前不寫任何聊天元件（同 inventory §5.4 對階段 0 的約束）

> **實際落地與上面兩點的差異（2026-08-04）**：
>
> 1. **`LocalDataSource` 維持全空殼，沒有先做 read-only 那半。** 動手才發現它每個
>    方法都要經過 Capacitor 版 `StorageAdapter`，而那個還沒實作。先寫一份猜的，
>    接上時多半要重寫 —— 正是階段 0 要避免的事。比照 `localEventSource.ts` 的先例。
> 2. **預設組改成 `list` / `get` 分開**：`/api/presets` 只回精簡欄位
>    （`worldSetting` 被截成 100 字），宣稱回傳完整 `PersonaPreset[]` 等於型別說謊。
> 3. **多了 `SettingsApi`**（階段 2a 期間補的，原本排在階段 4）：色彩主題必須能寫回
>    電腦端，否則手機改了不會存。目前只有 `setColorTheme`，其餘設定仍在階段 4。

### 階段 1 ── UI 骨架（G1–G4）

- ViewStack ＋ Sheet ＋ Toast ＋ Dialog ＋ 主題 ＋ 安全區域 ＋ `vite.mobile.config.ts`
- **驗收**：`npm run dev:mobile` 能開出空殼，9 種主題可切、sheet 可疊可返回、
  Chrome DevTools 手機模擬下無橫向捲動；APK 端此時尚不驗

### 階段 2 ── 聊天主線（A1–A9、B1–B5、C1–C6、D1–D6）

- 先接 remote DataSource（電腦要開著，但**能立刻對照 `mobile.html` 逐項驗**）
- 再接 local（獨立模式第一次真的用手機跑 LLM）
- **驗收**：對著 inventory §6 的勾選清單逐項勾；B2 縮圖壓縮要實測 4000px 照片；
  C 系列的機率與 token 展開已有 core 測試守著，UI 只驗顯示

### 階段 3 ── 角色庫 ＋ 角色卡編輯（決議 ④ 最大單項）✅ **已完成，落地筆記見 §4.14**

- 角色 CRUD、人格／開場白／主圖、Lorebook 綁定、PNG ＋ DST Pack 匯入匯出
- `core/card/` 已就緒；匯入匯出走 Capacitor Filesystem／網頁版走 `<input type=file>` 與 download
- **含 `mobileServer` 角色寫入端點**（新增／更新／刪除／匯入），供遙控模式走同一套 UI
- **驗收**：手機建一隻新角色 → 直接開始聊；桌面匯出的 PNG 卡在手機匯入後欄位全等；
  遙控模式改角色後，電腦端桌寵即時反映（走既有的 `desktop-updated` → `state-invalidated`）

### 階段 4 ── 設定 UI

- 第一層只露「填 API Key」＋ 供應商／模型；其餘（endpoint、記憶參數、模組開關）收進「進階」（§2 目標 4）
- 提醒 CRUD（排程本身是 B5，先做資料面）
- **含 `mobileServer` 設定寫入端點**；API Key 那支要在電腦端做**來源 IP 檢查**，
  非區網直連一律拒絕（不可信任手機端自稱），並回報給 UI 當 `apiKeyAccess`
- **驗收**：全新安裝 → 只填 API Key → 能聊天，過程中不出現任何進階名詞；
  遙控模式經 relay 連線時 API Key 欄位不出現，區網直連時出現

### 階段 5 ── 預設組編輯（E3–E5 寫入側）

- 情境／Persona／World 的新增・編輯・刪除；情境含 `moduleOverrides`、`lorebookIds`
- **含 `mobileServer` 預設組寫入端點**（現有只有 `activate-persona` / `activate-world` / `scenes/apply`）

### 階段 6 ── 個人新聞報（F1–F13，可平行插入）✅ **已完成，2026-08-06**

- F1 分欄統一走 core（順手解掉 `nrGroupByKeyword` 那份重複實作）
- F12 相對時間是純函式，搬 `core/util/`
- `readerFetch.ts` / `readerState.ts` 的純邏輯搬 core，I/O 留平台層（比照 B2.7 的形狀）
- ✅ 一併補上 §6.1 的最後一項「設定：新聞關鍵字、黑名單、來源、排程」。
  落地筆記見 **§4.21**。

### 階段 7 ── 收尾：APK 打包

- ~~`mobileServer` 改提供 `out/mobile/`；`mobile.html` 保留一個版本週期再刪~~
  → **網頁版切換已於 2026-08-07 完成**（§4.23；單一入口 `/`）
- `npx cap add android`（此時 `webDir` 才真的存在）→ 實機驗證
- keystore **不做**（owner 未決定）

#### 4.23 移除 `mobile.html` ＋ 舊版 QR —— ✅ **已完成，2026-08-07**

> **前提（硬性 gate）**：owner 完成 B6 真機驗證（真的點擊/拖曳有作用到滑鼠、
> 打字真的打進電腦、程式白名單開/關真的生效、系統動作真的執行、多螢幕/多視窗
> 切換截圖正確）。**已通過**，以下清單全部執行完畢。

1. ✅ `src/main/mobileServer.ts`：`GET /` 一律 `serveMobileAppFile('index.html')`；
   移除 `getMobileHtmlPath()` 與 `?ui=app` 分流。
2. ✅ 刪除 `assets/mobile.html`。
3. ✅ `QRCodeWindow.tsx`：只留一組 QR，文案不再寫新版／舊版。
4. ✅ `mobile:get-status`：拿掉 `appUrl`／`localAppUrl`／`relayAppUrl`／`withAppFlag`，
   以 `url`／`localUrl`／`relayUrl` 作為唯一入口。
5. ✅ `cloudflare-worker.js`：檔頭註解改為「代理手機 UI」。
6. ✅ `.bat` 腳本：`DesktopST-dev.bat` 文案去掉「新版」；其餘 bat 無舊版殘留。
7. ✅ 文件收尾：`CLAUDE.md`／`AGENTS.md`／inventory §7／本檔文首與 §4.20。
8. ✅ 回歸驗證：見本次 commit 的 typecheck／test／`build:mobile` 結果；
   直打 `/`（不帶 `?ui=app`）應進 React UI。

### 階段 8 ── 對話清單與切換（E1–E2）✅ **已完成，2026-08-05**

- 原始現況（已解決）：`ConversationsApi`／`mobileServer` 的 `/api/conversations*` 端點其實
  在階段 0-③ 就已經齊了（`RemoteDataSource.conversations` 全部方法都有實作），真正缺的
  只有 (a) `ViewStack.tsx` 沒有 `conversations` 的渲染分支、(b) 桌面切換對話時完全不會
  推播給手機，`setMobileConversationHook`（`src/main/index.ts`）發現 `conv.id !== mobileLastConvId`
  時原本直接 `return`，靜靜吞掉「換對話」這件事。
- 修法：`index.ts` 的 hook 在偵測到對話切換時改為呼叫 `pushDesktopUpdate(...)`，借用既有的
  `desktop-updated` WS 推播觸發 `RemoteEventSource` 的 `state-invalidated`，手機端 `refresh()`
  本來就會重抓 `/api/state`（含目前使用中的對話），不需要新的事件型別。
- 新增 `src/mobile/ui/conversations/ConversationsView.tsx`：清單 + 切換（點列＝切換並關閉
  sheet）+ 新增；改名與刪除移到 `ConversationEditor.tsx`（見下方「跨畫面操作邏輯統一」）。
  刪除無「至少留一個」限制，照抄桌面端「刪光自動生一個新對話」的行為，不像角色/預設組
  那樣會刪到壞掉。
- `scripts/mobile-stub-server.mjs` 補上對應四支端點；`messages` 變數改成指向「目前使用中
  對話」的訊息陣列（`let` 而非 `const`），切換/新增/刪除對話時重新指派。
- **跨畫面操作邏輯統一（2026-08-05 owner 回報）**：對話／情境／世界觀／使用者設定
  （`PresetsView`）／角色庫／在場角色（`PresenceSheet`）五個清單畫面原本位置不一致——
  `PresetsView` 是「左邊大按鈕套用、右邊 ✏️ 編輯」，但角色庫、`PresenceSheet`、原本的
  `ConversationsView` 都是反過來或另外把改名/刪除擠在清單列上。統一成同一套：
  **左邊大按鈕永遠是「套用／切換」或「加入／移出對話」這組動作，右邊固定一顆 ✏️ 進編輯，
  刪除一律收進編輯器內，清單列上不放刪除**（角色卡編輯器、預設組編輯器本來就是這樣，
  新增的 `ConversationEditor.tsx` 比照辦理）。使用中/在場的項目統一用薄荷綠底色標示。
- **驗收**：桌面切換對話後，手機不用重新整理就換成同一份訊息串（靠 `state-invalidated`
  推播 + `refresh()`）；手機清單新增/改名/刪除對話後，桌面端 log 視窗與桌寵泡泡跟著更新
  （沿用既有的 `broadcastConversationUpdate`）。**尚待 owner 真機驗證**，跟階段 5 一樣走
  `MobileST-real-test.bat`，核對終點是桌面的對話清單/log 視窗，不是 HTTP 200。

### 階段 9 ── 用語解說（Lorebook）內容編輯（2026-08-05 owner 加入排程）

- 現況：手機的角色卡編輯器與情境編輯器都能看到用語解說「清單」並勾選要不要綁定
  （見 `CharacterEditor.tsx` 的「用語解說」區塊、`PresetEditor.tsx` 的 `SceneFields`），
  但只有 `GET /api/lorebooks`（回 `{id, name}[]`，唯讀）——**看得到書名，卻無法在手機上
  新增/編輯/刪除書本身或裡面的條目**，使用者會覺得「看到了卻不知道去哪改」。
- core 的 `core/lore/` 已有完整的資料結構與純邏輯（B2.5／B2.6 桌面版已在用，見 CLAUDE.md
  Lorebook 段落），這裡要補的是 `mobileServer` 的讀寫端點 ＋ 手機端的編輯 UI，比照階段 5
  的 preset 編輯器形狀（一個共用的清單 + 編輯器，資料只走 `DataSource`）。
- **驗收**：手機能新增一本用語解說、加/刪條目、存檔後角色下一則回覆看得出生效；
  桌面端打開同一本書看到手機端的修改。
- ✅ **已完成，2026-08-06**，程式與 stub 端點驗證完成。落地筆記見 §4.18。
  （入口後來依 §4.19 從「設定 → 進階」併進 `PresetsView` accordion。）

> 階段 2–6 順序可依當下狀況調換，**唯一硬性約束是階段 0-③ 與階段 1 必須在前**。
> 階段 8、9 排在階段 7 之後單純是加入排程的時間順序，實際上不依賴階段 7 完成，
> 之後真要插隊提前做也可以。
>
> **執行順序改為 8 → 9 → 6 → 7**（2026-08-05）：階段 6 原本排在最前面沒有特別理由，
> 只是照 `docs/mobile-html-feature-inventory.md` 的功能編號（F 系列）順下來，
> 這份計畫書自己也寫了「順序可依當下狀況調換」。owner 實機驗證階段 5 時多次卡在
> 「對話沒同步」「情境/世界/使用者刪除保護的訊息看不懂」這類基礎體驗問題，
> 用語解說也是「畫面上看得到卻不能改」——這些都比新聞報更貼近每天實際會用到的
> 核心聊天流程，新聞報則是一個相對獨立、可隨時平行插入的附加模組（見階段 6 標題
> 本來就寫「可平行插入」），先把核心體驗補齊比較合理。

---

## 5. 已知風險與預先決定

| 風險 | 預先決定 |
|---|---|
| 獨立模式的 LLM 串流 | `HttpAdapter.supportsStreaming` 回 false 是正常路徑，UI 先做非串流，不當錯誤 |
| Capacitor SecretAdapter 選外掛 | 階段 4 才需要；在那之前 API Key 不落地，避免先挑錯外掛 |
| `mobileServer` 要補一批寫入端點 | 已分散進階段 3／4／5，不集中成一大塊。端點命名與 IPC 對齊，避免第三套語彙 |
| API Key 在非區網下的入口 | **隱藏而非 disabled** —— disabled 按鈕會讓使用者以為壞了；旁邊說明「改用區網連線可編輯」 |
| `mobile.html` 的機率表 | 已隨 §4.23 移除；機率統一走 `core/random` |
| 測試邊界 | 新寫的 UI 不進 vitest（`tests/README.md` 只測 `core/`）；能測的是搬進 core 的純函式與 DataSource 契約 |

---

## 4.9 進度（隨時更新）

| 階段 | 狀態 | commit |
|---|---|---|
| 0-③ DataSource | ✅ | `50d3c5d` |
| 1 UI 骨架 | ✅ 已人工驗機 | `0d6e97a` ＋ 修正數則 |
| **2a 聊天主線**（A1–A5、A8、A9） | ✅ 已人工驗機 | `f8b3622` ＋ 修正數則 |
| **2b 圖片**（B1–B5） | ✅ 已人工驗機 | `885384b` |
| **2c 隨機工具**（C1–C6 ＋ A7） | ✅ 已人工驗機 | `885384b` |
| **2d 角色列**（D1–D6）＋ A6 | ✅ 已人工驗機 | `00206fa` |
| **3a 角色卡寫入的資料面**（端點 ＋ DataSource） | ✅ 行為已驗 | `7bd2d3d` |
| **3b 角色庫 ＋ 角色卡編輯 UI** | ✅ 行為已驗，**待 owner 實機看畫面** | `d74d269` |
| **4 設定**（API Key／供應商／模型／進階：endpoint／記憶／模組開關／提醒 CRUD） | ✅ 行為已驗（假伺服器 ＋ 瀏覽器），**待 owner 實機看畫面** | 落地筆記見 §4.15 |
| **5 預設組編輯**（Scene／Persona／World 新增、編輯、刪除） | ✅ 程式與契約測試完成（假伺服器）；**待 owner 真機驗證** | 本次未提交變更 |
| **6 個人新聞報**（F1–F13 ＋ 新聞設定） | ✅ 程式與 stub＋瀏覽器操作驗證完成；**待 owner 真機驗證** | 落地筆記見 §4.21 |
| 7 收尾／APK | ⬜ | |
| **8 對話清單與切換**（E1–E2） | ✅ 程式與手動端點驗證完成（stub）；**待 owner 真機驗證** | 見 §4「階段 8」 |
| **9 用語解說內容編輯** | ✅ 程式與 stub 端點驗證完成；**待 owner 真機驗證** | 見 §4.18「階段 9 落地筆記」 |
| **資訊架構重整 ＋ 單色圖示**（owner 2026-08-06 回報） | ✅ 程式與瀏覽器 DOM 驗證完成；**畫面外觀待 owner 實機確認** | 見 §4.19 |

### 開發時怎麼連上真資料

```
http://<電腦區網IP>:<Vite 埠>/?server=http://<電腦區網IP>:<mobileServer 埠>&token=<存取權杖>
```

`MobileST-real-test.bat` 會在 DeST 已啟動且 mobileServer 可用時，自動尋找區網 IP、權杖、mobileServer 埠，並選擇可用的 Vite 埠後產生 QR；不必手動輸入 IP。`MobileST-test.bat` 則啟動假伺服器與假資料。
正式版是同源、不需要參數（階段 7）。

⚠️ **dev server 會無聲停掉**（工具重啟、機器休眠）。手機出現「載入失敗」時，
先確認批次檔選出的 Vite 埠仍在聽，再查別的；若模組改動後畫面沒更新，先重開 dev:mobile。

### 沒開 DeST 時怎麼驗（多數情況用這個）

```bash
node scripts/mobile-stub-server.mjs
```

假 mobileServer，起在 5999，把 `?server=` 指過去即可。
用法與已模擬的端點見 **`scripts/README-mobile-stub.md`**。

它的價值不只是「不必開 DeST」——**每一則請求都印在終端**，
手機上按了什麼、實際送出去什麼（含圖片壓縮後的大小）看得一清二楚，
這是接真 `mobileServer` 時反而看不到的。

⚠️ **stub 要連拒絕條件一起模擬，不能只回成功。**
理由與實際踩到的案例見該 README 與下面的 §4.13。

真的要驗角色口吻、prompt 組裝、圖片有沒有送進模型，還是得開 DeST。

### 4.17 階段 5 交接與驗證邊界（2026-08-05）

- 手機 UI 已有 Scene／Persona／World 的新增、編輯、刪除；資料寫入沿用 `ipcHandlers.ts` 的 `*Direct`，桌面 IPC 與 `mobileServer` 都是薄轉呼叫，不在手機端複製邏輯。
- UI 顯示名稱而非內部 ID：Scene／World 以角色列上方的緊湊 chip 顯示目前使用中項目；Persona 移到輸入框上方，顯示「目前以誰發言」，點名稱可切換。
- Scene 套用後會 refresh；桌面既有的「每個情境記住最後對話」邏輯仍由共用 handler 負責。這部分尚未由 owner 完成真機端到端確認。
- `MobileST-test.bat` 只驗 React UI 與拒絕條件 stub，資料不會持久化；`MobileST-real-test.bat` 才是接真 DeST 的入口，DeST 必須先啟動並開啟 mobileServer。
- ~~DeST 內建 QR 在階段 7 前仍指向舊的 `assets/mobile.html`~~ →
  ~~**已過時（2026-08-06）**：QR 視窗出兩組碼~~ →
  **已收尾（2026-08-07）**：B6 真機驗證通過後依 §4.23 移除 `mobile.html` 與舊版 QR，
  現為單一入口 `/`。`DesktopST-dev.bat` 會先 `build:mobile`，日常不必再開 `MobileST-*.bat`。
- 寫入驗證終點是 `%APPDATA%\desktop-st\Data\`（依實際資料根目錄）內對應的 `card.json`、`settings.json` 與 preset 檔案最終內容，不是 HTTP 200；測試選檔時 `accept` 只用 `image/*`。

#### 真機檢查清單

準備：DeST 先啟動並開啟 mobileServer → 跑 `MobileST-real-test.bat` → 手機掃碼連線。
資料根目錄預設在 `%APPDATA%\desktop-st\Data\`；preset 各自一個檔案存在 `personas\<id>.json`／`worlds\<id>.json`／`scenes\<id>.json`（見 [keys.ts](../src/core/store/keys.ts)），啟用中的 id 記在 `settings.json` 的 `activePersonaId`／`activeWorldId`（Scene 目前無 active 概念，套用即切換對話，不落地成 settings 欄位——若手機端顯示的 chip 與桌面實際使用中的情境不一致，這是要抓的重點）。每一步都是「操作 → 看畫面回饋 → 開檔案／桌面視窗核對實際內容」，不是看 HTTP 200 就算過。

1. **新增**
   - 手機端新增一個 Scene／Persona／World，填入名稱與內容後存檔。
   - 檢查對應 `Data\{personas|worlds|scenes}\<新 id>.json` 是否生成，欄位是否與手機填的一致。
   - 回桌面開設定視窗，確認新項目出現在清單裡（不用重啟 DeST）。

2. **編輯**
   - 在手機端修改一個既有 preset 的內容（如世界觀正文、Persona 名稱）並存檔。
   - 檔案內容應原地更新，id 不變；桌面端清單/設定視窗打開後應看到新內容。
   - 若該 preset 正是目前啟用中的（如 activePersonaId 指到它），確認下一則對話送出的 prompt 已套用新內容，而不是舊的快取版本。

3. **刪除**
   - 刪除一個非啟用中的 preset，確認對應檔案從資料夾消失，手機清單即時移除。
   - 嘗試刪除「目前唯一」或「正啟用中」的 Persona／World（比照桌面既有的保護邏輯，桌面端目前禁止刪到剩 0 個或刪除啟用中項目），確認手機端出現清楚的拒絕 UI，而不是靜默失敗或看起來成功但檔案還在。

4. **Scene 切換與對話保留**
   - 建立兩個以上 Scene，各自對話幾句後切到另一個 Scene 再切回來。
   - 確認切回原 Scene 時對話內容是原本那段（桌面「每個情境記住最後對話」的邏輯），而不是清空或串到別的情境。
   - 手機上角色列上方的 chip 名稱要跟著切換同步更新，不能停在舊名稱。

5. **Persona 切換身份**
   - 在輸入框上方點目前 Persona 名稱切換到另一個 Persona。
   - 送出一則訊息，確認：(a) `settings.json` 的 `activePersonaId` 已更新；(b) 這則訊息裡「使用者」的名稱／人稱如果會出現在 prompt 或訊息中，是用新 Persona 的設定，不是切換前殘留的。

6. **World 切換**
   - 切換 World 後送一則訊息，確認 `settings.json` 的 `activeWorldId` 更新，且角色回覆能反映新世界觀設定（例如 prompt 組裝時帶入新 World 的正文，可搭配桌面 log 或直接觀察角色回覆內容判斷）。

7. **拒絕條件與錯誤 UI**
   - 對照 `scripts/README-mobile-stub.md` 已模擬的拒絕情境（如刪除保護、必填欄位缺失），在真機／真伺服器上重現一次，確認錯誤訊息看得懂、不是原始 stack 或英文代碼直接丟出來。
   - 手機端網路中斷或 mobileServer 關閉時嘗試存檔，確認出現「存檔失敗」提示而不是假裝成功。

驗證完成後回來更新本節與 §4.9 表格的狀態，並同步 `docs/progress-log.md`。

---

## 4.10 現場筆記：階段 1–2a 實機踩到的五個坑

> 全部都有「**在桌機上完全正常、一到手機就壞**」或「**沒有任何錯誤訊息**」的性質。
> 寫在這裡是因為它們會再犯 —— 尤其後面還有六個階段要寫。

### 1. `css.postcss` 給字串是「目錄」不是「檔案」

手機 UI 靜靜地套用了**桌面版**的 Tailwind 產物，手機才用到的 class 全部沒生成
（sheet 沒有遮罩也沒有層級）。零錯誤訊息，從 DOM 與 computed style 也看不出原因。
→ 已改成內嵌 plugins，理由寫在 `vite.mobile.config.ts` 註解。

### 2. 驗行為 ≠ 驗外觀

上面那個之所以沒被自動驗證抓到，是因為那輪檢查的都是 DOM 與行為
（history 深度、body 鎖捲動、主題 CSS 變數）—— **那些剛好都不經過 Tailwind**。
是 owner 截圖才發現的。**UI 改動要真的看畫面，不能只讀數值。**

### 3. `crypto.randomUUID()` 只在安全內容下存在

`http://localhost` 算安全內容，`http://192.168.x.x` 不算。
桌機測一切正常、手機一連就壞。→ 改用 `crypto.getRandomValues`。

### 4. 錯誤分類錯了比錯誤本身貴

上面那個 TypeError 發生在 `HttpClient` 包住 fetch 的 `try` 裡，被收成
`unreachable` → UI 顯示「連不上電腦」→ 於是去查防火牆、監聽埠、CORS
preflight、token 有效性，**網路自始至終都是好的**。
→ `catch` 的範圍要剛好只包住真正會有網路問題的那一行。已加測試守住。

### 5. 「手機專屬的狀態」多半根本不是手機的

主題被我做成手機的本機狀態 → 改了不會存、也不跟桌面同步。
但它本來就是 `settings.ui.colorTheme`。
→ **加任何 UI 狀態前先問：這個東西在桌面端已經有真相了嗎？**
有的話就讀它、寫回它，不要在手機另存一份（那是 roadmap §4.1 的 drift）。

### 順帶修掉的桌面既有 bug

`ipcHandlers` 的一般聊天與群組接龍**從來沒推過 `thinking-done`**，手機的思考動畫
只能靠 90 秒逾時收掉。修法不是補上漏掉的幾行，而是把桌面動畫與手機推播綁進
同一支 `setThinking()`（17 個呼叫點全改），讓「少一邊」不再可能。

---

## 4.11 階段 2b（圖片附件）的落地筆記

### 三個「不記下來就會再犯一次」的地方

1. **`MessageSnapshot` 沒有 `images`，所以剛送出的那則要自己記著原圖。**
   `appStore.localImages`（訊息 id → data URI）就是為此存在。少了它，樂觀渲染那則
   會是幾個空框、等伺服器回音才浮現 —— 使用者的解讀是「圖沒送出去」。
   伺服器回音取代樂觀那則時**連 key 一起搬過去**，否則同一張圖會為了換個網址再下載一次。
2. **`findOptimisticMatch()` 是併訊息與搬 `localImages` 共用的判斷。**
   兩邊各寫一份的話，分歧的症狀是「圖片跑到別則訊息上」，從畫面完全推不回原因。
   測試釘住兩者一致（`tests/ui/messageMerge.test.ts`）。
3. **送失敗時文字不放回、圖片一定放回**（清單 B5）。
   不是不一致 —— 文字還在錯誤泡泡裡看得到可以複製，圖卻得重新從相簿一張張找回來，
   而且未必記得選了哪幾張。放回時只在使用者還沒選新的圖時才放，免得蓋掉他重選的內容。

### 燈箱是「一組圖」不是「一張圖」（owner 2026-08-05 實機回報）

初版一次只收一張，於是多圖訊息得**關掉再點下一張**。改成收
`{ images, index }`，並給三種換頁方式：左右滑（單手時唯一順手的）、
箭頭按鈕（不知道可以滑的人）、鍵盤方向鍵（掃 QR 用電腦瀏覽器開的路徑，roadmap §4.5）。

滑動要判斷**直向位移不得大於橫向**，否則上下甩動時會誤觸換頁。
`MessageImages` 傳進燈箱前**濾掉取不到位址的那幾張** —— 翻到 `null` 會是一片空白，
使用者只會覺得壞了。

### 「點一下關閉」拿掉了，換成縮放（owner 2026-08-05）

初版有點擊關閉，owner 指出**既多餘又擋路**：關閉本來就有 ✕ 與返回手勢兩條路，
而點擊這個動作留給雙擊放大遠比再開一條關閉路徑有用。
**一個手勢只能有一個意思** —— 點擊同時代表關閉與放大，兩邊都會誤觸。

縮放沿用 `mobile.html` 遙控截圖那份（2157–2232 行）的數學，不自己重推：
雙指 1×–6×、放大後單指平移、雙擊 1×↔2.5×、滾輪（網頁版）。
其中**「雙指放開剩一指時要重設平移基準」**那段一定要抄 —— 漏掉的話畫面會在
放開的瞬間跳一大段。換圖時縮放歸零（帶著上一張的倍率看下一張，位置必定是錯的）。

⚠️ **touch 與 wheel 監聽器必須自己 `addEventListener` 且 `passive: false`。**
React 對這兩者掛的是 passive 監聽器，裡面呼叫 `preventDefault()`
**沒有作用而且不會報錯** —— 症狀是手勢有時候會把整頁一起捲走。
這是本階段第二個「沒有錯誤訊息」的坑（第一個是 §4.10 的 postcss）。

> 驗證時另有一個**測量陷阱**：在同一個 JS tick 裡 dispatch 完手勢就讀 DOM，
> 讀到的是 React 還沒重繪的舊值 —— 看起來像「換頁沒反應」，其實是量錯了。
> 要隔一個 `setTimeout` 再讀。

### 燈箱吃返回鍵，所以 `useBackButton` 的深度也要算它

`handleBack()` 的順序是**由上而下關**：燈箱 > 對話框 > 畫面堆疊。
`useBackButton` 的 `depth` 必須涵蓋**每一個吃返回鍵的東西** ——
少算任何一項，返回一次就會連關兩層。

### 驗證方式：一支 40 行的假 mobileServer

沒開 DeST 也要能看畫面，所以寫了個只回 `/api/state`、`/api/send`、
`/api/message-image` 的 stub（一次性，放 scratchpad 未進 repo）。
對著它實測過：**4000×3000 的圖 → 1024×768 JPEG，237 KB → 5.4 KB**（B2 的重點）、
張數上限夾擠與 toast 文案、送失敗後圖片回到附件列、燈箱開關與返回鍵。

⚠️ 驗證時撞到一個容易誤判的現象：`loading="lazy"` 的圖在**沒有實際顯示的分頁**裡
永遠不會開始載入（`complete` 一直是 false、`currentSrc` 是空字串）。
看起來像「圖片抓不到」，其實只是還沒進視窗。查圖片問題前先確認頁面真的在畫。

---

## 4.12 階段 2c（隨機工具）的落地筆記

### 新增了一個 store：`composerStore`

輸入框的草稿從 `Composer` 的 `useState` 搬進 store，因為**寫入者不只一個**：
隨機工具插 token（C3）、之後新聞報的「💬 聊這個」（F10）。
兩者都不是輸入框的子元件，靠 props 傳下去會讓中間每一層都認識輸入框。

⚠️ **圖片附件蓄意留在 `Composer` 裡**：它的生命週期跟送出／失敗回填（B5）綁在一起，
搬進 store 只會讓那段邏輯散成兩個地方。

### 游標位置要接三個事件，不是只有 `onSelect`

`select` 事件涵蓋不到「用點的移動游標」與方向鍵，而手機上
**點一下句子中間再插一顆骰子**正是最常見的用法。
`onSelect` ＋ `onClick` ＋ `onKeyUp` 三個都接，重複觸發沒有代價（設同一個值）。
—— 這是實測時發現的：只接 `onSelect` 時 token 一律插在字尾。

### 擲出的時機：送出的那一刻，不是按按鈕的時候

面板**完全不呼叫 `computeRandomResult`**，只產生 token；展開發生在 `submit()` 裡，
走 `@core/prompt/randomTokens`。這是與桌面一致的設計，
為的是讓「先擲看看、不滿意就不送」變得不可能。

### 一處刻意的小重複：`randomLabels.ts`

`getToolEmoji` / `formatResultBadgeText` 在桌面 renderer 也有一份。
兩份都是 **UI 文案**，依 roadmap §3.3 都不能進 core，
而目前沒有「兩個 UI 共用」的層可以放。
**重複的只有措辭（`骰：`／`取：`與四顆 emoji），算式全部來自 core** ——
這是把重複面積縮到最小的結果。要根治得開一個共用 UI 文案層，
而不是把中文搬進 core（那會直接違反 §3.3）。

### 驗證

沿用 2b 的假 mobileServer。實測過：token 插在游標處（`我要擲一[🎲1d20]下看看`）、
面板插完自動關閉、送出時展開成 `｛🎲骰子1d20結果：16｝` 並帶 `randomResults`、
徽章顯示 `🎲 16`、取消勾選後 payload 的 `skipLlm` 為 `true`、
`randomToolsEnabled: false` 時 🎲 入口整個消失（圖片按鈕不受影響）。
`composerStore` 另有 8 項單元測試（反向驗證：把插入點改成字尾 → 精準抓到 2 項）。

---

## 4.13 階段 2d 的兩則實機回饋（owner 2026-08-05）

### ⋯ 要對齊泡泡中央，不能掛在最外層的 flex 上

最外層那一列是 `items-start`（頭像對齊第一行，聊天 UI 的慣例），
⋯ 掛在那裡就會被拉到右上角，**訊息越長看起來越歪**。
正解是把泡泡與 ⋯ 包成同一列並 `items-center`，
名字那行留在外面 —— 不然 ⋯ 會被它一起算進去而偏低。

### 「必定失敗的按鈕」第二次出現

「重新發送」原本對所有訊息都顯示，但電腦端擋著
`if (msg.role !== 'user') return { error: '只能重新發送使用者訊息' }`
（`ipcHandlers.ts:639`）—— 對角色訊息按下去只會拿到一句「重新發送失敗」。

這與 D5 那顆移出鈕是**同一類錯**：UI 給了一個伺服器一定會拒絕的入口。
兩次都是同樣的教訓 —— **接一支端點時要連它的拒絕條件一起讀完**，
只看成功路徑就會把限制留給使用者去撞。

> 這一則是靠假伺服器**沒有**照抄限制才浮出來的：
> 我的 stub 照樣讓角色訊息重送成功，owner 卻回報「按了只有刪掉後面」。
> 追下去才發現真伺服器根本不會做這件事。
> **假伺服器要連拒絕條件一起模擬**，否則它會掩蓋掉真實行為。

---

## 4.14 階段 3（角色庫 ＋ 角色卡編輯）的落地筆記

### 端點是新的，邏輯**一行都沒有新寫**

`mobileServer` 補了 10 支寫入端點，但實作全部指向 `ipcHandlers.ts` 那批
`*Direct` —— 桌面 IPC handler 同時改成薄轉呼叫。**兩邊共用同一份**，
因為「桌面存得起來、手機存出一張壞卡」這種 drift 不會有任何錯誤訊息
（roadmap §4.1）。DST Pack 匯入是唯一需要改形狀的：桌面靠對話框逐一問衝突，
抽成 `DstPackImportResolvers` 之後手機端改成**送出前就選好策略** ——
電腦前面沒有人，彈一個框等於讓手機那頭卡住直到有人回家。

### ⚠️ 信任邊界：角色卡不能整包直接存

`avatar` / `emotions` / `spriteIds` 是**電腦上的檔案路徑**，
而 `GET /api/avatar/:id` 會照著它讀檔並把內容回傳。讓遠端指定路徑
＝ 開一個「讀取電腦上任意檔案」的洞。所以 `mergeCharacterFromRemote()`
只收文字欄位，圖片一律只能經 `/api/characters/avatar` 落地
（檔名與位置由電腦端自己決定）。`id` / `createdAt` 同理以本機為準。

### 主圖不可以走聊天附件那支壓縮

`chat/imageCompress.ts` 會**鋪白底並輸出 JPEG** —— 對聊天照片是對的，
對主圖是災難：角色是站在桌布上的，去背是必要條件，不是畫質問題，
而 JPEG 連透明通道都沒有。另立 `characters/avatarFile.ts`：
能不動就不動（多數去背 PNG 直接原檔送），真的太大才縮，縮完仍保留透明；
GIF 一律原檔（重繪只會留下第一格）。

### 換了主圖畫面卻沒變 —— 位址沒變，是快取

`avatarUrl()` 回的是 `/api/avatar/:id`，換圖前後**同一個網址**，
瀏覽器直接給快取裡那張舊的。症狀是「存檔成功但還是舊圖」，
而且要重開 app 才會好 —— 使用者只會覺得沒存到，於是再選一次、再存一次。
→ `useAvatarUrl.invalidateAvatar(id)`：清掉快取 ＋ 在網址後面加一個遞增的 `v=`。

### 🐾 fallback 的**第二種**失敗（實測撞到）

清單 D6 記過「`avatarUrl()` 回 null 與圖片載入失敗都要落到 🐾」，
階段 3 又踩了一次同一顆釘子的另一面：**遙控模式的 `avatarUrl()` 永遠回得出網址**，
沒設主圖時是那個網址回 404。編輯器的主圖預覽初版只判斷 `url == null`，
結果新建的角色看到的是破圖圖示。

### 未儲存的改動要擋，而且**返回手勢與 ✕ 必須遇到同一道關卡**

手機上多數人是往回滑而不是找 ✕，只擋 ✕ 等於沒擋。
落地方式是 `uiStore.requestPop()` ＋ `closeGuard`，兩條路徑共用。
⚠️ **guard 刻意是同步的**：`handleBack()` 必須同步回答「我消化掉了嗎」，
改成 async 會讓 history 深度與畫面堆疊錯位（階段 1 就是靠這個對齊的）。
guard 回 `false` 時自己去開確認對話框，使用者按「捨棄」再呼叫 `pop()`。

### 這次的假伺服器又掩蓋了一件事

`/api/avatar/:id` 對**沒設主圖**的角色照樣回一張色塊圖，
真伺服器是回 404（`if (!char?.avatar)`）。於是 🐾 那條路徑在 stub 上
永遠驗不到 —— 上面那個破圖 bug 就是這樣多活了一輪。已補進 stub。
**這是 §4.13 那條規矩的第三個實例**：假伺服器要連拒絕與空值路徑一起模擬。

### 驗證方式與這次的限制

用假 mobileServer 走過：建立 → 命名 → 編輯 → 儲存（角色列名字跟著變）→
展開進階（用語解說清單、新聞關鍵字）→ 刪除（確認框 → 回角色庫 → 清單少一隻）、
未儲存時按 ✕ 會攔、按取消留在原地、存完之後返回鍵不再攔、
沒設主圖的角色顯示 🐾。端點的拒絕條件另以 curl 逐項確認
（404 找不到、400 名稱空白／檔案損毀／沒選角色）。

⚠️ **這一輪沒有截圖**：開發環境的瀏覽器面板沒有顯示，頁面不會合成畫面，
截圖與 CSS 動畫都停在第一幀（量到的 `getBoundingClientRect` 會少掉
sheet 的入場位移，差 690px —— 差點被當成 sticky 壞掉）。
版面改以幾何數值確認（無橫向捲動、欄位字級 16px、儲存鍵貼在捲動容器底部），
**但 §4.10 第 2 點說得很清楚：驗行為不等於驗外觀。外觀仍待 owner 過目。**

---

## 4.15 階段 4（設定）的落地筆記

### 範圍比 §4.8 描述的窄，是刻意的

`ipcHandlers.ts` 的 LLM 設定其實還有 `temperature`／`maxResponseTokens`／`maxGroupRounds`／
輔助模型等桌面獨有的細部調校欄位。**這次刻意不搬**——owner 交付這階段時明確列的是
「API Key ＋ 供應商／模型」＋「進階：endpoint、記憶參數、模組開關」＋「提醒 CRUD」，
這份清單本身就是範圍，不是「先做這些、其餘之後補」的暫定清單。

### `Capabilities.apiKeyAccess` 需要一次額外的往返，這是刻意的取捨

`capabilities` 是 `DataSource` 的唯讀同步欄位（階段 0-③ 定的規則），但「是不是區網直連」
只有問了電腦才知道。解法是 `App.tsx` 在建構 `RemoteDataSource` 前先打一次
`GET /api/connection-info`（不需要 `bridge` ready，純傳輸層判斷），問到答案才建構
`RemoteDataSource` 並 `attach()`。代價是遙控模式開啟 app 多一次序列往返，
換來的是 `Capabilities` 全程維持「唯讀、同步」——UI 不必為了這一個欄位另外訂閱變化。

### LAN 判定是「私有位址且非 loopback」，不是「同網段」

roadmap §4.7 原文寫「私有位址且與自身同網段」，但 relay／cloudflared tunnel 轉發進來的
請求，從 `req.socket.remoteAddress` 看也是 `127.0.0.1`（tunnel client 在本機把流量轉給
mobileServer）——跟「桌機自己開瀏覽器測」是同一種表面特徵。真正分得出「手機經區網直連」
的訊號只有「是不是 loopback」：手機在區網一定會顯示成自己的私有位址（192.168.x 等）。
`isLanDirectRequest()`（`mobileServer.ts`）因此簡化成「私有位址 AND NOT loopback」，
不比對子網路遮罩——差異只在「同路由器下的不同網段」這種邊緣案例，不影響
「區網直連 vs 經 relay」這條真正要守的界線。

### API Key 只能寫、不能讀回明文

`LlmSettingsSnapshot.hasApiKey` 只回布林。就算 `apiKeyAccess` 為 true（區網直連），
也不把金鑰明文送到手機顯示——換一把新的不需要先看到舊的，這是不必要的曝光面。
UI 顯示「已設定」／「尚未設定」，輸入框永遠是空的，使用者要嘛不填、要嘛整把換掉。

### API Key 寫入被拒絕用 409，不是 401/403

`statusToCode()`（`httpClient.ts`）把 401/403 都翻成「連線權杖失效」。如果拿它們表示
「這支端點只能區網直連呼叫」，使用者會被導去重新掃 QR code，但問題其實是連線方式——
兩件事文案上完全不搭。改用 409（`conflict`），UI 端 `describeSettingsError()` 對這個代碼
講的是「API Key 只能在與電腦同一個區網時修改」。正常情況下這條路徑走不到——
`Capabilities.apiKeyAccess` 應該已經把欄位藏起來了，409 只是「畫面顯示之後連線方式才變」
那種邊緣情況的防線。

### 提醒沿用 `characters.create()` 的 id 產生方式

`RemindersApi` 沒有讓 UI 自己生 id，而是 `create()` 在電腦端建好空白提醒、生好 id、
立刻存檔，回傳完整物件。理由與角色卡一致（`core/data/types.ts` 的註解）：手機上
`crypto.randomUUID()` 在非安全內容（`http://192.168.x.x`）不存在，讓 UI 自己生 id
會重踩計畫書 §4.10 第 3 點那個坑。

### 端點邏輯一行都沒新寫，reminder 那四支 IPC handler 順手瘦身

比照階段 3：`mobileServer.ts` 的新端點全部呼叫 `ipcHandlers.ts` 的 `*Direct` 函式，
桌面 IPC handler 同時改成薄轉呼叫（`reminder:list/save/delete/toggle` 從各自的內聯邏輯
改成一行呼叫對應的 `*Direct`）。桌面與手機因此不可能各存出一份不一致的提醒清單。

### 驗證方式

假伺服器（`mobile-stub-server.mjs`）新增了對應端點，**含拒絕與空值路徑**
（`llm-apikey` 在 `LANDIRECT=0` 時回 409、`memory` 數值超出範圍回 400、
`modules/toggle` 未知 id 回 400、`reminders/save` 缺 id 回 400）。用瀏覽器對著
`npm run dev:mobile` 走過：供應商切換／模型與端點儲存／API Key 欄位在 `LANDIRECT=0`
時正確隱藏並顯示中繼連線提示／記憶數值儲存／模組開關即時切換並持久化／
新增·編輯·刪除提醒的完整流程，過程中 console 無錯誤。

⚠️ **這一輪同樣沒有截圖**（環境限制，理由同 §4.14）：改用 `getComputedText` 與直接呼叫
React 事件 handler（而非模擬原生 DOM 事件）驗證每個互動的落地結果。**外觀仍待 owner 過目。**

---

## 4.16 實機回報修正：選檔的 `accept`、以及「移出對話」找不到

owner 2026-08-05 在真機上連續三輪回報「角色卡換主圖沒反應」。**修了三次才修對**，
過程本身比結果值得記——它示範了「桌機測得過的東西，手機上可以壞在完全沒想到的地方」。

### 真正的原因：`accept` 給了「一串具體格式」

| 路徑 | `accept` | 手機 |
|---|---|---|
| `chat/Composer.tsx` 聊天傳圖（**從來沒壞過**） | `image/*` | ✅ |
| 換主圖 | `image/png,image/jpeg,image/gif,image/webp` | ❌ 相簿一張圖都不顯示 |
| 匯入角色卡 | `.png,.json,.dstpack` | ❌（同一個坑，當時還沒測到） |

Android 的 Chrome 會把 `accept` 轉成丟給相簿 App 的篩選條件。給 `image/*` 一切正常，
給具體 MIME 清單時 Google 相簿等 App 常常篩不出任何東西。副檔名形式更糟——
Android 沒有副檔名的概念，`.dstpack` 這種自訂副檔名對映不到任何 MIME，檔案會整片灰掉。

**規則：`accept` 只給大類（`image/*`），格式把關留給選完之後的 `prepareAvatar`。**
選圖器上把關擋掉的不是壞檔案，是使用者的整個相簿。

### 前兩次改錯的東西（都不是原因，但第二次還製造了新 bug）

1. **改用 MIME 判斷副檔名**（`resolveExt`）——這件事本身是對的（相簿常給無副檔名的檔名），
   **但不是當時的原因**，因為根本還沒走到那一步
2. **把 `<input>` 掛進 DOM 再 `.click()`**——同樣是對的、也該留著，但同樣不是原因
3. ⚠️ **順手加的「切回瀏覽器就當作取消」猜測邏輯，製造了新的 bug**：
   剛拍的照片檔案較大、系統選圖器交還得慢，那個猜測會搶在檔案送達前判定成取消、
   把 input 拔掉。症狀變成「相簿裡的舊圖可以、剛拍的不行」，看起來像格式問題。
   **已移除。取消時就讓那個隱形 input 留著，不要用計時去猜使用者的意圖。**

### 順帶預防：HEIC

Pixel 等 Android 機在「省空間」模式下拍照存的是 HEIC／HEIF。`accept` 放寬之後相簿會
出現照片，但電腦端不收這個副檔名——所以 `prepareAvatar` 改成**認不得的格式先問瀏覽器
讀不讀得出來**，讀得出來就用 canvas 轉成 PNG 再送。讀不出來時拋 `bad-format`
（「格式不支援」）而不是 `decode`（「檔案損毀」）——後者會讓使用者跑去檢查一張好好的照片。

### 「移出對話」：功能有做，但放在使用者不會找的地方

移出原本只存在於 `PresenceSheet`（點 ＋ →「這次對話有誰在場」→ 再點一次「在場 ✓」）。
owner 從角色庫加了角色進來後找不到怎麼收回去——**點角色頭像**才是對著「這個角色」
動作時最直覺的入口，那裡沒有等於這條路走不通。已在 `CharacterMenu` 補「🚪 移出對話」，
D5「至少留一位」的判斷兩處一致（只剩一位時不顯示這一項）。

### 還有第二個 bug：檔案存了，但角色卡沒指到它（Codex 發現）

`accept` 修好、相簿能選圖之後仍然沒換成功。原因是**信任邊界把新路徑也一起擋掉了**：

1. `/api/characters/avatar` 寫檔成功、回傳路徑 ✅
2. 手機把路徑放進 draft，按儲存 → `/api/characters/save`
3. `mergeCharacterFromRemote()` 從 `...existing` 開始、**只覆蓋文字欄位**——
   `avatar` 不在清單裡（這是刻意的，遠端不可以指定本機檔案路徑），
   於是手機送來的新路徑被丟掉，角色卡永遠指著舊圖 ❌

修法（`saveCharacterAvatarDirect`）：既然 `/api/characters/avatar` 是唯一被信任的換圖入口，
**就由它自己把角色卡改好、存檔、廣播 `characters:updated`**，不要指望之後那次 save 帶過去。
`mergeCharacterFromRemote` 繼續擋掉遠端的 `avatar` 不變。模式與旁邊的
`deleteCharacterDirect` 一致（改記憶體 → `fileStore` → 廣播）。

⚠️ 附帶的行為改變：桌面版在編輯器裡換了圖又按取消，圖仍然會換掉。
這是對的——換圖是獨立動作，不是草稿的一部分（它本來就已經把檔案寫進磁碟了）。

### 驗證方式（以及**我漏掉的那一段**）

`prepareAvatar` 五種輸入逐一驗過：4000×3000 大 JPEG ✅、無副檔名 ✅、去背 PNG 保留透明 ✅、
解不開的 HEIC → `bad-format` ✅、純文字檔 → `bad-format` ✅。
再對真的 `mobileServer` 打完整上傳鏈路（4000×3000 → 43 KB `.jpg` → HTTP 200 → 檔案落地）。

⚠️ **但那條「端到端」測試其實斷在終點前一步**：它驗到「檔案落地」就收工，
沒有回頭檢查**角色卡的 `avatar` 欄位是不是真的變了**——而上面那個 bug 正好就藏在那裡。
測試綠燈、功能照壞。
**寫入類的驗證，終點是「資料的最終狀態」，不是「請求成功了」。**
下次驗這類流程，最後一步一律去讀 `card.json`／`settings.json` 本人。

⚠️ **`accept` 本身仍只能由 owner 在真機上驗**——那是 Android 相簿 App 的行為，桌機重現不了。
另外 owner 回報**改完要重開 `npm run dev:mobile`**，光重新整理頁面不一定吃得到
（Vite HMR 對這幾支模組沒有完整重新求值）。驗不出來時先重開 dev server 再說。

---

## 4.18 階段 9（用語解說內容編輯）落地筆記

### 端點邏輯一行都沒新寫，跟階段 4／5 同一個模式

`ipcHandlers.ts` 早就有 `lorebook:get` / `create` / `save` / `delete` 的 `ipcMain.handle`，
只是邏輯直接寫在 handler 裡、沒有拆成可重用的函式。這次拆出
`getLorebookDirect` / `createLorebookDirect` / `saveLorebookDirect` / `removeLorebookDirect`，
桌面 IPC 改呼叫這四支，`mobileServer.ts` 的新端點也呼叫同一批——
與階段 3／4／5 的既有慣例一致：手機端不得複製業務邏輯，只能薄轉呼叫。

### `mobileServer.ts` 的路由順序有一個坑：舊的 `GET /api/lorebooks` 是前綴比對

新增 `/api/lorebooks/:id`、`/api/lorebooks/create`、`/api/lorebooks/save`、
`/api/lorebooks/delete` 之前，`scripts/mobile-stub-server.mjs` 原本用
`url.startsWith('/api/lorebooks')` 判斷清單端點——這個寫法會把新加的四支路由全部
吃掉（都是同一個字首）。改成 `url === '/api/lorebooks'` 精確比對後才安全新增其餘路由。
真的 `mobileServer.ts` 本來就是逐支 `method === 'GET' && url === '...'` 或 regex 比對，
沒有這個問題，但這次順手在 stub 也修掉，避免下次照抄舊寫法又踩一次。

### 拒絕條件沒少：save 缺 `book.id`、缺 `book`、id 不存在都要回錯誤

比照 `scripts/README-mobile-stub.md` 的規矩，`/api/lorebooks/save` 在 stub 端補了
`book required`（400）與 `Lorebook not found`（404）兩條路徑，不是只模擬成功；
`/api/lorebooks/delete` 缺 `id` 一樣回 400。

### `LorebooksApi` 的型別來自 `core/lore`，不是 `core/types`

`Lorebook` / `LoreEntry` 定義在 `src/core/lore/types.ts`，`core/data/types.ts`
原本只 import `../types`，這次另外加一行 `import type { Lorebook } from '../lore'`。
容易漏看的地方：`@core/lore` 這個路徑別名在 `tsconfig.json` 與 `tsconfig.node.json`
都已經有（`@core/*` 泛用別名涵蓋），不用額外配置。

### 條目編輯照抄桌面版 `LorebookSection.tsx` 的四欄位限制與 UX 細節

`priority` / `insertion_order` / `secondary_keys` 依規格 §7.1 不進 UI，存檔時整個
`LoreEntry` 物件原樣 spread 回去，這幾個欄位不會被手機端弄丟。條目 id 沿用桌面版
`Date.now()-隨機字串` 的產生方式，不用 `crypto.randomUUID()`——階段 3（角色卡建立）
已經踩過一次「非安全內容（`http://192.168.x.x`）沒有這個 API」的坑（計畫書 §4.10 第 3 點），
新增用語條目是純前端狀態操作、不經 `create()` 端點，所以沒辦法比照角色/提醒讓伺服器發 id。

### ~~入口放在「設定 → 進階」~~ → 已併進 `PresetsView`（§4.19）

階段 9 當下入口在「設定 → 進階」＋獨立 `LorebookLibrary.tsx`。
**2026-08-06 資訊架構重整後**：用語解說併進情境／Persona／World 同一頁的 accordion，
`LorebookLibrary.tsx` 刪除；清單仍沒有「套用／切換」——是否生效由角色卡或情境勾選決定，
所以點列項就是進編輯（不再放多餘的 `StatusChip`）。詳見 §4.19。

### 驗證方式與這次的限制

`npm run typecheck`、`npm test`（300 條，含既有 `tests/lore/*`）全綠。
`node scripts/mobile-stub-server.mjs` 起假伺服器後用 `curl` 逐支打過
list／get／create／save（含缺 id 的 400）／delete，回應與檔案內狀態符合預期。
**沒有** 用瀏覽器實際操作過 UI（`npm run dev:mobile` 未啟動驗證），也沒有驗證
「存檔後角色下一則回覆看得出生效」這條端到端路徑——那需要真的 LLM 呼叫，
比照階段 5／8 的慣例交給 owner 用 `MobileST-real-test.bat` 驗。

---

## 4.19 資訊架構重整 ＋ 全面單色圖示（owner 2026-08-06 回報）

階段 9 收工後 owner 一次回報六件事，全部是「東西都在，但找不到／看不懂／很醜」，
所以這一輪動的是**資訊架構與視覺**，不是功能。

### Header 改成「狀態即入口」（owner 自己提的設計，比原提案好）

原本：`DeST` 字樣 ＋ 六顆 emoji 按鈕（💬📰👥🗂️🎨⚙️），底下再掛一整條
`CurrentContext` 顯示情境／世界觀。問題是按鈕越加越多、圖案全靠猜，而且狀態列
只能看不能點。

現在：**一列做完三件事** —— 對話標題／情境／世界觀三個標籤本身就是入口
（點下去分別進對話清單與預設組），右邊一顆 ☰ 收所有功能。
省掉一整條狀態列的高度，`DeST` 字樣也拿掉（手機螢幕窄，app 名稱在這裡沒有資訊量）。

- `context/CurrentContext.tsx` → `context/HeaderChips.tsx`（角色變了，順便改名）
- 點情境標籤會帶 `openParam='scene'` 進 `PresetsView`，直接展開那一組

### ☰ 主選單：`replace` 不是 `push`

`shell/MainMenu.tsx` 七項，每項都是**圖示＋名稱＋一句說明**。
⚠️ **點項目一律用新加的 `uiStore.replace()`** —— 用 `push` 的話選單會留在返回堆疊裡，
從「設定」按返回會先回到選單、要再按一次才回聊天。

「提醒」從設定的「進階」搬到這裡（owner 決定：它是會固定使用的功能，不是設定項）。

### 設定頁：一個「進階」大雜燴拆成三個平行區塊

owner 原話「分類太亂，容易讓新手困惑」。原本 endpoint／記憶／模組開關／提醒
全塞在同一個叫「進階」的摺疊區裡。現在：

| 區塊 | 內容 |
|---|---|
| 連線（不可收合） | 供應商／模型／API Key —— 唯一必填的東西 |
| 記憶 | 保留則數、摘要門檻、自動摘要 |
| 模組開關 | 四個模組，**每個都有一句說明**（`settings/moduleInfo.ts`）|
| 進階 | 只剩自訂端點 |

**自訂端點留著但收到最底**（owner 決定）：它是接 OpenRouter／自架代理／本機模型的
唯一入口，拿掉會讓已設定的人壞掉。文案改成「用官方 API 的話請留空」。

⚠️ 模組說明**不寫「去電腦上設定」**（手機版要能獨立運作的既有慣例），
只講「需要先完成設定才會生效」，不指定哪台裝置。

### 用語解說併進 `PresetsView`，四區塊改成 accordion

owner：「用語解說應該跟情境／使用者／世界觀放在同一頁」——它們確實是同一類東西
（都是「這次對話用哪一組設定」），拆開放使用者找不到。四組清單全攤開太長，改成
點標題才展開。`lorebooks/LorebookLibrary.tsx` 因此刪除，功能併入 `PresetsView`。

⚠️ **只有一種動作可做時不要放 `StatusChip`。** owner：「用語解說如果只有『編輯』選項，
那『點此編輯內容』的標籤就顯得很多餘」——說得對，那是一句廢話。
`StatusChip` 的檔頭已補上這條規則。

### 全面單色圖示：`src/shared/MonoIcon.tsx`

owner：「Icon 花花綠綠我覺得很醜，能統一成單色的，對齊桌面版樣式嗎」。

桌面版本來就有一份 26 個圖示的 `MonoIcon`。**與其在手機再抄一份（那就是 §4.1 的
drift），直接把實作搬到 `src/shared/`，兩邊 import 同一個檔案。**
`src/renderer/src/components/MonoIcon.tsx` 改成一層 re-export，
桌面既有的 15 個呼叫端**一行都沒改**。手機需要的 16 個新圖示（menu／chat／news／
users／palette／dice／paw／plus／chevron×3／book／volume／mute／exit／plug）加在同一份，
桌面日後也用得到。

新增 `src/shared/` 這個目錄的理由：`core/` 是純資料與邏輯層、`main/`（Node）也會
import 它，因此不得依賴 React。`src/shared/` 專收「兩個 UI 都要用、但不屬於 core」
的純呈現元件。

#### 這一輪踩到的三個坑

1. **改了 vite alias 一定要重開 dev server。**
   新增 `@shared` 之後 HMR 吃不到，畫面會整片壞掉但錯誤訊息指向 import ——
   §4.16 已經記過「改完要重開 `npm run dev:mobile`」，這次是同一件事的更硬版本
   （設定檔改動 100% 需要重啟，不是「不一定吃得到」）。
2. **`tailwind.mobile.config.ts` 的 `content` 要加 `./src/shared/**`。**
   不加的話 `MonoIcon` 預設的 `w-4 h-4` 不會被生成，圖示全部變成 0×0 ——
   跟 §4.10 第 1 點那個 postcss 坑同一個家族：**沒有錯誤訊息，只是安靜地消失**。
   桌面的 `tailwind.config.ts` 也一併加了。
3. **`<MonoIcon className="" />` 會讓 SVG 失去尺寸。**
   TS 的預設參數只在傳 `undefined` 時生效，傳空字串就是空字串，
   svg 沒有任何尺寸 class 就塌掉。`Avatar` 要跟著頭像大小縮放，
   正確寫法是傳比例 class（`h-1/2 w-1/2`），不是傳空字串再靠 style 撐。

### 模型清單與價格搬進 `core/llm/modelCatalog.ts`

owner：「模型清單應該跟桌面版同步，並且把價錢都標上去」。
`providerInfo.ts` 原本自己列了四五個常用型號，桌面加新型號時手機不會跟上。

現在型號清單、每百萬 tokens 參考價、高單價判定（`isHighPriceModel` /
`splitModelsByPrice`）全在 core，兩個 UI 共用。手機的模型欄位從自由輸入的
`<datalist>` 改成 `<select>`＋`optgroup`（一般／⚠ 高單價），每個選項都標價。

⚠️ **`core/llm/index.ts` 不得 re-export 這個檔案** —— `index.ts` 會 import
Anthropic／OpenAI／Google 的 SDK，透過它取用會把整包 SDK 拖進手機的 bundle。
呼叫端一律直接 `import ... from '@core/llm/modelCatalog'`。

中文文案（「⚠ 高單價」「一般」、帶價格的顯示字串）仍留在各自的 UI 層，符合 §3.3。

### 驗證方式與這次的限制

`npm run typecheck`、`npm test`（300 條）全綠。
`npm run dev:mobile` ＋ 假伺服器，用 DOM 查詢逐項確認：header 三個標籤與 ☰ 都在、
主選單七項各有圖示與說明、20 個 SVG 全部有非零尺寸（證明 Tailwind glob 生效）、
`PresetsView` 四區塊 accordion 且用語解說顯示 2 本、「點此編輯內容」已消失、
模型下拉 25 個選項分成「一般 / ⚠ 高單價」兩組且都帶價格、模組開關四項都有說明。

⚠️ **沒有看到實際畫面** —— 本次環境的瀏覽器窗格無法顯示，截圖取不到。
版面是否好看、標籤在窄螢幕會不會擠、圖示線條粗細在真機上的觀感，
**這些只能由 owner 實機確認**。

---

## 4.20 手機遠端入口與 relay 硬約束（歷史：曾雙入口並存）

> **2026-08-07 起為單一入口 `/`（B3 React）。** 下方「為什麼並存」「路由表」是過渡期
> 紀錄；**①②③ 三條硬約束仍完全有效**——改 QR／relay／建置／連線時只看那三段。

### 為什麼曾並存（已結束）

階段 7 原本寫「`mobileServer` 改提供 `out/mobile/`，`mobile.html` 保留一個版本週期再刪」。
盤點後發現這個講法低估了：**遙控面板（H1–H11）排在 B6**，比整個 B3 還晚，
而那是 `mobile.html` 獨有的功能。所以過渡期曾**兩個 QR 同時出**
（`/?ui=app` 新版日常聊天、`/` 舊版遙控）。B6 真機驗證通過後已依 §4.23 移除舊版。

### 路由（現行）

| 路徑 | 內容 |
|---|---|
| `/` | `out/mobile/index.html`（B3 React，含遙控） |
| `/assets/*` | 建置產物，**不需 token**（開發／未 inline 時；打包後多半已內嵌） |

#### ⚠️⚠️ relay 的真實行為（2026-08-06 對實機實測，不要再靠推測）

新版連續兩次「掃了全白」，兩次都是因為**猜 relay 的行為而沒去量**。
以下全部是拿 owner 的真實 relay URL 打過確認的：

| 事實 | 證據 |
|---|---|
| relay 是**反向代理**，不是轉址 | 瀏覽器網址一直停在 `relay.nori.tw/<deviceId>` |
| **每個請求**都要 `/<deviceId>` 路徑 | 少了 → relay 自己回 **503**（它的 HTML 錯誤頁） |
| **每個請求**都要 token（query 或 `X-DesktopST-Token` header） | 少了 → relay 自己回 **401** |
| 兩者都給就會轉給 DeST | `/<deviceId>/assets/x.js?token=` → **200, 271KB** |
| relay 會**注入**四個變數 ＋ 一個 fetch patch | 見下 |

注入的相容層（Cloudflare Worker 寫進 HTML 的）：

```js
window.__relayDeviceId, __relayPageUrl, __tunnelWsUrl, __mobileToken
// 並且 patch fetch：
if (typeof input==='string' && input.startsWith('/') && !input.startsWith('/'+deviceId))
  input = '/'+deviceId+input          // 補前綴
h.set('X-DesktopST-Token', __mobileToken)  // 補 token
```

#### 由此推出的三條硬約束

**① 產物必須是單一自足的 HTML（沒有任何子資源）**

Worker **只 patch 了 `fetch`**。`<script src>` / `<link href>` 是瀏覽器原生的
子資源載入，**完全繞過 fetch**，既不會補 deviceId 也不會帶 token
→ relay 回 503／401 → **整頁全白**。
`mobile.html` 從來沒事，正是因為它是單一檔案、零子資源。

→ `vite.mobile.config.ts` 關掉 code split／CSS split、資產全轉 data URI，
再由 `scripts/inline-mobile-build.mjs` 把 JS 與 CSS 內嵌進 index.html。
該腳本**最後會驗收**：只要還留著任何非 `data:`／`http` 的外部引用就直接
`exit 1`，因為那在 relay 上必然是白畫面。

**② `baseUrl` 必須是「相對路徑」，不能是 `location.origin`**

舊寫法組出 `https://relay.nori.tw/api/state` 這種**完整網址**，
不符合 Worker patch 的 `startsWith('/')` 條件 → 不補 deviceId → 503。

→ 改成：relay 時 `baseUrl = '/<deviceId>'`、區網時 `''`、`?server=` 時維持完整網址。
帶前綴的路徑會被 Worker 的 `!startsWith('/'+deviceId)` 判斷跳過，不會變成兩層。

**③ `<img src>` 與 WebSocket 得自己處理**

Worker 幫不上忙：圖片不經 fetch、WebSocket 也不是 fetch。

- 圖片：靠 ② 的 `baseUrl` 自帶 `/<deviceId>` 前綴，再由 `HttpClient.url()` 補 `?token=`
- WebSocket：**一定要用注入的 `__tunnelWsUrl`**（relay 只代理 HTTP，
  WS 得直連 cloudflared tunnel）。自己從 `location` 推會得到
  `wss://relay.nori.tw/...`，連不上。`mobile.html` 1220 行本來就是這樣做的。

> **教訓（兩次都栽在同一件事）**：跨越外部服務時，**先去量它的實際行為**，
> 不要從自家程式碼推測。第一次推測「relay 是轉址服務」，錯；
> 第二次推測「query 一定沒問題」，方向對但漏了子資源與 img/WS 三個面向。
> 真正解決是在拿真實 URL 打了六七個 curl、把回應碼與錯誤頁內容看清楚之後。

#### ⚠️ 靜態 bundle 刻意不要求 token

`mobile.html` 是單一自足檔案（CSS/JS 全內嵌），進入網址帶 `?token=` 就結束了。
React 版不同：index.html 會再去要 `./assets/*.js`，那些請求是**瀏覽器自己發的、
不會帶 query string**，照 token 擋就是 401、白畫面。

**cookie 方案評估後放棄**：進入頁面時種下、資源請求自動帶上，本地可行，
但經 relay 的路徑語意不確定，要繞過就得放寬成 `Path=/`，
等於讓 cookie 也能驗 `/api/*`，防線反而更鬆。

**最後只放行 `/assets/*`**：帶雜湊檔名的開源建置產物，不含使用者資料與金鑰
（API Key 從來不下發到手機，見 `LlmSettingsSnapshot` 的說明）。
入口頁本身與所有 `/api/*` 一律仍需 token。

`serveMobileAppFile()` 有**路徑穿越防護**：解析成絕對路徑後確認仍在 `out/mobile` 之內。
這台伺服器對區網（甚至經 relay 對外）開著，`/assets/../../settings.json` 這種請求
若照單全收等於把整台電腦的檔案交出去。

### 打包

`out/**` 早就在 `electron-builder.yml` 的 `files` 裡，打包後在 asar 內而 `fs` 讀得到 asar，
所以 `path.join(app.getAppPath(), 'out', 'mobile')` 在 dev 與打包都成立 ——
**不必像 `mobile.html` 那樣分兩種路徑**（那是因為 `assets` 走 extraFiles 在 asar 外）。

### QR 視窗

`QRCodeWindow.tsx` 改成上下兩組（各 160px），共用 `QrBlock` 版型與
「relay → tunnel → 區網」的同一套優先順序。沒跑過 `npm run build:mobile` 時
新版那組顯示「尚未建置」提示而不是一個掃了會 503 的碼。

#### ⚠️ 視窗被切掉：**兩個原因，都要修**（owner 2026-08-06 截圖回報）

第一版只放大了內容，結果第二張 QR 整個看不到也捲不到。成因有兩層：

1. **視窗高度不夠** —— 原本寫死 `320×440`，兩組 QR 的卡片實測高 **618px**。
   改成 `340 × min(700, max(420, workArea高 - 60))`，並開放 `resizable`。
2. **flex 置中會裁掉兩端，而且沒有捲軸** —— `root` 原本是
   `display:flex; alignItems:center` 且沒給 `overflow`。內容一旦高於容器，
   **上下同時被裁**，第二張 QR 完全拿不到。
   改成 `flexDirection:'column'` 由上往下堆 ＋ `overflowY:'auto'` ＋ `maxHeight:'100vh'`，
   卡片再補 `flexShrink:0`（column flex 裡預設會被壓縮，一壓縮又變成內容被切）。

**只修高度是不夠的**：螢幕比例千奇百怪，總會遇到更矮的工作區。
兩層都處理過才不會再切一次。

實測（把真實樣式抽成獨立頁面量）：視窗高 700 剛好不需捲動；
560／420／360 三種高度都可捲，且捲到底時第二張的複製鈕確實落在視野內。

### dev 一鍵

`DesktopST-dev.bat` 啟動前先跑 `npm run build:mobile`（約 6 秒），
所以 QR 的新版永遠是最新程式碼，**不必再另外開 `MobileST-*.bat`**。

⚠️ **代價：新版走的是建置產物，沒有 HMR。** 改完手機 UI 要重跑一次 bat（或手動
`npm run build:mobile`）才會生效。要邊改邊看仍然用 `MobileST-test.bat`（vite dev server）。

### 驗證方式

前兩次都因為「假 relay 是照推測寫的」而驗過頭卻沒驗到重點。
這次先用 owner 的真實 relay URL 打 curl 把行為量清楚（見上表），
再照量到的結果重寫假 relay（scratchpad）：反向代理、要求 deviceId ＋ token、
注入四變數與 fetch patch —— 與實測逐條對齊。

然後用瀏覽器完整走一次，全部通過：

| 檢查 | 結果 |
|---|---|
| 外部子資源數量 | **0**（單一檔產物生效） |
| React 掛載並顯示資料 | ✅ |
| API 路徑 | `/<deviceId>/api/state` → 200 ✅ |
| 頭像（`<img>`，不經 fetch） | `/<deviceId>/api/avatar/c1?token=` → 200 ✅ |
| WebSocket | 用注入的 `__tunnelWsUrl` 連上；推一則提醒，toast 有到 ✅ |
| 缺 token / 缺 deviceId | 401 / 503（與實測相同）✅ |

⚠️ **仍未在真的 DeST ＋ 真的 relay 上跑完整個流程** —— mobileServer 在 Electron
主行程內，本次未啟動桌面程式。假 relay 這次是「照實測結果」而非推測寫的，
可信度高很多，但最終仍以 owner 實機掃碼為準。
打包後 asar 內的 `out/mobile` 讀取也還沒驗。

---

## 4.21 階段 6 落地筆記：個人新聞報（2026-08-06）

### 抽進 core 的三件事（這階段的真正產出）

| 檔 | 內容 | 原本散在哪 |
|---|---|---|
| `core/news/reader.ts` | 分欄（F1）、`sectionIdOf`、配額查詢（F4）、可排序來源與上下移（F5／F6）、併回釘選（F3／F7）、換掉一欄、dismiss 上限 500（F8） | 桌面 `groupNewsItemsByKeyword` ＋ `mobile.html` 的 `nrGroupByKeyword`（兩份） |
| `core/util/relativeTime.ts` | `elapsedSince()`，**只算不寫字**；中文在 `src/shared/relativeTimeLabel.ts` | `mobile.html` 的 `nrFormatTime` |
| `main/modules/news/scheduler.ts` | `getNewsScheduler` / `syncNewsScheduler` | `ipc.ts` 的兩個 handler body |

桌面的 `groupNewsItemsByKeyword` 已改成薄薄一層包 core（只補固定欄的中文標題），
桌面新聞報的行為與過去逐項相同。**抓取邏輯完全沒有第二份**：手機打的
`/api/news/reader/*` 走的就是桌面在用的 `readerFetch.ts`。

### 新增的端點（都在既有的 `mobileRoutes.ts`）

`GET/POST /api/news/settings`（關鍵字／黑名單／來源）與 `GET/POST /api/news/scheduler`。
⚠️ POST settings **一定先跟磁碟現況淺層合併**再存 —— `saveNewsModuleSettings` 是把
收到的物件當「整份設定」正規化，直接丟 partial 會把 `enabled`、地方新聞、學習權重
全部清成預設。這正是 `news-reader-mobile-plan.md` §7.1 記載過的舊 bug，端點裡有註解。

### 兩個踩到的坑

1. **回傳新陣列的 zustand selector 會無限重繪。**
   `useNewsStore(selectSections)` 這種寫法每次都給新陣列，`useSyncExternalStore`
   的快照比對永遠不相等 → React 判定狀態一直在變，`Maximum update depth exceeded`，
   畫面整片空白、只有 console 有線索。改成元件端 `useMemo(() => …, [items, sources])`。
   衍生資料的 helper 現在收 `(items, sources)` 而不是收整包 state，
   從型別上就擋掉再被當 selector 用。
2. **每欄則數的輸入框必須 uncontrolled（`defaultValue` ＋ `onBlur`）。**
   controlled 會在每一次按鍵都送出去重抓一整欄（10 秒起跳），
   而且組字中的輸入法會被回灌的值蓋掉。`key` 帶電腦端現值，成功後才換數字；
   沒改就不送。

### 刻意的取捨

- **換一批的釘選併回比桌面簡化**：桌面 `mergeKeepingPins` 會依每欄配額細部併回，
  這裡是「釘選一律保留、分欄時各自歸位、排在該欄最前」。行為好預測，
  也不必維護第二份配額演算法（沿用舊版手機的既有決定）。
- **手機的新聞設定只有四樣**（關鍵字／黑名單／訂閱來源／排程）。語言處理、破圈、
  地方新聞、學習權重留在桌面設定面板 —— 目標 4 的分層，進階的不擠第一層。
  模組總開關在「設定 → 模組開關」，新聞設定畫面只顯示狀態，不重複放一顆。
- **顯示模式與目前分頁存手機自己的 localStorage**（沿用舊版的 key，換介面不會忘記
  使用者的偏好）；釘選／不看了走電腦端共用那份。

### 驗證到哪裡

`node scripts/mobile-stub-server.mjs` ＋ `dev:mobile`，在瀏覽器 375×812 實際操作過：
分欄與分頁、換一批（釘選留下、其他換掉）、單欄重抓（只換那一欄）、每欄則數、
關鍵字組多選（切了組會重抓且欄位清單跟著變）、欄位上移、釘選／不看了、
💬 聊這個插進輸入框並送出、模組停用時的提示。stub 連拒絕條件一起模擬
（模組沒開回 200 ＋ `ok:false`、順序清單對不上回 400）。
**尚未在真的 DeST ＋ 真新聞來源上跑過**，交 owner 走 `DesktopST-dev.bat` 掃「新版」QR。

### 4.21.1 owner 實測回報後重做：關鍵字管理（2026-08-06 當天）

owner 走過一次真機後回報三件事：①「點頻率，結果所有關鍵字一起被改掉」；
②排序的上／下移按鈕點下去沒有明顯變色，不確定有沒有按到；③新增／刪除關鍵字
要跑去另一個「設定」畫面才能做，希望跟排序合在同一個畫面，而且要一眼看出
每個關鍵字在哪一組，不要靠下拉選單；編輯／刪除可以多一步驟，但要放在同一個
UI 裡，位置要避開容易誤按的地方。

**①的根因**：階段 6 一開始把關鍵字管理拆成兩個畫面——「個人新聞報 → 欄位設定」
只管排序，「新聞設定」另外管新增／刪除／改權重／改分組——**兩邊各自維護一份
`sources`，各自呼叫同一支 `saveSettings({ sources })` 整批覆寫**。`saveSettings`
送的是完整陣列不是單筆 patch，兩個畫面的存檔前後腳送出，晚到的那個會用自己
手上（較舊）的整份陣列蓋掉先到的那個剛存好的變更。舊版 `NewsSettingsView` 只有
「頻率」按鈕檢查了 `busy`，啟用勾選框與分組下拉都沒檢查，兩個動作只要前後腳
碰在一起就會出現「改了 A，畫面上卻看到別的關鍵字也變了」的假象。

**修法**：兩個畫面合併成一個 —— `NewsKeywordsPanel.tsx`（原
`NewsOptions.tsx` 整支換掉），`NewsSettingsView.tsx` 的「興趣關鍵字」區塊整段
刪除，只留黑名單／訂閱來源／排程。**只留一個地方能動 `sources`**，
而且那個地方的每一個控制項（權重、啟用、改名、改組、刪除、新增、上下移）
共用同一支 `newsStore.mutateSources()`，用一個全域 `keywordsBusy` 擋住任何第二筆
在飛的存檔——不是每加一顆按鈕就要記得補一次防呆，是設計上不可能有兩筆同時發生。

**②③的重做**：
- 關鍵字依所屬組**分桶顯示**（`core/news/reader.ts` 新增 `groupSourcesByKeywordGroup`），
  組名當標題，不需要點開下拉才知道某關鍵字在哪組。
- 上／下移只在「同一組內」交換位置（`moveSource` 改成用該關鍵字自己的
  `groupId` 當範圍，不再依賴「新聞報要抓哪些組」的閱讀篩選——那是另一件事，
  管理排序不該被它牽動）。按鈕加 `active:scale-90 active:bg-[--mint]` 的按壓回饋，
  而且點下去到放開這段時間內整個面板進入 `keywordsBusy`，所有控制項一起變淡並
  顯示「儲存中⋯⋯」文字——用「螢幕明確在動」取代「顏色有沒有變」，後者在
  觸控裝置上本來就不可靠。
- 新增：每組底下各自一個快速輸入框（`QuickAddRow`），新關鍵字直接進那一組，
  不必先選組。
- 編輯／刪除：主要一行只有「標籤、頻率、上下移」三種常用操作；改名、切組、
  啟用切換、刪除全部收進一顆「⋯」（`more` 圖示）展開的次要區塊，**與上下移
  按鈕之間刻意留出間距**，刪除本身還要過一次確認對話框——兩層防呆對付「按鈕
  太密集容易誤按」。

**MonoIcon 新增**：`more`（三個點，⋯ 按鈕用）。

驗證方式同上（stub＋瀏覽器 375×812），另外針對這次的根因特別驗證了：
連續快速點擊三個不同關鍵字的頻率按鈕，只有第一下真的送出、後兩下因
`keywordsBusy` 被擋下（stub 的 log 只印出一次 `[news] 設定 -> ...`），
確認「一個動作在飛時擋住其他動作」而不是「發生了才回滾」。

**同一次回報還帶出一個排版坑**：`NewsKeywordsPanel` 一開始是 `NewsView` 的
`flex-col` 裡一個獨立子項，疊在分頁 chips 與新聞清單（新聞清單自己那個
`.scroll-y` 容器）之間，但**它自己沒有捲動容器**。`Sheet` 對 `'news'` 這個
畫面種類是 `scrollable={false}`（新聞報自己管捲動，理由見 `ViewStack.tsx`
的註解），於是關鍵字一多，面板整個被 Sheet 的 `85dvh` 高度切掉——
下面的關鍵字捲不到，「更多」展開出來的分組選項自然也點不到。
owner 真機截圖就是卡在「獨立遊戲…AI…女性向…Switch…任天堂」那幾個常見組合，
下面還有的關鍵字完全看不見。

修法：面板搬進新聞清單原本用的那個 `.scroll-y` 容器，`optionsOpen` 時整段
**取代**清單（而不是額外疊加），分頁 chips 也順便讓出空間（面板自己已經有
一排「要抓哪些組」的 chips，兩排疊在一起沒有意義）。用 15 個關鍵字測試過
`scrollHeight > clientHeight`，捲到底也能點開最後一個關鍵字的「更多」看到
「移到」選項。

### 4.21.2 owner 再回報：關鍵字組要能新增／刪除、按組收合（同一天）

owner 看過捲動修好之後又提三件事：①「關鍵字組」旁邊要能快速新增組；
②應該要「選了某組（例如『遊戲』）底下才顯示該組的關鍵字」，不要整批攤開；
③刪除組也要能在這個畫面做，但危險操作要藏得深一點。

**手風琴取代整批攤開**：`興趣關鍵字` 底下每組變成一個可收合的標頭
（組名 ＋ 則數），預設全部收合，點了才展開該組的關鍵字清單與快速新增輸入框
（單一開啟：開一組會收掉前一組，不是多開）。標頭右側只有預設組沒有的一顆
「⋯」，點了跳確認對話框問要不要刪除——**兩層防呆**（要先點中這顆遠離
展開／收合主要點擊區的小按鈕，再過一次確認），對付「危險操作藏深一點」
的要求；預設組本來就不給刪（電腦端也會擋），乾脆不放這顆按鈕。

**新增組**：「興趣關鍵字」小標題旁一顆「+」，點了在清單最上面長出一個
輸入框（`NewGroupRow`，故意跟每組底下「新增到『XX組』」的 `QuickAddRow`
分開元件，兩種「+」長得像但語意不同，用不同 placeholder 區分）。
新增成功後**自動展開剛加的那組**（用「新增前的 id 集合」比對存檔後回傳的
陣列，抓出「新出現的那筆」），不必使用者自己去點開才能開始加關鍵字。

**核心層**（`core/news/keywordGroups.ts` 新增）：
- `withNewGroup(groups, name)` —— 不帶 id（電腦端產生，理由同 `withNewKeyword`）
- `withoutGroup(groups, id)` —— 預設組永遠留著，直接擋在這層（同一參照回傳，
  UI 才知道不必送出）

`groupSourcesByKeywordGroup`（`core/news/reader.ts`）原本會把「沒有關鍵字的組」
濾掉不顯示——這對「純顯示」的欄位管理沒問題，但對「管理」畫面是錯的：
剛新增、還沒放進第一個關鍵字的空組會直接從畫面上消失，新增功能等於點了
沒反應。改成一律回傳全部組（含空的）。

**同一輪發現、也修掉的既有 bug（比今天的功能請求更嚴重）**：
`mobileRoutes.ts` 的 `/api/news/settings` 與另外四支端點（`quota`／`groups`／
`order`，還有桌面 `ipc.ts` 的 `news:save-settings`／`news:set-enabled`／
`news:reset-feedback`／`news:dont-want`）存檔前都先 `loadNewsModuleSettings()`
讀一次現況、整包 spread 進 `saveNewsModuleSettings()`。但 `saveNewsModuleSettings`
**自己內部也會在寫入前重新讀一次磁碟、只疊上傳進去的 patch**——外層那次讀取
完全多餘，而且是隱藏的 race：外層讀到的是「這個請求進來那一刻」的舊快照，
如果這段時間內有另一個請求（現在關鍵字管理面板一次操作可能連續打好幾支
不同端點：新增組、緊接著新增關鍵字）搶先存檔，這個請求事後才執行內部的
`saveNewsModuleSettings`，就會用它手上那份舊快照把剛存好的欄位蓋掉——
跟這輪一開始「頻率互相蓋掉」同一個 bug 類型，只是這次能發生在**不同欄位
之間**（例如新增組的請求把剛存好的關鍵字 `sources` 蓋回舊的），前端的
`keywordsBusy` 排隊只能擋住同一支 store action 之間的競速，擋不住這種
跨端點、在 main process 內部發生的競速。修法：拿掉外層的 `loadNewsModuleSettings()`
＋ spread，只把「這次真的送了什麼」交給 `saveNewsModuleSettings`，讓它自己
那次讀取（緊貼在寫入之前）成為唯一權威來源。`docs/news-reader-mobile-plan.md`
§7.1 補了一段更正說明，避免以後又寫回這個模式。

**驗證**：stub 也照抄了「新增組不能把已存在的 id（尤其是 `default`）當成
新的重配一個」這個規則（第一次寫 stub 時漏掉，複現出「刪組後預設組憑空
多一份複本」的畫面，跟正式碼是同一個成因，一起修掉）。瀏覽器 375×812
走了一輪：新增「遊戲」組並確認自動展開、往裡面加一個關鍵字、刪除整個組
並確認關鍵字沒有消失（歸回預設組、預設組則數 +1）、確認組清單沒有出現
重複的「預設組」。

---

## 4.22 B6 落地筆記：遙控 UI 搬新版（2026-08-06）

> 對照 `docs/mobile-html-feature-inventory.md` §2「H. 遙控專屬」與 §3 決議②。
> 範圍：H1、H2、H4–H11（H3 已決議排除，不做）。

### 這是 UI 移植，不是後端開發

`src/main/mobileServer.ts` 與 `src/main/modules/remote-control/` 的截圖、點擊、
視窗列舉、程式白名單、系統動作端點在這次任務**開工前就已經全部存在**（含權限
白名單、裝置限制、需要二次確認的能力清單）。這次只做兩件事：
`core/data/types.ts` 加一個 `RemoteControlApi` 分組（比照 `NewsApi` 的形狀），
以及 `src/mobile/ui/remote/` 一份 React 畫面。**一行新的遙控業務邏輯都沒有寫。**

### 落地形狀

- `RemoteControlApi`：`getState`／`listDisplays`／`listWindows`／
  `captureDisplay`／`captureWindow`／`isLocked`／`click`／`scroll`／
  `typeText`／`sendKey`／`listPrograms`／`launchProgram`／`closeProgram`／
  `systemAction`／`hideWindows`／`restoreWindows`。
- `RemoteDataSource.remoteControl`：逐條打既有端點；`LocalDataSource.remoteControl`
  的每個方法**永久回 `DataError('not-supported')`**（新的 `unsupported()` helper，
  刻意與既有的 `pending()` 分開，因為這不是「之後補」的階段，是獨立模式沒有
  電腦可控這件事不會改變）。
- 入口：`MainMenu.tsx` 用 `getData().capabilities.remoteControl` 過濾整個選單項，
  不是渲染出來再 disabled——獨立模式使用者的選單裡完全沒有這一項。
- 畫面：`src/mobile/ui/remote/RemoteControlView.tsx`（工具列、截圖區、遙控切換、
  程式／系統動作用內嵌覆蓋層而非疊 Sheet——遙控畫面本身已經是一個 Sheet，
  再疊一層在小螢幕上滑動衝突）＋ `ScreenshotStage.tsx`（手勢與座標換算）。

### 座標換算：逐字對照，沒有重新推導

`ScreenshotStage.tsx` 的 `toScreenCoords()` 逐字對照 `assets/mobile.html` 的
`ssToScreenCoords()`（原檔 2459 行）：圖片用
`transform: translate(tx,ty) scale(scale)`、預設置中的 `transform-origin`，
換算式因此是 `originX = vpW/2 + tx - imgW*scale/2`。手勢狀態全部放在 `useRef`
而非 React state——`touchmove` 一秒觸發幾十次，每次都 `setState` 會卡頓，
縮放/平移改直接寫 `imgRef.current.style.transform`。

### 確認流程（H11 與 `requireConfirmation`）

兩種確認分開處理，不要混成同一套：

- **關機／重開機**：不管桌面設定了什麼，UI 一律先跳 `ui.confirm()`
  （比照 `mobile.html` 原本的雙重確認），確認後帶 `confirmed: true`。
- **點擊／輸入／程式／螢幕電源**：只有桌面設定面板把該能力放進
  `RemoteControlState.requireConfirmation` 時才問一次，問完一樣帶
  `confirmed: true` 重打。這個旗標透過 `RemoteDataSource` 送
  `X-Remote-Confirmed: '1'` header，對應 `routes.ts` 的
  `ensureRemoteConfirmation()`／`hasRemoteConfirmation()`。

### 順便修掉的一個跨來源 bug

實機／dev 測試時發現：`mobileServer.ts` 的 CORS 設定只有
`Access-Control-Allow-Headers`（管請求方向），沒有
`Access-Control-Expose-Headers`（管回應方向）。瀏覽器預設只讓 JS 讀到少數
「安全」回應標頭，跨來源時 `X-Display-Bounds` / `X-Window-Bounds` 會被瀏覽器
擋下、`response.headers.get()` 永遠回 `null`，導致點擊座標換算全部落空——
而且**不會有任何錯誤或例外**，只是點了沒反應。手機 UI 的 dev 模式
（Vite 埠 ≠ mobileServer 埠）正好是跨來源，這條路徑不特別測是踩不到的。
已在 `mobileServer.ts` 與 `scripts/mobile-stub-server.mjs` 的 CORS 設定加上
`Access-Control-Expose-Headers`。

### 驗證到哪裡

程式與 stub 端點驗證完成（`scripts/mobile-stub-server.mjs` 新增
`/api/remote/*`、`/api/screenshot/*`、`/api/displays`、`/api/windows`、
`/api/capture-window`、`/api/system/lock-status`，含 `RC=0`／`RCDEVICE=0`／
`RCCONFIRM=1` 三種拒絕情境的環境變數開關）。瀏覽器 375×812 走了一輪：
截圖顯示、遙控模式切換、單指點擊座標換算、文字輸入、快捷鍵、程式開關、
系統動作二次確認、裝置不在允許清單時的提示、模組整個關閉時的 toast、
需要確認時的 428 → 確認對話框 → 帶 header 重打。`npm run typecheck`／
`npm test`（333 個測試，新增遙控相關契約測試於 `tests/data/dataSource.test.ts`）
全過。

**尚未驗證（寫落地筆記時）**：真的點擊/鍵盤有沒有作用到電腦、程式白名單開關是否真的
啟動/關閉程式、系統動作是否真的關機——這些只能接真的 `mobileServer` 才驗
得到，stub 只能驗 UI 流程與型別契約。

> **後續（2026-08-07）**：owner 真機驗證通過（點擊／拖曳／打字／程式白名單／
> 系統動作／多螢幕截圖），並依 §4.23 移除 `mobile.html` 與舊版 QR。

---

## 5.1 角色表情差分：**B3 不做，但不要擋住路**（owner 2026-08-04 問及）

手機版範圍是「單張主圖免表情差分」（roadmap §3.1），**這是範圍決定，不是資料缺口**。
盤查結果：需要的資料**全部已經存在且已在流動**，不需要「保留欄位」這種事。

| 東西 | 現況 |
|---|---|
| `Character.emotions: Record<string, string>` | 已存在（情緒 → 圖片） |
| `Character.spriteIds` | 已存在 |
| `Message.emotion?: string` | 已存在，桌面版每則回覆都在產並存檔 |

日後要加表情，只有兩處要動：

1. **`CharactersApi.avatarUrl(id)` → `avatarUrl(id, emotion?)`**
   ＋ 遙控端補一個回傳差分圖的端點。
   **刻意現在不加**：加可選參數在日後是非破壞性改動（現有呼叫端照樣編得過），
   不符合階段 0「晚做要拆掉重寫」的門檻；而現在加了、遙控端卻沒有端點，
   就變成一個傳進去默默沒作用的參數 —— 比沒有更糟。
2. UI 端把 `message.emotion` 對到圖片。

⚠️ **`MessageSnapshot` 必須維持 `Omit<Message, ...>` 的寫法，不要改成 `Pick`。**
現在是「預設全留、只挑掉肥的欄位（`images` 與 debug 三兄弟）」，
`emotion` 因此自動一路傳到手機。若有人為了「只列當下用得到的欄位」改成 `Pick`，
表情資料會在無聲無息中斷掉 —— 沒有任何錯誤訊息，正是 roadmap §4.1 那種 drift。

---

## 6. 明確不做（本階段）

- 角色印象（B8）、Android keystore、劇本匯入器
- 遙控 H1–H11 的 UI（~~B6~~ → **B6 已完成**，見 §4.22／§4.23）
- 資料同步 S1/S2（B5 之後）
- PWA 離線／瀏覽器內跑 LLM（§8 已否決）
