# DesktopST（DeST / 桌友）

> Windows 桌面 AI 角色扮演寵物程式 ＋ Android 手機獨立版（開發中）

![DesktopST 桌友 - 桌面 AI 角色寵物](assets/git_Repo_Banner.png)

讓 AI 角色以桌面寵物的形式常駐在你的螢幕上，點一下就能聊天，支援多角色群組對話，相容 SillyTavern 角色卡格式。另有 Android 手機獨立版，可不依賴電腦直接在手機上聊天。

---

## 平台

| 平台 | 狀態 | 說明 |
|---|---|---|
| **Windows 桌面版** | ✅ 穩定發布 | Electron；角色浮在桌面、點擊輸入 |
| **Android 手機版** | 🔧 開發中 | 不依賴電腦的獨立版；APK 尚未正式發布 |

---

## 桌面版特色功能

- **桌面寵物形式**：角色圖片浮在桌面上，不佔工作視窗，隨時點擊呼叫輸入框
- **多角色同時存在**：可放多個角色在桌面上，支援角色之間的群組對話
- **情緒表情系統**：支援最多 28 種情緒圖，AI 回應時自動切換對應表情
- **SillyTavern 相容**：可匯入 SillyTavern PNG 格式角色卡
- **多 LLM 供應商**：支援 OpenAI、Gemini（Google）、Claude（Anthropic）、Grok（xAI），可自訂 endpoint
- **天氣感知對話**：設定所在地點後，角色會參考即時天氣資訊進行互動
- **Spotify 音樂感知**：連接 Spotify 帳號後，角色會參考目前播放的曲目、藝術家與曲風進行互動
- **新聞陪聊**：可選模組；依興趣關鍵字／RSS 等來源讓角色聊時事（可停用）
- **個人新聞報**：獨立視窗批次瀏覽新聞、換一批與釘選，再一鍵跟角色聊這則
- **擲骰系統**：支援 D&D 風格骰子（1dN、修正值、keep highest / lowest），適合桌遊或 TRPG
- **圖片附件 / 截圖**：可附上圖片讓角色看圖回應，也能截取目前螢幕傳送
- **便利貼系統**：桌面上可貼多張浮動便利貼，支援拖曳、調整大小、顏色
- **定時提醒**：排程角色主動發話（每天固定時間、開機後、間隔計時等）
- **對話管理**：對話記錄可命名、瀏覽、刪除，支援自動摘要
- **API Key 加密**：以 Windows DPAPI 加密儲存，不以純文字存放
- **Persona / 世界觀預設**：可建立多組使用者 Persona 與世界觀設定，一鍵切換
- **Lorebook 用語解說**：建立專有名詞解說本，讓角色理解你世界裡的特定設定

---

## Android 手機版特色

> 手機版目前為開發中版本，APK 尚未正式對外發布。

- **完全獨立運作**：不需要連接電腦，直接在手機上與角色聊天
- **無須付費訂閱**：使用自己的 API Key，費用直接與 AI 供應商往來
- **資料留在裝置上**：角色卡、設定、對話記錄全存在手機本地
- **S1 資料匯入**：掃描 QR 一次從桌面電腦拉入角色卡、設定組、API Key 及對話記錄
- **天氣感知對話**：GPS 定位或 IP 定位，自動帶入即時天氣資訊
- **Lorebook 用語解說編輯**：可在手機上直接建立與管理用語解說本
- **擲骰系統**：與桌面版相同的 D&D 風格骰子，TRPG 玩家同樣可用
- **主題配色**：多組主題（春夏粉彩、森林、復古、賽博、黑白等）
- **多 LLM 供應商**：支援 OpenAI、Gemini、Claude、Grok，可自訂 endpoint

手機版尚未實作的功能：定時提醒（開發中）、新聞陪聊、Spotify 音樂感知、日曆整合。

---

## 系統需求

### 桌面版
- **作業系統**：Windows 10 / 11（64 位元）
- **API Key**：需自備 OpenAI、Gemini、Claude 或 Grok 其中一家的 API Key
  - 申請方式請見 <a href="https://nori.tw/DeST/api-key-guide.html" target="_blank" rel="noopener noreferrer">docs/api-key-guide.html</a>

### Android 手機版
- **作業系統**：Android 7.0 以上
- **API Key**：需自備 OpenAI、Gemini、Claude 或 Grok 其中一家的 API Key

---

## 下載與使用

### 桌面版
前往 [Releases](../../releases) 頁面下載最新版執行檔（`.exe`），下載後即可直接執行。

初次使用說明請見 <a href="https://nori.tw/DeST/getting-started.html" target="_blank" rel="noopener noreferrer">docs/getting-started.html</a>。

### Android 手機版
手機版 APK 尚未正式對外發布，開發進度請關注本 repo。

---

## 擴充包（選用）

### TRPG 擴充包

專為單人桌遊 / TRPG 玩家設計的角色包，可搭配內建擲骰系統（D&D 風格骰子）使用。桌面版與手機版皆可匯入。

內含：
- **GM**：說書人與規則引導者，負責描述場景、推進劇情、裁定規則
- **星離宸（冒險者版）**、**琉緋璃（冒險者版）**：改編自主線角色的冒險版同伴
- 預設好的 TRPG 用 Persona 與世界觀設定

桌面版：在程式設定 → 資料分頁匯入 `.dstpack` 檔案即可。  
手機版：透過 S1 資料匯入從電腦一次拉入，或直接在手機的設定 → 資料匯入。

[⬇ 下載 TRPG 擴充包](https://github.com/noritw/DesktopST/releases/download/trpg-pack/DesktopST_TRPGPack.dstpack)

---

## 開發者快速開始

```bash
# 安裝相依套件
npm install

# 桌面開發模式（熱重載）
npm run dev

# 手機 UI 即時預覽
npm run dev:mobile

# 型別檢查
npm run typecheck

# 執行核心測試
npm test

# 打包桌面版
npm run build

# 打包手機版（產出 out/mobile/）
npm run build:mobile
```

### 技術棧

| 項目 | 選用 |
|---|---|
| 桌面框架 | Electron |
| 手機框架 | Capacitor（Android） |
| 前端 | React + TypeScript |
| 樣式 | Tailwind CSS |
| 狀態管理 | Zustand |
| 打包 | electron-builder（桌面）/ Gradle（Android） |

詳細架構與規格請見 [DesktopST-Spec.md](DesktopST-Spec.md)。

---

## 授權

本專案採**作者自訂條款**（非 MIT／非標準 CC）。

重點摘要：
- 原始碼可閱讀、研究與修改
- 免費再散布衍生版本無需事先徵詢（需標示來源、不得使用相同名稱／Logo）
- **禁止**未經授權以原封不動或極小變動方式作為商品販售
- 直播、贊助、廣告分潤、付費 plugin（不含官方素材）等均允許

完整條款：**<a href="https://nori.tw/DeST/license.html" target="_blank" rel="noopener noreferrer">https://nori.tw/DeST/license.html</a>**（離線版：[docs/license.html](docs/license.html)）

---

## 作者

**Nori** · <a href="https://nori.tw" target="_blank" rel="noopener noreferrer">nori.tw</a> · starryseaweed@gmail.com
