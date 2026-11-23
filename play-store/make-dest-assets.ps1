Add-Type -AssemblyName System.Drawing
$root = 'D:\DesktopST'
$out = Join-Path $root 'play-store\dest'
$shotOut = Join-Path $out 'screenshots'
New-Item -ItemType Directory -Force $shotOut | Out-Null

function New-G($bmp) {
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode = 'HighQuality'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  return $g
}

# 1. 截圖：裁掉狀態列（上 140px）與導覽列（2300 以下），1080x2424 -> 1080x2160
$shots = 'mobile-chat-light','mobile-chat-dark-trpg','mobile-group-presence','mobile-emotion-edit','mobile-scene-list','mobile-reminder','mobile-news-list','widget-home'
$i = 1
foreach ($n in $shots) {
  $src = New-Object System.Drawing.Bitmap (Join-Path $root "docs\ScreenShot\$n.png")
  $dst = New-Object System.Drawing.Bitmap 1080, 2160
  $g = New-G $dst
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0,0,1080,2160), (New-Object System.Drawing.Rectangle 0,140,1080,2160), 'Pixel')
  $g.Dispose()
  $dst.Save((Join-Path $shotOut ("{0:D2}-{1}.png" -f $i, $n)), [System.Drawing.Imaging.ImageFormat]::Png)
  $dst.Dispose(); $src.Dispose(); $i++
}

# 2. 圖示：白底（與手機桌面圖示同底色），角色縮到 88% 置中，避免 Play 的圓角遮罩切到對話框
$char = New-Object System.Drawing.Bitmap (Join-Path $root 'assets\AppIcon-android.png')
$icon = New-Object System.Drawing.Bitmap 512, 512, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = New-G $icon
$g.Clear([System.Drawing.Color]::White)
$s = [int](512 * 0.9); $o = [int]((512 - $s) / 2)
$g.DrawImage($char, $o, 512 - $s, $s, $s)
$g.Dispose()
$icon.Save((Join-Path $out 'icon-512.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$icon.Dispose()

# 3. 主圖 1024x500：薄荷→天藍漸層，左文字、右角色
$fg = New-Object System.Drawing.Bitmap 1024, 500
$g = New-G $fg
$rect = New-Object System.Drawing.Rectangle 0,0,1024,500
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.ColorTranslator]::FromHtml('#DDFBD6')), ([System.Drawing.ColorTranslator]::FromHtml('#C8F1FB')), 20
$g.FillRectangle($grad, $rect)
# 柔和的圓形裝飾
$deco = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(110, 255, 255, 255))
$g.FillEllipse($deco, 600, -60, 520, 520)
$g.FillEllipse($deco, -120, 330, 300, 300)
# 角色
$g.DrawImage($char, 592, 70, 430, 430)
# 文字
$text = [System.Drawing.ColorTranslator]::FromHtml('#3D5A52')
$strong = [System.Drawing.ColorTranslator]::FromHtml('#267668')
$fTitle = New-Object System.Drawing.Font 'Segoe UI', 96, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fSub = New-Object System.Drawing.Font 'Microsoft JhengHei', 44, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$fTag = New-Object System.Drawing.Font 'Microsoft JhengHei', 26, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$g.DrawString('DeST', $fTitle, (New-Object System.Drawing.SolidBrush $strong), 64, 110)
$g.DrawString('AI 角色聊天與日常夥伴', $fSub, (New-Object System.Drawing.SolidBrush $text), 70, 240)
# 標籤膠囊
$tags = '相容角色卡','角色提醒','天氣','新聞'
$x = 72
$pill = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(200, 255, 255, 255))
foreach ($t in $tags) {
  $w = [int]$g.MeasureString($t, $fTag).Width + 28
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $h = 46; $y = 330; $r = $h
  $path.AddArc($x, $y, $r, $r, 90, 180); $path.AddArc($x + $w - $r, $y, $r, $r, 270, 180); $path.CloseFigure()
  $g.FillPath($pill, $path)
  $g.DrawString($t, $fTag, (New-Object System.Drawing.SolidBrush $text), $x + 14, $y + 7)
  $x += $w + 12
}
$g.Dispose()
$fg.Save((Join-Path $out 'feature-graphic-1024x500.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$fg.Dispose(); $char.Dispose()

Get-ChildItem -Recurse $out -File | ForEach-Object { $img = [System.Drawing.Image]::FromFile($_.FullName); '{0}  {1}x{2}  {3}KB' -f $_.FullName.Substring($out.Length + 1), $img.Width, $img.Height, [int]($_.Length / 1KB); $img.Dispose() }
