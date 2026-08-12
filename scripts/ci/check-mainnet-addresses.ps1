# Fail if known mainnet-only addresses appear in contracts/ or scripts/deploy/
$ErrorActionPreference = "Stop"

$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$ScanDirs = @(
    Join-Path $Root "contracts\src"
    Join-Path $Root "scripts\deploy"
)

$Blocked = @(
    "0x8a1E35F5c98C4E85B36B7B253222eE17773b2781"
    "0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652"
    "0x88d46717b16619b37fa2dfd2f038defb4459f1f7"
    "0xe7cd86e13AC4309349F30B3435a9d337750fC82D"
    "0xAd552A648C74D49E10027AB8a618A3ad4901c5bE"
)

$Found = $false

foreach ($dir in $ScanDirs) {
    if (-not (Test-Path $dir)) { continue }
    $files = Get-ChildItem -Path $dir -Recurse -File -Include *.sol,*.ts,*.js
    foreach ($file in $files) {
        $content = Get-Content $file.FullName -Raw
        foreach ($addr in $Blocked) {
            if ($content -match [regex]::Escape($addr)) {
                Write-Error "Mainnet-only address found in $($file.FullName): $addr"
                $Found = $true
            }
        }
    }
}

if ($Found) {
    Write-Host "Address guard FAILED"
    exit 1
}

Write-Host "Address guard PASSED"
