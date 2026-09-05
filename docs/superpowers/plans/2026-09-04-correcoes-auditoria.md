# Correções da Auditoria (F-01..F-15) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir os 15 achados técnicos da auditoria (F-01..F-15) com TDD estrito, commits por correção e verificação contínua, mantendo os 48 testes verdes e adicionando ~20 novos.

**Architecture:** Manter a estrutura em camadas; mudanças testáveis via injeção (Store/Agent/http já têm seams). Ordem por dependência: fundação de testes → dados/sessão → agente/config → HTTP/auth → processo.

**Tech Stack:** TypeScript strict, Vitest 2.1, zod, node:http, Biome (lint), GitHub Actions, `gh` (Ratel-tech logado).

**Decisões do dono (04/09/2026):** escopo F-01..F-15 (F-16/F-17 fora); F-05 com token via `.env`; F-15 com repo privado + push; F-02 (ADMIN_PHONE) pendente de número → só mecânica F-06; commits diretos em `master` (padrão do repo, consentido); execução inline com checkpoints por batch.

**Regras (TDD — Iron Law):** cada correção começa com teste que falha → ver RED → implementação mínima → ver GREEN → commit. Exceções acordadas: F-03 (correção de dados do arquivo), F-10 (infra de testes), F-14 (mudança mecânica), F-15 (processo/lint). Verificação a cada task: `npm run typecheck && npm test && npm run build`.

---

## Batch 1 — Fundação (F-04, F-10, F-03, F-14)

### Task 1: F-04 — typecheck cobre os testes e corrige erros latentes

**Files:**
- Create: `tsconfig.test.json`
- Modify: `package.json` (script typecheck)
- Modify: `tests/helpers/fake-provider.ts`

- [ ] **Step 1: RED — rodar typecheck atual sobre testes**
Run: `npx tsc -p tsconfig.test.json --noEmit` — antes de existir o tsconfig, provar com o comando ad-hoc usado na auditoria:
`npx tsc --noEmit --strict --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck --esModuleInterop --resolveJsonModule --noUncheckedIndexedAccess --types node tests/helpers/fake-provider.ts tests/agent.test.ts tests/agent-config.test.ts`
Expected: FAIL — `fake-provider.ts:1` (`AIProvider` não exportado) e `agent.test.ts:25` (argumentos).
- [ ] **Step 2: criar `tsconfig.test.json`**
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "noEmit": true, "rootDir": "." },
  "include": ["src/**/*.ts", "tests/**/*.ts", "scripts/**/*.ts", "vitest.config.ts"]
}
```
- [ ] **Step 3: `package.json`** — `"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json --noEmit"`
- [ ] **Step 4: GREEN — corrigir `tests/helpers/fake-provider.ts`**
Remover `import type { AIProvider } from '../../src/ai.js'`; importar `ChatMessage`; assinatura `complete(_messages: ChatMessage[], _opts?: { json?: boolean; temperature?: number })`.
- [ ] **Step 5: Verificar** — `npm run typecheck` limpo; `npm test` 48 verdes.
- [ ] **Step 6: Commit** — `fix: typecheck cobre testes e remove interface AIProvider inexistente`

### Task 2: F-10 — log injetável (testes não poluem `data/logs.txt`)

**Files:**
- Modify: `src/log.ts`
- Create: `vitest.config.ts`, `tests/setup.ts`, `tests/log.test.ts`
- Modify: `tests/agent.test.ts` (afterEach de tmpFiles)

- [ ] **Step 1: RED** — criar `tests/log.test.ts` importando `setLogFile` (inexistente) → teste falha por compilação/ausência.
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { log, setLogFile } from '../src/log.js';

describe('log com arquivo injetável', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-test-'));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  it('escreve no arquivo configurado via setLogFile', () => {
    const file = path.join(dir, 'logs.txt');
    setLogFile(file);
    log('info', 'mensagem de teste');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('INFO mensagem de teste');
  });
});
```
- [ ] **Step 2: GREEN — `src/log.ts`**
```ts
let logFile = config.logFile;
export function setLogFile(file: string): void { logFile = file; }
export function log(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  console.log(line);
  try { fs.appendFileSync(logFile, `${line}\n`); } catch { /* best-effort */ }
}
```
- [ ] **Step 3: `vitest.config.ts`** (`setupFiles: ['./tests/setup.ts']`) e `tests/setup.ts` com `setLogFile` para dir temporário.
- [ ] **Step 4: `tests/agent.test.ts`** — `afterEach` removendo `tmpFiles` (padrão dos demais).
- [ ] **Step 5: Verificar** — `npm test` verde; `data/logs.txt` inalterado durante os testes (tamanho antes/depois).
- [ ] **Step 6: Commit** — `fix: log com arquivo injetavel para testes nao poluirem logs.txt`

### Task 3: F-03 — `config/agent.json` corrompido (U+FFFD)

**Files:**
- Modify: `config/agent.json` (dados)
- Modify: `tests/agent-config.test.ts` (teste guarda)

- [ ] **Step 1: RED** — adicionar teste:
```ts
it('config real nao contem caracteres corrompidos (U+FFFD)', () => {
  const cfg = loadAgentConfig();
  for (const v of Object.values(cfg)) expect(v).not.toContain('\uFFFD');
});
```
Run: `npm test -- tests/agent-config.test.ts` → FAIL (personalidade tem U+FFFD).
- [ ] **Step 2: GREEN** — reescrever `config/agent.json` (UTF-8): `personalidade` = "Simpático, atencioso, descontraído e profissional. Trata o cliente pelo nome e usa tom de conversa natural de WhatsApp."
- [ ] **Step 3: Verificar** — teste passa; `npm run typecheck && npm test`.
- [ ] **Step 4: Commit** — `fix: reescreve agent.json em UTF-8 (caracteres corrompidos) + teste guarda`

### Task 4: F-14 — `path.dirname` no lugar de `lastIndexOf("\\")`

**Files:**
- Modify: `src/catalog.ts` (~linha 36) e `src/agent-config.ts` (~linha 33)
- Modify: `tests/catalog.test.ts` (teste cross-platform)

- [ ] **Step 1: RED** — adicionar em `catalog.test.ts`:
```ts
it('salva catalogo em caminho com separador / (cross-platform)', () => {
  const dir = os.tmpdir().replaceAll('\\', '/');
  const file = `${dir}/catalog-save-${Date.now()}/catalog.json`;
  try { saveCatalog(sample, file); } finally { fs.rmSync(file, { force: true }); }
  expect(fs.existsSync(file)).toBe(true);
});
```
(+ imports fs/os/path/saveCatalog já existentes/ajustar)
- [ ] **Step 2: GREEN** — `fs.mkdirSync(path.dirname(file), { recursive: true })` (+ `import path from 'node:path'`) em `catalog.ts` e `agent-config.ts`.
- [ ] **Step 3: Verificar** — `npm test`; typecheck.
- [ ] **Step 4: Commit** — `fix: saveCatalog/saveAgentConfig usam path.dirname (portabilidade)`

---

## Batch 2 — Sessão, dados e notificações (F-01, F-07, F-09, F-13) — CHECKPOINT

### Task 5: F-01 — shutdown preserva a sessão WhatsApp

**Files:**
- Modify: `src/whatsapp.ts` (método `stop()`)
- Create: `tests/whatsapp.test.ts`
- Modify: `src/index.ts` (shutdown)

- [ ] **Step 1: RED** — `tests/whatsapp.test.ts`:
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WhatsAppClient } from '../src/whatsapp.js';

describe('WhatsAppClient.stop', () => {
  it('encerra sem apagar a sessao salva', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stop-'));
    try {
      fs.writeFileSync(path.join(dir, 'creds.json'), '{}');
      const client = new WhatsAppClient(dir);
      await client.stop();
      expect(fs.existsSync(path.join(dir, 'creds.json'))).toBe(true);
      expect(client.status).toBe('disconnected');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
```
Expected: FAIL — `stop is not a function`.
- [ ] **Step 2: GREEN** — `whatsapp.ts` método público:
```ts
async stop(): Promise<void> {
  this.shouldClose = true;
  this.clearReconnectTimer();
  this.stopSocket();
  this.qr = null;
  this.qrRaw = null;
  this.phone = null;
  this.setStatus('disconnected');
}
```
- [ ] **Step 3: `src/index.ts` shutdown** — `whatsapp.resetSession()` → `whatsapp.stop()`.
- [ ] **Step 4: Verificar** — `npm test`; typecheck; build.
- [ ] **Step 5: Commit** — `fix: shutdown encerra socket sem apagar sessao (reinicio nao exige QR)`

### Task 6: F-07 — `db.json` escrita atômica + backup de corrupção

**Files:**
- Modify: `src/store.ts` (`read()`/`write()`)
- Modify: `tests/store.test.ts`

- [ ] **Step 1: RED** — testes:
```ts
it('arquivo corrompido vira backup e store inicia vazio', () => {
  const file = path.join(os.tmpdir(), `store-corrupt-${Date.now()}.json`);
  fs.writeFileSync(file, '{corrompido');
  const store = new Store(file);
  expect(store.listBookings()).toEqual([]);
  const backups = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(path.basename(file) + '.corrompido-'));
  expect(backups).toHaveLength(1);
  fs.rmSync(file, { force: true });
  for (const b of backups) fs.rmSync(path.join(os.tmpdir(), b), { force: true });
});
it('escrita atomica nao deixa arquivo .tmp residual', () => {
  const store = makeStore();
  store.addBooking({ clientJid: 'jid@s.whatsapp.net', clientName: null, service: 'Corte', price: 40, date: '2026-09-10', time: '10:00' });
  const res = fs.readdirSync(path.dirname(store.file)).filter((n) => n.startsWith(path.basename(store.file) + '.tmp'));
  expect(res).toHaveLength(0);
  expect(JSON.parse(fs.readFileSync(store.file, 'utf8')).bookings).toHaveLength(1);
});
```
- [ ] **Step 2: GREEN** — `store.ts`: `write()` com tmp+rename; `read()` valida shape (arrays) e em falha renomeia para `*.corrompido-<Date.now()>` + `log('warn', ...)` (import de `./log.js`) e retorna `emptyDb()`.
- [ ] **Step 3: Verificar** — `npm test`; typecheck.
- [ ] **Step 4: Commit** — `fix: escrita atomica e backup automatico de db.json corrompido`

### Task 7: F-09 — `pendingBooking` expira após 24 h

**Files:**
- Modify: `src/store.ts`
- Modify: `tests/store.test.ts`

- [ ] **Step 1: RED** — testes:
```ts
it('pendencia expira apos 24h', () => {
  const store = makeStore();
  store.setPendingBooking('jid@s.whatsapp.net', { service: 'Corte', date: null, time: null, client_name: 'João' });
  expect(store.getPendingBooking('jid@s.whatsapp.net', Date.now() + 25 * 60 * 60 * 1000)).toBeNull();
  expect(store.getPendingBooking('jid@s.whatsapp.net')).not.toBeNull();
});
```
- [ ] **Step 2: GREEN** — `PENDING_BOOKING_TTL_MS` exportado (24 h); campo `pendingBookingAt: number | null` na conversa (default `null`); `setPendingBooking` grava/limpa timestamp; `getPendingBooking(jid, now = Date.now())` retorna null se expirado.
- [ ] **Step 3: Verificar** — `npm test`; typecheck.
- [ ] **Step 4: Commit** — `fix: agendamento pendente expira apos 24h`

### Task 8: F-13 — reenvio de notificações pendentes

**Files:**
- Modify: `src/store.ts` (`listUnnotifiedBookings`)
- Modify: `src/notifier.ts` (`flushPendingNotifications`)
- Modify: `src/index.ts` (setInterval)
- Modify: `tests/notifier.test.ts`, `tests/store.test.ts`

- [ ] **Step 1: RED** — `notifier.test.ts`:
```ts
it('flush envia apenas pendentes e marca como notificados', async () => {
  const store = new Store(tmpFile()); // helper local com tmp
  const b1 = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-10', time: '10:00' });
  store.addBooking({ clientJid: JID, clientName: 'Maria', service: 'Barba', price: 30, date: '2026-09-10', time: '11:00' });
  store.markNotified(b1.id);
  const sent: string[] = [];
  const count = await flushPendingNotifications({ store, send: async (_j, t) => { sent.push(t); return true; }, adminPhone: '5511999999999' });
  expect(count).toBe(1);
  expect(sent).toHaveLength(1);
  expect(store.listUnnotifiedBookings()).toHaveLength(0);
});
it('flush nao envia quando adminPhone vazio', async () => { ... count 0 ... });
it('flush mantem pendente quando envio falha', async () => { ... send false → listUnnotified 1 ... });
```
- [ ] **Step 2: GREEN** — `Store.listUnnotifiedBookings()`; `notifier.flushPendingNotifications({ store, send, adminPhone })` (usa `buildNotification` + `markNotified`); `index.ts` com `setInterval(60_000)` se `whatsapp.isConnected()`.
- [ ] **Step 3: Verificar** — `npm test`; typecheck; build.
- [ ] **Step 4: Commit** — `fix: reenvia notificacoes pendentes periodicamente quando conectado`

---

## Batch 3 — Agente e configuração (F-06, F-08, F-11, F-12) — CHECKPOINT

### Task 9: F-06 — ADMIN_PHONE salvo na UI vale sem reiniciar

**Files:**
- Modify: `src/config.ts`
- Create: `tests/config.test.ts`
- Modify: `src/index.ts` (warn no boot se vazio)

- [ ] **Step 1: RED** — `tests/config.test.ts`:
```ts
it('updateEnv grava e preserva demais linhas (arquivo custom)', () => {
  const file = path.join(os.tmpdir(), `.env-test-${Date.now()}.env`);
  fs.writeFileSync(file, 'PORT=3081\nDEEPSEEK_API_KEY=x\n');
  updateEnv('ADMIN_PHONE', '5511999999999', file);
  const c = fs.readFileSync(file, 'utf8');
  expect(c).toContain('PORT=3081');
  expect(c).toContain('ADMIN_PHONE=5511999999999');
  fs.rmSync(file, { force: true });
});
it('updateEnv com ADMIN_PHONE atualiza config em memoria', () => {
  const prev = config.adminPhone;
  try { updateEnv('ADMIN_PHONE', '5511888888888'); expect(config.adminPhone).toBe('5511888888888'); }
  finally { updateEnv('ADMIN_PHONE', prev); }
});
```
Expected: 2º FAIL (config imutável `as const` / não atualiza).
- [ ] **Step 2: GREEN** — `config.ts`: declaração `export const config: AppConfig` (interface explícita, sem `as const`) e `updateEnv(key, value, file = envFile)`; quando `key === 'ADMIN_PHONE'`, `config.adminPhone = value`. Extrair `envFile`/manter caminho.
- [ ] **Step 3: `index.ts`** — no boot: `if (!config.adminPhone) log('warn', 'ADMIN_PHONE nao configurado — notificacoes desativadas.')`.
- [ ] **Step 4: Verificar** — `npm test`; typecheck.
- [ ] **Step 5: Commit** — `fix: salvar ADMIN_PHONE pela UI aplica sem reiniciar`

### Task 10: F-08 — `finalizar` tratado; `transferir` notifica o dono

**Files:**
- Modify: `src/agent.ts`
- Modify: `src/notifier.ts` (`buildTransferRequest`)
- Modify: `src/index.ts` (onTransfer)
- Modify: `tests/agent.test.ts`, `tests/notifier.test.ts`

- [ ] **Step 1: RED** — `agent.test.ts`:
```ts
it('intent finalizar limpa agendamento pendente', async () => {
  const ctx = makeContext(new FakeAIProvider([JSON.stringify({ intent: 'finalizar', reply: 'Até logo!', booking: {} })]));
  ctx.store.setPendingBooking(JID, { service: 'Corte', date: '2026-09-10', time: '10:00', client_name: null });
  await ctx.agent.handleInboundMessage({ jid: JID, text: 'só isso', name: 'João' });
  expect(ctx.store.getPendingBooking(JID)).toBeNull();
});
it('intent transferir dispara onTransfer', async () => {
  const transfers: { jid: string; clientName: string | null }[] = [];
  const ctx = makeContext(new FakeAIProvider([JSON.stringify({ intent: 'transferir', reply: 'ok', booking: {} })]), undefined, (t) => transfers.push(t));
  await ctx.agent.handleInboundMessage({ jid: JID, text: 'quero falar com humano', name: 'João' });
  expect(transfers).toHaveLength(1);
  expect(transfers[0]!.jid).toBe(JID);
});
```
(`makeContext` ganha 3º param opcional `onTransfer`.)
- [ ] **Step 2: GREEN** — `agent.ts`: branch `intent === 'finalizar'` → `setPendingBooking(jid, null)`; `transferir` → chama `this.opts.onTransfer?.({ jid, clientName })` (passar clientName no runTurn). `notifier.ts`: `buildTransferRequest(clientName)`. `index.ts`: passa `onTransfer` que envia ao admin quando configurado.
- [ ] **Step 3: Verificar** — `npm test`; typecheck.
- [ ] **Step 4: Commit** — `fix: trata intent finalizar e notifica dono em transferir`

### Task 11: F-11 — promoção compara data local

**Files:**
- Modify: `src/catalog.ts`
- Modify: `tests/catalog.test.ts`

- [ ] **Step 1: RED** — `catalog.test.ts`:
```ts
it('localDateString usa dia local (offset injetado)', () => {
  expect(localDateString(new Date('2026-09-01T02:30:00Z'), 180)).toBe('2026-08-31');
  expect(localDateString(new Date('2026-09-01T02:30:00Z'), -540)).toBe('2026-09-01');
});
```
- [ ] **Step 2: GREEN** — `localDateString(now: Date, offsetMinutes: number = now.getTimezoneOffset())` e `resolvePromocao` usa `localDateString(now)`.
- [ ] **Step 3: Verificar** — `npm test`; typecheck.
- [ ] **Step 4: Commit** — `fix: validade de promocao usa dia local do estabelecimento`

### Task 12: F-12 — fallback mais útil + roteiro smoke

**Files:**
- Modify: `src/agent.ts` (FALLBACK_REPLY)
- Create: `scripts/smoke-roteiro.ts`

- [ ] **Step 1:** alterar `FALLBACK_REPLY` (mantém "Desculpe" — testes existentes verificam isso):
`'Desculpe, não consegui processar sua mensagem. Pode tentar de novo, por favor? 🙂 Posso te ajudar com serviços, preços, horários e agendamento.'`
- [ ] **Step 2:** criar `scripts/smoke-roteiro.ts` — roteiro de perguntas, conta fallback (resposta contém "não consegui processar"), imprime taxa; execução manual com DeepSeek real.
- [ ] **Step 3: Verificar** — `npm test`; typecheck.
- [ ] **Step 4: Commit** — `feat: fallback mais util + roteiro smoke para medir qualidade da IA`

---

## Batch 4 — HTTP, auth e processo (F-05, F-15, docs) — CHECKPOINT FINAL

### Task 13: F-05 — token de acesso no painel

**Files:**
- Modify: `src/config.ts`, `src/http.ts`, `src/index.ts`, `.env.example`
- Create: `tests/http.test.ts`

- [ ] **Step 1: RED** — `tests/http.test.ts` (servidor real porta efêmera + fetch Node 25; deps fake; `panelToken`):
```ts
// casos: sem token → 200; com token sem header → 401; header errado → 401; certo → 200;
// PUT /api/catalog malformado → 422; POST /api/pairing-code numero curto → 422
```
- [ ] **Step 2: GREEN** — `HttpDeps.panelToken?: string`; helper `isAuthorized(req, token)` com `timingSafeEqual` quando token presente; 401 em todas as rotas `/api/*`; `.env.example` ganha `PANEL_TOKEN=`; UI: `authedFetch` com header `x-panel-token` via `sessionStorage` e `prompt` em 401; `index.ts` passa `panelToken: config.panelToken`.
- [ ] **Step 3: Verificar** — `npm test`; typecheck; build.
- [ ] **Step 4: Commit** — `feat: painel exige PANEL_TOKEN quando configurado + testes http`

### Task 14: F-15 — engines, lint Biome, CI, repo privado + push

**Files:**
- Modify: `package.json` (engines, devDep biome, script lint)
- Create: `biome.json`, `.github/workflows/ci.yml`

- [ ] **Step 1:** `package.json`: `"engines": { "node": ">=20" }`; `npm i -D biome`; script `"lint": "biome lint src tests scripts"`.
- [ ] **Step 2:** `biome.json` (linter on, formatter off, useIgnoreFile) e rodar `npm run lint`; corrigir/apaziguar apontamentos mantendo testes verdes.
- [ ] **Step 3:** `.github/workflows/ci.yml` — ubuntu, Node 22, `npm ci`, typecheck, test, lint, build (push/pull_request).
- [ ] **Step 4:** revisar `git status` (`.env`/`data/` fora) e `gh repo create ismerim-whatsapp-bot --private --source=. --push`.
- [ ] **Step 5: Commit** — `chore: engines, lint biome e CI` (antes do push final; ou commit único + push conforme status).
- [ ] **Step 6:** push.

### Task 15: README + fechamento

**Files:**
- Modify: `README.md`
- Modify: `docs/AUDITORIA_TECNICA.md`

- [ ] **Step 1:** README — 48+ testes, sessão persiste, `PANEL_TOKEN`, `ADMIN_PHONE` (instrução/aviso), `npm run lint`, typecheck ampliado, smoke-roteiro.
- [ ] **Step 2:** `docs/AUDITORIA_TECNICA.md` — seção "Correções aplicadas" com status F-01..F-15.
- [ ] **Step 3:** verificação final completa + commit + push.
- [ ] **Step 4:** Commit — `docs: atualiza README e auditoria com correcoes aplicadas`

---

**Fora de escopo:** F-16 (WhatsApp oficial — decisão de stack), F-17 (roadmap de produto), F-02 valor (aguarda número do dono; mecânica em Task 9).
