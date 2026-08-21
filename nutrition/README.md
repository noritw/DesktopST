# DeST 飲食記錄

B9a 的獨立 App 骨架。桌面與手機各自有入口、產物與原生 project，不使用 DeST 的 `android/` 或資料目錄。

## Desktop

```powershell
npm run dev:nutrition:desktop
npm run build:nutrition:desktop
```

The portable Windows build is written to `nutrition/desktop/dist`.

## Android

USB 偵錯已開啟、手機已接上時，直接雙擊根目錄的 `NutritionAPK.bat`，或執行：

```powershell
npm run build:nutrition:apk
```

它會自動建置、同步、安裝更新版 APK，最後啟動飲食 App。

```powershell
npm run build:nutrition:mobile
npm run sync:nutrition:android
```

To build a debug APK, use a Java 21 JDK. The Android Studio JBR on this machine is Java 25 and is not compatible with the current Gradle setup:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.8-hotspot'
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location nutrition/mobile/android
.\gradlew.bat assembleDebug
```

The debug APK is written under `nutrition/mobile/android/app/build/outputs/apk/debug`.
