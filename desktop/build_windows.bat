@echo off
rem Builds dist-desktop\MarsMap.exe on Windows. Needs Python 3.10+ (python.org, "Add to PATH").
rem Node.js is optional: without it the prebuilt website in the dist folder is used.
setlocal
cd /d "%~dp0.."

where py >nul 2>nul
if errorlevel 1 (
  echo Python was not found. Install Python 3.12 from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  exit /b 1
)
if not exist .venv-desktop py -3 -m venv .venv-desktop
call .venv-desktop\Scripts\activate.bat
python -m pip install --upgrade pip
python -m pip install -r requirements.txt -r desktop\requirements.txt
if errorlevel 1 exit /b 1

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js not found: using the prebuilt website in the dist folder.
) else (
  call npm ci
  if errorlevel 1 exit /b 1
  call npm run build
  if errorlevel 1 exit /b 1
)

pyinstaller --noconfirm --distpath dist-desktop --workpath build-desktop desktop\MarsMap.spec
if errorlevel 1 exit /b 1
set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if exist "%ISCC%" (
  "%ISCC%" desktop\installer.iss
  if errorlevel 1 exit /b 1
  echo Installer: %cd%\dist-desktop\MarsMap-Setup.exe
) else (
  echo Inno Setup 6 not found: skipping the installer. Get it from https://jrsoftware.org/isdl.php
)
echo.
echo Done: %cd%\dist-desktop\MarsMap.exe
endlocal
