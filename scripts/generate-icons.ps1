# Generates TinyNote app icons from a source image (JPG/PNG), no external deps (System.Drawing).
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/generate-icons.ps1 -Source <image path>
# Outputs to public/: pwa-192x192.png / pwa-512x512.png (rounded 22%),
#                     pwa-maskable-512.png / apple-touch-icon.png (full-bleed, OS masks itself).
param(
  [Parameter(Mandatory = $true)][string]$Source
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile($Source)
try {
  $outDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\public'))
  $targets = @(
    @{ Name = 'pwa-192x192.png';     Size = 192; Radius = 0.22; Zoom = 1.0 },
    @{ Name = 'pwa-512x512.png';     Size = 512; Radius = 0.22; Zoom = 1.0 },
    @{ Name = 'pwa-maskable-512.png'; Size = 512; Radius = 0;    Zoom = 1.1 },
    @{ Name = 'apple-touch-icon.png'; Size = 180; Radius = 0;    Zoom = 1.0 }
  )

  foreach ($t in $targets) {
    $size = [int]$t.Size

    # 1) cover-crop 缩放到正方形临时位图（zoom>1 时中心裁切放大）
    $tmp = New-Object System.Drawing.Bitmap($size, $size)
    $tg = [System.Drawing.Graphics]::FromImage($tmp)
    $tg.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $tg.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $side = [Math]::Min($src.Width, $src.Height) / [double]$t.Zoom
    $sx = ($src.Width - $side) / 2.0
    $sy = ($src.Height - $side) / 2.0
    $dest = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $tg.DrawImage($src, $dest, [float]$sx, [float]$sy, [float]$side, [float]$side, [System.Drawing.GraphicsUnit]::Pixel)
    $tg.Dispose()

    # 2) 圆角：TextureBrush + FillPath（抗锯齿边缘）；全出血直接落图
    $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($out)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $radius = [int]($size * [double]$t.Radius)
    if ($radius -gt 0) {
      $g.Clear([System.Drawing.Color]::Transparent)
      $path = New-Object System.Drawing.Drawing2D.GraphicsPath
      $d = 2 * $radius
      $path.AddArc(0, 0, $d, $d, 180, 90)
      $path.AddArc($size - $d, 0, $d, $d, 270, 90)
      $path.AddArc($size - $d, $size - $d, $d, $d, 0, 90)
      $path.AddArc(0, $size - $d, $d, $d, 90, 90)
      $path.CloseFigure()
      $brush = New-Object System.Drawing.TextureBrush($tmp)
      $brush.WrapMode = [System.Drawing.Drawing2D.WrapMode]::Clamp
      $g.FillPath($brush, $path)
      $brush.Dispose()
      $path.Dispose()
    } else {
      $g.DrawImageUnscaled($tmp, 0, 0)
    }
    $g.Dispose()

    $outPath = Join-Path $outDir $t.Name
    $out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
    $tmp.Dispose()
    Write-Output ("{0}  ({1}x{1}, radius {2}%, zoom {3})" -f $t.Name, $size, ([int](100 * $t.Radius)), $t.Zoom)
  }
} finally {
  $src.Dispose()
}
