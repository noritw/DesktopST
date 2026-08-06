# 假 mobileServer（開發手機 UI 用）

> 加入日期：2026-08-05（B3 階段 2 期間）｜程式：`scripts/mobile-stub-server.mjs`

## 這是做什麼的

**讓手機 UI 在沒開 DeST 的情況下也有東西可以接。**

`npm run dev:mobile` 起的是畫面，資料要有人給。正式的來源是電腦上的
`mobileServer`（DeST 開著才有），但開發途中常常只是想確認一顆按鈕的位置、
一段流程的順序 —— 為此開整個 DeST、還要有 API Key 才能看到角色回話，太慢。

這支只提供**手機 UI 會用到的那幾支 `/api/*`**，用假資料回答，
並把每一則請求印在終端 —— 手機上按了什麼、實際送出去什麼，一目了然。

## 怎麼跑

```bash
node scripts/mobile-stub-server.mjs
```

另一個終端起手機 UI：

```bash
npm run dev:mobile
```

然後開（手機要跟電腦在同一個 Wi-Fi）：

```
http://<電腦區網IP>:5180/?server=http://<電腦區網IP>:5999&token=x
```

Windows 也可以直接雙擊專案根目錄的 `MobileST-test.bat`：它會啟動假伺服器、
手機 UI、產生 `mobile-test-qr.png` 並開啟 QR Code。手機與電腦必須在同一個 Wi‑Fi；
測試完成後關閉批次檔開出的兩個命令視窗即可。

要用**真實 DeST 資料＋新的 React 手機 UI**，請先開啟 DeST 並啟用 mobileServer，
再雙擊根目錄的 `MobileST-real-test.bat`。它會自動偵測區網 IP、讀取 access token、
確認 `http://電腦IP:3721` 的 mobileServer 可連，並自動選擇未被占用的 Vite 埠、產生正確的 QR Code。DeST 內建 QR 視窗在階段 7 前仍指向舊的
`assets/mobile.html`，不適合用來驗證這批新 UI。

桌機瀏覽器用 `localhost` 也可以。`token` 隨便填，這支不驗。

### 環境變數

| 變數 | 預設 | 用途 |
|---|---|---|
| `PORT` | 5999 | 換埠 |
| `MAXIMG` | 5 | 圖片張數上限，驗「超過上限時的提示」 |
| `NR` | — | `NR=0` 關閉隨機工具，驗 C6 總開關關閉時 🎲 入口消失 |
| `THEME` | mint | 換色彩主題 |
| `LANDIRECT` | `1` | 設 `0` 驗「經中繼連線」那條路徑：設定畫面 API Key 欄位隱藏、寫入回 409 |
| `RC` | `1` | 設 `0` 驗「遙控模組整個關閉」：截圖仍可用，點擊/鍵盤/程式/系統動作全部 403 |
| `RCDEVICE` | `1` | 設 `0` 驗「這台裝置不在允許清單」：`RemoteControlView` 出現提示橫幅 |
| `RCCAPS` | 全開 | 逗號分隔，只開放列出的能力，例如 `RCCAPS=remote.pointer.click` |
| `RCCONFIRM` | — | 設 `1` 驗「需要先確認」：點擊/程式/系統動作類第一次打回 428，UI 要跳確認對話框再帶 header 重打 |

## ⚠️ 一條規矩：要連「拒絕條件」一起模擬

**只回成功的 stub 會安靜地掩蓋真實限制，比沒有 stub 更糟。**

2026-08-05 實際踩到：`/api/messages/resend` 在真的 DeST 上**只接受使用者訊息**
（`ipcHandlers.ts:639`），這支 stub 原本照單全收 ——
於是手機 UI 對角色訊息也顯示了「重新發送」，而那顆按鈕在真機上必定失敗。
owner 實測回報「按了只有刪掉後面」，追下去才發現。

同一類的還有 `/api/characters/desktop/remove`：
它用 **HTTP 200 ＋ `ok: false`** 表示「至少要留一個角色」，不是錯誤狀態碼。

2026-08-05 又踩了第三次，這次是**空值**不是拒絕：`/api/avatar/:id` 原本
對「沒設主圖」的角色照樣回一張色塊圖，真伺服器是回 404（`if (!char?.avatar)`）。
於是 🐾 fallback（清單 D6）那條路徑在 stub 上永遠驗不到，
角色卡編輯器的破圖 bug 因此多活了一輪。**空值與錯誤路徑一樣要照抄。**

**新增端點時，先讀 `src/main/mobileServer.ts` 對應那段的失敗分支，一併照抄。**

## 已模擬的端點

| 端點 | 行為 |
|---|---|
| `GET /api/state` | 三隻假角色（兩隻在場）＋ 一則開場訊息 |
| `GET /api/avatar/:id` | 純色方圖；**未知 id 回 404**（留給 🐾 fallback 驗證） |
| `GET /api/message-image/:id/:i` | 回傳送出時存下的那張原圖 |
| `GET /api/characters/library` | 角色庫 ＋ `onDesktop` |
| `POST /api/send` | 記下訊息、推 WS、1.2 秒後假回覆（`skipLlm` 時不回） |
| `POST /api/characters/desktop/{add,remove}` | remove 在只剩一位時回 `ok: false` |
| `POST /api/characters/toggle-mute` | 回 `{ muted }` ＋ 推 `desktop-updated` |
| `POST /api/characters/speak` | 思考 → 主動發話 |
| `POST /api/messages/{delete,edit,resend}` | resend 只接受使用者訊息（拒絕時回 **400**） |
| `GET /api/characters/card/:id` | 完整角色卡；**未知 id 回 404** |
| `POST /api/characters/{create,save,delete}` | save 對未知 id 回 404、名稱空白回 400 |
| `POST /api/characters/avatar` | 記下上傳的圖，之後 `/api/avatar/:id` 回它 |
| `POST /api/characters/{import,export}-card` | 太小的檔案當成「不是角色卡」回 400 |
| `POST /api/characters/{import,export}-pack` | 沒選角色／檔案損毀皆回 400 |
| `GET /api/lorebooks` | 兩本假的用語解說（驗角色卡的綁定勾選） |
| `GET /api/connection-info` | 回 `{ lanDirect }`；`LANDIRECT=0` 模擬經中繼連線 |
| `GET/POST /api/settings/llm`、`llm-provider`、`llm-model`、`llm-endpoint` | 供應商／模型／端點；`hasApiKey` 只回布林，不回明文 |
| `POST /api/settings/llm-apikey` | **`LANDIRECT=0` 時回 409**（照抄真伺服器的區網直連限制） |
| `GET/POST /api/settings/memory` | 數值超出範圍回 400（1–200 / 1–500，照抄 `setMemorySettingsDirect`） |
| `GET /api/settings/modules`、`POST .../toggle` | 天氣／Spotify／日曆／新聞四個開關；未知 id 回 400。**把新聞關掉就能驗新聞報的「模組尚未啟用」提示** |
| `GET /api/reminders`、`POST .../{create,save,delete,toggle}` | `save` 缺 `reminder.id` 回 400（照抄 `mobileServer.ts`） |
| `GET /api/presets`、`/api/scenes`、`GET/POST /api/presets/{persona,world,scene}/*` | 預設組完整讀寫；不存在回 404，Persona／World 最後一組刪除回 409 |
| `GET /api/news/reader/state` | 五個關鍵字來源（含一個 `readerQuota` 覆寫、一個地方新聞、一個 RSS）、兩個關鍵字組、共用的釘選／不看了 |
| `POST /api/news/reader/{batch,section}` | 每次都生新的假新聞（換一批看得出真的換了）；**模組關掉時回 200 ＋ `{ok:false, error}`**，熱門／地方／找不到來源同樣走 `ok:false` |
| `POST /api/news/reader/{pinned,dismissed}` | 共用內容狀態；dismissed 上限 500（照抄 `readerState.ts`） |
| `POST /api/news/reader/quota` | 缺 `sectionGroupId` 回 **400**；成功時順便回該欄重抓後的內容 |
| `POST /api/news/reader/{groups,order}` | order 的清單數量對不上回 **400**（不要靜靜接受） |
| `GET/POST /api/news/settings` | 關鍵字／黑名單／訂閱來源；**新來源的 id 由伺服器產生**（手機端沒有 `crypto.randomUUID`） |
| `GET/POST /api/news/scheduler` | 定時陪聊；`enabled` 卻沒給 `schedule` 回 **400** |
| `GET /api/conversations`、`POST .../{load,new,rename,delete}` | 對話清單完整讀寫（B3 階段 8）；`messages` 一律指向使用中對話的訊息陣列，切換會連帶影響 `/api/state` 與後續送訊息；刪光最後一個會自動生一個新的空對話（照抄桌面端沒有「至少留一個」限制的行為） |
| `GET /api/displays`、`GET /api/windows`、`GET /api/system/lock-status` | 兩個假螢幕／兩個假視窗；鎖定狀態隨關閉/喚醒螢幕連動（B6） |
| `GET /api/screenshot/{clean,with-chars}`、`POST /api/capture-window` | 假截圖（色塊 ＋ 標籤文字），帶 `X-Display-Bounds` / `X-Window-Bounds`，供座標換算驗證（B6） |
| `POST /api/remote/{click,scroll,type,key}` | 依 `RC`／`RCDEVICE`／`RCCAPS`／`RCCONFIRM` 回 403／428；成功只記在終端，不會真的動到任何東西（B6） |
| `GET /api/remote/programs`、`POST .../{launch,close}` | 兩個假程式，開關會切換 `running` 狀態（B6） |
| `POST /api/remote/{monitor-off,wake,system}` | 同樣走能力/確認檢查；`system` 的 `action` 不是 `shutdown`/`restart` 回 400（B6，**不會真的關機**） |
| `POST /api/remote/{hide-windows,restore-windows}` | 只記在終端，一律成功（B6） |

沒實作的端點一律回 404 並印在終端，「這支還沒模擬」一眼看得出來。

## 這不是什麼

- **不是測試**。真正的回歸測試在 `tests/`（只測 `src/core/`，見 `tests/README.md`）
- **不會被打包**。`scripts/` 不在 electron-builder 與 vite 的輸出範圍裡
- **不模擬 LLM**。角色的「回話」是罐頭字串，驗的是 UI 流程不是內容

真的要驗角色口吻、prompt 組裝、圖片有沒有送到模型，就得開 DeST 走真的
`mobileServer`（連線參數見 `docs/b3-mobile-ui-plan.md` §4.9）。
