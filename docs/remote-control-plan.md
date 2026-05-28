# 手機遠端遙控功能 — 實作清單

## 設計範圍

DeST 提供「輕量」遠端遙控,適用於等待 Unity build / AI 跑完後下一步指令的場景。
複雜遙控（精細操作、攝影機）由專門遙控軟體負責,DeST 只負責「能在手機上開啟那個遙控軟體」。

### 能做
- 在手機截圖上點擊 → 桌面點擊對應位置
- 輸入文字到目前 focus 的控制項（先 click 再 type 強制流程）
- 系統動作:關機 / 重開機
- 啟動 / 關閉「白名單登錄」的程式

### 不做
- 攝影機、麥克風
- 拖曳、複雜手勢
- 任意路徑執行程式

---

## 階段 0:截圖預覽縮放穩定化（前置必修）

手機端截圖縮放會「彈回原本大小」,點擊座標功能依賴穩定縮放,必須先修。

- [ ] `#ss-img` 與 overlay 加 `touch-action: none`,禁掉瀏覽器原生 double-tap-zoom
- [ ] 修雙指→單指轉換時的 pan 基準漏洞（`touchend` 若剩 1 指要重設 `ssPanStartX/Y`）
- [ ] scale 下限從 0.5 改為 1.0（不允許縮比 fit 還小）
- [ ] pan 範圍 clamp（縮放時不允許拖離畫面太遠）

檔案:`assets/mobile.html`（約 1180-1216 行）

---

## 階段 1:白名單程式管理（資料層 + 設定 UI）

### 資料結構

新增 `AppSettings.remoteControl`:

```ts
interface RemoteControlSettings {
  enableSystemActions: boolean    // 關機 / 重開機,預設 false
  enableInputControl: boolean     // 鍵鼠遙控,預設 false
  registeredPrograms: RegisteredProgram[]
}

interface RegisteredProgram {
  id: string
  name: string           // 顯示名稱
  path: string           // 可執行檔絕對路徑
  args?: string          // 啟動參數
  iconDataUrl?: string   // 從 exe 抽取的圖示（cache）
}
```

### 工作

- [ ] `src/main/types.ts` 加入 `RemoteControlSettings` / `RegisteredProgram`
- [ ] `src/main/fileStore.ts` 預設值與 migration
- [ ] 設定視窗新增「遙控」分頁
  - 兩個 toggle:允許系統動作 / 允許鍵鼠遙控
  - 程式白名單列表（新增 / 編輯 / 刪除）
  - 「新增」按鈕開檔案選取器選 .exe
  - 從 exe 抽取圖示（用 `app.getFileIcon`）
- [ ] IPC:`remote:list-programs` / `remote:add-program` / `remote:update-program` / `remote:remove-program`

---

## 階段 2:遙控核心（PowerShell + Win32 SendInput）

新檔 `src/main/remoteControl.ts`,所有遙控動作集中在這裡。

### Helper API

- [ ] `clickAt(x, y, button, double)` — 物理座標滑鼠點擊
- [ ] `typeText(text)` — 用 `SendInput` `KEYEVENTF_UNICODE` 模式輸入（繞過 IME）
- [ ] `sendKey(combo)` — `Enter` / `Ctrl+C` / `Alt+Tab` 等快捷鍵
- [ ] `launchProgram(program: RegisteredProgram)` — 啟動白名單程式,回傳 PID
- [ ] `closeProgram(pid)` — 關閉指定 PID（先 graceful,再 force）
- [ ] `shutdownPc(restart: boolean)` — 關機 / 重開機

### 已啟動程式追蹤

- [ ] 全域 Map<programId, pid[]> 記錄 DeST 啟動的程式
- [ ] 程式結束時自動從 map 移除（用 `child_process.spawn` 監聽 exit）

---

## 階段 3:HTTP API endpoint

加到 `src/main/mobileServer.ts`,所有 endpoint 都要檢查對應 setting toggle:

- [ ] `POST /api/remote/click` — body: `{ x, y, button?, double? }`
- [ ] `POST /api/remote/type` — body: `{ text, pressEnter? }`
- [ ] `POST /api/remote/key` — body: `{ keys }`(例如 `"Enter"` / `"Ctrl+S"`)
- [ ] `POST /api/remote/system` — body: `{ action: 'shutdown'|'restart' }`,需 `enableSystemActions`
- [ ] `GET /api/remote/programs` — 回傳白名單 + 每個程式的 running 狀態
- [ ] `POST /api/remote/programs/launch` — body: `{ id }`
- [ ] `POST /api/remote/programs/close` — body: `{ id }`

### 截圖 API 強化

點擊座標需要知道截圖對應的螢幕物理座標範圍:

- [ ] `/api/screenshot/clean` 與 `/with-chars` 改為回傳 multipart 或在 header 帶 `X-Display-Bounds`
- [ ] `/api/capture-window` 同樣帶上 `X-Window-Bounds`
- [ ] 手機端記住「當前截圖的 bounds + 圖片像素尺寸」用於換算

---

## 階段 4:手機 UI

### 截圖預覽加遙控模式 toggle

`assets/mobile.html`:

- [ ] 截圖 overlay 加「遙控模式」開關按鈕
- [ ] 遙控模式下:
  - 點擊截圖 = 送 `/api/remote/click`,點完自動重新截圖
  - 底部顯示輸入框 + 「送出」按鈕 = 送 `/api/remote/type`
  - 「送出後按 Enter」checkbox
  - 快捷鍵列:Enter / Esc / Tab / Ctrl+C / Ctrl+V / Alt+Tab
- [ ] 強制流程提示:「點擊截圖選擇目標欄位,再輸入文字」

### PC 選單加新分頁

PC 選單目前有「螢幕 / 視窗 / 截圖」,加入:

- [ ] 「程式」分頁 — 列出白名單,顯示 running 狀態,每個項目有開啟 / 關閉按鈕
- [ ] 「系統」分頁 — 關機 / 重開機按鈕（受 `enableSystemActions` 控制）
- [ ] 兩個分頁都加二次確認 dialog

---

## 階段 5:安全與提示

### 桌寵「遙控中」指示器

不做動畫,改成桌寵頭上浮出明顯標記:
- [ ] 紅色圓形 + 白色驚嘆號 icon,旁邊文字「遠端控制中」
- [ ] 收到任何遙控指令時顯示,3 秒後淡出（連續指令會延長）
- [ ] 用一個獨立的小視窗（類似對話泡泡）疊在角色上方
- [ ] 樣式:紅底白字、圓角、有點陰影,要醒目

### 裝置註冊（暱稱)

每支手機在 localStorage 存一個 UUID 作為 deviceId,連線時帶 `X-Device-Id` header。
首次連線（伺服器查無 token+deviceId 紀錄）強制要求設定暱稱,後續同 token+deviceId 直接沿用。

- [ ] 手機端:首次載入 mobile.html 時 localStorage 生成 UUID
- [ ] 所有 request 帶 `X-Device-Id` header(WebSocket 用 query string)
- [ ] 新檔 `%APPDATA%\DesktopST\registered-devices.json`:
  ```ts
  interface RegisteredDevice {
    deviceId: string
    tokenSuffix: string      // 用 token 後 4 碼分組(換 token 視為新裝置)
    nickname: string         // 使用者自訂,例如「我的 iPhone」「公司 Android」
    autoLabel: string        // UA 解析的自動標籤,fallback 用
    firstSeenAt: number
    lastSeenAt: number
  }
  ```
- [ ] `GET /api/device/check` — 回傳是否需要註冊
- [ ] `POST /api/device/register` — body: `{ nickname }`,儲存後回傳 ok
- [ ] 未註冊裝置呼叫遙控 API 一律 403,回應 `{ error: 'device-not-registered' }`
- [ ] 手機端攔截 403 → 跳全螢幕 modal「請為這支裝置取個名字」,輸入後送 register,完成才解鎖功能
- [ ] 手機端 localStorage 額外存 `lastNickname`,modal 開啟時自動填入(電腦端重灌或換 token 時免重打)

### 遙控日誌

每筆指令記錄:
```ts
interface RemoteControlLog {
  id: string
  timestamp: number
  action: 'click' | 'type' | 'key' | 'launch' | 'close' | 'shutdown' | 'restart' | 'device-connect'
  detail: string              // 例如 "click (1234, 567)" / "type: hello" / "launch: Cursor"
  clientIp: string            // 來源 IP
  deviceId: string            // localStorage 的 UUID
  deviceNickname: string      // 使用者設定的暱稱
  deviceAutoLabel: string     // UA 解析,例如 "iPhone · Safari"
  tokenSuffix: string         // token 後 4 碼
  success: boolean
  error?: string
}
```

- [ ] 存於 `%APPDATA%\DesktopST\remote-control-log.json`,環狀 buffer 上限 500 筆
- [ ] UA 解析簡單版:抓 `iPhone` / `iPad` / `Android` / `Windows` / `Macintosh` + 瀏覽器名
- [ ] WebSocket 連線建立時記一筆 `device-connect` 事件

### 日誌檢視視窗

- [ ] 新視窗 `remote-control-log` — 列出所有紀錄,可篩選 action 類型
- [ ] 每筆顯示:時間、裝置標籤、IP、動作、詳細內容、成功/失敗
- [ ] 「清除全部」按鈕
- [ ] 設定視窗「遙控」分頁,在「允許鍵鼠遙控」toggle 旁邊放「檢視日誌」按鈕
  - 按鈕啟用條件:`enableInputControl === true` 或日誌有紀錄
  - 否則灰掉

### 其他

- [ ] tray icon 在「鍵鼠遙控開啟」時加紅點變化
- [ ] 設定視窗「遙控」分頁開啟兩個 toggle 時顯示明顯警告文字

---

## 不在這次範圍內

- caret 位置高亮（UI Automation 抓 focus 控制項 bounding rect)— 之後再做
- 自動 refresh 截圖（遙控模式下定時抓）— 之後再做
- 開機 / 鎖定 / 睡眠 — 暫不加,需求出現再說
