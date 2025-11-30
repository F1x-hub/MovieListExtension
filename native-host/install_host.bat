@echo off
setlocal

echo Installing Native Messaging Host for Movie List Extension...

:: Define variables
set "HOST_NAME=com.movielist.updater"
set "HOST_MANIFEST=%~dp0com.movielist.updater.json"
set "REG_KEY=HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts\%HOST_NAME%"

:: Check if manifest exists
if not exist "%HOST_MANIFEST%" (
    echo [ERROR] Manifest file not found: %HOST_MANIFEST%
    pause
    exit /b 1
)

:: Add registry key
echo Adding registry key: %REG_KEY%
reg add "%REG_KEY%" /ve /t REG_SZ /d "%HOST_MANIFEST%" /f

if %errorlevel% equ 0 (
    echo.
    echo [SUCCESS] Native Messaging Host installed successfully!
    echo You can now use the automatic update feature in the extension.
) else (
    echo.
    echo [ERROR] Failed to add registry key.
)

pause
