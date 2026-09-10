# CI/CD para o Ismerim WhatsApp Bot — Design

**Data:** 2026-09-10
**Status:** Aprovado (Abordagem A)
**Contexto:** O projeto já tem Docker (`Dockerfile`, `docker-compose.yml`) e um CI básico (`.github/workflows/ci.yml`: typecheck, test, lint, build). Falta o CD: build da imagem e deploy automático nesta máquina.

## Objetivo

A cada push na branch `master`, testar, validar o build da imagem Docker e implantar automaticamente a aplicação nesta máquina Windows, preservando `.env`, a sessão do WhatsApp (`data/`) e as edições de runtime em `config/*.json`.

## Não-objetivos (YAGNI)

- Registry de imagens (ghcr.io/Docker Hub) — desnecessário para deploy em máquina única.
- Deploy em servidor remoto / SSH.
- Ambientes múltiplos (staging/produção).
- Rollback automático por tag.

## Arquitetura

### Um workflow (`.github/workflows/ci.yml`), dois jobs

Gatilhos: `push`, `pull_request` e `workflow_dispatch`.

**Job `ci`** — `runs-on: ubuntu-latest`, sempre roda:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run lint`
5. `npm run build`
6. `docker build` (sem push) — valida o `Dockerfile` antes do deploy.

**Job `deploy`** — `runs-on: [self-hosted, Windows]`, `needs: ci` e
`if: (github.event_name == 'push' && github.ref == 'refs/heads/master') || github.event_name == 'workflow_dispatch'`.
- Passos (PowerShell):
  1. **Atualizar código preservando runtime:** copia `config\*.json` para `$env:RUNNER_TEMP`, roda `git -C <projeto> fetch origin master` e `git -C <projeto> reset --hard origin/master`, e restaura `config\*.json`.
  2. **Rebuild/restart:** `docker compose --project-directory <projeto> up -d --build`.
  3. **Health check:** aguarda e exige HTTP 200 em `http://localhost:3081`; falha o job caso contrário.

O caminho do projeto é fixo (`C:\Users\ismer\OneDrive\Desktop\Ismerim BOT Whatsapp`), passado por variável de ambiente do workflow.

### Runner self-hosted

- Runner oficial instalado em `C:\actions-runner`, registrado no repo `Ratel-tech/ismerim-whatsapp-bot` com labels `self-hosted, Windows`.
- Deve rodar como o usuário `ismer` para acessar a pasta no OneDrive e o Docker Desktop.

### Preservação de estado

| Item | Mecanismo |
|---|---|
| `.env` | Fora do git; bind mount; intocado pelo deploy |
| `data/` (sessão, db, logs) | Fora do git; bind mount; intocado |
| `config/*.json` | Versionado; backup+restore no deploy (o painel edita em runtime) |

## Arquivos afetados

- Modificar: `.github/workflows/ci.yml` (adicionar `docker build` no job `ci` e o job `deploy`).
- Criar (infra, fora do repo): runner em `C:\actions-runner`.
- Commitar: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `src/config.ts`, `src/index.ts`, `start.ps1`, workflows.
- Não commitar: a alteração de runtime em `config/agent.json`.

## Segurança

- Nenhum segredo no workflow; `.env` permanece apenas na máquina.
- `PANEL_TOKEN` vazio hoje expõe o painel na rede — recomendação separada (fora do escopo do CI/CD).

## Verificação

1. PR para `master`: CI roda; `deploy` não dispara.
2. Push/merge na `master`: CI verde → `deploy` no runner → container recriado → health check 200.
3. `docker compose ps` mostra o container `ismerim-bot` saudável e a sessão do WhatsApp preservada (sem novo QR).

## Riscos / pontos de atenção

- O runner precisa do Docker Desktop ativo; se a máquina estiver desligada, o deploy fica na fila.
- Serviço do runner como usuário `ismer` pode exigir a senha do Windows no `config.cmd`.
- OneDrive Files On-Demand pode deixar arquivos como placeholders; o `git fetch/reset` deve hidratá-los.
- `config/*.json` versionado: se o repo mudar os defaults, o restore pós-deploy mantém a versão de runtime (comportamento desejado).
