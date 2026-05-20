# DesktopST（DeST / 桌友）

> Windows 桌面 AI 角色扮演寵物程式

![DesktopST 桌友 - 桌面 AI 角色寵物](assets/git_Repo_Banner.png)

讓 AI 角色以桌面寵物的形式常駐在你的螢幕上，點一下就能聊天，支援多角色群組對話，相容 SillyTavern 角色卡格式。

---

## 特色功能

- **桌面寵物形式**：角色圖片浮在桌面上，不佔工作視窗，隨時點擊呼叫輸入框
- **多角色同時存在**：可放多個角色在桌面上，支援角色之間的群組對話
- **情緒表情系統**：支援最多 28 種情緒圖，AI 回應時自動切換對應表情
- **SillyTavern 相容**：可匯入 SillyTavern PNG 格式角色卡
- **多 LLM 供應商**：支援 OpenAI、Gemini（Google）、Claude（Anthropic）、Grok（xAI），可自訂 endpoint
- **便利貼系統**：桌面上可貼多張浮動便利貼，支援拖曳、調整大小、顏色
- **定時提醒**：排程角色主動發話（每天固定時間、開機後、間隔計時等）
- **對話管理**：對話記錄可命名、瀏覽、刪除，支援自動摘要
- **API Key 加密**：以 Windows DPAPI 加密儲存，不以純文字存放
- **Persona / 世界觀預設**：可建立多組使用者 Persona 與世界觀設定，一鍵切換

---

## 系統需求

- **作業系統**：Windows 10 / 11（64 位元）
- **API Key**：需自備 OpenAI、Gemini、Claude 或 Grok 其中一家的 API Key
  - 第一次測試建議使用 **Gemini**（有免費額度）
  - 申請方式請見 [docs/api-key-guide.html](docs/api-key-guide.html)

---

## 下載與使用

前往 [Releases](../../releases) 頁面下載最新版安裝檔（`.exe`），安裝後即可執行。

初次使用說明請見 [docs/getting-started.html](docs/getting-started.html)。

---

## 開發者快速開始

```bash
# 安裝相依套件
npm install

# 開發模式（熱重載）
npm run dev

# 型別檢查
npm run typecheck

# 打包成安裝檔
npm run build
```

### 技術棧

| 項目 | 選用 |
|---|---|
| 桌面框架 | Electron |
| 前端 | React + TypeScript |
| 樣式 | Tailwind CSS |
| 狀態管理 | Zustand |
| 打包 | electron-builder |

詳細架構與規格請見 [DesktopST-Spec.md](DesktopST-Spec.md)。

---

## 授權

本專案採**作者自訂條款**（非 MIT／非標準 CC）。

重點摘要：
- 原始碼可閱讀、研究與修改
- 免費再散布衍生版本無需事先徵詢（需標示來源、不得使用相同名稱／Logo）
- **禁止**未經授權以原封不動或極小變動方式作為商品販售
- 直播、贊助、廣告分潤、付費 plugin（不含官方素材）等均允許

完整條款：**[https://nori.tw/DeST/license.html](https://nori.tw/DeST/license.html)**（離線版：[docs/license.html](docs/license.html)）

---

## 作者

**Nori** · [nori.tw](https://nori.tw) · starryseaweed@gmail.com
