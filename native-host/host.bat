@echo off
:: Pass stdin/stdout to PowerShell script
powershell -ExecutionPolicy Bypass -File "%~dp0host.ps1"
