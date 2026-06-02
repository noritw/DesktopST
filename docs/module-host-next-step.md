# Module Host Next Step

本文件是下一輪模組化工作的執行規劃。目標是建立「最小可用 module host」，讓 remote-control 從目前的內建模組資料夾，進一步接到統一 host lifecycle。這一輪不追求完整外掛系統，也不先拆手機 HTML。

---

## 1. 背景

目前 remote-control 已完成第一階段拆分：

- main process 已有 `src/main/modules/remote-control/`。
- renderer 已有 `src/renderer/src/modules/remote-control/`。
- `/api/remote/*` 已由 remote-control module 註冊到 `mobileServer` route registry。
- `remote:*` IPC handlers 已由 remote-control module 自行註冊。
- capability、裝置白名單、requireConfirmation 已實作。

但 core 仍直接依賴 remote-control：

- `mobileServer.ts` 直接 import `registerRemoteControlRoutes`。
- `ipcHandlers.ts` 直接 import `registerRemoteControlIpcHandlers`。
- `index.ts` 的 mobile bridge 直接提供 remote-control host callbacks。
- `AppSettings` 仍直接持有 `remoteControl` schema。

所以目前只是「內建模組資料夾」，還不是正式 module host。

---

## 2. 本輪目標

建立最小 module host，先支援內建模組：

- module definition 註冊。
- module activation。
- module 透過 context 註冊 IPC handlers。
- module 透過 context 註冊 mobile routes。
- remote-control 改成 export module definition。
- core 啟動時只向 module host 註冊/啟動 built-in modules。

這輪完成後，core 應該不再直接呼叫 remote-control 的 route/ipc 註冊函式。

---

## 3. 非目標

這輪不做：

- 不做外掛 marketplace。
- 不做動態載入第三方 plugin。
- 不搬 `settings.remoteControl` 到獨立檔案。
- 不拆 `assets/mobile.html` 成 fragments。
- 不全面重構所有 mobile core routes。
- 不重構 `windowManager.ts` 或整個 `ipcHandlers.ts`。
- 不改 remote-control 既有使用者行為。

---

## 4. 建議檔案

新增：

```text
src/main/modules/moduleTypes.ts
src/main/modules/moduleHost.ts
```

可選新增：

```text
src/main/modules/moduleSettings.ts
```

修改：

```text
src/main/modules/remote-control/index.ts
src/main/mobileServer.ts
src/main/ipcHandlers.ts
src/main/index.ts
```

暫時不碰：

```text
assets/mobile.html
src/main/types.ts
src/renderer/src/types/index.ts
```

---

## 5. 最小型別草案

```ts
export interface DesktopSTModule {
  id: string
  name: string
  version: string
  kind: 'built-in'
  riskLevel: 'low' | 'medium' | 'high'
  activate(ctx: ModuleContext): void | Promise<void>
  deactivate?(ctx: ModuleContext): void | Promise<void>
}

export interface ModuleContext {
  ipc: ModuleIpcRegistry
  mobile: ModuleMobileRouteRegistry
  settings: ModuleSettingsBridge
  host: ModuleHostBridge
}
```

`ModuleHostBridge` 先只放 remote-control 需要的 host callbacks。長期再拆成 `windows`、`events`、`logger`、`llm` 等更細 API。

---

## 6. Remote-Control 接入方式

目前：

```ts
registerRemoteControlRoutes(registerMobileRoute)
registerRemoteControlIpcHandlers()
```

下一步改成：

```ts
export const remoteControlModule: DesktopSTModule = {
  id: 'desktopst.remote-control',
  name: '遠端遙控',
  version: '1.0.0',
  kind: 'built-in',
  riskLevel: 'high',
  activate(ctx) {
    registerRemoteControlRoutes(ctx.mobile.registerRoute)
    registerRemoteControlIpcHandlers(ctx.ipc)
  }
}
```

實作時可以先保留舊函式，但由 module definition 呼叫。這能降低一次改動的風險。

---

## 7. IPC Registry 策略

目前 `remote-control/ipc.ts` 直接使用 Electron `ipcMain`。

本輪可以先做薄 wrapper：

```ts
interface ModuleIpcRegistry {
  handle(channel: string, handler: IpcHandler): void
}
```

`ipcHandlers.ts` 建立 host 時傳入：

```ts
ipc: {
  handle: (channel, handler) => ipcMain.handle(channel, handler)
}
```

後續再補 namespace guard、重複註冊檢查、deactivate unregister。

---

## 8. Mobile Route Registry 策略

目前 `mobileServer.ts` 已有 `registerMobileRoute(route)`。

本輪目標：

- 將 route registry 型別搬到 `moduleTypes.ts` 或由 module host 封裝。
- `mobileServer.ts` 不直接 import remote-control module。
- app startup 時由 module host 啟動 remote-control，remote-control 再透過 `ctx.mobile.registerRoute` 註冊 routes。

暫時不要求所有 core mobile routes 都走 registry。

---

## 9. Settings Bridge 策略

本輪只做相容 bridge，不做實際 migration：

```ts
interface ModuleSettingsBridge {
  get<T>(moduleId: string): T | undefined
  set<T>(moduleId: string, value: T): void
}
```

`desktopst.remote-control` 的 `get/set` 暫時映射到 `settings.remoteControl`。

這樣 remote-control module 可以開始透過 module settings bridge 存取設定，但資料位置仍保持現狀。

---

## 10. 實作順序

1. 新增 `moduleTypes.ts`，定義 module、context、registry 型別。
2. 新增 `moduleHost.ts`，支援 `registerBuiltInModule()` 與 `activateModules(ctx)`。
3. 調整 `remote-control/index.ts`，export `remoteControlModule`。
4. 調整 `remote-control/ipc.ts`，讓註冊函式可接受 registry wrapper；保留無參數 fallback 也可以。
5. 調整 `mobileServer.ts`，移除直接 import remote-control routes，改由 host 啟動時註冊。
6. 調整 `ipcHandlers.ts`，移除直接 import remote-control IPC，改由 host 啟動時註冊。
7. 在 app startup 組出 module context，註冊並啟動 built-in modules。
8. 跑 typecheck。
9. 手動驗證 remote-control routes、remote IPC、手機截圖、手機遙控。

---

## 11. 驗收標準

必須通過：

- `npm run typecheck`
- 設定頁仍可開啟遙控設定。
- `remote:*` IPC 功能仍正常，例如程式清單、log window。
- `/api/remote/*` routes 仍正常。
- 未允許裝置仍可截圖但看不到遙控入口。
- 已允許裝置可進入遙控模式。
- `requireConfirmation` 仍會在 server 端拒絕未確認請求。

---

## 12. 風險與注意事項

- `ipcHandlers.ts` 很大，不要在本輪順手重構其他 IPC。
- `mobileServer.ts` 還有很多 core routes，不要一次全搬 registry。
- remote-control 的 host callbacks 目前來自 `index.ts` mobile bridge，短期可以保留。
- 不要改 settings schema，避免和 UI/renderer 型別同時爆開。
- 若 host lifecycle 需要 deactivate/unregister，先記錄 TODO，不必本輪完成。

