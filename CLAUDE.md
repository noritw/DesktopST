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
- 扁平、圓潤、春夏粉彩；主色薄荷／天藍；背景 `#F7FFFC`；文字 `#3D5A52`
- 禁止：厚重陰影、毛玻璃、純黑字、尖角
- 檔案：`src/styles/theme.css`、`tailwind.config.ts`、`src/styles/global.css`、`src/shared/MonoIcon.tsx`
- 加圖示只改 `src/shared/MonoIcon.tsx`，不要在桌面／手機各抄一份

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
| **B3 手機 UI** | 階段 0–6、8、9 ＋ 資訊架構完成；`mobile.html` 已移除（單一入口 `/`）；部分畫面待真機再瞄 |
| **B6 遙控 UI** | 已完成（真機驗證通過） |
| **下一步** | ①B3 階段 7 APK；Spotify／日曆授權仍只在桌面。新聞進 prompt 上下文補強已實作（見 `docs/news-article-context-design.md`） |
| 延後 | 角色印象（B8）；系統通知（B5） |

分支：`feat/mobile-ui`。

---

## 5. 進行中仍會踩的坑（寫手機相關時看這裡就夠）

- 選檔 `accept` **只給** `image/*` 大類，不要列副檔名（Android 相簿會空）
- 改 vite alias 或 tailwind `content` 後**一定重開** `dev:mobile`，否則圖示無聲消失
- relay 三約束（改連線／建置／QR 必守；細節 §4.20）：
  ①產物＝**單一自足 HTML**（`build:mobile` 含 inline）②`baseUrl` 相對路徑
  ③WebSocket 用注入的 `__tunnelWsUrl`
- 入口：`/` 一律走 B3 React；`DesktopST-dev.bat` 先建置手機（**無 HMR**）；
  邊改邊看用 `MobileST-test.bat`
- 業務邏輯寫在 `core/` 或既有 `*Direct`；手機／`mobileServer` 只做薄轉呼叫

---

## 6. 依任務選讀（不要整份開）

| 你要做的事 | 讀這些 | 不要先讀 |
|---|---|---|
| 一般小修／問進度 | **本文件即可** | 一切長文 |
| B3 手機 UI（階段 7 等） | `b3-mobile-ui-plan.md` **文首＋§4.9**；該階段正文；對應落地筆記（如新聞→§4.21） | 整份計畫、舊階段筆記 |
| 改 QR／relay／手機建置 | 計畫書 **只讀 §4.20** | §4.10–4.18 |
| 查「以前為什麼這樣做／已知坑」 | `progress-log.md` **Grep 關鍵字** | 整份 log |
| 實作某桌面／資料規格 | `DesktopST-Spec.md` **對應章節** | 整本 Spec |
| 提案跨平台／散布／同步架構 | roadmap **§2、§8**（必要時 §4.5–4.7） | 整份 roadmap、§10 舊順序敘事 |
| 對照舊 mobile.html 功能清單（歷史） | `mobile-html-feature-inventory.md` **§6／§7** | 整份 inventory |
| Lorebook 規格 | `future-lorebook.md` | — |
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
npm run dev:mobile   # 手機 HMR（搭配 stub 或 real-test bat）
npm run build:mobile # 產出 out/mobile（含 inline，給 QR／relay）
```

授權：作者自訂條款 → https://nori.tw/DeST/license.html（repo 內 `docs/license.html`）。
