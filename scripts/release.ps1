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
$pkg = Get-Content "package.json" -Raw | ConvertFrom-Json
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

# ══════════════════════════════════════════════════════════════
#  [1/5] 檢查 git 狀態
# ══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[1/5] 檢查 git 狀態..." -ForegroundColor Cyan
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
#  [2/5] 升版號
# ══════════════════════════════════════════════════════════════
Write-Host ""
if ($doVersionBump) {
    Write-Host "[2/5] 升級版本號至 v$newVersion..." -ForegroundColor Cyan
    if ($bumpType) {
        npm version $bumpType --no-git-tag-version | Out-Null
    } else {
        npm version $newVersion --no-git-tag-version | Out-Null
    }
    $pkgNew = Get-Content "package.json" -Raw | ConvertFrom-Json
    Write-Host "      package.json 已更新：v$($pkgNew.version)" -ForegroundColor Green
} else {
    Write-Host "[2/5] 略過版本升級。" -ForegroundColor Gray
}

# ══════════════════════════════════════════════════════════════
#  [3/5] 打包
# ══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[3/5] 執行打包（這需要一點時間...）" -ForegroundColor Cyan
Write-Host ""
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "打包失敗！請查看上方錯誤訊息。" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    exit 1
}

$pkgFinal = Get-Content "package.json" -Raw | ConvertFrom-Json
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
#  [4/5] 建立免安裝版 zip（win-unpacked 全體）
# ══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[4/5] 建立免安裝版 zip..." -ForegroundColor Cyan

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
#  [5/5] Git commit + tag + push + GitHub Release
# ══════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "[5/5] Git 推送與 GitHub Release..." -ForegroundColor Cyan

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
        git add package.json package-lock.json
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
