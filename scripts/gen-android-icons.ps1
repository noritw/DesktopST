<#
.SYNOPSIS
    從一張來源圖產生 DeST Android App 的全部啟動器圖示資源。

.DESCRIPTION
    Android 的 adaptive icon 有兩個會讓人踩坑的規則，這支腳本把它們一次處理掉：

    1. 圓形遮罩只露出畫布中央 66.6%。方形構圖、內容佔滿的角色圖直接放進去，
       四角和下襬會被圓弧吃掉（DeST 就踩過：胸口深色衣服被裁掉，只剩白色領口，
       看起來像「中央變白」）。所以預設把角色縮到畫布的 55%。

    2. 桌布主題化（單色圖示）是啟動器自己從彩色圖生成的，做法是「取暗部」——
       原圖越暗越實心，越亮越透明。實測門檻約在亮度 0.15～0.25 之間。
       白色區域必定是透明的，這點無解。

    亮度公式 = (0.299R + 0.587G + 0.114B) / 255
    注意藍色權重只有 0.114、綠色高達 0.587，所以壓低 R/G、保留 B
    就能做出「看起來鮮豔、亮度卻很低」的顏色（例如 #0B0DDA 亮度只有 0.14）。

.PARAMETER Source
    來源圖（正方形 PNG，建議 1024x1024，去背）。預設 assets\AppIcon-android.png

.PARAMETER Scale
    角色在畫布中佔的比例。預設 0.55。調大角色變大但容易被圓弧裁到，
    調小則圖示看起來比別的 App 小。

.PARAMETER Preview
    只產生預覽圖，不寫入 android 專案。用來在打包前先確認構圖與單色效果。

.PARAMETER PreviewOut
    預覽圖輸出路徑。預設 icon-preview.png

.PARAMETER Analyze
    列出圖中各主要色塊的亮度，並標示在單色版會不會實心。改色前先跑這個。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\gen-android-icons.ps1 -Analyze
    先看看目前各部位的亮度落在哪一區。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\gen-android-icons.ps1 -Preview
    產生 icon-preview.png，確認構圖沒被裁、單色版該實心的地方有實心。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts\gen-android-icons.ps1
    正式寫入 android\app\src\main\res 底下五種密度的資源。
#>
param(
    [string]$Source = "assets\AppIcon-android.png",
    [double]$Scale = 0.55,
    [switch]$Preview,
    [string]$PreviewOut = "icon-preview.png",
    [switch]$Analyze
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

# 專案根目錄 = 這支腳本的上一層
$root = Split-Path -Parent $PSScriptRoot
if (-not [System.IO.Path]::IsPathRooted($Source)) { $Source = Join-Path $root $Source }
if (-not [System.IO.Path]::IsPathRooted($PreviewOut)) { $PreviewOut = Join-Path $root $PreviewOut }
$resDir = Join-Path $root "android\app\src\main\res"

if (-not (Test-Path $Source)) {
    Write-Error "找不到來源圖：$Source"
    exit 1
}

# 單色版門檻（實測值，見檔頭說明）
$SOLID_BELOW = 0.15   # 亮度低於此 -> 實心
$EMPTY_ABOVE = 0.25   # 亮度高於此 -> 空心
# 圓形遮罩佔畫布的比例（Android adaptive icon 規格）
$MASK = 0.666
$LEGACY_SCALE = 0.80  # 舊式方形圖示（API 25 以下才會用到）

$src = New-Object System.Drawing.Bitmap $Source
$W = $src.Width
$H = $src.Height
if ($W -ne $H) {
    Write-Warning "來源圖不是正方形（${W}x${H}），圖示可能變形。建議裁成正方形。"
}

Write-Host ""
Write-Host "來源圖：$Source  (${W}x${H})"
Write-Host "縮放  ：$([int]($Scale*100))%  的畫布（圓形遮罩露出 $([int]($MASK*100))%）"
Write-Host ""

# ---- 把整張圖的像素讀進來，後面重複用 ----
$rect = New-Object System.Drawing.Rectangle 0, 0, $W, $H
$data = $src.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$stride = $data.Stride
$byteCount = $stride * $H
$px = New-Object byte[] $byteCount
[System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $px, 0, $byteCount)
$src.UnlockBits($data)

function Get-Luminance([int]$r, [int]$g, [int]$b) {
    return (0.299 * $r + 0.587 * $g + 0.114 * $b) / 255.0
}

# 模擬啟動器的單色化：取暗部，白色填充（alpha 帶形狀）
function Get-MonoAlpha([double]$lum, [int]$srcAlpha) {
    $v = ($EMPTY_ABOVE - $lum) / ($EMPTY_ABOVE - $SOLID_BELOW)
    if ($v -lt 0) { $v = 0 }
    if ($v -gt 1) { $v = 1 }
    return [byte][Math]::Round(255 * $v * ($srcAlpha / 255.0))
}

# ============================ -Analyze ============================
if ($Analyze) {
    Write-Host "各色塊亮度分析（只統計不透明的像素）"
    Write-Host ("-" * 62)

    $buckets = @{}
    for ($i = 0; $i -lt 10; $i++) { $buckets[$i] = 0 }
    $total = 0
    for ($y = 0; $y -lt $H; $y += 2) {
        for ($x = 0; $x -lt $W; $x += 2) {
            $i = $y * $stride + $x * 4
            if ($px[$i + 3] -lt 200) { continue }
            $lum = Get-Luminance $px[$i + 2] $px[$i + 1] $px[$i]
            $bi = [int][Math]::Floor($lum * 10)
            if ($bi -gt 9) { $bi = 9 }
            $buckets[$bi]++
            $total++
        }
    }
    Write-Host ""
    Write-Host "亮度分布："
    for ($i = 0; $i -lt 10; $i++) {
        $lo = $i / 10.0
        $hi = ($i + 1) / 10.0
        $n = $buckets[$i]
        if ($n -eq 0) { continue }
        $pct = 100.0 * $n / $total
        if ($hi -le $SOLID_BELOW) { $verdict = "實心" }
        elseif ($lo -ge $EMPTY_ABOVE) { $verdict = "空心" }
        else { $verdict = "過渡帶" }
        $bar = "#" * [int]($pct / 2)
        Write-Host ("  {0:0.0}-{1:0.0}  {2,6:0.0}%  {3,-7} {4}" -f $lo, $hi, $pct, $verdict, $bar)
    }
    Write-Host ""
    Write-Host "門檻：亮度 <= $SOLID_BELOW 實心；>= $EMPTY_ABOVE 空心。"
    Write-Host "想讓某個顏色在單色版變實心，就把它的亮度壓到 $SOLID_BELOW 以下。"
    Write-Host "壓的時候優先砍 R 和 G（權重 0.299 / 0.587），藍色可以留著（權重僅 0.114）。"
    Write-Host ""
    $src.Dispose()
    exit 0
}

# ---- 產生單色母圖（白色填充 + alpha 帶形狀）----
$mono = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$mdata = $mono.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$mpx = New-Object byte[] $byteCount
for ($i = 0; $i -lt $byteCount; $i += 4) {
    $lum = Get-Luminance $px[$i + 2] $px[$i + 1] $px[$i]
    $mpx[$i] = 255
    $mpx[$i + 1] = 255
    $mpx[$i + 2] = 255
    $mpx[$i + 3] = Get-MonoAlpha $lum $px[$i + 3]
}
[System.Runtime.InteropServices.Marshal]::Copy($mpx, 0, $mdata.Scan0, $byteCount)
$mono.UnlockBits($mdata)

# 把來源圖依比例置中畫到指定尺寸的畫布上
function New-Tile {
    param(
        [System.Drawing.Image]$Image,
        [int]$Canvas,
        [double]$Ratio,
        [bool]$WhitePlate,
        [bool]$ClipCircle
    )
    $inner = [int][Math]::Round($Canvas * $Ratio)
    $off = [int][Math]::Round(($Canvas - $inner) / 2.0)
    $bmp = New-Object System.Drawing.Bitmap($Canvas, $Canvas, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.Clear([System.Drawing.Color]::Transparent)
    if ($ClipCircle) {
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddEllipse(0, 0, $Canvas, $Canvas)
        $g.SetClip($path)
        $path.Dispose()
    }
    if ($WhitePlate) { $g.Clear([System.Drawing.Color]::White) }
    $g.DrawImage($Image, $off, $off, $inner, $inner)
    $g.Dispose()
    return $bmp
}

# ============================ -Preview ============================
if ($Preview) {
    $C = 432
    $maskD = [int]($C * $MASK)
    $maskOff = [int](($C - $maskD) / 2)

    $tiles = @()
    foreach ($mode in @("colour", "mono")) {
        if ($mode -eq "colour") { $art = $src } else { $art = $mono }
        $inner = [int][Math]::Round($C * $Scale)
        $off = [int][Math]::Round(($C - $inner) / 2.0)
        $t = New-Object System.Drawing.Bitmap($C, $C)
        $g = [System.Drawing.Graphics]::FromImage($t)
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.Clear([System.Drawing.Color]::FromArgb(255, 228, 228, 232))
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddEllipse($maskOff, $maskOff, $maskD, $maskD)
        $g.SetClip($path)
        if ($mode -eq "colour") {
            $g.Clear([System.Drawing.Color]::White)
            $g.DrawImage($art, $off, $off, $inner, $inner)
        }
        else {
            # 模擬主題化：淺色底盤 + 主題色圖案
            $g.Clear([System.Drawing.Color]::FromArgb(255, 247, 228, 206))
            $tinted = New-Object System.Drawing.Bitmap($W, $H, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $td = $tinted.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
            $tp = New-Object byte[] $byteCount
            for ($i = 0; $i -lt $byteCount; $i += 4) {
                $tp[$i] = 58
                $tp[$i + 1] = 74
                $tp[$i + 2] = 140
                $tp[$i + 3] = $mpx[$i + 3]
            }
            [System.Runtime.InteropServices.Marshal]::Copy($tp, 0, $td.Scan0, $byteCount)
            $tinted.UnlockBits($td)
            $g.DrawImage($tinted, $off, $off, $inner, $inner)
            $tinted.Dispose()
        }
        $path.Dispose()
        $g.Dispose()
        $tiles += $t
    }

    $out = New-Object System.Drawing.Bitmap(($C * 2 + 30), ($C + 46))
    $go = [System.Drawing.Graphics]::FromImage($out)
    $go.Clear([System.Drawing.Color]::FromArgb(255, 245, 245, 247))
    $font = New-Object System.Drawing.Font("Segoe UI", 15, [System.Drawing.FontStyle]::Bold)
    $brush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::Black)
    $go.DrawString("彩色（含圓形遮罩）", $font, $brush, 8, 10)
    $go.DrawString("單色（模擬主題化）", $font, $brush, ($C + 38), 10)
    $go.DrawImage($tiles[0], 0, 42, $C, $C)
    $go.DrawImage($tiles[1], ($C + 30), 42, $C, $C)
    $go.Dispose(); $font.Dispose(); $brush.Dispose()
    $out.Save($PreviewOut, [System.Drawing.Imaging.ImageFormat]::Png)
    foreach ($t in $tiles) { $t.Dispose() }
    $out.Dispose()

    Write-Host "預覽已輸出：$PreviewOut"
    Write-Host ""
    Write-Host "檢查重點："
    Write-Host "  - 角色有沒有被圓弧裁到（尤其下襬）。被裁就把 -Scale 調小。"
    Write-Host "  - 單色版該實心的地方有沒有實心。沒有就把該處顏色的亮度壓到 $SOLID_BELOW 以下。"
    Write-Host ""
    $mono.Dispose(); $src.Dispose()
    exit 0
}

# ============================ 正式產生資源 ============================
if (-not (Test-Path $resDir)) {
    Write-Error "找不到 android 資源目錄：$resDir"
    exit 1
}

$densities = @(
    @{ name = "mdpi";    adaptive = 108; legacy = 48 },
    @{ name = "hdpi";    adaptive = 162; legacy = 72 },
    @{ name = "xhdpi";   adaptive = 216; legacy = 96 },
    @{ name = "xxhdpi";  adaptive = 324; legacy = 144 },
    @{ name = "xxxhdpi"; adaptive = 432; legacy = 192 }
)

foreach ($d in $densities) {
    $dir = Join-Path $resDir ("mipmap-" + $d.name)
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    $A = [int]$d.adaptive
    $L = [int]$d.legacy

    # adaptive 前景（內縮已烘進圖片，XML 不再用 <inset>）
    $fg = New-Tile -Image $src -Canvas $A -Ratio $Scale -WhitePlate $false -ClipCircle $false
    $fg.Save((Join-Path $dir "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $fg.Dispose()

    # adaptive 單色層（系統多半會自己重算，這裡備著讓兩種路徑結果一致）
    $mo = New-Tile -Image $mono -Canvas $A -Ratio $Scale -WhitePlate $false -ClipCircle $false
    $mo.Save((Join-Path $dir "ic_launcher_monochrome.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $mo.Dispose()

    # adaptive 背景：整片白，不能留透明否則圓形邊緣會透出桌布
    $bg = New-Object System.Drawing.Bitmap($A, $A, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $gb = [System.Drawing.Graphics]::FromImage($bg)
    $gb.Clear([System.Drawing.Color]::White)
    $gb.Dispose()
    $bg.Save((Join-Path $dir "ic_launcher_background.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $bg.Dispose()

    # 舊式方形／圓形圖示（API 25 以下）
    $lg = New-Tile -Image $src -Canvas $L -Ratio $LEGACY_SCALE -WhitePlate $true -ClipCircle $false
    $lg.Save((Join-Path $dir "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $lg.Dispose()

    $rd = New-Tile -Image $src -Canvas $L -Ratio $LEGACY_SCALE -WhitePlate $true -ClipCircle $true
    $rd.Save((Join-Path $dir "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $rd.Dispose()

    [System.GC]::Collect()
    Write-Host ("  mipmap-{0,-8} adaptive={1,3}px  legacy={2,3}px" -f $d.name, $A, $L)
}

# adaptive icon 的 XML。內縮已經烘進圖片，所以這裡不用 <inset>——
# 實測 android:inset="16.7%" 會被編成 0.167%，等於沒有內縮。
$xml = @'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
'@
$anyDir = Join-Path $resDir "mipmap-anydpi-v26"
if (-not (Test-Path $anyDir)) { New-Item -ItemType Directory -Path $anyDir | Out-Null }
[System.IO.File]::WriteAllText((Join-Path $anyDir "ic_launcher.xml"), $xml, (New-Object System.Text.UTF8Encoding $false))
[System.IO.File]::WriteAllText((Join-Path $anyDir "ic_launcher_round.xml"), $xml, (New-Object System.Text.UTF8Encoding $false))

$mono.Dispose()
$src.Dispose()

Write-Host ""
Write-Host "完成。接下來："
Write-Host "  1. 打包：MobileST.bat -> [4]（正式簽章）或 [1]（debug）"
Write-Host "  2. 裝到手機後，圖示快取很頑固——建議「解除安裝再重裝」，換版號和重開機都推不動它。"
Write-Host "  3. 主題化有 10-25 秒的轉場動畫，剛拉上桌面是彩色的，等它轉完再看。"
Write-Host ""
