# =====================================================================
# Установщик офисного подписанта Cosmex — одна команда, всё сам:
#   скачивает агента, находит КриптоПро и сертификат УКЭП, проверяет
#   подпись, прописывает автозапуск и запускает агента в фоне.
#
# Запуск (даёт интеграция вместе с секретом):
#   powershell -ExecutionPolicy Bypass -File install-agent.ps1 -Secret <секрет>
# =====================================================================
param(
    [Parameter(Mandatory = $true)][string]$Secret,
    [string]$GuardUrl = "https://guard.89-167-54-69.sslip.io"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Dir = "C:\cosmex-signer"
$RawBase = "https://raw.githubusercontent.com/cosmeeex/cos/claude/honest-sign-cosmex-integration-nukn89/deploy/office-signer"

function Step([string]$m) { Write-Host "==> $m" -ForegroundColor Cyan }
function Fail([string]$m) { Write-Host "ОШИБКА: $m" -ForegroundColor Red; Read-Host "Нажмите Enter для выхода"; exit 1 }

Step "1/6 Папка $Dir"
New-Item -ItemType Directory -Force -Path $Dir | Out-Null

Step "2/6 Скачиваю агента"
Invoke-RestMethod "$RawBase/agent.ps1" -OutFile (Join-Path $Dir "agent.ps1")

Step "3/6 Ищу КриптоПро"
$CspTest = @(
    "C:\Program Files\Crypto Pro\CSP\csptest.exe",
    "C:\Program Files (x86)\Crypto Pro\CSP\csptest.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $CspTest) {
    Fail "КриптоПро CSP не найден. Установщик нужно запускать на том компьютере, где вставляют Рутокен и заходят в Честный знак."
}
Write-Host "    найден: $CspTest"

Step "4/6 Ищу сертификат УКЭП"
# ГОСТ-сертификаты с закрытым ключом в хранилище «Личное» текущего пользователя.
$certs = @(Get-ChildItem Cert:\CurrentUser\My | Where-Object {
    $_.HasPrivateKey -and $_.SignatureAlgorithm.Value -like "1.2.643.*" -and $_.NotAfter -gt (Get-Date)
})
if ($certs.Count -eq 0) {
    Fail "Не найден действующий ГОСТ-сертификат с закрытым ключом. Вставьте Рутокен и запустите ещё раз. Если сертификат есть, но не виден — откройте «КриптоПро → Сертификаты» и установите его в «Личное»."
}
if ($certs.Count -eq 1) {
    $cert = $certs[0]
} else {
    Write-Host "Найдено несколько сертификатов:"
    for ($i = 0; $i -lt $certs.Count; $i++) {
        Write-Host ("  [{0}] {1}  (до {2:dd.MM.yyyy})" -f ($i + 1), $certs[$i].Subject, $certs[$i].NotAfter)
    }
    $n = Read-Host "Введите номер сертификата организации"
    $cert = $certs[[int]$n - 1]
}
# Фрагмент CN для csptest -my
$cn = ($cert.Subject -split ",\s*" | Where-Object { $_ -like "CN=*" } | Select-Object -First 1) -replace "^CN=", ""
if (-not $cn) { $cn = $cert.Subject }
Write-Host "    выбран: $cn"

Step "5/6 Записываю настройки и проверяю подпись"
@{ GuardUrl = $GuardUrl; Secret = $Secret; CertName = $cn; CspTest = $CspTest } |
    ConvertTo-Json | Set-Content -Path (Join-Path $Dir "agent-config.json") -Encoding UTF8
& powershell -ExecutionPolicy Bypass -File (Join-Path $Dir "agent.ps1") -Test
if ($LASTEXITCODE -ne 0) {
    Fail "Пробная подпись не прошла — пришлите текст выше в чат интеграции, разберём."
}

Step "6/6 Автозапуск и старт"
$startup = [Environment]::GetFolderPath("Startup")
$cmd = "@echo off`r`nstart """" /min powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Dir\agent.ps1`""
Set-Content -Path (Join-Path $startup "cosmex-signer.cmd") -Value $cmd -Encoding ASCII
Start-Process powershell -ArgumentList "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "$Dir\agent.ps1" -WindowStyle Hidden

Write-Host ""
Write-Host "ГОТОВО. Подписант работает в фоне и будет запускаться при входе в Windows." -ForegroundColor Green
Write-Host "Журнал: $Dir\agent.log. Больше ничего делать не нужно."
Read-Host "Нажмите Enter для выхода"
