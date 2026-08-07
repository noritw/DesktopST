# `src/mobile/` — 手機獨立版（Capacitor）

> 狀態：**W1 adapters ＋ W2 獨立啟動已接線**；正式 debug APK 打包仍待 W3。
> 規劃見 `docs/multi-device-platform-roadmap.md` §4.2 / §4.5 / §11。

## 這一層是什麼

`src/core/` 的平台外殼，對應 `src/main/`（Electron 那一側）。

```
src/core/     純 TypeScript，業務邏輯只有這一份
src/main/     Electron adapter  ← 已有
src/mobile/   Capacitor adapter ＋ LocalDataSource ＋ runtime ← 這裡
```

**業務邏輯不寫在這裡。** 這層只負責把平台 API 包成 `core/adapters/` 的介面形狀，
以及把獨立模式的讀寫／精簡聊天編排接到 `LocalDataSource`。

## 模式

| 進入 | 模式 | 怎麼進 |
|---|---|---|
| 掃 QR／`dev:mobile`＋`?server=` | 遙控 | 永遠 |
| APK 冷啟 | **獨立** | `Capacitor.isNativePlatform()` |
| 瀏覽器強制獨立（煙測） | 獨立 | `?mode=standalone` |
| APK 對桌面除錯 | 遙控 | `?mode=remote` 或 `?server=` |

Header 左側狀態列會標：`本機`／`電腦 · 區網`／`電腦 · 中繼`／`電腦`。

## Adapters

| 介面 | 套件 | 備註 |
|---|---|---|
| Storage | `@capacitor/filesystem` | 不實作 SyncStorageAdapter |
| Secret | `@aparajita/capacitor-secure-storage` ＋ `@noble/ciphers` | 先 `initCapacitorSecrets()` |
| Http | 全域 fetch（`CapacitorHttp` 已開） | `supportsStreaming: false` |
| Scheduler／Notifier | stub | B5 再換 |

## 獨立啟動流程（W2）

1. `resolveConnection` → standalone  
2. `initCapacitorSecrets()`  
3. `bootStandaloneSession(capacitorAdapters)`：讀 settings、種 preset／預設角色、開對話  
4. `LocalDataSource` ＋ `LocalEventSource` → `attach`

預設角色：建置時若本機有 `assets/DesktopST_DefaultChara.dstpack`，
`build:mobile` 會抄進 `out/mobile/`；沒有則建一張空白卡。

## 瀏覽器煙測獨立模式（W3 前）

```bash
npm run dev:mobile
# 開 http://localhost:5180/?mode=standalone
```

確認 header 左側是 **「本機」**（不是「電腦」）。

### 怎麼有角色可聊

1. **匯入**（已接通）：☰ → 角色庫 → 匯入  
   - 桌面匯出的 **PNG 角色卡**／**JSON**／**.dstpack** 都行  
   - 匯入後會自動加入在場，可直接聊天  
2. **新建**：角色庫 → 新增，填名字與人設  
3. **預設包**：本機有 `assets/DesktopST_DefaultChara.dstpack` 時，`npm run build:mobile` 後 APK／產物會帶種子；純 `dev:mobile` 通常沒有這包，空庫只會生一張空白「新角色」

然後：☰ → 設定 → 填 API Key → 回聊天列送一則。

掃 QR／一般 `?server=` 仍是遙控（看的是電腦那份資料）。

## 尚未做

- **W3**：`npx cap add android` → sync → Gradle debug（`JAVA_HOME`＝JDK 21）
- 新聞／提醒完整本機實作、角色卡 import／export、情境 apply
- S1／S2 與電腦同步
- 簽章 keystore（不要自行產生）
