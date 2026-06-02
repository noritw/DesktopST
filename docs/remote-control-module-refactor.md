# 遠端遙控模組化重構規劃

本文件只處理現有遠端遙控功能如何拆成獨立模組。共用 module host 規格請見 `docs/module-system-roadmap.md`。

---

## 1. 目標

遠端遙控應成為高權限獨立模組，而不是 DeST 核心的一部分。

拆分後應達成：

- 預設未啟用。
- 可以獨立啟用、停用。
- 能力逐項授權。
- 有獨立設定、UI、紀錄與資料儲存。
- 核心 DeST 不直接 import 鍵鼠或 PowerShell 操作。
- `mobileServer.ts` 不直接寫死 `/api/remote/*`。
- 未啟用模組時，不暴露遠端遙控 API 與手機 UI。

---

## 2. 現況耦合點

目前遠端遙控相關功能分散在：

- `src/main/remoteControl.ts`：鍵鼠、捲動、螢幕關閉/喚醒、程式啟動/關閉、關機/重啟。
- `src/main/mobileServer.ts`：手機 HTTP API、WebSocket、授權、截圖、聊天 API、遠端 endpoint 混在同一個 server。
- `src/main/relayService.ts`：relay URL、deviceId、accessToken、tunnel 註冊。
- `src/main/cloudflaredManager.ts`：cloudflared tunnel 下載與啟動。
- `src/main/remoteControlLog.ts`：遠端操作紀錄。
- `src/main/types.ts`：`RemoteControlSettings`、`RegisteredProgram`。
- `src/renderer/src/types/index.ts`：renderer 端對應型別。
- `src/renderer/src/windows/SettingsWindow.tsx`：遠端遙控設定 UI。
- `src/renderer/src/windows/RemoteControlLogWindow.tsx`：操作紀錄 UI。
- `assets/mobile.html`：手機端遙控 UI。
- `src/main/index.ts`：mobile bridge、relay 狀態、視窗隱藏/恢復。

這代表「手機聊天」、「手機連線」、「截圖」、「鍵鼠控制」、「系統操作」目前綁在一起。模組化時要先切開 mobile access 與 remote control。

---

## 3. 邊界設計

建議分成三層：

```text
Core DeST
  - 角色、聊天、記憶、視窗、設定、module host

Mobile Access
  - HTTP/WebSocket server
  - token 驗證
  - relay/tunnel
  - QR code 狀態
  - route registry

Remote Control Module
  - 鍵鼠輸入
  - 捲動
  - 螢幕關閉/喚醒
  - 登錄程式啟動/關閉
  - 關機/重啟
  - 操作紀錄
  - 遠端控制設定與 UI fragment
```

relay/tunnel 應歸屬 Mobile Access，不應歸屬遠端遙控。手機聊天也會用到 relay，遠端遙控只是 mobile access 的其中一個使用者。

---

## 4. Capability 模型

現有設定只有：

- `enableInputControl`
- `enableSystemActions`

拆模組後建議改為細項 capability：

```ts
type RemoteCapability =
  | 'remote.viewScreen'
  | 'remote.captureWindow'
  | 'remote.pointer.click'
  | 'remote.pointer.scroll'
  | 'remote.keyboard.type'
  | 'remote.keyboard.hotkey'
  | 'remote.program.launch'
  | 'remote.program.close'
  | 'remote.monitor.power'
  | 'remote.system.shutdown'
  | 'remote.system.restart'
```

模組設定：

```ts
interface RemoteControlModuleSettings {
  enabled: boolean
  allowedCapabilities: RemoteCapability[]
  requireConfirmation: RemoteCapability[]
  registeredPrograms: RegisteredProgram[]
  allowedDevices: RegisteredRemoteDevice[]
  logRetention: {
    maxEntries: number
    keepDays?: number
  }
}
```

舊設定 migration：

- `enableInputControl: true` -> click、scroll、type、hotkey、monitor power。
- `enableSystemActions: true` -> shutdown、restart。
- `registeredPrograms` 原樣搬移。

---

## 5. 檔案拆分建議

短期先做內建模組，不必立刻做第三方 plugin：

```text
src/main/modules/remote-control/
  index.ts
  types.ts
  settings.ts
  actions.ts
  routes.ts
  logStore.ts

src/renderer/src/modules/remote-control/
  SettingsPanel.tsx
  LogWindow.tsx
```

對應搬移：

- `src/main/remoteControl.ts` -> `src/main/modules/remote-control/actions.ts`
- `src/main/remoteControlLog.ts` -> `src/main/modules/remote-control/logStore.ts`
- 遠端相關型別 -> `src/main/modules/remote-control/types.ts`
- `RemoteControlLogWindow.tsx` -> `src/renderer/src/modules/remote-control/LogWindow.tsx`
- `SettingsWindow.tsx` 中遠端設定區 -> `SettingsPanel.tsx`

第一階段可以保留 re-export，降低一次搬移造成的風險。

---

## 6. Mobile Routes 重構

目前 `mobileServer.ts` 直接處理 `/api/remote/*`。拆分後應改成 route registry。

```ts
ctx.mobile?.registerRoute({
  method: 'POST',
  path: '/api/remote/click',
  requiredCapability: 'remote.pointer.click',
  handler: async ({ body, device, host }) => {
    host.windows.notifyRemoteClickPending()
    return remoteControl.clickAt(body.x, body.y, body.button, body.double)
  }
})
```

`mobileServer` 應只負責：

- token 驗證。
- 裝置資訊解析。
- body 解析。
- 找到 route。
- 檢查 capability。
- 統一 JSON response。

不再直接 import `remoteControl` 或 `remoteControlLog`。

---

## 7. UI 拆分

設定頁：

- 新增「模組」入口。
- 遠端遙控設定由模組提供 panel。
- 權限用分組 toggle 呈現：畫面檢視、鍵鼠、程式、系統電源。
- 高風險項目需明確標示。

手機 UI：

- 遠端控制面板由模組提供 fragment。
- 模組停用時不顯示控制面板。
- capability 未授權時，對應按鈕 disabled 或不渲染。

紀錄 UI：

- 操作紀錄視窗由遠端遙控模組提供。
- 核心只提供開窗能力。

---

## 8. 安全要求

遠端遙控是高風險模組，至少要有：

- 預設關閉全部高權限 capability。
- 首次啟用風險說明。
- 裝置註冊或信任流程。
- 高風險操作二次確認，例如關機、重啟、關閉程式。
- 一鍵暫停遠端遙控。
- 操作紀錄不可預設關閉。
- log 記錄時間、裝置、IP、能力、結果。
- token 不寫入一般 log。
- 遠端輸入文字可選擇遮蔽。
- 停用模組時移除 routes、釋放 keep-awake process、關閉模組視窗。

---

## 9. 分階段路線

### Phase 1：檔案邊界整理，不改行為

- 建立 `src/main/modules/remote-control/`。
- 搬移 actions、log、types。
- 用 re-export 保持舊 import 可用。
- 抽出 renderer 設定 panel 與 log window。
- 不改 endpoint、不改設定格式、不改 UI 行為。

### Phase 2：Mobile Route Registry

- 從 `mobileServer.ts` 抽出 route registry。
- 核心 routes 與 remote routes 都透過 registry 註冊。
- `/api/remote/*` 搬到 remote-control module 的 `routes.ts`。
- `mobileServer.ts` 不再 import 遠端遙控 actions。

### Phase 3：設定遷移

- 新增 module settings store。
- 從 `settings.remoteControl` migration 到 remote-control module settings。
- 保留相容讀取一段時間。
- 前端改讀寫新位置。

### Phase 4：Capability 與裝置管理

- 引入 `allowedCapabilities`。
- route 層統一檢查 capability。
- 增加 device registration。
- log 記錄 capability、success、error。

### Phase 5：模組管理 UI

- 新增模組列表。
- 遠端遙控可從模組列表啟用/停用。
- 停用後移除 routes 與手機 UI fragment。

### Phase 6：外掛化準備

內建模組 manifest 範例：

```json
{
  "id": "desktopst.remote-control",
  "name": "遠端遙控",
  "version": "1.0.0",
  "kind": "built-in",
  "riskLevel": "high",
  "requestedCapabilities": [
    "mobile.routes",
    "mobile.ui",
    "desktop.input",
    "desktop.capture",
    "desktop.programs",
    "desktop.systemPower",
    "window.host"
  ]
}
```

第一版不必支援第三方任意程式碼，先讓內建模組跑在同一套規格上即可。

---

## 10. 目前進度與剩餘工作

更新時間：2026-06-02

### 已完成

- 建立 `src/main/modules/remote-control/`，承接 actions、routes、settings、logStore、types。
- 建立 `src/renderer/src/modules/remote-control/`，承接 SettingsPanel 與 LogWindow。
- `src/main/remoteControl.ts`、`src/main/remoteControlLog.ts` 改為 re-export shim。
- `mobileServer.ts` 已加入 route registry，`/api/remote/*` 由 remote-control module 註冊。
- remote route 層已接 capability gate。
- 操作紀錄已補 `capability`、`success`、`error`。
- 手機端 UI 已依 capability 顯示、隱藏或 disabled。
- 設定頁 remote control UI 已從 `SettingsWindow.tsx` 拆到 module `SettingsPanel.tsx`。
- mobile runtime 設定已能即時 start/stop mobile server 與 tunnel，不再依賴重啟。
- `allowedDevices` 已加入 UI 管理。
- 新增 `restrictToAllowedDevices`，白名單清單與「只允許指定裝置使用遙控功能」分離。
- `/api/state` 會依目前手機 `X-Device-Id` 回傳 `currentDeviceAllowed`。
- 手機端未授權時仍可使用截圖與檢視功能，但不顯示 remote module、程式、系統動作與截圖 overlay 的遙控按鈕。
- 遙控設定 UI 已簡化成單一「遙控模組」總開關；打開時同時啟用鍵鼠遙控、螢幕電源、關機與重新開機。
- `remote.monitor.power` 已併入遙控模組總開關，不再作為獨立 UI 選項。
- `requireConfirmation` 已接入路由與手機端：需要確認的 capability 若沒有 `X-Remote-Confirmed` 會被 server 拒絕。
- 手機端確認設定已簡化成單一「手機端送出動作前要求確認」開關。
- 建立 remote-control module IPC registry，`remote:*` IPC handlers 已由 module 自行註冊。

### 剩餘工作

#### 1. 正式 Module Host 整合

目前 remote-control 已是內建模組資料夾，但還不是完整 module host lifecycle。

尚需：

- 建立內建 module manifest。
- module host 統一管理 enable / disable / startup / shutdown。
- 停用 remote-control module 時，由 module host 統一解除 routes、IPC、mobile UI fragment。
- module host 提供受控 API，例如 mobile routes、window host、settings store、log store。

#### 2. Settings Schema 遷移

目前 `RemoteControlSettings` 仍在 core settings：

- `src/main/types.ts`
- `src/renderer/src/types/index.ts`

尚需：

- 將 remote-control 設定遷移到 module settings store。
- 保留一段 migration：`settings.remoteControl` -> module settings。
- 最終讓 core `AppSettings` 不再直接持有 remote-control schema。

#### 3. Mobile UI Fragment Registry

目前手機端仍是單一 `assets/mobile.html`。

尚需：

- 建立 mobile UI fragment registry。
- remote-control module 提供手機端控制 UI fragment。
- module disabled 或 device not allowed 時，不只 disabled，而是由 registry 決定是否注入。
- 長期可把 mobile HTML 拆成 core shell + module fragments。

#### 4. Route Registry 完整化

目前 route registry 已可註冊 remote routes，但檢查仍有部分分散。

尚需：

- 將 body parsing、device info、capability check、JSON response 統一到 registry middleware。
- module route handler 只處理業務行為。
- 所有 core mobile routes 也逐步改走 registry，而不只 remote routes。

#### 5. Security / Operational Safety

目前 capability、裝置限制與 `requireConfirmation` 已可用，但高風險流程仍有操作層面的收尾。

尚需：

- 一鍵暫停遠端遙控。
- 遠端輸入文字可選擇遮蔽或降低 log detail。
- 停用 remote-control 時釋放 keep-awake process。
- 螢幕關閉 / 喚醒行為仍需修正與測試，目前實機回報尚不穩定。

#### 6. 測試

目前主要靠手動實機測試與 typecheck。

尚需：

- route/capability/device policy 單元測試。
- settings migration 測試。
- mobile client state 測試：capability disabled、device not allowed、module disabled、device not allowed 但仍可截圖。
- monitor power / wake 行為至少補 mockable wrapper 測試。

### 目前完成度粗估

- 以「功能可用、責任大致切開」來看：約 75-80%。
- 以「正式 module host / manifest / IPC registry / mobile UI fragment registry」來看：約 45-55%。
