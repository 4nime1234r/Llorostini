$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

python -m pip install --quiet --upgrade -r requirements.txt pyinstaller

$ffmpegDir = Join-Path $PSScriptRoot "build\ffmpeg"
$ffmpeg = Get-ChildItem $ffmpegDir -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ffmpeg) {
    Write-Host "Descargando ffmpeg..."
    New-Item -ItemType Directory -Force $ffmpegDir | Out-Null
    $zip = Join-Path $ffmpegDir "ffmpeg.zip"
    Invoke-WebRequest "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $zip
    Expand-Archive $zip -DestinationPath $ffmpegDir -Force
    Remove-Item $zip
    $ffmpeg = Get-ChildItem $ffmpegDir -Recurse -Filter ffmpeg.exe | Select-Object -First 1
}

python -m PyInstaller --noconfirm --clean --onedir `
    --name llorostini-backend `
    --distpath build\backend `
    --workpath build\pyinstaller `
    --collect-submodules yt_dlp `
    --specpath build `
    --paths "$PSScriptRoot\python" `
    --exclude-module tkinter `
    --add-binary "$($ffmpeg.FullName);." `
    "$PSScriptRoot\python\backend.py"
if ($LASTEXITCODE -ne 0) { throw "PyInstaller fallo" }

npm ci
if ($LASTEXITCODE -ne 0) { throw "npm ci fallo" }
node node_modules/electron/install.js
npm run dist
if ($LASTEXITCODE -ne 0) { throw "electron-builder fallo" }

Write-Host "Listo: $(Join-Path $PSScriptRoot 'dist\LLorostini.exe')"
