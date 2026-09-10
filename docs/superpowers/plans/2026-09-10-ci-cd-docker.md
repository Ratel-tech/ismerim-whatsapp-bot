# CI/CD (Docker) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Testar, validar o build Docker e implantar automaticamente o bot nesta máquina a cada push na `master`, preservando `.env`, `data/` e `config/*.json`.

**Architecture:** Um único workflow (`ci.yml`) com dois jobs: `ci` (ubuntu-latest, test/lint/build + `docker build`) e `deploy` (runner self-hosted Windows, `needs: ci`, só na master). O deploy atualiza a pasta do projeto via `git fetch/reset` (preservando `config/`), roda `docker compose up -d --build` e valida HTTP 200.

**Tech Stack:** GitHub Actions, runner self-hosted Windows, Docker Compose, PowerShell.

**Spec:** `docs/superpowers/specs/2026-09-10-ci-cd-docker-design.md`

## Global Constraints

- Branch de deploy: `master`. Repo: `Ratel-tech/ismerim-whatsapp-bot`.
- Caminho fixo do projeto: `C:\Users\ismer\OneDrive\Desktop\Ismerim BOT Whatsapp`.
- Porta da aplicação: `3081`. Container: `ismerim-bot`.
- Nenhum segredo no workflow; `.env` fica apenas na máquina.
- Não commitar `config/agent.json` (edição de runtime).

---

### Task 1: Atualizar o workflow (docker build + job de deploy)

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: job `deploy` (runs-on `[self-hosted, Windows]`, `needs: ci`) usado pela Task 3.

- [ ] **Step 1: Reescrever `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
  pull_request:
  workflow_dispatch:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Tests
        run: npm test

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Docker build
        run: docker build -t ismerim-whatsapp-bot:ci .

  deploy:
    needs: ci
    if: (github.event_name == 'push' && github.ref == 'refs/heads/master') || github.event_name == 'workflow_dispatch'
    runs-on: [self-hosted, Windows]
    env:
      PROJECT_DIR: C:\Users\ismer\OneDrive\Desktop\Ismerim BOT Whatsapp
    steps:
      - name: Atualizar codigo preservando config de runtime
        shell: powershell
        run: |
          $cfg = Join-Path $env:RUNNER_TEMP "cfg-backup"
          New-Item -ItemType Directory -Force -Path $cfg | Out-Null
          Copy-Item -Path (Join-Path $env:PROJECT_DIR "config\*.json") -Destination $cfg -Force
          git -C $env:PROJECT_DIR fetch origin master
          git -C $env:PROJECT_DIR reset --hard origin/master
          Copy-Item -Path (Join-Path $cfg "*.json") -Destination (Join-Path $env:PROJECT_DIR "config") -Force

      - name: Rebuild e restart
        shell: powershell
        run: |
          docker compose --project-directory $env:PROJECT_DIR -f (Join-Path $env:PROJECT_DIR "docker-compose.yml") up -d --build

      - name: Health check
        shell: powershell
        run: |
          $ok = $false
          for ($i = 0; $i -lt 12; $i++) {
            Start-Sleep -Seconds 5
            try {
              $r = Invoke-WebRequest -Uri "http://localhost:3081" -UseBasicParsing -TimeoutSec 10
              if ($r.StatusCode -eq 200) { $ok = $true; break }
            } catch { }
          }
          if (-not $ok) { throw "Health check falhou: sem HTTP 200 em http://localhost:3081" }
```

- [ ] **Step 2: Validar o YAML com actionlint**

Run: `docker run --rm -v "C:\Users\ismer\OneDrive\Desktop\Ismerim BOT Whatsapp:/repo" -w /repo rhysd/actionlint:latest .github/workflows/ci.yml`
Expected: sem saída (exit 0).

- [ ] **Step 3: Commit**

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: valida build docker e adiciona job de deploy self-hosted"
```

---

### Task 2: Commit do trabalho Docker e verificação do CI

**Files:**
- Add: `Dockerfile`, `docker-compose.yml`, `.dockerignore`
- Modify: `src/config.ts`, `src/index.ts`
- (não adicionar `config/agent.json`)

- [ ] **Step 1: Conferir o que será commitado**

Run: `git status --short`
Expected: os arquivos Docker/`src` listados; `config/agent.json` modificado (não incluir).

- [ ] **Step 2: Commitar os arquivos do Docker**

```powershell
git add Dockerfile docker-compose.yml .dockerignore src/config.ts src/index.ts
git commit -m "feat: dockeriza a aplicacao (host configuravel, volumes de sessao/dados)"
```

- [ ] **Step 3: Push e observar o CI**

Run: `git push origin master`
Expected: workflow "CI" dispara; job `ci` verde; job `deploy` falha por não haver runner (esperado até a Task 3).

---

### Task 3: Runner self-hosted e primeiro deploy

**Files:**
- Infra (fora do repo): `C:\actions-runner`

**Pré-requisito:** `gh auth login` concluído.

- [ ] **Step 1: Obter token de registro**

Run: `gh api -X POST repos/Ratel-tech/ismerim-whatsapp-bot/actions/runners/registration-token --jq .token`
Expected: token (string).

- [ ] **Step 2: Baixar e configurar o runner**

```powershell
$v = (gh api repos/actions/runner/releases/latest --jq .tag_name).TrimStart('v')
New-Item -ItemType Directory -Force -Path "C:\actions-runner" | Out-Null
Invoke-WebRequest "https://github.com/actions/runner/releases/download/v$v/actions-runner-win-x64-$v.zip" -OutFile "$env:TEMP\runner.zip"
Expand-Archive "$env:TEMP\runner.zip" -DestinationPath "C:\actions-runner" -Force
$token = gh api -X POST repos/Ratel-tech/ismerim-whatsapp-bot/actions/runners/registration-token --jq .token
& "C:\actions-runner\config.cmd" --url "https://github.com/Ratel-tech/ismerim-whatsapp-bot" --token $token --name ismerim-runner --labels self-hosted,Windows --unattended --replace
```

Expected: "Runner successfully added" e "Runner connection is good".

- [ ] **Step 3: Iniciar o runner**

```powershell
Start-Process -FilePath "C:\actions-runner\run.cmd" -WorkingDirectory "C:\actions-runner" -WindowStyle Hidden
```

Expected: runner aparece online em `gh api repos/Ratel-tech/ismerim-whatsapp-bot/actions/runners --jq '.runners[] | {name,status}'`.

- [ ] **Step 4: Disparar o deploy e verificar**

Run: `gh workflow run CI --ref master` (ou `git commit --allow-empty -m "ci: dispara deploy" && git push`)
Expected: `ci` verde → `deploy` no runner → `docker compose ps` com `ismerim-bot` Up → health check 200.

- [ ] **Step 5: Verificação final**

Run: `gh run list --workflow CI --limit 3`
Expected: run da master com `ci` e `deploy` concluídos com sucesso.

---

## Self-Review

- **Spec coverage:** workflow único com 2 jobs (Task 1), `docker build` (Task 1), preservação de `config/` (Task 1), runner self-hosted (Task 3), commit Docker (Task 2), health check (Task 1). OK.
- **Placeholders:** nenhum.
- **Consistência:** `PROJECT_DIR`, labels `[self-hosted, Windows]` e container `ismerim-bot` batem entre as tasks.
