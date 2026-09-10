# ============================================================
#  Ismerim WhatsApp Bot - start
#  Instala dependências se necessário e inicia o bot.
#  Painel local: http://localhost:3081 (se ocupada, sobe +1).
# ============================================================
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

# Usa npm.cmd em vez de npm para contornar a Execution Policy do Windows
# que bloqueia a execução de scripts .ps1 (npm.ps1), mantendo o bot rodando.
$npm = "npm.cmd"

if (-not (Test-Path "node_modules")) {
    Write-Host "Instalando dependências (primeira execução)..."
    & $npm install
}

if (-not (Test-Path ".env")) {
    Copy-Item ".env.example" ".env"
    Write-Host "Arquivo .env criado - edite com sua chave do DeepSeek e o ADMIN_PHONE."
}

Write-Host "============================================"
Write-Host "  Ismerim WhatsApp Bot iniciando..."
Write-Host "  Página/QR:  http://localhost:3081"
Write-Host "  (Ctrl+C para encerrar)"
Write-Host "============================================"
& $npm run dev
