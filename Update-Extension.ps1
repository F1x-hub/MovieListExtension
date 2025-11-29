param(
    [Parameter(Mandatory = $true)]
    [string]$ZipPath,        # Path to downloaded zip
    
    [Parameter(Mandatory = $true)]
    [string]$ExtensionPath   # Path to extension folder
)

$ErrorActionPreference = "Stop"

function Write-Color([string]$text, [ConsoleColor]$color) {
    Write-Host $text -ForegroundColor $color
}

try {
    Write-Color "=== Chrome Extension Update Started ===" Green

    # Check paths
    if (-not (Test-Path $ZipPath)) {
        throw "Zip archive not found: $ZipPath"
    }
    if (-not (Test-Path $ExtensionPath)) {
        throw "Extension folder not found: $ExtensionPath"
    }

    # Step 1: Backup
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupPath = "${ExtensionPath}-backup-${timestamp}"
    Write-Color "[1/7] Creating backup: $backupPath" Cyan
    Copy-Item -Path $ExtensionPath -Destination $backupPath -Recurse -Force

    # Step 2: Prepare temp folder
    $tempDir = "$env:TEMP\extension_update_temp"
    Write-Color "[2/7] Preparing temp folder: $tempDir" Cyan
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force
    }
    New-Item -Path $tempDir -ItemType Directory | Out-Null

    # Step 3: Unzip
    Write-Color "[3/7] Unzipping archive..." Cyan
    Expand-Archive -Path $ZipPath -DestinationPath $tempDir -Force

    # Find manifest.json
    $manifestPath = Get-ChildItem -Path $tempDir -Recurse -Filter "manifest.json" | Select-Object -First 1
    if (-not $manifestPath) {
        throw "manifest.json not found in archive"
    }
    $sourceDir = $manifestPath.DirectoryName
    Write-Color "    Update root folder: $sourceDir" Gray

    # Step 4: Save user data
    Write-Color "[4/7] Saving user data..." Cyan
    $userDataFiles = @("storage.json", "settings.json", "user_data.json", "config.js")
    $savedData = @{}

    foreach ($file in $userDataFiles) {
        $fullPath = Join-Path $ExtensionPath $file
        if (Test-Path $fullPath) {
            Write-Color "    Saving $file" Gray
            $savedData[$file] = Get-Content -Path $fullPath -Raw
        }
    }

    # Step 5: Replace files
    Write-Color "[5/7] Replacing files..." Cyan
    
    # Remove old files
    Get-ChildItem -Path $ExtensionPath -Recurse | Remove-Item -Recurse -Force

    # Copy new files
    Copy-Item -Path "$sourceDir\*" -Destination $ExtensionPath -Recurse -Force

    # Step 6: Restore user data
    Write-Color "[6/7] Restoring user data..." Cyan
    foreach ($file in $savedData.Keys) {
        $fullPath = Join-Path $ExtensionPath $file
        Write-Color "    Restoring $file" Gray
        Set-Content -Path $fullPath -Value $savedData[$file]
    }

    # Step 7: Cleanup
    Write-Color "[7/7] Cleaning up..." Cyan
    Remove-Item -Path $tempDir -Recurse -Force
    
    # Remove old backups (> 7 days)
    $parentPath = Split-Path $ExtensionPath -Parent
    Get-ChildItem -Path $parentPath -Filter "*-backup-*" | 
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | 
    Remove-Item -Recurse -Force

    Write-Color "=== Update Completed Successfully! ===" Green
    Write-Color "Please reload the extension at chrome://extensions" Yellow

}
catch {
    Write-Color "!!! UPDATE ERROR !!!" Red
    Write-Color $_.Exception.Message Red
    
    # Rollback
    if ($backupPath -and (Test-Path $backupPath)) {
        Write-Color "Rolling back changes..." Yellow
        try {
            if (Test-Path $ExtensionPath) {
                Remove-Item -Path $ExtensionPath -Recurse -Force
            }
            Copy-Item -Path $backupPath -Destination $ExtensionPath -Recurse -Force
            Write-Color "Rollback successful." Green
        }
        catch {
            Write-Color "Rollback failed: $($_.Exception.Message)" Red
        }
    }
    
    exit 1
}
