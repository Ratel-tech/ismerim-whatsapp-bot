# 💈 Ismerim WhatsApp Bot

Bot de WhatsApp da **Ismerim Barbearia**: conecta o WhatsApp da loja (Baileys), atende clientes com IA (DeepSeek ou outro provedor) usando o catálogo da barbearia, cria/gerencia agendamentos de verdade e notifica **admin** e **barbeiros**.

- **Cliente:** tira dúvidas, vê serviços e preços (só quando pergunta), agenda, cancela, remarca e confirma presença.
- **Admin/Barbeiro (operador):** vê a agenda, cria agendamentos para clientes e marca como feito — tudo pelo WhatsApp.
- **Painel web** (`http://localhost:3081`) para QR/status, agendamentos, profissionais, conversas, catálogo, agente e configurações.

---

## Como usar

```powershell
.\start.ps1
```

1. O terminal imprime o QR Code — escaneie com o celular (WhatsApp → Aparelhos conectados).
2. Alternativa: abra `http://localhost:3081` e use o QR na página ou **"Conectar por código"**.
3. Pronto — clientes podem conversar e agendar.

> A sessão fica salva em `data/sessions`: reiniciar o bot **não exige novo QR**.

### Docker (produção)

```powershell
docker compose up -d --build
```

- `docker-compose.yml` sobe o container `ismerim-bot` na porta `3081`, com fuso `America/Sao_Paulo`.
- Volumes: `./data` (banco/sessão/logs), `./config` (catálogo/agente ao vivo) e `./.env`.

---

## Configuração (`.env`)

```env
PORT=3081
HOST=127.0.0.1                 # 0.0.0.0 dentro do Docker
TZ=America/Sao_Paulo           # fuso do estabelecimento (datas/lembretes)

# IA (deepseek | openai | codex | gemini)
AI_PROVIDER=deepseek
AI_API_KEY=
AI_MODEL=deepseek-chat
# legado: DEEPSEEK_API_KEY / DEEPSEEK_MODEL (usados se AI_* estiver vazio)

# Transcrição de áudio (opcional)
TRANSCRIBE_ENABLED=true
TRANSCRIBE_API_KEY=
TRANSCRIBE_BASE_URL=https://api.openai.com/v1/audio/transcriptions
TRANSCRIBE_MODEL=whisper-1

ADMIN_PHONE=5511999999999      # recebe notificações (agendamento, confirmação, cancelamento...)
PANEL_TOKEN=                   # opcional: senha do painel (se vazio, painel sem senha)

HUMAN_PAUSE_MINUTES=30         # agente pausa quando um atendente responde e retoma após X min (0 = nunca)
REMINDER_MINUTES_BEFORE=120    # lembrete ao cliente N min antes do agendamento (0 = desliga)

# Banco de dados (opcional; padrão ./data dentro do projeto)
DATA_DIR=                      # ex.: C:/IsmerimBot/dados
DATA_HOST_DIR=                 # (Docker) pasta do host montada em /app/data
```

Salvar `ADMIN_PHONE`/IA pela aba **Config** já vale sem reiniciar (atualiza `.env` e a memória).

---

## Banco de dados

- Arquivo único: **`data/db.json`** (fora do Git) — clientes, conversas, agendamentos, profissionais e vínculos.
- Escrita **atômica** (`tmp` + `rename`) e backup automático (`db.json.corrompido-<data>`) se corromper.
- **Migrações aditivas** no código (`src/store.ts`) — nunca apaga dados existentes.
- `data/` guarda também `sessions/` (WhatsApp) e `logs.txt`.

---

## Catálogo (`config/catalog.json`)

Editável no painel (aba **Catálogo**) ou no arquivo — o bot lê a cada mensagem (sem reiniciar):

- `horarios`: expediente por dia da semana (0=domingo ... 6=sábado)
- `servicos`: `nome`, `preco`, `duracao` (min, opcional) e `descricao` (opcional)
- `promocoes`: `nome`, `preco`, `de` (preço "de"), `valida_ate` (opcional) e `descricao`

> O agente **nunca inventa** preços, promoções, serviços ou horários: responde só com o que está no catálogo, e o backend valida tudo antes de registrar (serviço existe, data futura, expediente, vaga livre, profissional ativo).

`config/agent.json` define a personalidade/instruções do agente (também editável na aba **Agente**).

---

## Funcionalidades

### Cliente
- Responde dúvidas, apresenta serviços/promoções (preço só quando perguntado).
- **Agenda**, **cancela**, **remarca** e **confirma presença** — sempre validado no backend.
- Entende **datas passadas** (marca como "JÁ PASSOU"; não trata como ativo).
- Áudio: transcreve notas de voz (STT).

### Admin / Barbeiro (operador)
- Identificados por **telefone** (`ADMIN_PHONE` / telefone do profissional) ou **vínculo manual** na ficha da conversa (aba **Conversas**).
- **Ver agenda:** admin vê tudo; **barbeiro vê só os agendamentos dele do dia**.
- **Criar agendamento de cliente:** nome + telefone (pede sempre) + serviço + data/hora. Para o barbeiro, o agendamento é **sempre dele** (só muda se ele informar outro profissional). Pode criar quantos quiser.
- **Marcar como feito:** admin em qualquer; barbeiro só nos dele (somente passados).

### Lembretes e confirmação
- **2h antes** (`REMINDER_MINUTES_BEFORE`), o cliente recebe um lembrete com **SIM / CANCELAR**.
- Se o cliente **confirmar**, o **admin e o barbeiro** são avisados.
- Se **cancelar**, cai no fluxo de cancelamento (admin + barbeiro avisados).

### Atendimento humano (pausa)
- Ao enviar uma mensagem pelo painel, o agente **pausa** naquela conversa.
- Ele **retoma sozinho** quando o cliente voltar a falar após `HUMAN_PAUSE_MINUTES` (ou pelo botão "Voltar para o agente de IA").

### Contatos
- Todo cliente que manda mensagem tem **nome + telefone real** salvos (quando o WhatsApp entrega).
- **Exportar CSV** (aba Conversas) gera `contatos.csv` (`Nome,Telefone,JID`) para importar na agenda do celular.

### Status do agendamento
- `confirmado` · `cancelado` · `feito` — e identificação de **passado** no painel e no agente.

---

## Painel (`http://localhost:3081`)

Abas: **WhatsApp** (QR/status) · **Agendamentos** (status + marcar feito) · **Profissionais** (cadastro + telefone privado) · **Conversas** (inbox estilo WhatsApp, envio em massa, exportar contatos) · **Agente** · **Catálogo** · **Config**.

- O painel **lembra a aba ativa** ao recarregar.
- O telefone do profissional é **privado**: nunca aparece no agente/cliente/CSV.

---

## Comandos

| Comando | Descrição |
|---|---|
| `.\start.ps1` | Instala dependências (1ª vez) e inicia o bot |
| `npm test` | Testes (vitest) — sem tocar no `data/logs.txt` |
| `npm run typecheck` | Typecheck do código **e** dos testes |
| `npm run lint` | Lint (Biome) de `src`, `tests` e `scripts` |
| `npm run build` | Compila TypeScript para `dist/` |
| `npm run dev` | Roda em modo desenvolvimento (`tsx`) |
| `npx tsx scripts/smoke.ts` | Simula um cliente conversando (IA real) |
| `npx tsx scripts/smoke-roteiro.ts` | Roteiro de perguntas e mede a taxa de fallback da IA |

---

## Estrutura

```
src/
├── index.ts         # bootstrap: amarra Store, WhatsApp, Agent, HTTP e agendadores
├── config.ts        # .env (PORT, IA, TZ, pausa, lembretes, DATA_DIR...)
├── log.ts           # logs (console + data/logs.txt)
├── store.ts         # data/db.json (clientes, conversas, agendamentos, profissionais, vínculos)
├── catalog.ts       # config/catalog.json (serviços, durações, promoções, horários)
├── agent-config.ts  # config/agent.json (personalidade/instruções)
├── prompt.ts        # prompts do agente: cliente e operador (admin/barbeiro)
├── ai.ts            # chamada à IA + validação zod do JSON estruturado
├── providers.ts     # provedores de IA (deepseek/openai/codex/gemini)
├── agent.ts         # mensagem → IA → ações (agendar/cancelar/remarcar/confirmar/agenda)
├── papeis.ts        # identidade: cliente | admin | profissional (telefone/vínculo)
├── profissionais.ts # domínio do profissional + DTO público (sem telefone)
├── bookings.ts      # validação: criar, cancelar, remarcar, confirmar, passado
├── booking-flow.ts  # adapta a saída do agente para o backend
├── operador.ts      # agenda do operador + marcar como feito
├── notifier.ts      # notificações/lembretes gerados pelo backend
├── whatsapp.ts      # Baileys (sessão, QR, presença, mensagens/áudio)
├── stt.ts           # transcrição de áudio
├── broadcast.ts     # envio em massa (lotes/limite diário)
├── funnel.ts        # funil de atendimento
└── http.ts          # painel :3081 (HTML+JS embutidos) + API REST
```

---

## CI/CD

- `.github/workflows/ci.yml`: job **`ci`** (typecheck, testes, lint, build, docker build) e job **`deploy`** (self-hosted Windows: `git reset --hard` + `docker compose up -d --build` + health check).
- O `deploy` só roda se houver um **runner self-hosted** registrado.

---

## Segurança e privacidade

- `.env`, `data/` e `chave API.txt` **não** vão para o Git.
- Telefone de profissional é **privado** (só no backend; nunca no agente/cliente/CSV).
- Painel pode ser protegido com `PANEL_TOKEN`.
