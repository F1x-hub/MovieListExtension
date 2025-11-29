@echo off
chcp 65001 >nul
title Обновление Chrome-расширения

:: Конфигурация
set "EXTENSION_PATH=d:\Programing\JS\Projects\MovieListExstension"
set "ZIP_PATH=%USERPROFILE%\Downloads\extension_update.zip"
set "SCRIPT_PATH=%~dp0Update-Extension.ps1"

:: Проверки
if not exist "%SCRIPT_PATH%" (
    echo [ОШИБКА] Не найден Update-Extension.ps1
    pause
    exit /b 1
)

:: Запуск с правами администратора
powershell -ExecutionPolicy Bypass -Command "Start-Process powershell -ArgumentList '-ExecutionPolicy Bypass -NoProfile -File \"%SCRIPT_PATH%\" -ZipPath \"%ZIP_PATH%\" -ExtensionPath \"%EXTENSION_PATH%\"' -Verb RunAs"
