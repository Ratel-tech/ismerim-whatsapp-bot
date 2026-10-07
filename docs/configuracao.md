# Configuracao

## `.env`

Copie o modelo e preencha:

```powershell
Copy-Item .env.example .env
```

| Variavel | Padrao | Descricao |
|---|---|---|
| `PORT` | `3081` | Porta do painel/API |
| `HOST` | `127.0.0.1` | Interface de escuta (`0.0.0.0` no Docker) |
| `TZ` | `America/Sao_Paulo` | Fuso do estabelecimento (datas/lembretes) |
| `DATA_DIR` | `./data` | Pasta do banco/sessao/logs (pode ficar fora do OneDrive) |
| `DATA_HOST_DIR` | - | (Docker) pasta do host montada em `/app/data` |
| `AI_PROVIDER` | `deepseek` | `deepseek` \| `openai` \| `codex` \| `gemini` |
| `AI_API_KEY` | - | Chave da IA |
| `AI_MODEL` | `deepseek-chat` | Modelo |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` | - | Legado (fallback se `AI_*` vazio) |
| `TRANSCRIBE_ENABLED` | `true` | Liga/desliga transcricao de audio |
| `TRANSCRIBE_API_KEY` | - | Chave do endpoint de STT |
| `TRANSCRIBE_BASE_URL` | OpenAI | Endpoint `/audio/transcriptions` |
| `TRANSCRIBE_MODEL` | `whisper-1` | Modelo de transcricao |
| `ADMIN_PHONE` | - | Numero que recebe notificacoes (digitos com DDI) |
| `PANEL_TOKEN` | - | Senha do painel (vazio = sem senha) |
| `HUMAN_PAUSE_MINUTES` | `30` | Minutos que o agente fica pausado apos atendente responder (0 = nunca retoma) |
| `REMINDER_MINUTES_BEFORE` | `120` | Antecedencia do lembrete ao cliente (0 = desliga) |

`ADMIN_PHONE` e a IA podem ser salvos pela aba **Config** do painel (atualiza o `.env` e a memoria).

## Catalogo (`config/catalog.json`)

Editavel no painel (aba **Catalogo**) ou no arquivo — o bot le a cada mensagem (sem reiniciar):

- `horarios`: expediente por dia da semana (0=domingo ... 6=sabado).
- `servicos`: `nome`, `preco`, `duracao` (min, opcional), `descricao` (opcional).
- `promocoes`: `nome`, `preco`, `de` (preco "de"), `valida_ate` (opcional), `descricao`.

O agente nunca inventa precos, promocoes, servicos ou horarios: responde apenas com o que esta no catalogo, e o backend valida tudo antes de registrar.

## Agente (`config/agent.json`)

Personalidade e instrucoes do agente (aba **Agente**): `empresa`, `personalidade`, `instrucoes`, `prompt_extra`, `boas_vindas`, `transferencia`.

## Dados de runtime

- `data/db.json` — clientes, conversas, agendamentos, profissionais e vinculos.
- `data/sessions/` — sessao do WhatsApp (evita novo QR ao reiniciar).
- `data/logs.txt` — logs.

## Seguranca e privacidade

- `.env`, `data/` e `chave API.txt` **nao** vao para o Git (ver `.gitignore`).
- Telefone de profissional e privado (so no backend; nunca no agente/cliente/CSV).
- Proteja o painel com `PANEL_TOKEN`.
