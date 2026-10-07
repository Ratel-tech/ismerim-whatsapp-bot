# CI/CD (GitHub Actions)

Workflow: `.github/workflows/ci.yml`.

## Gatilhos

- `push` (qualquer branch)
- `pull_request`
- `workflow_dispatch` (manual, pela aba Actions)

## Jobs

### `ci` (ubuntu-latest, cloud)

1. `actions/checkout`
2. `actions/setup-node` (Node 22, cache npm)
3. `npm ci`
4. `npm run typecheck`
5. `npm test`
6. `npm run lint`
7. `npm run build`
8. `docker build -t ismerim-whatsapp-bot:ci .`

Roda rapido e valida o codigo + a imagem.

### `deploy` (self-hosted, Windows)

Roda **somente** quando:

- `push` na branch `master`, **ou**
- `workflow_dispatch`.

E depende de `ci` (`needs: ci`). Passos:

1. **Atualizar codigo preservando config de runtime** — faz backup de `config/*.json`, `git fetch origin master`, `git reset --hard origin/master` e restaura `config/*.json`.
2. **Rebuild e restart** — `docker compose up -d --build` no `PROJECT_DIR`.
3. **Health check** — tenta `http://localhost:3081` por ate ~60s; falha se nao receber HTTP 200.

Configuracao relevante:

- `runs-on: [self-hosted, Windows]`
- `PROJECT_DIR: C:\Users\ismer\OneDrive\Desktop\Ismerim BOT Whatsapp`

## Runner self-hosted (Windows)

O job `deploy` precisa de um runner com os labels `self-hosted` e `Windows`. Sem ele, o job fica **queued** (e a run pode ser cancelada).

### Instalar

1. No GitHub: **Settings -> Actions -> Runners -> New self-hosted runner -> Windows x64**. Copie os comandos (incluem um token de registro valido por ~1h).
2. No PowerShell (recomendado rodar como Administrador):

```powershell
New-Item -ItemType Directory -Force C:\actions-runner | Out-Null
Set-Location C:\actions-runner
Invoke-WebRequest -Uri https://github.com/actions/runner/releases/download/v2.319.1/actions-runner-win-x64-2.319.1.zip -OutFile runner.zip
Expand-Archive -Path runner.zip -DestinationPath . -Force
# O token abaixo vem da tela "New self-hosted runner" do GitHub:
.\config.cmd --url https://github.com/Ratel-tech/ismerim-whatsapp-bot --token SEU_TOKEN_DE_REGISTRO --name ismerim-windows --labels self-hosted,Windows --unattended
```

3. Instalar e iniciar como servico (permite deploy apos reboot):

```powershell
.\svc.cmd install
.\svc.cmd start
```

4. Confirmar: em **Settings -> Actions -> Runners** o runner aparece como **Idle** (verde).

### Requisitos da maquina do runner

- **Docker Desktop** instalado e rodando (o deploy usa `docker compose`).
- Acesso a pasta `PROJECT_DIR` (mesmo caminho usado no workflow).
- Git configurado para `fetch`/`reset` (o workflow roda `git -C $PROJECT_DIR ...`).

### Verificacao

- Aba **Actions**: a run deve mostrar `ci` (success) e `deploy` (success), com o health check passando.
- Local: `docker ps` deve mostrar `ismerim-bot` up na porta 3081.

## Deploy manual (alternativa sem runner)

Equivalente ao que o job `deploy` faz:

```powershell
git fetch origin master
git reset --hard origin/master
docker compose up -d --build
(Invoke-WebRequest http://localhost:3081/api/status -UseBasicParsing).StatusCode
```
