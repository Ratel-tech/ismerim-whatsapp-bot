# Arquitetura

## Visao geral

O sistema e um processo Node.js unico (TypeScript, ESM) que amarra quatro partes:

1. **WhatsApp (Baileys)** — sessao da loja, recepcao de mensagens/audio e envio de respostas.
2. **Agente de IA** — interpreta a mensagem do cliente e devolve uma intencao estruturada (agendar, cancelar, remarcar, confirmar, listar agenda, transferir...).
3. **Backend de dominio** — valida tudo contra o catalogo e o banco, cria/gerencia agendamentos e dispara notificacoes.
4. **Painel HTTP** (`http://localhost:3081`) — QR/status, agenda, conversas, catalogo, agente, config e API REST.

Principio central: **o LLM nunca grava dados**. Ele apenas sugere uma acao; o backend valida (servico existe, data futura, dentro do expediente, vaga livre, profissional ativo) e so entao persiste.

## Modulos (`src/`)

```
src/
  index.ts           # bootstrap: amarra Store, WhatsApp, Agent, HTTP, lembretes e notificacoes
  config.ts          # leitura do .env (PORT, IA, TZ, pausa humana, lembretes, DATA_DIR...)
  log.ts             # logs (console + data/logs.txt)
  store.ts           # data/db.json (clientes, conversas, agendamentos, profissionais, vinculos)
  catalog.ts         # config/catalog.json (servicos, duracoes, promocoes, horarios)
  agent-config.ts    # config/agent.json (personalidade/instrucoes)
  prompt.ts          # prompts do agente (cliente e operador)
  ai.ts              # chamada a IA + validacao zod do JSON estruturado
  providers.ts       # provedores de IA (deepseek/openai/codex/gemini)
  agent.ts           # mensagem -> IA -> acoes
  papeis.ts          # identidade: cliente | admin | profissional
  profissionais.ts   # dominio do profissional + DTO publico (sem telefone)
  bookings.ts        # validacao: criar, cancelar, remarcar, confirmar, passado
  booking-flow.ts    # adapta a saida do agente para o backend
  atendimento.ts     # agendar/remarcar pelo painel (atendimento humano) + notificacoes
  operador.ts        # agenda do operador + marcar como feito
  notifier.ts        # notificacoes/lembretes gerados pelo backend
  whatsapp.ts        # Baileys (sessao, QR, presenca, mensagens/audio)
  stt.ts             # transcricao de audio
  broadcast.ts       # envio em massa (lotes/limite diario)
  funnel.ts          # funil de atendimento
  http.ts            # painel :3081 (HTML+JS embutidos) + API REST
```

## Fluxo de uma mensagem de cliente

```
Cliente (WhatsApp)
      -> whatsapp.ts (Baileys)
      -> agent.ts (debounce/agrupamento + presenca)
      -> ai.ts / providers.ts (DeepSeek)
      -> metadados (catalog + prompt)
      <- intencao estruturada (JSON validado por zod)
      -> backend:
           agendar   -> booking-flow.ts -> bookings.ts -> store.addBooking
           cancelar  -> bookings.cancelBookingCliente
           remarcar  -> bookings.validateAndRescheduleBooking
           confirmar -> bookings.confirmBookingCliente
           transferir-> store.markNeedsHuman + notifica ADMIN
      -> notifier.ts (ADMIN + profissional)
      <- resposta ao cliente (whatsapp.ts)
```

## Fluxo de atendimento humano

- Ao enviar uma mensagem pelo painel, o agente e **pausado** naquela conversa (`store.setHuman(jid, true)`).
- Ele **retoma sozinho** quando o cliente volta a falar apos `HUMAN_PAUSE_MINUTES` (0 = nunca retoma) ou pelo botao "Voltar para o agente de IA".
- Durante a pausa, o atendente pode **agendar/remarcar** o corte pela ficha do cliente; esse caminho passa por `atendimento.ts` e usa as mesmas validacoes/notificacoes do agente. Ver [agendamento-e-atendimento-humano.md](agendamento-e-atendimento-humano.md).

## Persistencia

- Arquivo unico `data/db.json` (fora do Git) — clientes, conversas, agendamentos, profissionais e vinculos.
- Escrita **atomica** (`tmp` + `rename`) e backup automatico se corromper.
- **Migracoes aditivas** no codigo (`src/store.ts`) — nunca apaga dados existentes.
- `data/` guarda tambem `sessions/` (WhatsApp) e `logs.txt`.
- `DATA_DIR` permite manter o banco fora do projeto/OneDrive (ver [configuracao.md](configuracao.md)).

## Decisoes de projeto

- **Backend valida tudo** (anti-alucinacao): precos, servicos e horarios vem do catalogo, nunca do LLM.
- **Privacidade:** o telefone do profissional nunca aparece no agente/cliente/CSV; e resolvido apenas no backend para envio.
- **Separacao de responsabilidades:** `agent.ts` interpreta; `bookings.ts`/`atendimento.ts` decidem; `store.ts` persiste; `notifier.ts` avisa.
- **Testes** cobrem as regras de dominio (validacao, notificacao, papeis, atendimento) em `tests/` com Vitest.

## Tecnologias

| Item | Valor |
|---|---|
| Runtime | Node.js >= 20 (Docker usa Node 24) |
| Linguagem | TypeScript (ESM, `NodeNext`, strict) |
| WhatsApp | `@whiskeysockets/baileys` 7.0.0-rc14 (cliente nao oficial) |
| IA | DeepSeek por padrao; tambem OpenAI, Codex e Gemini |
| Validacao | zod |
| Testes | Vitest |
| Lint | Biome |
