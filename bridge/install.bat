@echo off
REM ============================================================
REM  Asad Downloader Bridge - Installer (Windows)
REM  Installs Python dependencies (yt-dlp) for the local bridge.
REM ============================================================
title Asad Downloader Bridge - Install

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Python was not found.
    echo Please install Python 3.10 or newer from https://www.python.org/downloads/
    echo IMPORTANT: tick "Add python.exe to PATH" during installation.
    echo.
    pause
    exit /b 1
)

echo.
echo Installing bridge dependencies...
python -m pip install --upgrade pip
python -m pip install -r "%~dp0requirements.txt"
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo  Done! Now start the bridge with run.bat
echo  Then open https://asadkharal91.github.io/asaddownloader.io/
echo ============================================================
echo.
pause
