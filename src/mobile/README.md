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

## 這份是哪一次建置的

設定頁最底有版本、建置時間與 git 短雜湊（`buildInfo.ts`，值由
`vite.mobile.config.ts` 的 `define` 注入）。

**判斷「手機更新了沒」要看建置時間**，版本號沒有用 —— debug APK 重打十次都還是同一版。
遙控模式顯示的是**電腦那份 bundle** 的建置時間，時間戳舊代表電腦該重跑 `build:mobile`。

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

> ⚠️ **瀏覽器煙測時請用測試用 API Key。** 沒有 Android Keystore，
> `initCapacitorSecrets()` 會退回 `unavailableSecrets`，金鑰以**明文**落在
> Filesystem 的 web 後備（IndexedDB）。設定頁的 API Key 欄位底下會出現提示。

### 怎麼有角色可聊

1. **匯入**（已接通）：☰ → 角色庫 → 匯入  
   - 桌面匯出的 **PNG 角色卡**／**JSON**／**.dstpack** 都行  
   - 匯入後會自動加入在場，可直接聊天  
2. **新建**：角色庫 → 新增，填名字與人設  
3. **預設包**：本機有 `assets/DesktopST_DefaultChara.dstpack` 時，`npm run build:mobile` 後 APK／產物會帶種子；純 `dev:mobile` 通常沒有這包，空庫只會生一張空白「新角色」

然後：☰ → 設定 → 填 API Key → 回聊天列送一則。

掃 QR／一般 `?server=` 仍是遙控（看的是電腦那份資料）。

## W3：打 debug APK

```bash
npm run build:mobile          # 一定要先建置，cap 同步的是 out/mobile
npx cap sync android
cd android && ./gradlew.bat assembleDebug
```

產物：`android/app/build/outputs/apk/debug/app-debug.apk`（約 19 MB）。

**兩個一定會踩的坑**

1. **`JAVA_HOME` 不能指向 Android Studio 的 jbr。** 本機那顆是 **JDK 25**，
   Gradle 8.14 只支援到 Java 24，會炸 `Unsupported class file major version 69`。
   跑之前先在該次 shell 覆蓋成 JDK 21：
   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot"
   ```
2. **Capacitor 外掛必須放 `dependencies`，不能放 `devDependencies`。**
   `cap sync` 只掃 `dependencies`；放錯的話 `capacitor.settings.gradle` 不會註冊
   Filesystem／SecureStorage，APK 裝起來但**儲存與金鑰全滅**，而且不會有編譯錯誤。
   目前正確時 sync 會印 `Found 4 Capacitor plugins for android`。

## 加新的 Capacitor 外掛時

除了上面第 2 點，還有兩件事會安靜地咬人：

1. **權限不見得會自動合併。** `@capacitor/geolocation` 的 AndroidManifest 是**空的**，
   `ACCESS_COARSE_LOCATION` 得自己寫進 `android/app/src/main/AndroidManifest.xml`。
   漏了的話 `requestPermissions()` 直接被系統拒絕，畫面上只會看到「定位失敗」。
   只索取真正需要的精度 —— 天氣是縣市級的，`FINE` 會讓 Android 多跳一層
   「精確／大概」讓使用者猶豫。

   ⚠️ **`/android/` 整個被 .gitignore，手改的 manifest 進不了版控**，
   `npx cap add android` 一跑就沒了。所以 `scripts/prepare-android.mjs`
   每次 `sync:android` 都會檢查補上（`REQUIRED_PERMISSIONS`）——
   **要加新權限請改那份清單**，不要只改 manifest。
2. **用動態 `import()` 載外掛，不要靜態 import。** 手機 UI 也跑在瀏覽器
   （`dev:mobile` 煙測）與 vitest 裡，那些環境沒有原生 plugin；
   靜態 import 會讓整個模組在載入時就炸，連退回方案都走不到。
   範例：`src/mobile/runtime/weather.ts` 的 `loadGeolocation()`。

## 尚未做
- 新聞／提醒完整本機實作、角色卡 export
- S2 雙向同步（S1 單向匯入與「從電腦重新拉設定」已完成）
- 簽章 keystore（不要自行產生）

## 原生層（提醒鬧鐘）

`android/` 整包是 `npx cap add android` 的產生物，**但底下有手寫的原始碼**：

```
android/app/src/main/java/tw/nori/dest/
  MainActivity.java              註冊 ReminderPlugin（要在 super.onCreate 之前）
  reminder/ReminderPlugin.java   Capacitor 介面
  reminder/ReminderScheduler.java   AlarmManager 註冊／取消
  reminder/ReminderAlarmStore.java  SharedPreferences 落地（開機重註冊靠它）
  reminder/ReminderAlarmReceiver.java  到點；判螢幕、發通知
  reminder/ReminderBootReceiver.java   BOOT_COMPLETED／MY_PACKAGE_REPLACED
  reminder/ReminderNotifier.java       通知頻道與發送
android/app/src/main/AndroidManifest.xml   receiver 與權限
```

這幾個檔案 **有進版控**（`.gitignore` 逐層 un-ignore，其餘 android/ 仍忽略）。

⚠️ **`npx cap add android` 會覆寫 `MainActivity.java` 與 `AndroidManifest.xml`。**
重建原生樹之後記得 `git checkout android/` 把手寫的部分救回來，
否則提醒鬧鐘會安靜地失效（編得過、就是不會響）。

分工原則見 `docs/mobile-standalone-reminder-plan.md` §2.1：
**原生只負責喚醒與發通知，prompt 組裝與「該不該響」的判定都在 TS。**
