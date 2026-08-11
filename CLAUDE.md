# DesktopST — AI 接手說明（每次新對話只讀這份）

> **省 Token 硬規則**
> 1. 新對話**預設只讀本文件**，讀完即可開工。
> 2. **禁止**一開工就整份讀：`DesktopST-Spec.md`、`docs/multi-device-platform-roadmap.md`、
>    `docs/progress-log.md`、`docs/b3-mobile-ui-plan.md`、`docs/mobile-html-feature-inventory.md`、
>    `docs/pre-b3-work-assessment.md`。
> 3. 需要細節時依下方「依任務選讀」開**對應段落**；用 Grep 找關鍵字，不要從頭掃到尾。
> 4. `AGENTS.md` 只是薄轉址，**以本文件為準**。文件總索引：`docs/README.md`。

---

## 1. 專案是什麼

Windows 桌面 AI 角色扮演寵物（Electron）＋ 進行中的手機 UI（B3）。
角色站在桌面、點擊才叫出輸入；相容 SillyTavern 角色卡；多角色／群組。

定位擴張見 roadmap（選讀）：主線是「AI 角色聊天平台，有桌寵版與手機版」，
手機獨立版是一般使用者第一優先——但**不要為了定位去整份讀 roadmap**。

---

## 2. 技術棧與目錄

| 項目 | 選用 |
|---|---|
| 桌面 | Electron ＋ React ＋ TS ＋ Tailwind ＋ Zustand |
| 資料 | 本地 JSON（`%APPDATA%\DesktopST\`），API Key 走 `safeStorage` |
| 邏輯 | `src/core/` 純 TS（**禁** import electron／fs／path；**禁**被 `main/` 反向污染） |
| 共用 UI | `src/shared/`（目前只有 `MonoIcon`） |
| 手機 | `src/mobile/`（B3 React；單一入口 `/`） |

```
src/core/   純邏輯
src/shared/ 桌面＋手機共用呈現
src/main/   Electron 主行程
src/renderer/ 桌面 UI
src/mobile/ 手機 UI
```

---

## 3. 硬規則（永遠有效）

**產品／範圍**
- 不做規格外功能；有想法先跟 owner 討論
- 第一版排除：自動發話、TTS、Live2D、ST 對話記錄匯入
- Lorebook（用語解說）**要做**——桌面＋手機內容編輯已完成；規格 `docs/future-lorebook.md`（選讀）
- 桌面至少留一個角色；只剩一個時隱藏移除
- 解除安裝不刪使用者資料

**視覺（只改這些檔，勿動邏輯）**
- 扁平、圓潤；預設仍是春夏粉彩（主色薄荷／天藍；背景 `#F7FFFC`；文字 `#3D5A52`）
- 另有多組可選主題（含無彩度純白／黑白灰，以及森林、復古、賽博）；細節見 `docs/progress-log.md`「介面配色擴充」
- 禁止：厚重陰影、毛玻璃、純黑字、尖角；賽博主題亦避免霓虹 glow
- 檔案：`src/renderer/src/styles/theme.css`、`src/mobile/ui/theme.ts`、`tailwind.config.ts`、`src/renderer/src/styles/global.css`、`src/shared/MonoIcon.tsx`
- 加圖示只改 `src/shared/MonoIcon.tsx`，不要在桌面／手機各抄一份
- 新增／改主題時：`ColorTheme` union、桌面選色器、情境 `THEME_META`、手機 ThemePicker、**以及** `mobileServer` 的 `MOBILE_COLOR_THEMES` 白名單要一起改

**架構（手機／跨平台提案必過）**——濃縮自 roadmap §2／§8，細節選讀原文
- 四大目標：①裝置上可單機聊自己的角色 ②不另付費給作者（無須營運後端）
  ③敏感資料不放第三方（relay 是例外，須揭露＋可自架 Tunnel）④新手三步上手（分層，進階勿擠第一層）
- **已否決、不要重提**：雲端同步後端、React Native 重寫、手機重寫一份 prompt 邏輯、
  NAS 當 DeST host、付費模式、Relay 代排程、RTC 半夜喚醒、把 HTML 打包進遙控 APK、Spotify 自動選歌

---

## 4. 現況與下一步

| 區塊 | 狀態 |
|---|---|
| 桌面版 | MVP～進階大致完成（新聞、情境覆蓋、reaction、記憶摘要、日曆、Lorebook 桌面…） |
| B1／B2／B2.5–2.7 | 完成（`core/`、adapter、store、Lorebook） |
| **B3 手機 UI** | 階段 0–9 ＋ 資訊架構完成；`mobile.html` 已移除（單一入口 `/`） |
| **B6 遙控 UI** | 已完成（真機驗證通過） |
| **手機獨立版 W1–W3** | 完成。**debug APK 已在 Pixel 10a 實測通過**（聊天、落地、金鑰加密、重開保留）。建置流程與陷阱：`src/mobile/README.md` |
| **S1 初始化匯入** | 完成（掃 QR 單向拉角色／預設組／設定／**對話**；對話勾選匯入，預設全不選）。另有可重複執行的「從電腦重新拉設定」 |
| **獨立版天氣** | 完成（缺口 #4）。邏輯在 `core/weather/`，定位 GPS 優先退回 IP，聊天會帶 `[Weather]`。地震／颱風關鍵詞查詢仍桌面限定 |
| **獨立版 Lorebook 編輯** | 完成（缺口 #2，2026-08-09）。`StandaloneSession` 接上 CRUD＋參照清理；`chat.ts` 補了原本沒接的 `[Glossary]` 注入（桌面版本來就有，獨立版聊天管線之前完全沒有） |
| **下一步** | owner 2026-08-09 排序：① Persona 清單切分頁 UI bug（已修，見 `docs/mobile-standalone-gap-inventory.md` §0）→ ② Lorebook 編輯（已完成）→ ③ 提醒（缺口 #5，**要連「哪台裝置響」一起做**；owner：切獨立版的主因就是這個）→ ④ 新聞報（缺口 #6，外出常用）。角色卡匯出（#3）與模式切換／S2 同步（`mobile-mode-switch-sync.md`）**排在這批之後**，先求獨立版功能完整。另：v0.4.0 真機煙測（配色／新聞泡泡／遙控） |
| 延後／已排程 | 角色印象（B8）；系統通知（B5）；**飲食熱量模組（B9）** → `docs/future-nutrition-module.md`（owner 自用優先；含換機搬家包） |

獨立模式**尚未實作**（會誠實擲 `not-supported`，不是 bug）：新聞、提醒、
角色卡匯出、天氣的地震／颱風關鍵詞查詢。Spotify／日曆授權仍只在桌面。
（情境套用／擷取／刪除、設定組刪除、天氣 2026-08-08 已補上；Lorebook 編輯 2026-08-09 已補上。）
→ 缺口總表與建議順序：`docs/mobile-standalone-gap-inventory.md`（不長，可整份讀）。

分支：`feat/mobile-standalone`。

---

## 5. 進行中仍會踩的坑（寫手機相關時看這裡就夠）

- 選檔 `accept` **只給** `image/*` 大類，不要列副檔名（Android 相簿會空）
- 改 vite alias 或 tailwind `content` 後**一定重開** `dev:mobile`，否則圖示無聲消失
- relay 三約束（改連線／建置／QR 必守；細節 §4.20）：
  ①產物＝**單一自足 HTML**（`build:mobile` 含 inline）②`baseUrl` 相對路徑
  ③WebSocket 用注入的 `__tunnelWsUrl`
- 入口：`/` 一律走 B3 React；`DesktopST-dev.bat` 先建置手機（**無 HMR**）；
  邊改邊看用 `MobileST.bat` → `[3]`
- 業務邏輯寫在 `core/` 或既有 `*Direct`；手機／`mobileServer` 只做薄轉呼叫
- **獨立模式改完資料一定要 `events.push({ kind: 'state-invalidated', … })`**，
  否則畫面不會更新（漏推過一次：重新發送截斷後畫面停在舊清單）
- **Capacitor 外掛放 `dependencies`，不是 `devDependencies`**；打 APK 前先看
  `src/mobile/README.md` 的兩個陷阱（另一個是 `JAVA_HOME` 不能用 Android Studio 的 jbr）
- 手機版本資訊：`vite.mobile.config.ts` 的 `define` 注入，包裝在 `src/mobile/buildInfo.ts`；
  header 左上角兩字標籤（本機／區網／中繼）點進去「關於」。**要看「更新了沒」請看建置時間，不是版本號**
- 清單列慣例（角色／情境／使用者／世界觀／對話）：**點名稱編輯（小「編輯」在名稱下方）、右邊大標籤套用／加入**
- 加 Capacitor 外掛時：**權限不見得會自動合併**（`@capacitor/geolocation` 的
  AndroidManifest 是空的），要自己寫進 `android/app/src/main/AndroidManifest.xml`；
  外掛一律用**動態 `import()`** 載，否則瀏覽器煙測與 vitest 會在載入時就炸
- core 裡要打外部 API 就**注入 `HttpAdapter`**（比照 `core/llm`、`core/weather`），
  不要用全域 `fetch` —— 手機那邊要 CapacitorHttp patch 過才繞得過 CORS
- **CapacitorHttp 完全忽略 `init.signal`**：core 裡那些 `AbortController` ＋
  `setTimeout(abort)` 的逾時在手機上等於不存在，原生請求一慢就無限等
  （天氣「抓取位置」卡住就是這個）。`mobile/adapters/httpAdapter.ts` 已用
  `Promise.race` 把 signal 翻成 reject，**新的逾時邏輯照樣要走 signal，別自己 setTimeout**
- **Capacitor plugin 的 `timeout` 選項不保證兌現**（`Geolocation.getCurrentPosition`
  沒權限時 Promise 可能永遠不 settle）。外面自己再包一層計時器
- **絕對不要讓 async function 直接 `return` Capacitor 的 plugin 物件**
  （`return mod.Geolocation`）。JS resolve 時會摸回傳值的 `.then` 判斷是不是
  thenable，而 plugin proxy **把任何屬性存取都當成原生方法呼叫**，就變成呼叫
  原生的 `Geolocation.then()`：原生沒這方法、不回呼 resolve／reject，
  **外面的 `await` 永遠卡住**（天氣「抓取位置」按了沒反應就是這個，
  錯誤只在 logcat 看得到：`"Geolocation.then()" is not implemented on android`）。
  要回傳就包一層：`return { plugin: mod.Geolocation }`
- **手機通知一定要自己建 channel**：Capacitor 預設頻道 importance=3，
  只會安靜躺進通知欄、**不會有橫幅彈出**，手機又常在震動模式 ——
  看起來就像「時間到了什麼都沒發生」。用 importance 4（`reminderScheduler.ts` 的
  `dest-reminders-v1`）。**channel 建好後 importance 改不動**，要調就換 id
- **手機時間顯示一律走 `toLocaleTimeString()`**（`ui/settings/reminderFormat.ts`）：
  `<input type="time">`／`datetime-local` 是照裝置語系畫的（zh-TW ＝「下午4:43」），
  清單若自己 `padStart` 拼 24 小時制，同一則提醒兩邊長不一樣，使用者會以為存錯
- 真機除錯提醒／通知：`adb logcat | grep Reminder` 看排程；
  `adb shell run-as tw.nori.dest cat files/reminders.json` 直接讀資料（debug build 才行）；
  `adb shell dumpsys notification` 看通知有沒有真的送出。
  ⚠️ **配對的 Wear OS 手錶會把通知轉走並連帶清掉手機那則**（`WearNotifRemoval`），
  通知欄看不到不代表沒發出去
- 動 LLM 供應商設定時注意 `llm.model` 是早期單一供應商的遺留欄位，
  `resolveModel()` 仍會拿它墊底 —— 不同步會把 A 家型號送去 B 家

---

## 6. 依任務選讀（不要整份開）

| 你要做的事 | 讀這些 | 不要先讀 |
|---|---|---|
| 一般小修／問進度 | **本文件即可** | 一切長文 |
| B3 手機 UI（階段 7 等） | `b3-mobile-ui-plan.md` **文首＋§4.9**；該階段正文；對應落地筆記（如新聞→§4.21） | 整份計畫、舊階段筆記 |
| 改 QR／relay／手機建置 | 計畫書 **只讀 §4.20** | §4.10–4.18 |
| S1／S2 同步 | roadmap **§4.7**（模式、S1–S3 分層、API Key 判定、星狀拓樸） | 整份 roadmap |
| 手機模式切換／切換時帶資料走 | `mobile-mode-switch-sync.md`（整份，S2 第一階段的實作設計） | 整份 roadmap |
| 打 APK／改 Capacitor | `src/mobile/README.md` | 一切長文 |
| 動天氣（兩邊共用） | `core/weather/`（四個小檔，直接讀原始碼）＋ `progress-log.md` 搜「獨立版天氣」 | 舊的 `weather-realtime-query-spec.md`（那是桌面 CWA 規格） |
| 問「獨立版還缺什麼」／挑下一項做 | `mobile-standalone-gap-inventory.md`（整份，不長） | 舊的 `mobile-html-feature-inventory.md` |
| 實作手機獨立版精準鬧鐘／提醒 | `mobile-standalone-reminder-plan.md`（整份） | 一切長文 |
| **實作獨立版個人新聞報（缺口 #6）** | `news-standalone-kickoff.md`（整份，開工指令） | 一切長文 |
| 實作 Android 桌面小工具 (Widget) | `mobile-android-widget-plan.md`（整份） | 一切長文 |
| 查「以前為什麼這樣做／已知坑」 | `progress-log.md` **Grep 關鍵字** | 整份 log |
| 實作某桌面／資料規格 | `DesktopST-Spec.md` **對應章節** | 整本 Spec |
| 提案跨平台／散布／同步架構 | roadmap **§2、§8**（必要時 §4.5–4.7） | 整份 roadmap、§10 舊順序敘事 |
| 對照舊 mobile.html 功能清單（歷史） | `mobile-html-feature-inventory.md` **§6／§7** | 整份 inventory |
| Lorebook 規格 | `future-lorebook.md` | — |
| 飲食熱量模組（B9） | `future-nutrition-module.md` | — |
| 新聞報 | `news-reader-mobile-plan.md`（舊版規格／UX）＋ b3 **§4.21**（React 版落地） | 所有 `news-future-*`（那是構想） |
| 新聞進 prompt 斷章／摘要設計 | `news-article-context-design.md` | — |
| 假伺服器怎麼驗 | `scripts/README-mobile-stub.md` | — |

文件夾總表與「必讀／選讀」標記：`docs/README.md`。

---

## 7. 開發指令

```bash
npm install
npm run dev          # 桌面；DesktopST-dev.bat 會先 build:mobile
npm run build
npm run typecheck
npm test             # 只測 src/core/，見 tests/README.md
npm run dev:mobile   # 手機 HMR（一般走 MobileST.bat [3]，它會順便起 stub 與 QR）
npm run build:mobile # 產出 out/mobile（含 inline，給 QR／relay）
```

**根目錄只有三個 `.bat`**（2026-08-08 從七個併過來，舊的 `MobileST-*.bat` 都已刪除）：

| 檔案 | 做什麼 |
|---|---|
| `DesktopST-dev.bat` | 日常開發：先 `build:mobile` 再開桌面 DeST |
| `MobileST.bat` | 手機全部：`[1]` 打包 APK 並裝機（含防火牆、桌面 DeST、區網 QR）`[2]` 只重開 QR `[3]` UI 即時預覽 |
| `release.bat` | 發布：升版 → build → zip →（可選）APK → commit／tag／push → GitHub Release |

選單邏輯在 `scripts/mobile-tool.mjs`；它只做編排，實際工作仍在
`build-mobile-apk.mjs`／`serve-apk.mjs`／`mobile-test-qr.mjs`。

授權：作者自訂條款 → https://nori.tw/DeST/license.html（repo 內 `docs/license.html`）。
