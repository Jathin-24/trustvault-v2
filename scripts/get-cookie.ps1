# Mints a Clerk session and prints a ready-to-use Cookie header.
# Usage: .\scripts\get-cookie.ps1 admin@vaultdemo.com
param([Parameter(Mandatory = $true)][string]$Email)

$envOut = node scripts/mint-token.mjs $Email
if ($LASTEXITCODE -ne 0) { Write-Error $envOut; exit 1 }
$j = $envOut | ConvertFrom-Json

# __client_uat must be <= token iat (Clerk rejects future uat)
$parts = $j.token.Split('.')[1].Replace('-', '+').Replace('_', '/')
while ($parts.Length % 4) { $parts += '=' }
$payload = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($parts))
$iat = [int]([regex]::Match($payload, '"iat":(\d+)')).Groups[1].Value
$uat = $iat - 5

$db = Select-String -Path "$env:TEMP\clerk-jar.txt" -Pattern '__clerk_db_jwt' -ErrorAction SilentlyContinue
if ($db) {
  $dbVal = ($db.Line -split "`t")[-1]
} else {
  $dbVal = $null
}

$cookie = "__session=$($j.token); __client_uat=$uat"
if ($dbVal) { $cookie += "; __clerk_db_jwt=$dbVal" }
Write-Output $cookie
