# Windows' built-in text recognition (Windows.Media.Ocr) for Lin Brain: photos, screenshots and scanned PDF pages.
# Usage: powershell -File ocr.ps1 <list of image paths, one per line> <output.json>. Runs offline.
param([string]$ListPath, [string]$OutPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($operation, [Type]$type) { $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation)); $null = $task.Wait(-1); $task.Result }
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$results = New-Object System.Collections.ArrayList
foreach ($line in Get-Content -LiteralPath $ListPath -Encoding UTF8) {
  $path = [string]$line  # a plain string: Get-Content lines carry extra properties that would leak into the JSON
  if (-not $path) { continue }
  try {
    if (-not $engine) { throw 'Windows text recognition is not available for your language.' }
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
      $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
      if ($decoder.PixelWidth -gt $max -or $decoder.PixelHeight -gt $max) {
        $scale = [Math]::Min($max / $decoder.PixelWidth, $max / $decoder.PixelHeight)
        $transform = New-Object Windows.Graphics.Imaging.BitmapTransform
        $transform.ScaledWidth = [uint32]($decoder.PixelWidth * $scale); $transform.ScaledHeight = [uint32]($decoder.PixelHeight * $scale)
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied, $transform, [Windows.Graphics.Imaging.ExifOrientationMode]::RespectExifOrientation, [Windows.Graphics.Imaging.ColorManagementMode]::DoNotColorManage)) ([Windows.Graphics.Imaging.SoftwareBitmap])
      } else {
        $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
      }
      $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      [void]$results.Add(@{ path = $path; text = (($result.Lines | ForEach-Object { $_.Text }) -join "`n") })
    } finally { $stream.Dispose() }
  } catch { [void]$results.Add(@{ path = $path; error = $_.Exception.Message }) }
}
ConvertTo-Json -InputObject @($results) -Depth 3 | Set-Content -LiteralPath $OutPath -Encoding UTF8
