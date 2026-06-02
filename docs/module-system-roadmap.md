# DeST 模組系統總覽

本文件定義 DeST 未來模組化的共用方向。遠端遙控、新聞陪聊、TRPG、以及其他可選能力，都應該接到同一套 module host，而不是各自長出不同的半模組架構。

---

## 1. 核心原則

DeST 本體應維持在以下責任：

- 角色、對話、記憶與聊天流程。
- 角色卡、Persona、World、Scene 等核心資料。
- LLM provider 與 utility model 調度。
- 視窗管理與桌面角色呈現。
- 設定儲存與資料目錄管理。
- 模組載入、啟用、停用與權限控管。

可選能力應搬到模組：

- 遠端遙控：高權限桌面操作。
- 新聞陪聊：外部資訊整理與角色化表達。
- TRPG：骰子、規則輔助、主持流程、角色包。
- 其他未來能力：行事曆、郵件、瀏覽器、自動化等。

核心不應直接依賴特定模組的內部實作。模組應透過 module host 提供的受控 API 接入 DeST。

---

## 2. 模組分級

不同模組的風險不同，權限 UI 與審查程度也應不同。

### 低風險模組

例如 TRPG 擲骰、角色包、純前端 UI 擴充。

- 不操作系統。
- 不連外抓取敏感資料。
- 不需要高權限確認。

### 中風險模組

例如新聞陪聊、天氣、公開資料查詢。

- 會連外抓資料。
- 會影響使用者接收到的資訊。
- 需要來源透明、快取、資料品質提示。

### 高風險模組

例如遠端遙控、桌面自動化、系統電源操作。

- 會操作鍵鼠、程式、視窗或系統。
- 可能透過網路暴露本機能力。
- 必須預設關閉、逐項授權、保留操作紀錄。

---

## 3. Module Host 草案

第一階段可先支援內建模組，不必立刻開放第三方任意程式碼。重點是先把邊界切出來。

```ts
interface DeSTModule {
  id: string
  name: string
  version: string
  riskLevel: 'low' | 'medium' | 'high'
  requestedCapabilities: ModuleCapability[]
  activate(ctx: ModuleContext): Promise<void> | void
  deactivate?(): Promise<void> | void
}

interface ModuleContext {
  settings: ModuleSettingsStore
  ipc: ModuleIpcRegistry
  mobile?: MobileRouteRegistry
  scheduler?: ModuleScheduler
  windows: ModuleWindowHost
  events: ModuleEventBus
  llm: ModuleLlmBridge
  logger: ModuleLogger
}
```

### 設定儲存

模組設定不應全部塞進 `AppSettings` 頂層。建議新增模組設定區或獨立檔案：

```ts
interface ModuleSettingsEnvelope {
  enabled: boolean
  version: string
  data: unknown
}

type ModuleSettingsFile = Record<string, ModuleSettingsEnvelope>
```

短期可放在 `settings.modules[moduleId]`。中期可改為每個模組自己的設定檔，例如：

```text
%APPDATA%/DesktopST/modules/desktopst.remote-control/settings.json
%APPDATA%/DesktopST/modules/desktopst.news/settings.json
```

### 權限宣告

```ts
type ModuleCapability =
  | 'mobile.routes'
  | 'mobile.ui'
  | 'scheduler.jobs'
  | 'llm.utility'
  | 'llm.characterOutput'
  | 'network.fetch'
  | 'desktop.input'
  | 'desktop.capture'
  | 'desktop.programs'
  | 'desktop.systemPower'
  | 'window.host'
```

模組宣告的是大類權限；模組內部還可以再細分自己的 capability，例如遠端遙控的 `remote.pointer.click` 或 `remote.system.shutdown`。

---

## 4. 共用註冊點

### IPC

模組可以註冊 renderer 呼叫的 IPC handler，但必須有 namespace：

```ts
ctx.ipc.handle('remote-control:get-log', handler)
ctx.ipc.handle('news:get-settings', handler)
```

核心應避免讓模組直接散落註冊到全域 `ipcMain`。

### Mobile Routes

手機 HTTP API 應由 route registry 管理：

```ts
ctx.mobile?.registerRoute({
  method: 'POST',
  path: '/api/remote/click',
  requiredCapability: 'remote.pointer.click',
  handler
})
```

`mobileServer` 只負責驗證、找 route、檢查權限、回傳結果，不應知道每個模組的業務邏輯。

### Scheduler

新聞 digest、TRPG 定時事件、其他背景任務都可以透過 scheduler 註冊：

```ts
ctx.scheduler?.registerJob({
  id: 'news.daily-digest',
  schedule: { type: 'daily', hour: 9, minute: 0 },
  run
})
```

### 角色輸出

模組若需要讓角色說話，不應自己繞過聊天流程。建議透過核心提供的角色輸出接口：

```ts
ctx.llm.requestCharacterMessage({
  characterId,
  intent: 'news.digest',
  facts,
  constraints
})
```

這樣角色卡語氣、世界觀、對話上下文仍由核心掌握。

---

## 5. 內建模組資料夾建議

短期可以先用內建模組結構：

```text
src/main/modules/
  moduleHost.ts
  moduleTypes.ts
  moduleSettings.ts
  mobileRouteRegistry.ts

src/main/modules/remote-control/
  index.ts
  settings.ts
  actions.ts
  routes.ts
  logStore.ts
  types.ts

src/main/modules/news/
  index.ts
  settings.ts
  sources.ts
  classifier.ts
  digest.ts
  types.ts
```

前端也應對應拆出：

```text
src/renderer/src/modules/remote-control/
  SettingsPanel.tsx
  LogWindow.tsx

src/renderer/src/modules/news/
  SettingsPanel.tsx
  DigestPanel.tsx
```

---

## 6. 建議實作順序

截至 2026-06-02，遠端遙控已先行拆成內建模組資料夾，並已完成部分 registry 化：

- `src/main/modules/remote-control/` 已承接 actions、routes、settings、logStore、types、ipc。
- `src/renderer/src/modules/remote-control/` 已承接 SettingsPanel 與 LogWindow。
- `/api/remote/*` 已由 remote-control module 註冊到 `mobileServer` route registry。
- `remote:*` IPC handlers 已由 remote-control module 自行註冊。
- capability、allowedDevices、restrictToAllowedDevices、requireConfirmation 已可用。
- 手機端未授權裝置仍可截圖，但不注入/顯示遙控入口。

因此下一階段建議順序改為：

1. 建立最小 module host 與 module types。
2. 讓 remote-control 以 module definition 接入 host，而不是由 `mobileServer.ts` / `ipcHandlers.ts` 直接 import。
3. 建立相容版 module settings store，先包住現有 `settings.remoteControl`，暫不搬檔案。
4. 將 host 提供的 mobile route / IPC registry API 穩定下來。
5. 再規劃正式 settings migration：`settings.remoteControl` -> module settings。
6. 最後再拆 mobile UI fragment registry，讓 `assets/mobile.html` 從單檔變成 core shell + module fragments。
7. 用同一套 host 介面實作新聞模組 MVP。

遠端遙控是最適合先拆的模組，因為它已經存在、耦合高、風險高。先拆它可以逼出真正需要的 module host API，新聞模組之後就能直接沿用。
