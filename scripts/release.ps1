# DesktopST 一鍵包版腳本
# 用法：雙擊 release.bat，或在專案根目錄執行 .\scripts\release.ps1
# 需要 GitHub CLI（gh）才能自動建立 Release：winget install --id GitHub.cli

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'

# 強制 PS 5.1 以 UTF-8 解碼外部命令（git log 等）的輸出
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding          = [System.Text.Encoding]::UTF8

$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectRoot

trap {
    Write-Host ""
    Write-Host "發生錯誤：$($_.Exception.Message)" -ForegroundColor Red
    Write-Host $_.ScriptStackTrace -ForegroundColor DarkGray
    Read-Host "按 Enter 結束"
    exit 1
}

# ══════════════════════════════════════════════════════════════
#  讀取目前版本
# ══════════════════════════════════════════════════════════════
# ⚠️ 讀 package.json 一定要指定 -Encoding UTF8。
# PS 5.1 的 Get-Content 預設用系統 ANSI 碼頁（zh-TW 是 cp950）讀無 BOM 的檔，
# package.json 裡的中文（description／usageNotice）是 UTF-8，decode 會失敗；
# 更糟的是無效位元組會連同後面那個 `"` 一起被吃掉，於是字串沒有結尾引號、
# ConvertFrom-Json 報「必須有 ':' 或 '}'」——錯誤訊息完全指不到真正的原因。
# 症狀只在 release.bat（走 powershell 5.1）出現；在 pwsh 7 裡直接跑不會中，
# 因為 PS 7 預設就是 UTF-8。
$pkg = Get-Content "package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$currentVersion = $pkg.version

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  DesktopST 包版工具" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  目前版本：v$currentVersion" -ForegroundColor Yellow
Write-Host ""

# ── 選擇版本升級方式 ───────────────────────────────────────
Write-Host "請選擇版本升級方式：" -ForegroundColor White
Write-Host "  [1] patch  — 小修正  (0.1.0 → 0.1.1)"
Write-Host "  [2] minor  — 新功能  (0.1.0 → 0.2.0)"
Write-Host "  [3] major  — 大改版  (0.1.0 → 1.0.0)"
Write-Host "  [4] 自訂版本號"
Write-Host "  [5] 不改版本，直接打包"
Write-Host ""
$choice = Read-Host "請輸入選項 (1-5)"

$newVersion = $currentVersion
$doVersionBump = $true

switch ($choice) {
    "1" { $bumpType = "patch" }
    "2" { $bumpType = "minor" }
    "3" { $bumpType = "major" }
    "4" {
        $bumpType = $null
        $customVer = Read-Host "請輸入新版本號（例如：0.3.0）"
        $newVersion = $customVer.TrimStart('v')
    }
    "5" {
        $doVersionBump = $false
        $bumpType = $null
        Write-Host ""
        Write-Host "跳過版本升級，使用目前版本 v$currentVersion 直接打包。" -ForegroundColor Gray
    }
    default {
        Write-Host "無效的選項，結束。" -ForegroundColor Red
        exit 1
    }
}

# ── 預估新版本號 ───────────────────────────────────────────
if ($doVersionBump -and $bumpType) {
    $parts = $currentVersion -split '\.'
    $major = [int]$parts[0]; $minor = [int]$parts[1]; $patch = [int]$parts[2]
    switch ($bumpType) {
        "patch" { $patch++ }
        "minor" { $minor++; $patch = 0 }
        "major" { $major++; $minor = 0; $patch = 0 }
    }
    $newVersion = "$major.$minor.$patch"
}

if ($doVersionBump) {
    Write-Host ""
    Write-Host "  新版本：v$currentVersion  →  v$newVersion" -ForegroundColor Green
    Write-Host ""
    $confirm = Read-Host "確認開始打包？(y/N)"
    if ($confirm -notmatch '^[Yy]$') {
        Write-Host "已取消。" -ForegroundColor Gray
        exit 0
    }
}

# ── 手機 APK 要不要一起打 ──────────────────────────────────
# 先問完所有問題再開始跑，中間就不用顧著看螢幕（桌面 build 本身要好幾分鐘）。
Write-Host ""
Write-Host "要不要一併打包手機 APK 並附到 Release？" -ForegroundColor White
Write-Host "  有 android\keystore.properties 就輸出正式簽章版（可覆蓋更新舊版），否則是 debug 版。" -ForegroundColor Gray
Write-Host "  兩者都需要允許「未知來源」，也都無法上架商店。" -ForegroundColor Gray
Write-Host "  會多花約 1 分鐘（gradle）。" -ForegroundColor Gray
$apkChoice = Read-Host "打包 APK？(y/N)"
$buildApk = $apkChoice -match '^[Yy]$'

# ══════════════════════════════════════════════════════════════
#  [1/6] 檢查 git 狀態
# ══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[1/6] 檢查 git 狀態..." -ForegroundColor Cyan
$gitStatus = git status --porcelain 2>&1
$modified = $gitStatus | Where-Object { $_ -match '^\s?[MADRU]' }
if ($modified) {
    Write-Host ""
    Write-Host "警告：有未提交的修改：" -ForegroundColor Yellow
    $modified | ForEach-Object { Write-Host "  $_" -ForegroundColor Gray }
    Write-Host ""
    $cont = Read-Host "仍要繼續打包？(y/N)"
    if ($cont -notmatch '^[Yy]$') {
        Write-Host "已取消。請先提交修改再打包。" -ForegroundColor Gray
        exit 0
    }
}
Write-Host "      OK" -ForegroundColor Green

# ── 收集 commit log（上次 release tag → 現在）──────────────
$prevTag = git describe --tags --abbrev=0 HEAD 2>&1
if ($LASTEXITCODE -ne 0 -or -not "$prevTag".Trim()) {
    $rawLog = git log --pretty=format:"- %s" --no-merges 2>&1
} else {
    $rawLog = git log "$prevTag..HEAD" --pretty=format:"- %s" --no-merges 2>&1
}
$changelogLines = @($rawLog | Where-Object { $_ -notmatch '^- release: v' -and $_.Trim() -ne '' })

# ══════════════════════════════════════════════════════════════
#  [2/6] 升版號
# ══════════════════════════════════════════════════════════════
Write-Host ""
if ($doVersionBump) {
    Write-Host "[2/6] 升級版本號至 v$newVersion..." -ForegroundColor Cyan
    if ($bumpType) {
        npm version $bumpType --no-git-tag-version | Out-Null
    } else {
        npm version $newVersion --no-git-tag-version | Out-Null
    }
    $pkgNew = Get-Content "package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
    Write-Host "      package.json 已更新：v$($pkgNew.version)" -ForegroundColor Green
} else {
    Write-Host "[2/6] 略過版本升級。" -ForegroundColor Gray
}

# ══════════════════════════════════════════════════════════════
#  偵測 TRPG 擴充包是否有更新
# ══════════════════════════════════════════════════════════════
$dstpackPath    = "assets\DesktopST_TRPGPack.dstpack"
$dstpackHashFile = "assets\DesktopST_TRPGPack.dstpack.sha256"
$dstpackUpdated  = $false
$dstpackHash     = ''

Write-Host ""
if (Test-Path $dstpackPath) {
    $dstpackHash = (Get-FileHash $dstpackPath -Algorithm SHA256).Hash.ToLower()
    $storedHash  = if (Test-Path $dstpackHashFile) { (Get-Content $dstpackHashFile -Raw).Trim().ToLower() } else { '' }

    if ($dstpackHash -ne $storedHash) {
        $sizeMB = [math]::Round((Get-Item $dstpackPath).Length / 1MB, 1)
        Write-Host "  TRPG 擴充包已更新（$sizeMB MB），將一併上傳至 Release。" -ForegroundColor Green
        $dstpackUpdated = $true
    } else {
        Write-Host "  TRPG 擴充包未變更，略過上傳。" -ForegroundColor Gray
    }
} else {
    Write-Host "  未找到 TRPG 擴充包，略過上傳。" -ForegroundColor Gray
}

# ══════════════════════════════════════════════════════════════
#  [3/6] 打包
# ══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[3/6] 執行打包（這需要一點時間...）" -ForegroundColor Cyan
Write-Host ""
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "打包失敗！請查看上方錯誤訊息。" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    exit 1
}

$pkgFinal = Get-Content "package.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = $pkgFinal.version
$exeName = "DesktopST $ver.exe"
$exePath  = "dist\$exeName"

if (-not (Test-Path $exePath)) {
    Write-Host "找不到安裝檔：$exePath" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    exit 1
}
$exeSizeMB = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
Write-Host ""
Write-Host "      安裝檔：$exePath ($exeSizeMB MB)" -ForegroundColor Yellow

# ══════════════════════════════════════════════════════════════
#  [4/6] 建立免安裝版 zip（win-unpacked 全體）
# ══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[4/6] 建立免安裝版 zip..." -ForegroundColor Cyan

$zipPath = $null
$unpackedDir = "dist\win-unpacked"

if (-not (Test-Path $unpackedDir)) {
    Write-Host "      找不到 win-unpacked，略過 zip 建立。" -ForegroundColor Yellow
} else {
    $zipName = "DesktopST-v$ver-full.zip"
    $zipPath = "dist\$zipName"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    Write-Host "      壓縮中（約需 30 秒）..." -ForegroundColor Gray
    Compress-Archive -Path "$unpackedDir\*" -DestinationPath $zipPath -CompressionLevel Optimal

    $zipSizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
    Write-Host "      免安裝版：$zipPath ($zipSizeMB MB)" -ForegroundColor Yellow
}

# ══════════════════════════════════════════════════════════════
#  [5/6] 手機 APK（可選）
# ══════════════════════════════════════════════════════════════
#  2026-08-24：有 android/keystore.properties 就自動改打正式簽章版
#  （scripts/build-mobile-apk-release.mjs），沒有就照舊打 debug 版。
#  這個判斷只影響「打哪一種」，不會自動幫你決定「要不要發」——
#  keystore 不在，這裡就跟以前一樣印出 debug 版，不會擋住整個流程。
# ══════════════════════════════════════════════════════════════
Write-Host ""
$apkRelease = $null
$apkLatest = $null
$apkIsSigned = $false
if (-not $buildApk) {
    Write-Host "[5/6] 略過手機 APK。" -ForegroundColor Gray
} else {
    $hasKeystore = Test-Path "android\keystore.properties"
    if ($hasKeystore) {
        Write-Host "[5/6] 打包手機 APK（找到 keystore，將輸出正式簽章版）..." -ForegroundColor Cyan
        node scripts\build-mobile-apk-release.mjs
    } else {
        Write-Host "[5/6] 打包手機 APK（找不到 android\keystore.properties，輸出 debug 版）..." -ForegroundColor Cyan
        Write-Host "      正式簽章設定：docs\pre-b3-work-assessment.md §9" -ForegroundColor Gray
        node scripts\build-mobile-apk.mjs
    }
    if ($LASTEXITCODE -ne 0) {
        # APK 失敗不該讓桌面版跟著陪葬 —— 桌面安裝檔這時已經好了
        Write-Host ""
        Write-Host "      APK 打包失敗，桌面版不受影響。" -ForegroundColor Yellow
        $cont = Read-Host "      繼續發布（不含 APK）？(Y/n)"
        if ($cont -match '^[Nn]$') {
            Write-Host "已中止。" -ForegroundColor Gray
            Read-Host "按 Enter 結束"; exit 1
        }
    } else {
        if ($hasKeystore) {
            $apkSrc = "out\apk\DeST-v$ver-release.apk"
            $apkIsSigned = $true
        } else {
            $apkSrc = "out\apk\DeST-debug.apk"
        }
        if (Test-Path $apkSrc) {
            # 檔名帶版本號與簽章類型，Release 附件列表才看得出是哪一種
            $apkSuffix = if ($apkIsSigned) { "release" } else { "debug" }
            $apkRelease = "dist\DeST-v$ver-$apkSuffix.apk"
            Copy-Item $apkSrc $apkRelease -Force
            $apkSizeMB = [math]::Round((Get-Item $apkRelease).Length / 1MB, 1)
            Write-Host "      APK：$apkRelease ($apkSizeMB MB)" -ForegroundColor Yellow

            # ⚠️ 正式簽章版還要再傳一份「檔名固定不變」的副本。
            # docs\mobile.html 的下載鈕直連
            #   releases/latest/download/DeST-latest.apk
            # 那個網址是對「最新的 release」解析的，所以只要有一版沒附這個檔名，
            # 官網那顆按鈕就會 404 —— 而且是發布之後才壞，很難當場發現。
            # debug 版刻意不傳：讓官網直連拿到 debug 簽章的話，已裝正式版的人
            # 會變成無法覆蓋安裝。
            if ($apkIsSigned) {
                $apkLatestSrc = "out\apk\DeST-latest.apk"
                if (Test-Path $apkLatestSrc) {
                    $apkLatest = "dist\DeST-latest.apk"
                    Copy-Item $apkLatestSrc $apkLatest -Force
                    Write-Host "      APK（官網直連用的固定檔名）：$apkLatest" -ForegroundColor Yellow
                } else {
                    Write-Host "      找不到 $apkLatestSrc，官網的『直接下載最新 APK』會 404。" -ForegroundColor Red
                }
            }
        } else {
            Write-Host "      打包回報成功但找不到 $apkSrc，略過附件。" -ForegroundColor Yellow
        }
    }
}

# ══════════════════════════════════════════════════════════════
#  [6/6] Git commit + tag + push + GitHub Release
# ══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[6/6] Git 推送與 GitHub Release..." -ForegroundColor Cyan

# 決定是否推送
$shouldPush = $false
if ($doVersionBump) {
    # 版本號有改 → 自動推送（不詢問）
    $shouldPush = $true
    Write-Host "      版本已升級，將自動推送至 git 與建立 Release。" -ForegroundColor Green
} else {
    # 版本號未改 → 詢問用戶
    Write-Host "      版本號未改變，是否推送至 git 與建立 Release？" -ForegroundColor Yellow
    $pushChoice = Read-Host "推送？(y/N)"
    if ($pushChoice -match '^[Yy]$') {
        $shouldPush = $true
    }
}

if (-not $shouldPush) {
    Write-Host "      略過推送。" -ForegroundColor Gray
} else {
    # git commit + tag + push（僅在版本號改變時）
    if ($doVersionBump) {
        # 若擴充包有更新，先把新 hash 寫入追蹤檔，一起納入 release commit
        if ($dstpackUpdated) {
            [System.IO.File]::WriteAllText(
                (Resolve-Path $dstpackHashFile),
                "$dstpackHash`n",
                (New-Object System.Text.UTF8Encoding $false)
            )
        }

        $filesToAdd = @("package.json", "package-lock.json")
        if ($dstpackUpdated) { $filesToAdd += $dstpackHashFile }
        git add @filesToAdd
        git commit -m "release: v$ver"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "      git commit 失敗，請手動處理。" -ForegroundColor Red
            Read-Host "按 Enter 結束"; exit 1
        }
        git tag "v$ver"
        git push origin main
        if ($LASTEXITCODE -ne 0) {
            Write-Host "      git push main 失敗，請手動處理。" -ForegroundColor Red
            Read-Host "按 Enter 結束"; exit 1
        }
        git push origin "v$ver"
        if ($LASTEXITCODE -ne 0) {
            Write-Host "      git push tag 失敗，請手動處理。" -ForegroundColor Red
            Read-Host "按 Enter 結束"; exit 1
        }
        Write-Host "      Git push 完成，tag v$ver 已建立。" -ForegroundColor Green
    }

    # 建立上傳檔案清單
    $uploadFiles = @($exePath)
    if ($zipPath -and (Test-Path $zipPath)) { $uploadFiles += $zipPath }
    if ($apkRelease -and (Test-Path $apkRelease)) { $uploadFiles += $apkRelease }
    if ($apkLatest -and (Test-Path $apkLatest)) { $uploadFiles += $apkLatest }
    if ($dstpackUpdated) { $uploadFiles += $dstpackPath }

    # 檢查 gh 是否安裝
    $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
    if (-not $ghCmd) {
        Write-Host ""
        Write-Host "      未找到 gh 指令，無法自動建立 Release。" -ForegroundColor Yellow
        Write-Host "      請先安裝 GitHub CLI：" -ForegroundColor White
        Write-Host "        winget install --id GitHub.cli" -ForegroundColor Gray
        Write-Host "      安裝後執行 gh auth login 完成授權，下次即可全自動。" -ForegroundColor Gray
        Write-Host ""
        Write-Host "      手動建立 Release：" -ForegroundColor Cyan
        Write-Host "        https://github.com/noritw/DesktopST/releases/new?tag=v$ver" -ForegroundColor White
        foreach ($f in $uploadFiles) {
            Write-Host "        上傳：$f" -ForegroundColor White
        }
    } else {
        Write-Host ""
        Write-Host "      建立 GitHub Release v$ver..." -ForegroundColor Cyan

        # 寫 Release notes 到暫存檔
        $notesFile = [System.IO.Path]::GetTempFileName()
        $notesLines = @()
        if ($changelogLines.Count -gt 0) {
            $notesLines += "## 更新內容"
            $notesLines += ""
            $notesLines += $changelogLines
            $notesLines += ""
        }
        $notesLines += @(
            "## 下載（擇一即可）",
            "",
            "- **EXE版**：``DesktopST $ver.exe``（檔案較小，執行時才自動解壓縮所需檔案）",
            "- **ZIP版**（開啟速度較快）：``DesktopST-v$ver-full.zip``（解壓縮後直接執行 ``DesktopST.exe``）"
        )
        if ($apkRelease -and (Test-Path $apkRelease)) {
            if ($apkIsSigned) {
                $notesLines += @(
                    "",
                    "## Android",
                    "",
                    "- ``DeST-v$ver-release.apk``　—　正式簽章版，可以直接覆蓋安裝更新舊版。",
                    "  安裝時系統仍會提示「未知來源」（因為不是從 Play 商店下載），這是正常的，跟簽章無關。",
                    "  可獨立使用，也可以掃電腦上的 QR 把角色與設定帶過去。"
                )
            } else {
                $notesLines += @(
                    "",
                    "## Android（測試版）",
                    "",
                    "- ``DeST-v$ver-debug.apk``　—　debug 簽章，安裝時需允許「未知來源」。",
                    "  ⚠️ debug 簽章之後換成正式簽章時無法直接覆蓋更新，屆時需要先解除安裝（會清空資料）。",
                    "  可獨立使用，也可以掃電腦上的 QR 把角色與設定帶過去。"
                )
            }
        }
        # Set-Content -Encoding UTF8 在 PS 5.1 會加 BOM，gh 傳給 GitHub 後中文亂碼
        # 改用 .NET 直接寫 UTF-8 無 BOM
        [System.IO.File]::WriteAllText($notesFile, ($notesLines -join "`n"), (New-Object System.Text.UTF8Encoding $false))

        # 呼叫 gh release create
        $ghArgs = @("release", "create", "v$ver", "--title", "v$ver", "--notes-file", $notesFile) + $uploadFiles
        & gh @ghArgs
        $ghExit = $LASTEXITCODE

        Remove-Item $notesFile -Force -ErrorAction SilentlyContinue

        if ($ghExit -eq 0) {
            Write-Host ""
            Write-Host "      GitHub Release 建立完成！" -ForegroundColor Green
            Write-Host "      https://github.com/noritw/DesktopST/releases/tag/v$ver" -ForegroundColor Cyan
        } else {
            Write-Host "      Release 建立失敗（exit $ghExit），請手動處理。" -ForegroundColor Red
            Write-Host "      https://github.com/noritw/DesktopST/releases/new?tag=v$ver" -ForegroundColor White
        }
    }
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  完成！" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "按 Enter 結束"
