# Set encoding to UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "🚀 Setting up Movie Rating Extension Native Host..." -ForegroundColor Cyan

# Check for Admin privileges
$IsAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if ($IsAdmin) {
    Write-Host "⚠️ WARNING: You are running this script as Administrator." -ForegroundColor Yellow
    Write-Host "   If you use Chrome as a normal user, the registry key might be created for the wrong user."
    Write-Host "   It is recommended to run this script as your NORMAL user."
    Write-Host "   Press Enter to continue anyway, or Ctrl+C to cancel."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
}

# 1. Define paths
$ScriptDir = $PSScriptRoot
$ManifestPath = Join-Path $ScriptDir "com.movielist.updater.json"
$HostPath = Join-Path $ScriptDir "host.bat"

# 2. Find Chrome Extension ID
Write-Host "🔍 Searching for installed extension..." -ForegroundColor Yellow

$ChromeUserData = "$env:LOCALAPPDATA\Google\Chrome\User Data"
# Simplified profile search to avoid regex syntax issues in some PowerShell versions
$Profiles = Get-ChildItem -Path $ChromeUserData -Directory | Where-Object { 
    $_.Name -eq "Default" -or $_.Name.StartsWith("Profile ") 
}

$FoundId = $null
# List of known IDs to look for (from logs and previous versions)
$TargetIds = @("eedcgknijhecfpnpenleikmadfkahnfc", "mlpnfkhikdfocakladfeomklemjkgpgl")

foreach ($Profile in $Profiles) {
    $ExtensionsDir = Join-Path $Profile.FullName "Extensions"
    if (Test-Path $ExtensionsDir) {
        foreach ($TargetId in $TargetIds) {
            if (Test-Path (Join-Path $ExtensionsDir $TargetId)) {
                $FoundId = $TargetId
                Write-Host "✅ Found extension in $($Profile.Name): $FoundId" -ForegroundColor Green
                break
            }
        }
    }
    if ($FoundId) { break }
}

if (-not $FoundId) {
    Write-Host "⚠️ Extension not found in standard profiles." -ForegroundColor Yellow
    Write-Host "   Using the ID from your latest logs: eedcgknijhecfpnpenleikmadfkahnfc" -ForegroundColor Gray
    $FoundId = "eedcgknijhecfpnpenleikmadfkahnfc"
}

Write-Host "ℹ️ Using Extension ID: $FoundId" -ForegroundColor Cyan

# 3. Update Manifest
Write-Host "📝 Updating manifest file..." -ForegroundColor Yellow

$ManifestContent = @{
    name            = "com.movielist.updater"
    description     = "Movie List Extension Updater"
    path            = "host.bat"
    type            = "stdio"
    allowed_origins = @(
        "chrome-extension://$FoundId/"
    )
}

$ManifestJson = $ManifestContent | ConvertTo-Json -Depth 2
Set-Content -Path $ManifestPath -Value $ManifestJson -Encoding UTF8

Write-Host "✅ Manifest updated with ID: $FoundId" -ForegroundColor Green

# 4. Register in Registry
Write-Host "🔑 Registering in Windows Registry (HKCU)..." -ForegroundColor Yellow

$RegKeyPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.movielist.updater"

try {
    if (-not (Test-Path $RegKeyPath)) {
        New-Item -Path $RegKeyPath -Force | Out-Null
    }
    
    # Set the default value to the manifest path
    New-ItemProperty -Path $RegKeyPath -Name "(default)" -Value $ManifestPath -PropertyType String -Force | Out-Null
    
    Write-Host "✅ Registry key successfully added!" -ForegroundColor Green
    Write-Host "   Key: $RegKeyPath" -ForegroundColor Gray
    Write-Host "   Value: $ManifestPath" -ForegroundColor Gray
}
catch {
    Write-Error "❌ Failed to update registry: $_"
    exit 1
}

Write-Host "`n🎉 Setup complete! Please restart Chrome completely." -ForegroundColor Cyan
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
