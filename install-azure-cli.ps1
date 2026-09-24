$ProgressPreference = 'SilentlyContinue'
$msi = Join-Path $env:TEMP 'AzureCLI.msi'

Write-Host 'Downloading Azure CLI installer...'
Invoke-WebRequest -Uri 'https://aka.ms/installazurecliwindows' -OutFile $msi

Write-Host 'Installing Azure CLI...'
$proc = Start-Process msiexec.exe -ArgumentList @('/i', $msi, '/quiet', '/norestart') -Wait -PassThru
if ($proc.ExitCode -ne 0) {
    throw "Azure CLI MSI install failed with exit code $($proc.ExitCode)"
}

$machinePath = [System.Environment]::GetEnvironmentVariable('Path', 'Machine')
$userPath = [System.Environment]::GetEnvironmentVariable('Path', 'User')
$env:Path = "$machinePath;$userPath"

$paths = @(
    "$env:ProgramFiles\Azure CLI\az.exe",
    "$env:ProgramFiles(x86)\Azure CLI\az.exe",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps\az.exe",
    "$env:ProgramFiles\Microsoft SDKs\Azure\CLI2\wbin\az.cmd",
    "$env:ProgramFiles(x86)\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"
)

foreach ($p in $paths) {
    if (Test-Path $p) {
        Write-Host "FOUND:$p"
        & $p version
        exit 0
    }
}

throw 'Azure CLI not found after install.'
