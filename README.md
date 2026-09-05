# 💈 Ismerim WhatsApp Bot

Bot de WhatsApp minimalista para a Ismerim Barbearia: conecta o WhatsApp da loja (Baileys), responde clientes com IA (DeepSeek) usando o catálogo da barbearia e notifica o dono quando um cliente confirma um agendamento.

## Como usar

```powershell
.\start.ps1
```

1. O terminal imprime o QR Code — escaneie com o celular (WhatsApp → Aparelhos conectados)
2. Alternativa: abra `http://localhost:3081` e use o QR na página ou o botão **"Conectar por código"**
3. Pronto — clientes podem conversar e agendar

## Configuração (arquivo `.env`)

```
PORT=3081
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat
ADMIN_PHONE=5511999999999   # número que recebe a notificação de novo agendamento
PANEL_TOKEN=                # opcional: senha do painel local (se vazio, painel sem senha)
```

> Salvar o `ADMIN_PHONE` pela aba **Config** do painel já vale sem reiniciar o bot (atualiza o `.env` e a memória).

## Catálogo (`config/catalog.json`)

Editável no bloco de notas — o bot lê a cada mensagem (sem reiniciar):

- `horarios`: expediente por dia da semana (0=domingo ... 6=sábado)
- `servicos`: nome + preço (+ descrição)
- `promocoes`: nome + preço (+ "de", + "valida_ate" opcional)

> O agente NUNCA inventa preços, promoções ou horários: só responde com o que está no catálogo, e o backend valida o agendamento antes de registrar (serviço existe, data futura, horário no expediente, vaga livre).

## Como funciona

```
Cliente → WhatsApp (Baileys) → agente IA (DeepSeek) → resposta
         → cliente confirma agendamento → validação → data/db.json
         → notificação formatada → ADMIN_PHONE (mesmo número conectado)
```

- Sessão salva em `data/sessions` — reiniciar o bot **não exige novo QR** (o encerramento gracioso preserva a sessão)
- Agendamentos e conversas em `data/db.json` (1 arquivo: backup fácil; escrita atômica e backup automático se corromper)
- Logs no terminal e em `data/logs.txt`
- Testar sem celular: `npx tsx scripts/smoke.ts`
- Medir a qualidade das respostas da IA (DeepSeek real): `npx tsx scripts/smoke-roteiro.ts`

## Comandos

| Comando | Descrição |
|---|---|
| `.\start.ps1` | Instala dependências (1ª vez) e inicia o bot |
| `npm test` | 76+ testes (vitest) — sem tocar no `data/logs.txt` |
| `npm run typecheck` | Typecheck do código **e** dos testes |
| `npm run lint` | Lint (Biome) de `src`, `tests` e `scripts` |
| `npm run build` | Compila TypeScript para `dist/` |
| `npx tsx scripts/smoke.ts` | Simula um cliente conversando (DeepSeek real) |
| `npx tsx scripts/smoke-roteiro.ts` | Roteiro de 10 perguntas e mede a taxa de fallback da IA |

## Estrutura

```
src/
├── index.ts        # bootstrap (tudo orquestrado)
├── config.ts       # .env
├── log.ts          # logs (console + data/logs.txt)
├── store.ts        # data/db.json (clientes, conversas, agendamentos)
├── catalog.ts      # carrega config/catalog.json
├── prompt.ts       # prompt do agente (catálogo + regras)
├── ai.ts           # DeepSeek + validação do JSON estruturado
├── agent.ts        # mensagem → IA → resposta
├── bookings.ts     # validação e registro de agendamentos
├── notifier.ts     # notificação gerada pelo backend
├── whatsapp.ts     # Baileys (sessão, QR, mensagens)
└── http.ts         # página única :3081 (QR, status, agendamentos)
```
