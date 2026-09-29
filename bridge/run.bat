@echo off
REM ============================================================
REM  Asad Downloader Bridge - Run (Windows)
REM  Starts the local download engine on http://127.0.0.1:8765
REM  Keep this window open while using the website downloader.
REM ============================================================
title Asad Downloader Bridge
cd /d "%~dp0"

where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Python was not found. Run install.bat first.
    pause
    exit /b 1
)

python bridge.py
if %errorlevel% neq 0 (
    echo.
    echo The bridge stopped with an error. See message above.
    pause
)
