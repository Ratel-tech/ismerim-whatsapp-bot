# Operacao

## Requisitos

- Node.js >= 20 (para rodar local). O Docker usa Node 24.
- Docker Desktop (para o modo container).

## Rodar local (desenvolvimento)

```powershell
.\start.ps1
```

O script instala dependencias na primeira vez, cria o `.env` a partir do exemplo e roda `npm run dev`.

1. O terminal imprime o QR Code — escaneie com o celular (WhatsApp -> Aparelhos conectados).
2. Alternativa: abra `http://localhost:3081` e use o QR na pagina ou **"Conectar por codigo"**.
3. Pronto — clientes podem conversar e agendar.

A sessao fica salva em `data/sessions`: reiniciar o bot **nao exige novo QR**.

## Docker (producao)

```powershell
docker compose up -d --build
```

- Sobe o container `ismerim-bot` na porta `3081`, com `TZ=America/Sao_Paulo`.
- Volumes: `./data` (banco/sessao/logs), `./config` (catalogo/agente ao vivo) e `./.env`.
- Imagem: `ismerim-whatsapp-bot:latest`.

Comandos uteis:

```powershell
docker compose logs -f          # acompanhar logs
docker compose restart          # reiniciar
docker compose down             # parar
docker compose build            # reconstruir a imagem
```

Health check manual:

```powershell
(Invoke-WebRequest http://localhost:3081/api/status -UseBasicParsing).StatusCode  # 200
```

## Comandos npm

| Comando | Descricao |
|---|---|
| `npm run dev` | Roda em desenvolvimento (`tsx src/index.ts`) |
| `npm start` | Roda o build compilado (`node dist/index.js`) |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm run typecheck` | Typecheck do codigo **e** dos testes |
| `npm test` | Testes (Vitest) — nao toca em `data/logs.txt` |
| `npm run lint` | Lint (Biome) de `src`, `tests` e `scripts` |
| `npx tsx scripts/smoke.ts` | Simula um cliente conversando (IA real) |
| `npx tsx scripts/smoke-roteiro.ts` | Roteiro de perguntas e mede a taxa de fallback da IA |

## Dados, backup e migracao

- Banco unico `data/db.json` (ou em `DATA_DIR`). Escrita atomica + backup automatico `db.json.corrompido-<data>` se corromper.
- **Backup:** copie a pasta `data/` (contem `db.json`, `sessions/` e `logs.txt`).
- **Restauracao:** reponha a pasta `data/` e reinicie.
- **Deixar o banco fora do OneDrive:** defina `DATA_DIR=C:/IsmerimBot/dados` (`DATA_HOST_DIR` equivalente no Docker).
- Migracoes sao **aditivas** no codigo (`src/store.ts`); nunca apagam dados existentes.

## Boas praticas

- Nao versionar `.env`, `data/` nem `chave API.txt`.
- Proteger o painel com `PANEL_TOKEN` se ele ficar acessivel em rede.
- Usar `HOST=0.0.0.0` apenas no Docker (dentro da rede).
- Manter `ADMIN_PHONE` configurado, senao as notificacoes de agendamento nao sao enviadas.
