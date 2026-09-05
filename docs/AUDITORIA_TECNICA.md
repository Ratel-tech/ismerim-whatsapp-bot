# Auditoria Técnica — Ismerim WhatsApp Bot (AG 60)

- **Data da auditoria:** 04/09/2026
- **Projeto:** `AG 60 - WHATSAPP ISMERIM BARBEARIA` / `ismerim-whatsapp-bot` v1.0.0
- **Autor do histórico:** Ratel-tech (3 commits, todos em 28/08/2026)
- **Método:** leitura integral do código-fonte, testes, configurações e dados; execução de `typecheck`, `build`, `test` e checagem de tipos dos testes; inspeção de `data/db.json`, `data/logs.txt`, `.env` (apenas presença de chaves, sem valores), sessões do WhatsApp e histórico git (`git log`, `git show --stat`).

---

## 1. Resumo executivo

O projeto é um **bot de WhatsApp para a Ismerim Barbearia** (TypeScript, Node.js): conecta o WhatsApp da loja via Baileys, responde clientes com IA (DeepSeek) usando um catálogo local, conduz agendamentos com validação no backend e notifica o dono pelo próprio WhatsApp. Inclui um painel web local (`http://localhost:3081`) para QR Code, agendamentos, e edição de catálogo/agente/configurações.

**Estado atual:** código **funcional e organizado** para um piloto — build limpo, 48/48 testes passando, arquitetura em camadas simples e clara, com boa disciplina anti-alucinação (o LLM nunca grava dados direto; tudo passa por validação contra o catálogo). Porém ainda **não houve operação real consolidada**: não há agendamentos fechados, o `ADMIN_PHONE` está vazio (notificação nunca dispararia hoje), a sessão do WhatsApp não persiste entre reinícios e não existe remote git (zero backup remoto).

Os achados mais relevantes:

| # | Severidade | Achado |
|---|---|---|
| 1 | 🔴 Alta | `shutdown()` destrói a sessão WhatsApp a cada saída graciosa — contradiz o README e o requisito "não precisa novo QR ao reiniciar" |
| 2 | 🔴 Alta | `.env` atual está sem `ADMIN_PHONE` → notificações de agendamento nunca são enviadas no estado atual |
| 3 | 🟠 Média | `config/agent.json` está com caracteres corrompidos (U+FFFD) no campo `personalidade` (bytes `EF BF BD`) |
| 4 | 🟠 Média | Testes têm erros de tipo invisíveis (`AIProvider` não existe em `ai.ts`); `typecheck` não cobre `tests/` |
| 5 | 🟠 Média | Painel web sem autenticação — qualquer processo local pode gerar pairing code / resetar sessão / reescrever arquivos |
| 6 | 🟡 Baixa/Média | Salvar `ADMIN_PHONE` na UI não tem efeito sem reiniciar o processo (config é lida uma única vez no boot) |
| 7 | 🟡 Baixa | `db.json` (único armazenamento) escrito de forma síncrona, sem escrita atômica, sem backup e com perda silenciosa se corromper |
| 8 | 🟡 Baixa | `intent: "finalizar"` existe no contrato, mas não é tratado no agente; `transferir` não avisa o dono |
| 9 | 🟡 Baixa | Pendência de agendamento (`pendingBooking`) nunca expira |
| 10 | 🟡 Baixa | README desatualizado (diz 44 testes; são 48; diz que sessão persiste) |

---

## 2. Identificação técnica

| Item | Valor |
|---|---|
| Linguagem / runtime | TypeScript 5.7 (ESM, `NodeNext`), Node v25.2.1, strict mode |
| WhatsApp | `@whiskeysockets/baileys` **7.0.0-rc14** (versão exata, sem `^`) — cliente *não oficial* |
| IA | DeepSeek API (`deepseek-chat`), `response_format: json_object`, timeout 60 s |
| Armazenamento | `data/db.json` (JSON único) + `data/sessions` (credenciais Baileys) + `data/logs.txt` |
| HTTP | servidor `node:http` puro (sem framework), bind `127.0.0.1:3081`, página única com JS embutido |
| Testes | Vitest 2.1.9 — 7 arquivos, 48 testes |
| Validação | zod 3.24 (schemas estritos) |
| Build/tooling | `tsx` (dev), `tsc` (build), `npm run typecheck` |
| Repositório | git local, branch `master`, **sem remote**, 3 commits em 28/08/2026 (03:10→03:30 BRT) |

### Estrutura e inventário (LOC efetivas)

```
src/
├── index.ts        79   bootstrap: amarra Store, WhatsApp, Agent, HTTP e shutdown
├── config.ts       32   lê .env, define caminhos; updateEnv() grava no .env
├── log.ts          11   log console + data/logs.txt (append síncrono)
├── store.ts       131   data/db.json: clientes, conversas, pendingBooking, bookings
├── catalog.ts      90   carrega/valida config/catalog.json (serviços, promoções, horários)
├── agent-config.ts 31   carrega/valida config/agent.json (personalidade do agente)
├── prompt.ts       66   monta o system prompt (catálogo + regras + data atual)
├── ai.ts          124   chamada DeepSeek + parsing/validação zod da resposta JSON
├── agent.ts       136   mensagem → histórico → IA → ações (agendar/transferir/fallback)
├── bookings.ts     87   validação e registro de agendamento (backend decide)
├── notifier.ts     31   monta a notificação ao admin (sempre gerada pelo backend)
├── whatsapp.ts    244   Baileys: sessão, QR, pareamento, reconexão, mensagens
└── http.ts        401   painel web (HTML+CSS+JS embutido) + API REST mínima
scripts/smoke.ts    50   simula cliente conversando (DeepSeek real) sem WhatsApp
tests/            529   7 arquivos + helper fake AI provider
```

Configuração: `config/catalog.json` (6 serviços, 1 promoção, expediente seg–sáb 09:00–19:00), `config/agent.json` (personalidade), `.env` (PORT, DEEPSEEK_API_KEY, DEEPSEEK_MODEL, ADMIN_PHONE).

---

## 3. O que já foi feito (histórico e fases)

Tudo foi construído em **28/08/2026**, em 3 commits (~20 min entre o 1º e o último), por agente de IA + revisão do dono:

### Fase 1 — `a0e62e8` (03:10 BRT) — Bot mínimo
"feat: Fase 1 - bot WhatsApp minimalista (Baileys + DeepSeek + catalogo + pagina 3081)" — **21 arquivos, +5.111 linhas**
- Esqueleto completo: `index.ts`, `config.ts`, `log.ts`, `store.ts`, `catalog.ts`, `prompt.ts`, `ai.ts`, `agent.ts`, `whatsapp.ts`, `http.ts` (primeira versão, 185 linhas), `scripts/smoke.ts`
- Catálogo inicial (`config/catalog.json`, 27 linhas), `.env.example`, `start.ps1`, `tsconfig.json` (strict), `.gitignore`
- Testes de base: parsing da IA (`ai-parse`), catálogo, store
- Funcionalidades: QR no terminal + página 3081, resposta por IA com catálogo, persistência de sessão e conversas

### Fase 2 — `c1c1078` (03:18 BRT) — Agendamento validado + notificação
"feat: Fase 2 - agendamento com validacao + notificacao ao administrador + testes" — **10 arquivos, +618/-9**
- Novos módulos `bookings.ts` (validação: serviço existe no catálogo, data real/futura, horário no expediente, vaga livre) e `notifier.ts` (mensagem do admin gerada 100% pelo backend)
- `agent.ts` passa a detectar `intent: booking` com `requested`/`confirmed` e chama `onBookingConfirmed` injetável
- `index.ts` liga o fluxo real: confirmação → validação → gravação → envio ao `ADMIN_PHONE` + `markNotified`
- Testes novos: `agent.test.ts` (7), `bookings.test.ts` (8), `notifier.test.ts` (2) + helper `FakeAIProvider`
- README criado (72 linhas)

### Fase 3 — `9d2bd1c` (03:30 BRT) — Painel completo + robustez da IA
"feat: interface grafica com abas (WhatsApp, Agendamentos, Agente, Catalogo, Config) + robustez no parsing da IA" — **11 arquivos, +539/-93**
- `http.ts` cresce para 401 linhas: interface em abas (WhatsApp / Agendamentos / Agente / Catálogo / Config), API `/api/status`, `/api/reconnect`, `/api/pairing-code`, `/api/agent-config` (GET/PUT), `/api/catalog` (GET/PUT), `/api/admin-phone` (PUT)
- `agent-config.ts` novo (config/agent.json editável pela UI), catálogo enriquecido (80 linhas, promoção com validade)
- Robustez do parsing: retry automático quando a IA responde fora do contrato JSON (2ª chamada com temperatura 0.3 e lembrete)
- `store/config/catalog`: ajustes de suporte (ex.: reescrita do `.env` via `updateEnv`)
- Testes de `agent-config` (+4)

> Observação: os logs mostram que o teste ao vivo no WhatsApp real (conversa com cliente "Juan", ~03:24–03:30 BRT) **antecedeu a Fase 3** — várias respostas caíram no fallback "Desculpe, não consegui processar sua mensagem" durante esse teste, o que motivou a robustez adicionada na Fase 3.

---

## 4. Estado atual verificado (evidências de 04/09/2026)

### 4.1 Qualidade — comandos executados nesta auditoria

| Verificação | Comando | Resultado |
|---|---|---|
| Testes | `npm test` | ✅ **48/48 passando** (7 arquivos; 380 ms) |
| Typecheck (src) | `npm run typecheck` | ✅ sem erros |
| Build | `npm run build` | ✅ gera `dist/` |
| Typecheck dos testes | `npx tsc --noEmit … tests/*.ts` | ❌ **2 erros** (ver achado F-04) |

### 4.2 Ambiente (`data/`, `.env`, sessão)

| Item | Estado observado | Implicação |
|---|---|---|
| `DEEPSEEK_API_KEY` | ✅ preenchida no `.env` | IA funcionaria |
| `PORT`, `DEEPSEEK_MODEL` | ✅ definidos (3081, deepseek-chat) | — |
| `ADMIN_PHONE` | ⚠️ **vazio** | Notificação de agendamento **não é enviada** hoje (só log de warn) |
| `data/db.json` | 2 clientes, 2 conversas, **0 agendamentos**, `nextBookingId: 1` | Piloto: nenhum agendamento real fechado ainda |
| `data/sessions/` | Diretório **vazio** | Sessão do WhatsApp **não persiste** — cada início exige QR novo |
| `data/logs.txt` | Registros de 28/08 e de testes de 04/09 | Histórico de execução consultável; testes poluem o log (ver F-10) |
| Remote git | **Não existe** (`git remote -v` vazio) | Nenhum backup remoto do código |
| `config/agent.json` | Campo `personalidade` com bytes corrompidos | Ver achado F-03 |

### 4.3 Comportamento real observado nos logs (28/08)

Sequência no log (horários UTC; −3 h = BRT):
1. **03:24–03:26 BRT** — bot conectado e atendendo de verdade (cliente interage; 3 respostas boas, 2 quedas no fallback).
2. **03:27 BRT** — `logged out` (sessão encerrada — compatível com clique em "Gerar novo QR" ou fim do teste).
3. **03:29–03:30 BRT** — novo início: QR gerado, **nunca escaneado**; loop de `awaiting_scan` → `reconnecting` (backoff 5 s → 10 s → 20 s → 40 s) por ~15 min até o processo ser encerrado.

Lições dos dados reais: o fallback genérico apareceu com frequência relevante no teste ao vivo (ver F-12); o loop de QR expirado sem scan fica reconectando indefinidamente (comportamento esperado, mas ruidoso).

---

## 5. Arquitetura e pontos fortes

```
Cliente WhatsApp
   │  mensagem (Baileys → extractText, ignora grupos/status)
   ▼
whatsapp.ts (session, QR, reconnect, readMessages)
   ▼
agent.ts ──(store.ts: histórico 12 msgs + pendingBooking)──► prompt.ts (system prompt)
   │  chamada: ai.ts complete() [DeepSeek JSON mode]
   │  parse zod estrito (.strict()) + retry com lembrete
   ├─ intent=conversation ─────────────► responde reply
   ├─ intent=booking requested+confirmed► resolveService no catálogo → onBookingConfirmed
   │                                    └─► index.ts: bookings.validateAndCreateBooking()
   │                                         (data real/futura, expediente, vaga livre)
   │                                      → store.addBooking() → buildNotification()
   │                                      → envia ao ADMIN_PHONE + markNotified
   ├─ intent=transferir ────────────────► mensagem pronta (não avisa o dono)
   └─ falha (parse/API) ────────────────► fallback amigável
   ▲
http.ts — painel :3081 (QR, status, agendamentos, agente, catálogo, admin)
```

**Pontos fortes identificados (defesas em profundidade):**

1. **Anti-alucinação em 3 camadas** — o LLM só propõe; o backend valida: (a) prompt proíbe inventar e fixa contrato JSON; (b) zod `.strict()` rejeita campos fora do contrato (`ai.ts:72`); (c) `resolveService`/`validateAndCreateBooking` só aceitam serviço/expediente/vaga reais (`bookings.ts:29-71`). Evidência funcionando: log "serviço inventado 'Serviço Fantasma'" foi **bloqueado** no teste.
2. **Notificação ao admin gerada pelo backend**, nunca pelo LLM (`notifier.ts`).
3. **Injeção de dependências** no `Agent` (`sendText`, `complete`, `onBookingConfirmed`) → testes unitários sem rede nem WhatsApp.
4. **Parsing tolerante + retry**: extrai JSON com markdown/texto ao redor; 2ª tentativa com temperatura baixa quando o contrato falha (`agent.ts:86-99`).
5. **Anti-spam e serialização por cliente** (`agent.ts:41-59`): mínimo 2 s entre turnos e descarte de mensagens durante turno em andamento (com registro no histórico).
6. **QR com estabilidade** (`whatsapp.ts:35`): só troca de QR após 12 s de exibição (evita rotação infinita).
7. **Reconexão com backoff exponencial** limitado a 60 s (`whatsapp.ts:209-219`).
8. **Grupos e status ignorados** (`shouldIgnoreJid`, filtro `@g.us`/`status@broadcast`).
9. **Catálogo/agente lidos a cada mensagem** — editar `config/*.json` vale sem reiniciar.
10. Código limpo, pequeno (~1.500 LOC), strict mode, sem framework desnecessário, testes determinísticos com arquivos temporários.

---

## 6. Achados detalhados

### F-01 🔴 Encerrar o bot apaga a sessão do WhatsApp — reiniciar exige QR novo
**Local:** `src/index.ts:82-86` (`shutdown`) → `whatsapp.resetSession()` (`src/whatsapp.ts:93-105`).
**O que acontece:** no `SIGINT`/`SIGTERM`, o shutdown chama `resetSession()`, que faz `logout()` **e apaga `data/sessions/`**. Toda saída graciosa (Ctrl+C) derruba a sessão.
**Contradição:** o README diz "Sessão salva em `data/sessions` (reiniciar não exige novo QR)" — hoje isso só vale se o processo for morto à força.
**Evidência:** `data/sessions/` está vazio após os usos de 28/08; log mostra `logged out` seguido de novo QR sem scan.
**Recomendação:** no shutdown, encerrar apenas o socket (`sock.end()`), preservando credenciais; reservar `resetSession()` para o botão "Gerar novo QR". Corrigir o README conforme a decisão.

### F-02 🔴 `ADMIN_PHONE` vazio no `.env` — notificação nunca sai
**Local:** `src/index.ts:33-43`.
**Evidência:** verificação do `.env` (presença apenas): `ADMIN_PHONE=False`. Sem isso, o fluxo de confirmação salva o agendamento, mas só loga `warn 'ADMIN_PHONE não configurado'`.
**Recomendação:** preencher o número (ou configurar pela aba Config e reiniciar — ver F-06).

### F-03 🟠 `config/agent.json` com caracteres corrompidos
**Local:** `config/agent.json:3` — campo `personalidade`: "Simp�tico, atencioso, descontra�do e profissional…".
**Evidência:** bytes `EF BF BD` (U+FFFD) no arquivo — o texto foi salvo em encoding incompatível em algum momento.
**Impacto:** o prompt enviado ao DeepSeek contém "Simp�tico…", degradando a personalidade instruída (e qualquer processamento futuro do texto).
**Recomendação:** reescrever o arquivo como UTF-8 (ou salvar de novo pela aba "Agente" da UI, que grava UTF-8). Adicionar teste que detecta U+FFFD (ou `JSON` inválido) ao carregar.

### F-04 🟠 Testes fora do typecheck — há erros de tipo latentes
**Local:** `tsconfig.json` inclui só `src/**/*.ts`; testes rodam via Vitest (esbuild, sem checagem de tipos).
**Evidência (executado nesta auditoria):**
```
tests/helpers/fake-provider.ts(1,15): error TS2305: Module '"../../src/ai.js"' has no exported member 'AIProvider'
tests/agent.test.ts(25,53): error TS2554: Expected 0 arguments, but got 2.
```
`AIProvider` não existe mais em `ai.ts` (sobrinha de refatoração) e o fake ignora argumentos — os testes passam, mas o tipo está morto.
**Recomendação:** incluir `tests/**/*.ts` no `typecheck` (segundo tsconfig ou `vitest` com `tsc`) e limpar o contrato do fake; o `npm test` não deve ser a única barreira.

### F-05 🟠 Painel local sem autenticação
**Local:** `src/http.ts` (toda a API); mitigação única: bind `127.0.0.1` (`index.ts:74`).
**Riscos:** qualquer processo/usuário da máquina pode: gerar **pairing code** para conectar o WhatsApp do negócio a outro celular (`POST /api/pairing-code`), resetar a sessão (`/api/reconnect`), reescrever catálogo e `agent.json`, e alterar o `.env`. A API também expõe conversas/agendamentos/QR via `/api/status`.
**Recomendação (para piloto):** aceitável em máquina dedicada e sem uso remoto. Se um dia exposta em rede/`0.0.0.0` ou VPS, exigir **token simples** (ex.: senha no `.env`, header `Authorization`) em toda a API e servir o QR/`/` com CSP. Não expor `127.0.0.1` a outros usuários do Windows sem conta separada.

### F-06 🟡 Salvar ADMIN_PHONE pela UI não vale sem reiniciar
**Local:** `src/index.ts:70-71` (`updateEnv('ADMIN_PHONE', …)`) + `config.ts:10-21`.
**O que acontece:** `updateEnv` grava o arquivo `.env`, mas `config.adminPhone` (objeto em memória, lido no boot) **não é atualizado** — o `if (config.adminPhone)` de `index.ts:33` continua vendo o valor antigo até reiniciar. A UI informa apenas "Número salvo no .env!" sem avisar que exige reinício (diferente da nota da chave DeepSeek).
**Recomendação:** atualizar o objeto `config` em memória após `updateEnv` (ex.: `saveAdminPhone` retornar o novo valor e atribuí-lo), ou deixar explícito na UI que reinício é necessário.

### F-07 🟡 Persistência frágil: `db.json` sem escrita atômica, sem backup, perda silenciosa
**Local:** `src/store.ts:63-74` (read/write), usado a cada mensagem/agendamento; `log.ts` idem.
- `read()` com JSON inválido → devolve `emptyDb()` **em silêncio**; se o arquivo corromper (crash no meio de um `writeFileSync`, disco cheio), todo o histórico some e é sobrescrito no próximo `write`.
- `write()` grava o arquivo inteiro **de forma síncrona** no event loop (aceitável no volume atual — anti-spam limita a ~1 msg/2 s por cliente).
- Sem backup automático (única cópia em `data/`).
**Recomendação:** gravação atômica (`write tmp + rename`), validação com zod no `read` (rejeitar e **backupear** `db.json.corrompido-<data>` em vez de zerar), e rotina simples de backup periódico (ex.: cópia para `data/backups/` a cada N horas ou ao subir).

### F-08 🟡 `intent: "finalizar"` sem tratamento; `transferir` não notifica o dono
**Local:** contrato em `ai.ts:73-74` define `intent: conversation | booking | transferir | finalizar`; `agent.ts:114-115` só trata `transferir`.
- `finalizar` cai no comportamento padrão (responder `reply`) — se a intenção era limpar `pendingBooking`/dar um "tchau", não acontece.
- `transferir` apenas responde com a mensagem pronta: o dono **não é avisado** que um cliente pediu atendimento humano (lead pode se perder).
**Recomendação:** definir e implementar `finalizar` (ex.: limpar pendência e encerrar) ou removê-lo do contrato; no `transferir`, notificar o `ADMIN_PHONE` (reusando `notifier.ts`) quando configurado.

### F-09 🟡 `pendingBooking` nunca expira
**Local:** `store.ts:115-122` + prompt (`prompt.ts:22-24`).
Um cliente que começou um agendamento e voltou dias depois ainda é recebido com "AGENDAMENTO EM ANDAMENTO — confirme ou corrija", mesmo que o contexto tenha expirado.
**Recomendação:** guardar `updatedAt` na pendência e expirar (ex.: 24 h) ao montar o prompt ou ao receber nova mensagem.

### F-10 🟡 Testes escrevem no log e deixam arquivos temporários
**Local:** `log.ts:8` usa `config.logFile` fixo; testes de `agent.test.ts` acumulam `tmpFiles` sem limpar (`afterEach` ausente — diferente dos outros arquivos de teste).
**Evidência:** o `npm test` de hoje (04/09 23:05 BRT) **gravou no `data/logs.txt` de produção** (linhas "Agendamento rejeitado…" / "Falha de parsing…" no rodapé do log).
**Recomendação:** permitir injetar o arquivo de log (como `Store` faz) e limpar temporários no `afterEach` do `agent.test.ts`.

### F-11 🟡 Assimetria de fuso horário
- O prompt usa data **local** do servidor (`prompt.ts:11-12`, `toLocaleDateString`) e a validação usa `new Date()` local (`bookings.ts:46-48`) — consistente em máquina no fuso brasileiro.
- Mas `resolvePromocao` compara `valida_ate` com `toISOString()` (**UTC**) (`catalog.ts:67`) — perto da meia-noite ou com servidor em outro fuso, uma promoção pode valer/vigora no dia errado.
**Recomendação:** padronizar tudo em horário local do estabelecimento (ou configurar `TZ=America/Sao_Paulo` no processo e usar datas locais em ambos os pontos).

### F-12 🟡 Confiabilidade da resposta da IA no teste real (a melhorar com medição)
**Evidência nos dados reais (28/08, pré-Fase 3):** em ~5 interações do cliente, **2 caíram no fallback** "Desculpe, não consegui processar sua mensagem" ("Você sabe quando o Pelé morreu?" e "Quantos profissionais trabalham aí?"). A Fase 3 (retry com lembrete + temperatura baixa) endereça isso, mas **não há teste de regressão com o DeepSeek real** nem medição contínua da taxa de fallback.
**Recomendação:** rodar `scripts/smoke.ts` com um roteiro de perguntas variadas após a Fase 3, medir a taxa de sucesso, e considerar: mensagem de fallback mais útil (ex.: "não entendi, posso ajudar com serviços/horários/agendamento"), e tratamento de perguntas fora do escopo (a IA deve dizer que não sabe **sem** quebrar o contrato JSON).

### F-13 🟡 Notificação sem re-tentativa se o WhatsApp cair no momento exato
**Local:** `index.ts:33-40`: se `sendText` falhar (desconectado entre a mensagem do cliente e a notificação), registra `warn` e fica por isso — `notifiedAt` permanece `null`, mas nada re-tenta depois.
**Recomendação:** ao reconectar, varrer `bookings` com `notifiedAt == null` e reenviar (o campo já existe no modelo para isso).

### F-14 🟢 Portabilidade: separador de caminho Windows hardcoded
**Local:** `catalog.ts:36` e `agent-config.ts:33` usam `file.substring(0, file.lastIndexOf('\\'))` — falha em Linux/macOS (e é inconsistente com o resto do código, que usa `path`).
**Recomendação:** `path.dirname(file)`.

### F-15 🟢 Sem remote git / CI / lint / cobertura
- Repositório 100% local (sem backup), sem `lint`/formatador, sem pipeline de CI, sem cobertura de testes (Vitest roda sem `--coverage`), sem `engines` no `package.json`.
**Recomendação:** criar remote (GitHub/GitLab) e push imediato; adicionar `npm run lint` (ex.: `biome` ou `eslint`) e rodar testes no CI quando houver remote; `engines.node`.

### F-16 🟢 Baileys em release candidate pinada
**Local:** `package.json:16` — `"@whiskeysockets/baileys": "7.0.0-rc14"`.
Pinada (bom para reprodutibilidade), mas é uma **RC de cliente não oficial do WhatsApp** — risco permanente de quebra/logout em massa e de **bloqueio do número** (viola ToS da Meta). Para produção comercial real, considerar alternativas oficiais (WhatsApp Cloud API, Twilio, etc.) — há outros projetos no portfólio (AG 16, AG 47) que podem servir de base de comparação.

### F-17 🟢 Limitações funcionais de negócio (decisões conscientes, registrar)
- Painel lista só os **10 agendamentos mais recentes** (`index.ts:61`); sem busca/cancelamento/editar.
- Conflito de vaga é por **data+horário exatos** — sem duração de serviço nem múltiplos barbeiros.
- Sem lembrete automático ao cliente, sem confirmação do dono, sem cancelamento pelo cliente no WhatsApp.

---

## 7. Cobertura de testes (48)

| Arquivo | Testes | Cobre |
|---|---|---|
| `catalog.test.ts` | 11 | load, normalização, resolve serviço/promoção (anti-invenção), horários, formatação |
| `store.test.ts` | 8 | CRUD clientes/conversas/pendência, persistência entre instâncias, vaga ocupada |
| `bookings.test.ts` | 8 | validação (serviço, data passada/inválida, horário, expediente, domingo, vaga) e confirmação |
| `ai-parse.test.ts` | 8 | JSON válido, markdown ao redor, normalização data/hora, defaults, rejeições do schema estrito |
| `agent.test.ts` | 7 | fluxo com agendamento, bloqueio de serviço inventado, dados incompletos, fallback, anti-spam, notificação |
| `agent-config.test.ts` | 4 | defaults, merge, salvar/carregar, prompt incorpora configuração |
| `notifier.test.ts` | 2 | formatação de telefone e mensagem do admin |

**Lacunas relevantes:** nenhum teste para `whatsapp.ts` (reconexão/QR/mensagens) nem `http.ts` (rotas/validação de entrada) — as duas pontas mais arriscadas (rede e API aberta); nada testa `prompt.ts` contra o contrato de saída em conjunto com o retry; `store` corrompida não é testada; sem teste de encoding do `agent.json`/`catalog.json`.

---

## 8. Segurança e privacidade (LGPD — atenção)

- `data/db.json` guarda **conversas completas e identificadores de clientes** (telefone/JID) em texto puro. Para uso real: restringir permissões do diretório `data/`, incluir nos backups, e prever **apagamento de dados de um cliente quando solicitado** (direito do titular) — hoje não existe rota para isso.
- Chave DeepSeek no `.env` (não versionado — correto; `.gitignore` inclui `.env`). Cuidado para não commitar em remotes futuros.
- Painel sem senha (F-05) e com CSRF inexistente (API só JSON via fetch; risco baixo em localhost, mas zero se a origem for exposta).

---

## 9. Recomendações priorizadas (próximos passos)

**Correções rápidas (horas, alto valor):**
1. F-02: preencher `ADMIN_PHONE` no `.env` e reiniciar (ou configurar pela UI e reiniciar).
2. F-01: shutdown sem destruir a sessão (decisão de 5 linhas) — ou corrigir o README se o comportamento for intencional.
3. F-03: reescrever `config/agent.json` em UTF-8 (salvar pela aba Agente).
4. F-04: incluir `tests/` no typecheck e remover a interface fantasma `AIProvider`; padronizar o fake.
5. F-06: aplicar o novo `ADMIN_PHONE` também em memória.

**Médio prazo (1–3 dias):**
6. F-07: escrita atômica + backup de `db.json` corrompido + backup periódico.
7. F-08: tratar `finalizar` e notificar dono em `transferir`.
8. F-09: expirar `pendingBooking` (24 h).
9. F-10: log injetável; limpeza de temporários no `agent.test.ts`.
10. F-13: reenvio de notificações pendentes ao reconectar.
11. F-14/F-11: `path.dirname`; padronizar fuso (`TZ`).

**Estrutural / decisão de produto:**
12. F-15: remote git + CI + lint + cobertura.
13. F-12: roteiro de smoke real pós-Fase 3 e medição de fallback; melhorar fallback.
14. F-16: avaliar WhatsApp oficial (Cloud API) para produção.
15. F-17: definir roadmap funcional (gerenciar agendamentos no painel, cancelamento via WhatsApp, lembretes, multi-barbeiro/duração).

---

## 10. Comandos e dados de auditoria

```
git log --oneline                          # 3 commits (ver seção 3)
npm test                                   # 48/48 OK
npm run typecheck                          # OK (src/)
npm run build                              # OK
npx tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --resolveJsonModule --noUncheckedIndexedAccess --types node tests/**/*.ts   # 2 erros (F-04)
```

Arquivos de dados consultados (sem expor valores de segredo nem telefones): `.env` (presença de chaves), `data/db.json`, `data/logs.txt` (final), `config/catalog.json`, `config/agent.json` (análise de bytes), `data/sessions` (vazio).
