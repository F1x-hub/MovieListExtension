<#
.SYNOPSIS
    Updates the Movie Rating Extension.
.DESCRIPTION
    Extracts the update zip and overwrites the extension files, preserving the native host.
#>
param (
    [Parameter(Mandatory = $true)]
    [string]$ZipPath,

    [Parameter(Mandatory = $true)]
    [string]$ExtensionPath
)

# Set encoding to handle Cyrillic characters correctly
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

try {
    # Validate paths
    if (-not (Test-Path -LiteralPath $ZipPath)) {
        throw "Zip file not found"
    }

    if (-not (Test-Path -LiteralPath $ExtensionPath)) {
        throw "Extension directory not found"
    }

    # Create backup
    $BackupPath = "$ExtensionPath.backup.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $ExtensionPath -Destination $BackupPath -Recurse -Force -ErrorAction Stop

    # Create temp directory
    $TempDir = Join-Path $env:TEMP "MovieRatingExtensionUpdate_$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

    # Extract Zip
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $TempDir -Force

    # GitHub releases often contain a single root folder
    $ExtractedItems = Get-ChildItem -Path $TempDir
    $SourceDir = $TempDir
    
    if ($ExtractedItems.Count -eq 1 -and $ExtractedItems[0].PSIsContainer) {
        $SourceDir = $ExtractedItems[0].FullName
    }

    # Copy files
    $SourceFiles = Get-ChildItem -Path $SourceDir -Recurse
    
    foreach ($File in $SourceFiles) {
        $RelativePath = $File.FullName.Substring($SourceDir.Length + 1)
        $DestPath = Join-Path $ExtensionPath $RelativePath
        
        # Skip native-host directory
        if ($RelativePath -like "native-host*") {
            continue
        }

        if ($File.PSIsContainer) {
            if (-not (Test-Path -LiteralPath $DestPath)) {
                New-Item -ItemType Directory -Force -Path $DestPath | Out-Null
            }
        }
        else {
            Copy-Item -LiteralPath $File.FullName -Destination $DestPath -Force
        }
    }
    
    # Clean up
    Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    
}
catch {
    Write-Error "Update failed: $($_.Exception.Message)"
    exit 1
}
