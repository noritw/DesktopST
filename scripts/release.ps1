# DesktopST 一鍵包版腳本
# 用法：雙擊 release.bat，或在專案根目錄執行 .\scripts\release.ps1

Set-StrictMode -Off
$ErrorActionPreference = 'Stop'

# ══════════════════════════════════════════════════════════════
#  設定區（第一次用請修改這裡）
# ══════════════════════════════════════════════════════════════
$DropboxPath = "C:\Users\nori9\Dropbox\AI\DesktopST\Build"   # ← 改成你的 Dropbox 路徑
# ══════════════════════════════════════════════════════════════

$ProjectRoot = Split-Path $PSScriptRoot -Parent
Set-Location $ProjectRoot

# ── 讀取目前版本 ───────────────────────────────────────────
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

# ── [1/5] 檢查 git 狀態 ────────────────────────────────────
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

# ── [2/5] 升版號 ───────────────────────────────────────────
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

# ── [3/5] 打包 ─────────────────────────────────────────────
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
    Write-Host "找不到打包輸出：$exePath" -ForegroundColor Red
    Read-Host "按 Enter 結束"
    exit 1
}
$sizeMB = [math]::Round((Get-Item $exePath).Length / 1MB, 1)
Write-Host ""
Write-Host "      $exePath ($sizeMB MB)" -ForegroundColor Yellow

# ── [4/5] 壓縮成 zip ───────────────────────────────────────
Write-Host ""
Write-Host "[4/5] 壓縮成 zip..." -ForegroundColor Cyan

$zipName = "DesktopST-v$ver-portable.zip"
$zipPath = "dist\$zipName"

# 清掉舊的同名 zip
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# 建立暫存資料夾，複製要打包的檔案
$tmpDir = "dist\_zip_tmp"
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
New-Item -ItemType Directory -Path $tmpDir | Out-Null

Copy-Item $exePath "$tmpDir\$exeName"
if (Test-Path "docs") {
    Copy-Item "docs" "$tmpDir\docs" -Recurse
}

Compress-Archive -Path "$tmpDir\*" -DestinationPath $zipPath -CompressionLevel Optimal
Remove-Item $tmpDir -Recurse -Force

$zipSizeMB = [math]::Round((Get-Item $zipPath).Length / 1MB, 1)
Write-Host "      $zipPath ($zipSizeMB MB)" -ForegroundColor Yellow

# ── 複製到 Dropbox ─────────────────────────────────────────
if ($DropboxPath -and (Test-Path (Split-Path $DropboxPath -Parent))) {
    if (-not (Test-Path $DropboxPath)) {
        New-Item -ItemType Directory -Path $DropboxPath | Out-Null
    }
    $destZip = Join-Path $DropboxPath $zipName
    Copy-Item $zipPath $destZip -Force
    Write-Host "      已複製到 Dropbox：$destZip" -ForegroundColor Green
} elseif ($DropboxPath) {
    Write-Host "      警告：Dropbox 路徑不存在，略過複製。($DropboxPath)" -ForegroundColor Yellow
    Write-Host "      請確認 release.ps1 頂端的 `$DropboxPath 設定是否正確。" -ForegroundColor Gray
}

# ── [5/5] Git commit + tag + push ─────────────────────────
Write-Host ""
Write-Host "[5/5] Git 推送" -ForegroundColor Cyan
if ($doVersionBump) {
    $pushChoice = Read-Host "要推送到 GitHub 嗎？(git commit + tag + push) (y/N)"
    if ($pushChoice -match '^[Yy]$') {
        git add package.json package-lock.json
        git commit -m "release: v$ver"
        git tag "v$ver"
        git push origin main
        git push origin "v$ver"
        Write-Host ""
        Write-Host "      已推送！tag v$ver 已建立在 GitHub。" -ForegroundColor Green
        Write-Host ""
        Write-Host "      前往 GitHub 上傳 Release：" -ForegroundColor Cyan
        Write-Host "      https://github.com/noritw/DesktopST/releases/new?tag=v$ver" -ForegroundColor White
        Write-Host "      上傳檔案：$zipPath" -ForegroundColor White
    } else {
        Write-Host "      略過 git push。" -ForegroundColor Gray
    }
} else {
    Write-Host "      （未升版，略過 git push）" -ForegroundColor Gray
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "  完成！" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Read-Host "按 Enter 結束"
