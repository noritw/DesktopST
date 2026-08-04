# B3 手機 UI 實作計畫

> 日期：2026-08-04｜分支 `feat/mobile-ui`（自 `099b80a`）
> 範圍定義：`docs/mobile-html-feature-inventory.md`（49 項獨立版必做 ＋ §6.1 的 10 項設定 UI）
> 設計約束：`docs/multi-device-platform-roadmap.md` §2（四大目標）、§3.3、§4.5、§4.7、§8
>
> **狀態：階段 0–3 完成（0-③／1／2a–2d／3a／3b）。下一步是階段 4（設定 UI）。**
> 進度見 §4.9，實機踩到的坑見 §4.10–§4.14（**寫任何手機 UI 前務必讀完**）。
> 沒開 DeST 時的驗證方式見 §4.9 與 `scripts/README-mobile-stub.md`。

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

### 階段 6 ── 個人新聞報（F1–F13，可平行插入）

- F1 分欄統一走 core（順手解掉 `nrGroupByKeyword` 那份重複實作）
- F12 相對時間是純函式，搬 `core/util/`
- `readerFetch.ts` / `readerState.ts` 的純邏輯搬 core，I/O 留平台層（比照 B2.7 的形狀）

### 階段 7 ── 收尾：網頁版切換 ＋ APK 打包

- `mobileServer` 改提供 `out/mobile/`；`mobile.html` **保留一個版本週期**再刪（§4.5）
- `npx cap add android`（此時 `webDir` 才真的存在）→ 實機驗證
- keystore **不做**（owner 未決定）

> 階段 2–6 順序可依當下狀況調換，**唯一硬性約束是階段 0-③ 與階段 1 必須在前**。

---

## 5. 已知風險與預先決定

| 風險 | 預先決定 |
|---|---|
| 獨立模式的 LLM 串流 | `HttpAdapter.supportsStreaming` 回 false 是正常路徑，UI 先做非串流，不當錯誤 |
| Capacitor SecretAdapter 選外掛 | 階段 4 才需要；在那之前 API Key 不落地，避免先挑錯外掛 |
| `mobileServer` 要補一批寫入端點 | 已分散進階段 3／4／5，不集中成一大塊。端點命名與 IPC 對齊，避免第三套語彙 |
| API Key 在非區網下的入口 | **隱藏而非 disabled** —— disabled 按鈕會讓使用者以為壞了；旁邊說明「改用區網連線可編輯」 |
| `mobile.html` 的機率表 | B3 期間仍需與 core 同步（已加註解），階段 7 後消失 |
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
| 4 設定 | ⬜ 下一步 | |
| 5–7 | ⬜ | |

### 開發時怎麼連上真資料

```
http://<電腦區網IP>:5180/?server=http://<電腦區網IP>:<mobileServer 埠>&token=<存取權杖>
```

`npm run dev:mobile` 起 5180；埠與權杖見 DeST 設定 → 擴充 → 手機遠端對話 → QR Code 視窗。
正式版是同源、不需要參數（階段 7）。

⚠️ **dev server 會無聲停掉**（工具重啟、機器休眠）。手機出現「載入失敗」時，
先確認 5180 還在聽（`Get-NetTCPConnection -LocalPort 5180`）再查別的。

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
- 遙控 H1–H11 的 UI（B6，僅預留 `Capabilities.remoteControl`）
- 資料同步 S1/S2（B5 之後）
- PWA 離線／瀏覽器內跑 LLM（§8 已否決）
