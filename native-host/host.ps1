param()
$ErrorActionPreference = "Stop"

function Read-Message {
    $lengthBytes = [byte[]]::new(4)
    $bytesRead = [Console]::OpenStandardInput().Read($lengthBytes, 0, 4)
    if ($bytesRead -lt 4) { return $null }
    
    # Little-endian conversion
    $length = [BitConverter]::ToInt32($lengthBytes, 0)
    
    if ($length -eq 0) { return "" }
    
    $buffer = [byte[]]::new($length)
    $totalRead = 0
    while ($totalRead -lt $length) {
        $read = [Console]::OpenStandardInput().Read($buffer, $totalRead, $length - $totalRead)
        if ($read -eq 0) { break }
        $totalRead += $read
    }
    
    return [System.Text.Encoding]::UTF8.GetString($buffer)
}

function Write-Message ($json) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $length = $bytes.Length
    $lengthBytes = [BitConverter]::GetBytes($length)
    
    [Console]::OpenStandardOutput().Write($lengthBytes, 0, 4)
    [Console]::OpenStandardOutput().Write($bytes, 0, $length)
}

while ($true) {
    try {
        $msgString = Read-Message
        if ($null -eq $msgString) { break }
        
        $msg = $msgString | ConvertFrom-Json
        
        if ($msg.action -eq "update") {
            $scriptPath = $msg.scriptPath
            $zipPath = $msg.zipPath
            $extensionPath = $msg.extensionPath
            
            # Verify paths exist
            if (-not (Test-Path $scriptPath)) {
                Write-Message (ConvertTo-Json @{ success = $false; error = "Script not found: $scriptPath" })
                continue
            }
            
            # Start the update script as Admin and WAIT for it to finish
            # We use -Wait to ensure we only send success after it's done
            $process = Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$scriptPath`" -ZipPath `"$zipPath`" -ExtensionPath `"$extensionPath`"" -Verb RunAs -PassThru -Wait
            
            # Check exit code if possible (Start-Process -Wait returns process object but ExitCode might be available)
            if ($process.ExitCode -eq 0) {
                Write-Message (ConvertTo-Json @{ success = $true })
            }
            else {
                Write-Message (ConvertTo-Json @{ success = $false; error = "Update script failed with exit code $($process.ExitCode)" })
            }
        }
        elseif ($msg.action -eq "ping") {
            Write-Message (ConvertTo-Json @{ success = $true; message = "pong" })
        }
    }
    catch {
        $err = $_.Exception.Message
        try {
            Write-Message (ConvertTo-Json @{ success = $false; error = $err })
        }
        catch {}
        break
    }
}
