# =====================================================================
# Офисный подписант УКЭП для интеграции маркировки Cosmex.
#
# Работает на Windows-компьютере, где установлены КриптоПро CSP и
# сертификат УКЭП (Рутокен или реестр). Опрашивает сервер стража по
# HTTPS, подписывает присланные данные локально и возвращает подпись.
# Ключ УКЭП компьютер не покидает. Входящих подключений нет.
#
# Запуск вручную:      powershell -ExecutionPolicy Bypass -File agent.ps1
# Проверка подписи:    powershell -ExecutionPolicy Bypass -File agent.ps1 -Test
# Автозапуск: см. deploy/office-signer/README.md (планировщик задач)
# =====================================================================

param(
    [switch]$Test
)

# ----------------------- НАСТРОЙКИ -----------------------------------
$GuardUrl   = "https://guard.89-167-54-69.sslip.io"
$Secret     = "ЗАМЕНИТЕ_НА_SIGNER_SECRET"   # выдаст интеграция (finish.sh печатает его)
# Часть имени (CN) сертификата УКЭП — как он виден в «КриптоПро → Сертификаты»
# или в certmgr. Достаточно уникального фрагмента, например названия организации.
$CertName   = "ЗАМЕНИТЕ_НА_ЧАСТЬ_ИМЕНИ_СЕРТИФИКАТА"
# Путь к csptest из состава КриптоПро CSP:
$CspTest    = "C:\Program Files\Crypto Pro\CSP\csptest.exe"
# ---------------------------------------------------------------------

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Настройки из agent-config.json (создаёт install-agent.ps1) важнее значений выше.
$ConfigPath = Join-Path $PSScriptRoot "agent-config.json"
if (Test-Path $ConfigPath) {
    $cfgJson = Get-Content $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($cfgJson.GuardUrl) { $GuardUrl = $cfgJson.GuardUrl }
    if ($cfgJson.Secret)   { $Secret   = $cfgJson.Secret }
    if ($cfgJson.CertName) { $CertName = $cfgJson.CertName }
    if ($cfgJson.CspTest)  { $CspTest  = $cfgJson.CspTest }
}

function Write-Log([string]$msg) {
    $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Write-Host $line
    Add-Content -Path (Join-Path $PSScriptRoot "agent.log") -Value $line -Encoding UTF8
}

function Sign-Data([string]$data) {
    $tmpIn  = Join-Path $env:TEMP ("chz-sign-" + [guid]::NewGuid() + ".bin")
    $tmpOut = "$tmpIn.p7s"
    try {
        # Данные пишем как байты UTF-8 без BOM — подпись должна покрывать их точно.
        [IO.File]::WriteAllBytes($tmpIn, [Text.Encoding]::UTF8.GetBytes($data))
        # Присоединённая CMS-подпись (PKCS#7). -add кладёт сертификат в подпись.
        $args = @("-sfsign", "-sign", "-in", $tmpIn, "-out", $tmpOut, "-my", $CertName, "-add", "-silent")
        $proc = Start-Process -FilePath $CspTest -ArgumentList $args -Wait -PassThru -NoNewWindow `
                 -RedirectStandardOutput (Join-Path $env:TEMP "chz-sign-out.txt") `
                 -RedirectStandardError  (Join-Path $env:TEMP "chz-sign-err.txt")
        if ($proc.ExitCode -ne 0) {
            $err = Get-Content (Join-Path $env:TEMP "chz-sign-out.txt") -Raw -ErrorAction SilentlyContinue
            throw "csptest завершился с кодом $($proc.ExitCode): $err"
        }
        return [Convert]::ToBase64String([IO.File]::ReadAllBytes($tmpOut))
    }
    finally {
        Remove-Item $tmpIn, $tmpOut -ErrorAction SilentlyContinue
    }
}

if ($Test) {
    Write-Log "ТЕСТ: подписываю строку 'test-cosmex'…"
    $sig = Sign-Data "test-cosmex"
    Write-Log ("ОК: подпись получена, длина base64 = " + $sig.Length)
    Write-Log ("Начало подписи: " + $sig.Substring(0, [Math]::Min(60, $sig.Length)) + "…")
    Write-Log "Если КриптоПро спросил PIN от контейнера — при постоянной работе сохраните PIN (галочка «Запомнить») либо снимите PIN с контейнера."
    exit 0
}

$headers = @{ "X-Signer-Secret" = $Secret }
Write-Log "Агент запущен. Сервер: $GuardUrl, сертификат: *$CertName*"

while ($true) {
    try {
        $resp = Invoke-RestMethod -Uri "$GuardUrl/sign/poll" -Headers $headers -Method Get -TimeoutSec 40
        foreach ($job in $resp.jobs) {
            Write-Log "Задание $($job.id): подписываю $($job.data.Length) байт…"
            try {
                $sig = Sign-Data $job.data
                $body = @{ id = $job.id; signature = $sig } | ConvertTo-Json -Compress
                Invoke-RestMethod -Uri "$GuardUrl/sign/result" -Headers $headers -Method Post `
                    -ContentType "application/json; charset=utf-8" -Body $body | Out-Null
                Write-Log "Задание $($job.id): подпись отправлена ✓"
            }
            catch {
                $emsg = $_.Exception.Message
                Write-Log "Задание $($job.id): ОШИБКА подписи — $emsg"
                $body = @{ id = $job.id; error = $emsg } | ConvertTo-Json -Compress
                Invoke-RestMethod -Uri "$GuardUrl/sign/result" -Headers $headers -Method Post `
                    -ContentType "application/json; charset=utf-8" -Body $body | Out-Null
            }
        }
    }
    catch {
        Write-Log ("Связь с сервером: " + $_.Exception.Message + " — повтор через 15 c")
        Start-Sleep -Seconds 15
    }
}
