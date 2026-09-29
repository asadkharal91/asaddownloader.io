@echo off
REM ============================================================
REM  Asad Downloader Bridge - Build EXE (Windows)
REM  Produces dist\AsadDownloaderBridge.exe via PyInstaller.
REM
REM  Requirements:
REM    - Python 3.10+ with pip
REM    - run:  pip install pyinstaller yt-dlp
REM    - FFmpeg (recommended): place ffmpeg.exe next to
REM      this file. It is bundled into the one-file EXE so users
REM      do not need a separate FFmpeg installation.
REM ============================================================
title Asad Downloader Bridge - Build
cd /d "%~dp0"
setlocal

set FFMPEG_PATH=%~dp0ffmpeg.exe

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python was not found.
    pause
    exit /b 1
)

python -m pip install --upgrade pyinstaller yt-dlp

set ADD_BIN=
if exist "%FFMPEG_PATH%" (
    echo Bundling FFmpeg: %FFMPEG_PATH%
    set ADD_BIN=--add-binary "%FFMPEG_PATH%;."
) else (
    echo [WARN] ffmpeg.exe not found next to build.bat - building without bundled FFmpeg.
    echo        Users will need FFmpeg on PATH. See README.md.
)

python -m PyInstaller ^
    --noconfirm ^
    --clean ^
    --onefile ^
    --console ^
    --name AsadDownloaderBridge ^
    %ADD_BIN% ^
    --collect-all yt_dlp ^
    bridge.py

if %errorlevel% neq 0 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Built: %~dp0dist\AsadDownloaderBridge.exe
echo  Publish it as a GitHub Release asset so the website's
echo  "Download Local Engine" button can point at it.
echo ============================================================
pause
