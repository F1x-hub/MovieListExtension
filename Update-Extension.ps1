param(
    [Parameter(Mandatory=$true)]
    [string]$ZipPath,        # Путь к скачанному zip-архиву
    
    [Parameter(Mandatory=$true)]
    [string]$ExtensionPath   # Путь к папке расширения
)

$ErrorActionPreference = "Stop"

function Write-Color([string]$text, [ConsoleColor]$color) {
    Write-Host $text -ForegroundColor $color
}

try {
    Write-Color "=== Начало обновления Chrome-расширения ===" Green

    # Проверка путей
    if (-not (Test-Path $ZipPath)) {
        throw "Zip-архив не найден: $ZipPath"
    }
    if (-not (Test-Path $ExtensionPath)) {
        throw "Папка расширения не найдена: $ExtensionPath"
    }

    # Этап 1: Создание резервной копии
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = "${ExtensionPath}-backup-${timestamp}"
    Write-Color "[1/7] Создание резервной копии: $backupPath" Cyan
    Copy-Item -Path $ExtensionPath -Destination $backupPath -Recurse -Force

    # Этап 2: Подготовка временной папки
    $tempDir = "$env:TEMP\extension_update_temp"
    Write-Color "[2/7] Подготовка временной папки: $tempDir" Cyan
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force
    }
    New-Item -Path $tempDir -ItemType Directory | Out-Null

    # Этап 3: Распаковка архива
    Write-Color "[3/7] Распаковка архива..." Cyan
    Expand-Archive -Path $ZipPath -DestinationPath $tempDir -Force

    # Найти manifest.json внутри распакованного архива
    $manifestPath = Get-ChildItem -Path $tempDir -Recurse -Filter "manifest.json" | Select-Object -First 1
    if (-not $manifestPath) {
        throw "manifest.json не найден в архиве"
    }
    $sourceDir = $manifestPath.DirectoryName
    Write-Color "    Корневая папка обновления: $sourceDir" Gray

    # Этап 4: Сохранение пользовательских данных
    Write-Color "[4/7] Сохранение пользовательских данных..." Cyan
    $userDataFiles = @("storage.json", "settings.json", "user_data.json", "config.js") # Добавил config.js на всякий случай
    $savedData = @{}

    foreach ($file in $userDataFiles) {
        $fullPath = Join-Path $ExtensionPath $file
        if (Test-Path $fullPath) {
            Write-Color "    Сохранение $file" Gray
            $savedData[$file] = Get-Content -Path $fullPath -Raw
        }
    }

    # Этап 5: Замена файлов
    Write-Color "[5/7] Замена файлов..." Cyan
    
    # Удаляем старые файлы (кроме бэкапов, если они внутри, но мы делали бэкап рядом)
    # Очищаем папку расширения
    Get-ChildItem -Path $ExtensionPath -Recurse | Remove-Item -Recurse -Force

    # Копируем новые файлы
    Copy-Item -Path "$sourceDir\*" -Destination $ExtensionPath -Recurse -Force

    # Этап 6: Восстановление пользовательских данных
    Write-Color "[6/7] Восстановление пользовательских данных..." Cyan
    foreach ($file in $savedData.Keys) {
        $fullPath = Join-Path $ExtensionPath $file
        Write-Color "    Восстановление $file" Gray
        Set-Content -Path $fullPath -Value $savedData[$file]
    }

    # Этап 7: Очистка и финализация
    Write-Color "[7/7] Очистка..." Cyan
    Remove-Item -Path $tempDir -Recurse -Force
    
    # Удаление zip-архива (опционально, можно оставить)
    # Remove-Item -Path $ZipPath -Force 

    # Удаление старых бэкапов (старше 7 дней)
    $parentPath = Split-Path $ExtensionPath -Parent
    Get-ChildItem -Path $parentPath -Filter "*-backup-*" | 
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | 
        Remove-Item -Recurse -Force

    Write-Color "=== Обновление успешно завершено! ===" Green
    Write-Color "Пожалуйста, перезагрузите расширение на странице chrome://extensions" Yellow

} catch {
    Write-Color "!!! ОШИБКА ОБНОВЛЕНИЯ !!!" Red
    Write-Color $_.Exception.Message Red
    
    # Попытка отката
    if ($backupPath -and (Test-Path $backupPath)) {
        Write-Color "Выполняется откат изменений..." Yellow
        try {
            if (Test-Path $ExtensionPath) {
                Remove-Item -Path $ExtensionPath -Recurse -Force
            }
            Copy-Item -Path $backupPath -Destination $ExtensionPath -Recurse -Force
            Write-Color "Откат выполнен успешно." Green
        } catch {
            Write-Color "Не удалось выполнить откат: $($_.Exception.Message)" Red
        }
    }
    
    exit 1
}
