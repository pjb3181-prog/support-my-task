$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$path = Join-Path $PSScriptRoot "launcher.ico"
$bmp = [System.Drawing.Bitmap]::new(256, 256)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)
$rect = [System.Drawing.Rectangle]::new(10, 10, 236, 236)
$round = [System.Drawing.Drawing2D.GraphicsPath]::new()
$radius = 50
$round.AddArc($rect.Left, $rect.Top, $radius, $radius, 180, 90)
$round.AddArc($rect.Right-$radius, $rect.Top, $radius, $radius, 270, 90)
$round.AddArc($rect.Right-$radius, $rect.Bottom-$radius, $radius, $radius, 0, 90)
$round.AddArc($rect.Left, $rect.Bottom-$radius, $radius, $radius, 90, 90)
$round.CloseFigure()
$gradient = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
  $rect,
  [System.Drawing.Color]::FromArgb(42, 79, 145),
  [System.Drawing.Color]::FromArgb(114, 68, 170),
  45
)
$g.FillPath($gradient, $round)
$font = [System.Drawing.Font]::new("Segoe UI", 148, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$format = [System.Drawing.StringFormat]::new()
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center
$g.DrawString("R", $font, [System.Drawing.Brushes]::White,
  [System.Drawing.RectangleF]::new(18, 6, 220, 237), $format)
$ms = [System.IO.MemoryStream]::new()
$bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$img = $ms.ToArray()
# ICO container holding a single, standards-compliant PNG-encoded 256x256 image.
$fs = [System.IO.File]::Create($path)
$w = [System.IO.BinaryWriter]::new($fs)
$w.Write([uint16]0)
$w.Write([uint16]1)
$w.Write([uint16]1)
$w.Write([byte]0)
$w.Write([byte]0)
$w.Write([byte]0)
$w.Write([byte]0)
$w.Write([uint16]1)
$w.Write([uint16]32)
$w.Write([uint32]$img.Length)
$w.Write([uint32]22)
$w.Write($img)
$w.Dispose()
$ms.Dispose()
$font.Dispose()
$format.Dispose()
$gradient.Dispose()
$round.Dispose()
$g.Dispose()
$bmp.Dispose()
Write-Host "Created $path"
