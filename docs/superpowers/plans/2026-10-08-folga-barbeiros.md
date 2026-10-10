# Folga dos Barbeiros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada barbeiro define semanalmente (por WhatsApp) o dia de folga ou "não vou folgar", com unicidade de dias; o agente informa clientes e o backend bloqueia agendamento no dia de folga, oferecendo cobertura.

**Architecture:** Novo módulo de domínio `src/folga.ts` (semana ISO, folga efetiva, parser). Persistência aditiva em `store.ts` (campos no profissional + controle de cobrança). Rotina semanal determinística (`src/folga-scheduler.ts`) chamada pelo tick existente. Comando do barbeiro interceptado no `Agent` antes do LLM. Bloqueio em `bookings.ts`. Prompt/DTO expõem a folga.

**Tech Stack:** TypeScript (ESM), Vitest, Biome, zod (não usado aqui), Baileys (envio).

**Spec:** `docs/superpowers/specs/2026-10-08-folga-barbeiros-design.md`

## Global Constraints

- Fuso do estabelecimento: `America/Sao_Paulo` (via `TZ`); cálculos de semana/dia usam data local.
- Domingo (`0`) NÃO é dia de folga válido; dias válidos `1..6` (segunda..sábado).
- Nunca expor telefone de profissional no DTO/agente.
- Migrações são aditivas (nunca apagar dados).
- Comandos: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Commits frequentes (um por task).

---

### Task 1: Módulo de domínio `src/folga.ts`

**Files:**
- Create: `src/folga.ts`
- Modify: `src/profissionais.ts` (campos opcionais)
- Test: `tests/folga.test.ts`

**Interfaces:**
- Produces:
  - `DIAS_UTEIS: number[]` (`[1..6]`)
  - `DIA_NOMES: Record<number, string>`
  - `nomeDia(dia: number): string`
  - `semanaId(date: Date): string`
  - `weekdayOf(dateISO: string): number`
  - `folgaEfetiva(prof: Profissional, semana: string): number | null`
  - `folgaNaData(prof: Profissional, dateISO: string, hoje?: Date): number | null`
  - `diasOcupados(profissionais: Profissional[], semana: string, excetoId?: number): Set<number>`
  - `parseFolgaAnswer(text: string): { tipo: 'dia'; dia: number } | { tipo: 'sem_folga' } | { tipo: 'invalido' }`
  - `buildFolgaQuestion(nome: string, diasLivres: number[]): string`
  - `buildFolgaReminder(nome: string, diasLivres: number[]): string`
  - `buildFolgaConfirmation(dia: number | null): string`

- [ ] **Step 1: Escrever os testes que falham**

`tests/folga.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DIAS_UTEIS, DIA_NOMES, nomeDia, semanaId, weekdayOf,
  folgaEfetiva, folgaNaData, diasOcupados, parseFolgaAnswer,
} from '../src/folga.js';
import type { Profissional } from '../src/profissionais.js';

function prof(patch: Partial<Profissional>): Profissional {
  return { id: 1, nome: 'JUAN', telefone: '5521988887777', horarioInicio: '', horarioFim: '', ativo: true, createdAt: '2026-01-01T00:00:00.000Z', ...patch };
}

describe('folga — nomes e semana', () => {
  it('nomeia os dias uteis', () => {
    expect(nomeDia(1)).toBe('segunda');
    expect(nomeDia(6)).toBe('sábado');
    expect(DIA_NOMES[3]).toBe('quarta');
    expect(DIAS_UTEIS).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('calcula o id ISO da semana', () => {
    expect(semanaId(new Date('2026-10-08T12:00:00'))).toBe('2026-W41');
    expect(semanaId(new Date('2026-01-01T12:00:00'))).toBe('2026-W01');
  });

  it('converte data para dia da semana', () => {
    expect(weekdayOf('2026-10-08')).toBe(4); // quinta
    expect(weekdayOf('2026-10-11')).toBe(0); // domingo
  });
});

describe('folga efetiva e na data', () => {
  it('usa a recorrente quando nao ha decisao da semana', () => {
    expect(folgaEfetiva(prof({ folgaDia: 3 }), '2026-W41')).toBe(3);
  });
  it('decisao da semana corrente tem prioridade (inclusive sem folga)', () => {
    expect(folgaEfetiva(prof({ folgaDia: 3, folgaSemana: { semanaId: '2026-W41', dia: null } }), '2026-W41')).toBeNull();
    expect(folgaEfetiva(prof({ folgaDia: 3, folgaSemana: { semanaId: '2026-W41', dia: 2 } }), '2026-W41')).toBe(2);
  });
  it('decisao de outra semana cai na recorrente', () => {
    expect(folgaEfetiva(prof({ folgaDia: 3, folgaSemana: { semanaId: '2026-W40', dia: 2 } }), '2026-W41')).toBe(3);
  });
  it('folgaNaData: semana corrente usa efetiva; futura usa recorrente', () => {
    const p = prof({ folgaDia: 4, folgaSemana: { semanaId: '2026-W41', dia: null } });
    expect(folgaNaData(p, '2026-10-08', new Date('2026-10-08T12:00:00'))).toBeNull(); // semana atual, sem folga
    expect(folgaNaData(p, '2026-10-22', new Date('2026-10-08T12:00:00'))).toBe(4); // semana futura, recorrente
  });
});

describe('folga — ocupados', () => {
  it('lista os dias ocupados, exceto o proprio', () => {
    const a = prof({ id: 1, folgaDia: 3 });
    const b = prof({ id: 2, folgaDia: 5 });
    const c = prof({ id: 3, folgaDia: 5, ativo: false });
    expect([...diasOcupados([a, b, c], '2026-W41')].sort()).toEqual([3, 5]);
    expect([...diasOcupados([a, b, c], '2026-W41', 1)].sort()).toEqual([5]);
  });
});

describe('folga — parser', () => {
  it('reconhece nomes e abreviacoes', () => {
    expect(parseFolgaAnswer('quarta')).toEqual({ tipo: 'dia', dia: 3 });
    expect(parseFolgaAnswer('QUA')).toEqual({ tipo: 'dia', dia: 3 });
    expect(parseFolgaAnswer('sábado')).toEqual({ tipo: 'dia', dia: 6 });
    expect(parseFolgaAnswer('terca')).toEqual({ tipo: 'dia', dia: 2 });
    expect(parseFolgaAnswer('6ª')).toEqual({ tipo: 'dia', dia: 6 }); // sabado
    expect(parseFolgaAnswer('2')).toEqual({ tipo: 'dia', dia: 2 }); // terca
  });
  it('reconhece "nao vou folgar"', () => {
    expect(parseFolgaAnswer('não vou folgar')).toEqual({ tipo: 'sem_folga' });
    expect(parseFolgaAnswer('sem folga')).toEqual({ tipo: 'sem_folga' });
    expect(parseFolgaAnswer('nao folgo')).toEqual({ tipo: 'sem_folga' });
  });
  it('domingo e invalido', () => {
    expect(parseFolgaAnswer('domingo')).toEqual({ tipo: 'invalido' });
  });
  it('texto irrelevante e invalido', () => {
    expect(parseFolgaAnswer('bom dia')).toEqual({ tipo: 'invalido' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/folga.test.ts`
Expected: FAIL — `Failed to load url ../src/folga.js`.

- [ ] **Step 3: Adicionar campos opcionais ao profissional**

Em `src/profissionais.ts`, adicionar ao `interface Profissional` (após `createdAt`):

```ts
  /** Preferencia recorrente de folga: 1=segunda ... 6=sabado. null/undefined = nunca definiu. */
  folgaDia?: number | null;
  /** Decisao da semana corrente. dia=null = "nao vou folgar nesta semana". */
  folgaSemana?: { semanaId: string; dia: number | null } | null;
```

- [ ] **Step 4: Implementar `src/folga.ts`**

```ts
import type { Profissional } from './profissionais.js';

export const DIAS_UTEIS = [1, 2, 3, 4, 5, 6];
export const DIA_NOMES: Record<number, string> = {
  0: 'domingo', 1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado',
};

export function nomeDia(dia: number): string {
  return DIA_NOMES[dia] ?? String(dia);
}

/** Identificador ISO da semana (ex.: 2026-W41) a partir de uma data local. */
export function semanaId(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // segunda=0 ... domingo=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // quinta da semana
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Dia da semana (0=domingo..6=sabado) de uma data YYYY-MM-DD. */
export function weekdayOf(dateISO: string): number {
  return new Date(`${dateISO}T12:00:00`).getDay();
}

export function folgaEfetiva(prof: Profissional, semana: string): number | null {
  if (prof.folgaSemana && prof.folgaSemana.semanaId === semana) return prof.folgaSemana.dia;
  return prof.folgaDia ?? null;
}

export function folgaNaData(prof: Profissional, dateISO: string, hoje: Date = new Date()): number | null {
  const semanaData = semanaId(new Date(`${dateISO}T12:00:00`));
  const semanaHoje = semanaId(hoje);
  return semanaData === semanaHoje ? folgaEfetiva(prof, semanaHoje) : (prof.folgaDia ?? null);
}

export function diasOcupados(profissionais: Profissional[], semana: string, excetoId?: number): Set<number> {
  const set = new Set<number>();
  for (const p of profissionais) {
    if (!p.ativo || p.id === excetoId) continue;
    const d = folgaEfetiva(p, semana);
    if (d != null) set.add(d);
  }
  return set;
}

const NOME_PARA_DIA: [RegExp, number][] = [
  [/domingo|dom\b/, 0],
  [/segunda|seg\b/, 1],
  [/ter[cç]a|ter\b/, 2],
  [/quarta|qua\b/, 3],
  [/quinta|qui\b/, 4],
  [/sexta|sex\b/, 5],
  [/s[aá]bado|sab\b/, 6],
];

export type FolgaParsed = { tipo: 'dia'; dia: number } | { tipo: 'sem_folga' } | { tipo: 'invalido' };

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\sª]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseFolgaAnswer(text: string): FolgaParsed {
  const t = normalize(text);
  if (!t) return { tipo: 'invalido' };
  if (/\b(nao\s*(vou\s*)?folgar|nao\s*folgo|sem\s*folga|folgar|nao\s*vou\s*descansar|nenhum|nenhuma)\b/.test(t) || t === '-') {
    return { tipo: 'sem_folga' };
  }
  for (const [re, dia] of NOME_PARA_DIA) {
    if (re.test(t)) return dia === 0 ? { tipo: 'invalido' } : { tipo: 'dia', dia };
  }
  // Numeros: 1=domingo ... 6=sabado (opcional com ª/a/º). Doming o(1) e invalido.
  const num = t.match(/\b([1-6])\s*[ªaº]?\b/);
  if (num) {
    const dia = Number(num[1]) === 1 ? 0 : Number(num[1]); // 1=domingo
    return dia === 0 ? { tipo: 'invalido' } : { tipo: 'dia', dia };
  }
  return { tipo: 'invalido' };
}

export function buildFolgaQuestion(nome: string, diasLivres: number[]): string {
  const livres = diasLivres.length ? diasLivres.map(nomeDia).join(', ') : '(nenhum dia livre)';
  return [
    `Oi, ${nome}! Fechamos hoje (domingo) e as folgas da semana são definidas agora.`,
    '',
    `Dias livres: ${livres}.`,
    'Responda só o dia (ex.: *quarta*) ou *não vou folgar* nesta semana.',
  ].join('\n');
}

export function buildFolgaReminder(nome: string, diasLivres: number[]): string {
  const livres = diasLivres.length ? diasLivres.map(nomeDia).join(', ') : '(nenhum dia livre)';
  return `${nome}, ainda falta definir sua folga desta semana. Dias livres: ${livres}. Responda o dia ou "não vou folgar".`;
}

export function buildFolgaConfirmation(dia: number | null): string {
  return dia == null
    ? 'Combinado! Esta semana você não folga. 👍'
    : `Perfeito! Sua folga esta semana: ${nomeDia(dia)}. ✅`;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run tests/folga.test.ts`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add src/folga.ts src/profissionais.ts tests/folga.test.ts
git commit -m "feat: dominio de folga (semana, folga efetiva e parser)"
```

---

### Task 2: Persistência no `store` (folga + controle de cobrança)

**Files:**
- Modify: `src/store.ts`
- Test: `tests/folga-store.test.ts`

**Interfaces:**
- Consumes: `semanaId`, `folgaEfetiva` de `src/folga.js`.
- Produces:
  - `store.setFolga(id: number, patch: { folgaDia?: number | null; folgaSemana?: { semanaId: string; dia: number | null } | null }): Profissional | null`
  - `store.getFolgaControle(id: number): FolgaControle | null`
  - `store.setFolgaControle(id: number, patch: Partial<FolgaControle>): void`
  - `type FolgaControle = { semanaId: string; askedAt: string | null; remindedAt: string | null; answeredAt: string | null }`
  - `store.listProfissionaisPublic(now?: Date)` inclui `folgaSemanaDia` efetivo.

- [ ] **Step 1: Testes que falham**

`tests/folga-store.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';

const tmp: string[] = [];
afterEach(() => { for (const f of tmp.splice(0)) fs.rmSync(f, { force: true }); });
function makeStore(): Store {
  const f = path.join(os.tmpdir(), `folga-store-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmp.push(f);
  return new Store(f);
}

describe('store — folga', () => {
  it('grava folga recorrente e da semana', () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    store.setFolga(p.id, { folgaDia: 3, folgaSemana: { semanaId: '2026-W41', dia: 3 } });
    const salvo = store.getProfissional(p.id)!;
    expect(salvo.folgaDia).toBe(3);
    expect(salvo.folgaSemana).toEqual({ semanaId: '2026-W41', dia: 3 });
  });

  it('controle de cobranca persiste', () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN' });
    store.setFolgaControle(p.id, { semanaId: '2026-W41', askedAt: 'x' });
    expect(store.getFolgaControle(p.id)).toEqual({ semanaId: '2026-W41', askedAt: 'x', remindedAt: null, answeredAt: null });
  });

  it('DTO publico expoe folga efetiva sem telefone', () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    store.setFolga(p.id, { folgaDia: 3 });
    const pub = store.listProfissionaisPublic(new Date('2026-10-08T12:00:00'))[0]!;
    expect(pub.folgaSemanaDia).toBe(3);
    expect(JSON.stringify(pub)).not.toContain('telefone');
    expect(JSON.stringify(pub)).not.toContain('5521988887777');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/folga-store.test.ts`
Expected: FAIL — `store.setFolga is not a function`.

- [ ] **Step 3: Implementar no `store.ts`**

1. Import no topo: `import { folgaEfetiva, semanaId } from './folga.js';`
2. Adicionar tipo e campo no `Db`:

```ts
export interface FolgaControle {
  semanaId: string;
  askedAt: string | null;
  remindedAt: string | null;
  answeredAt: string | null;
}
```
No `interface Db`: `folgaControle: Record<number, FolgaControle>;`
No `emptyDb()`: `folgaControle: {}`.
Na migração `read()` (junto aos outros ajustes): 
```ts
if (!parsed.folgaControle || typeof parsed.folgaControle !== 'object' || Array.isArray(parsed.folgaControle)) parsed.folgaControle = {};
```
3. Métodos (na seção de profissionais):

```ts
  /** Define a folga (recorrente e/ou da semana) do profissional. */
  setFolga(id: number, patch: { folgaDia?: number | null; folgaSemana?: { semanaId: string; dia: number | null } | null }): Profissional | null {
    const p = this.db.profissionais.find((x) => x.id === id);
    if (!p) return null;
    if (patch.folgaDia !== undefined) p.folgaDia = patch.folgaDia;
    if (patch.folgaSemana !== undefined) p.folgaSemana = patch.folgaSemana;
    this.write();
    return p;
  }

  getFolgaControle(id: number): FolgaControle | null {
    return this.db.folgaControle[id] ?? null;
  }

  setFolgaControle(id: number, patch: Partial<FolgaControle>): void {
    const atual = this.db.folgaControle[id] ?? { semanaId: '', askedAt: null, remindedAt: null, answeredAt: null };
    this.db.folgaControle[id] = { ...atual, ...patch };
    this.write();
  }
```
4. `listProfissionaisPublic` passa a receber `now` e preencher `folgaSemanaDia`:

```ts
  listProfissionaisPublic(now: Date = new Date()): ReturnType<typeof toPublicProfissional>[] {
    const week = semanaId(now);
    return this.db.profissionais.map((p) => ({ ...toPublicProfissional(p), folgaSemanaDia: folgaEfetiva(p, week) }));
  }
```
5. Em `profissionais.ts`, adicionar ao `ProfissionalPublic`:
```ts
  folgaDia?: number | null;
  folgaSemanaDia?: number | null;
```
E em `toPublicProfissional`: `folgaDia: p.folgaDia ?? null, folgaSemanaDia: null,`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/folga-store.test.ts tests/store.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.ts src/profissionais.ts tests/folga-store.test.ts
git commit -m "feat: persiste folga e controle de cobranca no store"
```

---

### Task 3: Bloqueio e cobertura no agendamento (`bookings.ts`)

**Files:**
- Modify: `src/bookings.ts`
- Test: `tests/folga-bookings.test.ts`

**Interfaces:**
- Consumes: `folgaNaData`, `weekdayOf`, `nomeDia` de `src/folga.js`.
- Produces: novo código de falha `professional_folga` em `validateAndCreateBooking` e `validateAndRescheduleBooking`.

- [ ] **Step 1: Testes que falham**

`tests/folga-bookings.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { Store } from '../src/store.js';
import { validateAndCreateBooking } from '../src/bookings.js';
import type { Catalog } from '../src/catalog.js';
import type { Profissional } from '../src/profissionais.js';

const tmp: string[] = [];
afterEach(() => { for (const f of tmp.splice(0)) fs.rmSync(f, { force: true }); vi.useRealTimers(); });
function makeStore(): Store {
  const f = path.join(os.tmpdir(), `folga-bk-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmp.push(f);
  return new Store(f);
}
const catalog: Catalog = {
  horarios: { '0': [], '1': [{ open: '09:00', close: '19:00' }], '2': [{ open: '09:00', close: '19:00' }], '3': [{ open: '09:00', close: '19:00' }], '4': [{ open: '09:00', close: '19:00' }], '5': [{ open: '09:00', close: '19:00' }], '6': [{ open: '09:00', close: '19:00' }] },
  servicos: [{ nome: 'Corte', preco: 70 }],
  promocoes: [],
};

describe('folga bloqueia agendamento', () => {
  it('rejeita agendar com o profissional no dia de folga dele', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00')); // quinta
    const store = makeStore();
    const juan = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    store.setFolga(juan.id, { folgaDia: 4 }); // quinta
    const out = validateAndCreateBooking(store, catalog, { jid: 'x@s.whatsapp.net', clientName: 'Ana', serviceName: 'Corte', date: '2026-10-09', time: '10:00', professionalName: 'JUAN' }, store.listProfissionais());
    expect(out.ok).toBe(true); // sexta ok
    const sexta = out;
    expect(sexta.ok).toBe(true);
  });

  it('rejeita no dia de folga', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00')); // quinta
    const store = makeStore();
    const juan = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    store.setFolga(juan.id, { folgaDia: 4 });
    const out = validateAndCreateBooking(store, catalog, { jid: 'x@s.whatsapp.net', clientName: 'Ana', serviceName: 'Corte', date: '2026-10-15', time: '10:00', professionalName: 'JUAN' }, store.listProfissionais());
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('professional_folga');
  });

  it('sem profissional, nao bloqueia', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00'));
    const store = makeStore();
    const juan = store.addProfissional({ nome: 'JUAN' });
    store.setFolga(juan.id, { folgaDia: 4 });
    const out = validateAndCreateBooking(store, catalog, { jid: 'x@s.whatsapp.net', clientName: 'Ana', serviceName: 'Corte', date: '2026-10-15', time: '10:00' }, store.listProfissionais());
    expect(out.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/folga-bookings.test.ts`
Expected: FAIL — o caso "rejeita no dia de folga" retorna `ok: true`.

- [ ] **Step 3: Implementar em `bookings.ts`**

Import: `import { folgaNaData, weekdayOf, nomeDia } from './folga.js';`

Em `validateAndCreateBooking`, logo após resolver o profissional (`professionalId`/`resolvedProfessionalName`) e antes de `store.addBooking`:

```ts
  if (professionalId != null) {
    const prof = profissionais.find((p) => p.id === professionalId) ?? null;
    const diaFolga = prof ? folgaNaData(prof, input.date) : null;
    if (diaFolga != null && weekdayOf(input.date) === diaFolga) {
      return {
        ok: false,
        code: 'professional_folga',
        userMessage: `Nesse dia (${nomeDia(diaFolga)}) esse profissional folga. Posso agendar com outro que atende nesse dia?`,
      };
    }
  }
```

Em `validateAndRescheduleBooking`, após resolver o profissional de destino (bloco `if (novoProfissional) {...}`, obtendo `professionalId`), antes de `store.rescheduleBooking`:

```ts
  const profFinal = profissionais.find((p) => p.id === (professionalId ?? original.professionalId));
  if (profFinal) {
    const diaFolga = folgaNaData(profFinal, input.date);
    if (diaFolga != null && weekdayOf(input.date) === diaFolga) {
      return {
        ok: false,
        code: 'professional_folga',
        userMessage: `Nesse dia (${nomeDia(diaFolga)}) esse profissional folga. Posso remarcar com outro que atende nesse dia?`,
      };
    }
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/folga-bookings.test.ts tests/bookings.test.ts tests/cancel-remarca.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bookings.ts tests/folga-bookings.test.ts
git commit -m "feat: bloqueia agendamento no dia de folga (com cobertura)"
```

---

### Task 4: Rotina semanal (`src/folga-scheduler.ts`)

**Files:**
- Create: `src/folga-scheduler.ts`
- Test: `tests/folga-scheduler.test.ts`

**Interfaces:**
- Consumes: `semanaId`, `diasOcupados`, `DIAS_UTEIS`, `buildFolgaQuestion`, `buildFolgaReminder` de `src/folga.js`; `store.getFolgaControle`/`setFolgaControle`.
- Produces: `processFolgaSchedule(deps): Promise<{ perguntados: number; cobrados: number }>`.

- [ ] **Step 1: Testes que falham**

`tests/folga-scheduler.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { processFolgaSchedule } from '../src/folga-scheduler.js';

const tmp: string[] = [];
afterEach(() => { for (const f of tmp.splice(0)) fs.rmSync(f, { force: true }); });
function makeStore(): Store {
  const f = path.join(os.tmpdir(), `fsched-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmp.push(f);
  return new Store(f);
}

describe('folga scheduler', () => {
  it('pergunta no domingo a partir da hora configurada', async () => {
    const store = makeStore();
    store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const sent: string[] = [];
    const r = await processFolgaSchedule({
      store,
      send: async (_jid, text) => { sent.push(text); return true; },
      adminPhone: '',
      now: new Date('2026-10-11T09:05:00'), // domingo
      askWeekday: 0, askHour: 9, remindHour: 9,
    });
    expect(r.perguntados).toBe(1);
    expect(sent[0]).toContain('domingo');
  });

  it('nao pergunta duas vezes na mesma semana', async () => {
    const store = makeStore();
    store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const deps = { store, send: async () => true, adminPhone: '', askWeekday: 0, askHour: 9, remindHour: 9 };
    await processFolgaSchedule({ ...deps, now: new Date('2026-10-11T09:05:00') });
    const r2 = await processFolgaSchedule({ ...deps, now: new Date('2026-10-11T10:00:00') });
    expect(r2.perguntados).toBe(0);
  });

  it('cobra 1x por dia enquanto nao responder', async () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const deps = { store, send: async () => true, adminPhone: '', askWeekday: 0, askHour: 9, remindHour: 9 };
    await processFolgaSchedule({ ...deps, now: new Date('2026-10-11T09:05:00') }); // domingo pergunta
    const seg = await processFolgaSchedule({ ...deps, now: new Date('2026-10-12T09:30:00') }); // segunda cobra
    expect(seg.cobrados).toBe(1);
    const seg2 = await processFolgaSchedule({ ...deps, now: new Date('2026-10-12T15:00:00') }); // segunda, ja cobrou
    expect(seg2.cobrados).toBe(0);
    // respondeu -> para de cobrar
    store.setFolgaControle(p.id, { semanaId: '2026-W41', answeredAt: new Date().toISOString() });
    const ter = await processFolgaSchedule({ ...deps, now: new Date('2026-10-13T09:30:00') });
    expect(ter.cobrados).toBe(0);
  });

  it('ignora profissional sem telefone', async () => {
    const store = makeStore();
    store.addProfissional({ nome: 'SEM FONE', telefone: '' });
    const r = await processFolgaSchedule({ store, send: async () => true, adminPhone: '', now: new Date('2026-10-11T09:05:00'), askWeekday: 0, askHour: 9, remindHour: 9 });
    expect(r.perguntados).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/folga-scheduler.test.ts`
Expected: FAIL — módulo ausente.

- [ ] **Step 3: Implementar `src/folga-scheduler.ts`**

```ts
import { log } from './log.js';
import { DIAS_UTEIS, buildFolgaQuestion, buildFolgaReminder, diasOcupados, semanaId } from './folga.js';
import type { Store } from './store.js';

export interface FolgaSchedulerDeps {
  store: Store;
  send: (jid: string, text: string) => Promise<boolean>;
  adminPhone: string;
  now?: Date;
  /** Dia da pergunta (0=domingo). */
  askWeekday?: number;
  askHour?: number;
  remindHour?: number;
}

function soDigitos(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}
function mesmoDia(a: string | null, now: Date): boolean {
  if (!a) return false;
  const d = new Date(a);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export async function processFolgaSchedule(deps: FolgaSchedulerDeps): Promise<{ perguntados: number; cobrados: number }> {
  const now = deps.now ?? new Date();
  const week = semanaId(now);
  const today = now.getDay();
  const hour = now.getHours();
  const askWeekday = deps.askWeekday ?? 0;
  const askHour = deps.askHour ?? 9;
  const remindHour = deps.remindHour ?? 9;
  // Gatilho ativo: e domingo e ja passou da hora, OU ja passou do domingo (recupera se o bot ficou offline).
  const gatilhoAtivo = today !== askWeekday || hour >= askHour;
  let perguntados = 0;
  let cobrados = 0;

  for (const prof of deps.store.listProfissionais()) {
    if (!prof.ativo) continue;
    const fone = soDigitos(prof.telefone);
    if (fone.length < 10) continue;
    const jid = `${fone}@s.whatsapp.net`;
    const controle = deps.store.getFolgaControle(prof.id);
    const doCiclo = controle?.semanaId === week;

    if (!doCiclo) {
      // Primeira vez nesta semana: pergunta (a partir do gatilho).
      if (!gatilhoAtivo) continue;
      const livres = DIAS_UTEIS.filter((d) => !diasOcupados(deps.store.listProfissionais(), week, prof.id).has(d));
      const ok = await deps.send(jid, buildFolgaQuestion(prof.nome, livres)).catch(() => false);
      if (ok) {
        deps.store.setFolgaControle(prof.id, { semanaId: week, askedAt: now.toISOString(), remindedAt: null, answeredAt: null });
        perguntados += 1;
      } else {
        log('warn', `Folga: falha ao perguntar a ${prof.nome} (WhatsApp desconectado).`);
      }
      continue;
    }

    // Ja perguntado nesta semana: cobra 1x por dia enquanto nao responder.
    if (!controle?.answeredAt && hour >= remindHour && !mesmoDia(controle.remindedAt, now)) {
      const livres = DIAS_UTEIS.filter((d) => !diasOcupados(deps.store.listProfissionais(), week, prof.id).has(d));
      const ok = await deps.send(jid, buildFolgaReminder(prof.nome, livres)).catch(() => false);
      if (ok) {
        deps.store.setFolgaControle(prof.id, { remindedAt: now.toISOString() });
        cobrados += 1;
      }
    }
  }
  return { perguntados, cobrados };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/folga-scheduler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/folga-scheduler.ts tests/folga-scheduler.test.ts
git commit -m "feat: rotina semanal de folga (pergunta e cobranca)"
```

---

### Task 5: Comando do barbeiro no `Agent` (determinístico)

**Files:**
- Modify: `src/agent.ts`
- Test: `tests/folga-comando.test.ts`

**Interfaces:**
- Consumes: `parseFolgaAnswer`, `diasOcupados`, `DIAS_UTEIS`, `nomeDia`, `semanaId`, `buildFolgaQuestion`, `buildFolgaConfirmation`, `buildFolgaReminder`.
- Produces: `AgentOptions.onFolgaChange?: (info: { profissionalId: number; nome: string; dia: number | null }) => void`; interceptação em `runTurn` antes do LLM.

- [ ] **Step 1: Testes que falham**

`tests/folga-comando.test.ts` (usa injeção `complete` inexistente? não: intercepta antes do LLM, então não precisa de IA):

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';

const tmp: string[] = [];
afterEach(() => { for (const f of tmp.splice(0)) fs.rmSync(f, { force: true }); });
function makeStore(): Store {
  const f = path.join(os.tmpdir(), `fcmd-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmp.push(f);
  return new Store(f);
}

function makeAgent(store: Store, replies: string[], changes: unknown[]) {
  return new Agent({
    store,
    sendText: async (_jid, text) => { replies.push(text); return true; },
    adminPhone: '5521999999999',
    onFolgaChange: (info) => changes.push(info),
  } as never);
}

describe('comando de folga do barbeiro', () => {
  it('grava o dia quando o barbeiro responde a pergunta pendente', async () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    // marca a semana como "perguntada"
    const { semanaId } = await import('../src/folga.js');
    store.setFolgaControle(p.id, { semanaId: semanaId(new Date()), askedAt: new Date().toISOString() });
    const replies: string[] = [];
    const changes: unknown[] = [];
    const agent = makeAgent(store, replies, changes);
    await agent.handleInboundMessage({ jid: `${p.telefone}@s.whatsapp.net`, text: 'quarta', name: 'JUAN', phone: p.telefone });
    expect(store.getProfissional(p.id)!.folgaDia).toBe(3);
    expect(store.getFolgaControle(p.id)!.answeredAt).toBeTruthy();
    expect(replies.join(' ')).toMatch(/quarta/i);
    expect(changes).toHaveLength(1);
  });

  it('recusa dia ocupado e lista os livres', async () => {
    const store = makeStore();
    const { semanaId } = await import('../src/folga.js');
    const week = semanaId(new Date());
    const a = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const b = store.addProfissional({ nome: 'GEANI', telefone: '5521977778888' });
    store.setFolga(a.id, { folgaDia: 3 });
    store.setFolgaControle(a.id, { semanaId: week, answeredAt: 'x' });
    store.setFolgaControle(b.id, { semanaId: week });
    const replies: string[] = [];
    const agent = makeAgent(store, replies, []);
    await agent.handleInboundMessage({ jid: `${b.telefone}@s.whatsapp.net`, text: 'quarta', name: 'GEANI', phone: b.telefone });
    expect(store.getProfissional(b.id)!.folgaDia ?? null).toBeNull();
    expect(replies.join(' ')).toMatch(/livre|ocupad/i);
  });

  it('aceita "nao vou folgar"', async () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const agent = makeAgent(store, [], []);
    await agent.handleInboundMessage({ jid: `${p.telefone}@s.whatsapp.net`, text: 'não vou folgar', name: 'JUAN', phone: p.telefone });
    expect(store.getProfissional(p.id)!.folgaSemana?.dia).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/folga-comando.test.ts`
Expected: FAIL — `folgaDia` fica null (nada implementado).

- [ ] **Step 3: Implementar em `src/agent.ts`**

Imports: adicionar `import { DIAS_UTEIS, buildFolgaConfirmation, buildFolgaQuestion, diasOcupados, nomeDia, parseFolgaAnswer, semanaId } from './folga.js';`

Em `AgentOptions`, adicionar:
```ts
  /** Chamado quando um barbeiro define/muda a folga (para notificar o admin). */
  onFolgaChange?: (info: { profissionalId: number; nome: string; dia: number | null }) => void;
```

Em `runTurn`, logo após `const papelResolvido = resolverPapel({...});` e antes de montar o `system`:
```ts
    if (papelResolvido.papel === 'profissional' && papelResolvido.profissionalId != null) {
      const folgaReply = this.tryFolgaComando(jid, papelResolvido.profissionalId, text);
      if (folgaReply) {
        await this.reply(jid, folgaReply);
        return;
      }
    }
```

Adicionar o método privado na classe:
```ts
  private tryFolgaComando(jid: string, profissionalId: number, text: string): string | null {
    const store = this.opts.store;
    const prof = store.getProfissional(profissionalId);
    if (!prof) return null;
    const week = semanaId(new Date());
    const controle = store.getFolgaControle(profissionalId);
    const pendente = controle?.semanaId === week && !controle.answeredAt;
    const menciona = /\bfolg/i.test(text) || /n[aã]o\s+(vou\s+)?folg/i.test(text);
    if (!pendente && !menciona) return null;

    const parsed = parseFolgaAnswer(text);
    if (parsed.tipo === 'invalido') {
      if (!pendente) return null;
      const livres = DIAS_UTEIS.filter((d) => !diasOcupados(store.listProfissionais(), week, profissionalId).has(d));
      return buildFolgaQuestion(prof.nome, livres);
    }
    if (parsed.tipo === 'sem_folga') {
      store.setFolga(profissionalId, { folgaSemana: { semanaId: week, dia: null } });
      store.setFolgaControle(profissionalId, { semanaId: week, answeredAt: new Date().toISOString() });
      this.opts.onFolgaChange?.({ profissionalId, nome: prof.nome, dia: null });
      return buildFolgaConfirmation(null);
    }
    const ocupados = diasOcupados(store.listProfissionais(), week, profissionalId);
    if (ocupados.has(parsed.dia)) {
      const livres = DIAS_UTEIS.filter((d) => !ocupados.has(d));
      const lista = livres.length ? livres.map(nomeDia).join(', ') : '(nenhum dia livre — responda "não vou folgar")';
      return `Esse dia já está com outro barbeiro. Livres: ${lista}. Qual você quer?`;
    }
    store.setFolga(profissionalId, { folgaDia: parsed.dia, folgaSemana: { semanaId: week, dia: parsed.dia } });
    store.setFolgaControle(profissionalId, { semanaId: week, answeredAt: new Date().toISOString() });
    this.opts.onFolgaChange?.({ profissionalId, nome: prof.nome, dia: parsed.dia });
    return buildFolgaConfirmation(parsed.dia);
  }
```
Obs.: o `handleInboundMessage` já registrou a mensagem do barbeiro como 'cliente' e `reply()` registra a resposta.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/folga-comando.test.ts tests/agent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent.ts tests/folga-comando.test.ts
git commit -m "feat: comando de folga do barbeiro (deterministico, sem IA)"
```

---

### Task 6: Prompt do cliente mostra a folga

**Files:**
- Modify: `src/prompt.ts`
- Test: `tests/folga-prompt.test.ts`

**Interfaces:**
- Consumes: `ProfissionalPublic.folgaSemanaDia`, `nomeDia` de `src/folga.js`.

- [ ] **Step 1: Testes que falham**

`tests/folga-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/prompt.js';
import type { Catalog } from '../src/catalog.js';
import type { AgentConfig } from '../src/agent-config.js';

const catalog: Catalog = { horarios: { '4': [{ open: '09:00', close: '19:00' }] }, servicos: [{ nome: 'Corte', preco: 70 }], promocoes: [] };
const cfg: AgentConfig = { empresa: 'X', personalidade: 'p', instrucoes: 'i', prompt_extra: 'x', boas_vindas: 'b', transferencia: 't' };

describe('prompt inclui folga', () => {
  it('mostra o dia de folga do profissional', () => {
    const p = buildSystemPrompt(catalog, cfg, { clientName: 'Ana', pendingBooking: null, profissionais: [{ id: 1, nome: 'JUAN', horarioInicio: '10:00', horarioFim: '20:00', ativo: true, hasTelefone: true, folgaDia: 3, folgaSemanaDia: 3 }] });
    expect(p).toContain('JUAN');
    expect(p).toMatch(/folga/i);
    expect(p).toContain('quarta');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/folga-prompt.test.ts`
Expected: FAIL — o prompt não contém "folga".

- [ ] **Step 3: Implementar em `src/prompt.ts`**

Import: `import { nomeDia } from './folga.js';`
Trocar a montagem da lista de profissionais (linhas 32-37) por:
```ts
  const ativos = (opts.profissionais ?? []).filter((p) => p.ativo);
  const profissionais = ativos.length
    ? ativos
        .map((p) => {
          const folga = p.folgaSemanaDia != null ? ` — folga: ${nomeDia(p.folgaSemanaDia)}` : '';
          return `- ${p.nome}${p.horarioInicio && p.horarioFim ? ` (${p.horarioInicio} às ${p.horarioFim})` : ''}${folga}`;
        })
        .join('\n')
    : '- (nenhum profissional cadastrado)';
```
Adicionar uma regra após a regra 10 (ou reenumerar) — inserir no bloco REGRAS DE OURO:
```
13. FOLGA DOS PROFISSIONAIS: cada profissional pode ter um dia de folga (indicado na lista "Profissionais disponíveis"). Se o cliente quiser agendar/remarcar com um profissional no dia de folga dele, NÃO agende: avise que ele folga nesse dia e ofereça outro profissional que atende (cobertura), ou pergunte se pode ser outro dia.
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/folga-prompt.test.ts tests/prompt-gestao.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/prompt.ts tests/folga-prompt.test.ts
git commit -m "feat: prompt do cliente informa a folga dos profissionais"
```

---

### Task 7: Configuração, wiring do scheduler e notificação ao admin

**Files:**
- Modify: `src/config.ts`, `.env.example`, `src/index.ts`
- Test: `tests/folga-config.test.ts`

**Interfaces:**
- Consumes: `processFolgaSchedule`, `buildFolgaConfirmation`, `nomeDia`.
- Produces: config `folgaAskEnabled`, `folgaAskWeekday`, `folgaAskHour`, `folgaRemindHour`.

- [ ] **Step 1: Testes que falham**

`tests/folga-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

describe('config de folga', () => {
  it('tem defaults', async () => {
    const { config } = await import('../src/config.js');
    expect(config.folgaAskWeekday).toBe(0);
    expect(config.folgaAskHour).toBe(9);
    expect(config.folgaRemindHour).toBe(9);
    expect(typeof config.folgaAskEnabled).toBe('boolean');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/folga-config.test.ts`
Expected: FAIL — `config.folgaAskWeekday` undefined.

- [ ] **Step 3: Implementar**

Em `src/config.ts`, no `interface Config`:
```ts
  /** Rotina semanal de folga dos barbeiros. */
  folgaAskEnabled: boolean;
  folgaAskWeekday: number;
  folgaAskHour: number;
  folgaRemindHour: number;
```
No objeto `config`:
```ts
  folgaAskEnabled: process.env.FOLGA_ASK_ENABLED !== 'false',
  folgaAskWeekday: Number(process.env.FOLGA_ASK_WEEKDAY ?? 0),
  folgaAskHour: Number(process.env.FOLGA_ASK_HOUR ?? 9),
  folgaRemindHour: Number(process.env.FOLGA_REMIND_HOUR ?? 9),
```
Em `.env.example`, adicionar bloco:
```
# ---- Folga dos barbeiros (pergunta semanal) ----
FOLGA_ASK_ENABLED=true
FOLGA_ASK_WEEKDAY=0
FOLGA_ASK_HOUR=9
FOLGA_REMIND_HOUR=9
```
Em `src/index.ts`:
1. Imports: `import { processFolgaSchedule } from './folga-scheduler.js';` e `import { buildFolgaConfirmation, DIAS_UTEIS, diasOcupados, nomeDia, semanaId } from './folga.js';` (ajustar ao que usar).
2. No `new Agent({...})`, adicionar `onFolgaChange`:
```ts
  onFolgaChange: (info) => {
    if (!config.adminPhone) return;
    const quando = info.dia == null ? 'não folga esta semana' : nomeDia(info.dia);
    void whatsapp.sendText(`${config.adminPhone}@s.whatsapp.net`, `🗓️ FOLGA DEFINIDA\n\nProfissional: ${info.nome}\n${quando}.`).catch(() => false);
  },
```
3. No `setInterval` de 60s já existente (após o flush de notificações), adicionar:
```ts
  if (config.folgaAskEnabled) {
    void processFolgaSchedule({
      store,
      send: (jid, text) => whatsapp.sendText(jid, text),
      adminPhone: config.adminPhone,
      askWeekday: config.folgaAskWeekday,
      askHour: config.folgaAskHour,
      remindHour: config.folgaRemindHour,
    }).catch((err) => log('error', `Falha na rotina de folga: ${(err as Error).message}`));
  }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/folga-config.test.ts tests/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts .env.example src/index.ts tests/folga-config.test.ts
git commit -m "feat: config e wiring da rotina semanal de folga"
```

---

### Task 8: Painel (aba Profissionais) e documentação

**Files:**
- Modify: `src/http.ts`, `README.md`, `docs/funcionalidades.md`, `docs/agendamento-e-atendimento-humano.md`, `docs/changelog.md`
- Test: `tests/http.test.ts` (adicionar caso)

- [ ] **Step 1: Teste que falha (DTO/painel)**

Adicionar em `tests/http.test.ts` (dentro do describe existente):
```ts
  it('aba Profissionais mostra o dia de folga efetivo', async () => {
    await withServer(
      makeDeps({ getProfissionais: () => [{ id: 1, nome: 'JUAN', horarioInicio: '10:00', horarioFim: '20:00', ativo: true, hasTelefone: true, folgaDia: 3, folgaSemanaDia: 3 }] }),
      async (base) => {
        const html = await (await fetch(`${base}/`)).text();
        expect(html).toContain('folga'); // coluna/rotulo presente no HTML do painel
      },
    );
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run tests/http.test.ts -t "folga"`
Expected: FAIL — HTML não contém "folga".

- [ ] **Step 3: Implementar no painel**

Em `src/http.ts`, na aba **Profissionais**:
- No `<thead>` da tabela, adicionar `<th>Folga</th>` antes de `<th style="width:210px">Ações</th>`.
- Adicionar antes de `function profRow`:
```js
const DIA_ABREV = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function profFolgaLabel(p) {
  if (p.folgaSemanaDia != null) return DIA_ABREV[p.folgaSemanaDia];
  if (p.folgaDia != null) return DIA_ABREV[p.folgaDia] + ' (recorrente)';
  return '—';
}
```
- Em `profRow(p)`, incluir a célula antes das ações:
```js
    '<td>' + esc(profFolgaLabel(p)) + '</td>' +
```
- Ajustar o estado vazio de `colspan="5"` para `colspan="6"` (em `renderProfList`).

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run tests/http.test.ts`
Expected: PASS.

- [ ] **Step 5: Atualizar documentação**

- `docs/funcionalidades.md`: nova seção **Folga dos barbeiros** (regras, canal WhatsApp, unicidade, cobertura).
- `docs/agendamento-e-atendimento-humano.md`: nota de que o backend bloqueia `professional_folga` e o agente oferece cobertura.
- `docs/configuracao.md`: variáveis `FOLGA_ASK_*`.
- `docs/changelog.md`: bullet em "Adicionado".
- `README.md`: bullet na seção de funcionalidades + `.env` (variáveis de folga).

- [ ] **Step 6: Commit**

```bash
git add src/http.ts tests/http.test.ts README.md docs
git commit -m "feat: painel exibe folga e documenta a funcionalidade"
```

---

## Verificação final

- [ ] `npm run typecheck` — sem erros.
- [ ] `npm test` — todos passam.
- [ ] `npm run lint` — sem apontamentos.
- [ ] `npm run build` — compila.
- [ ] `docker compose up -d --build` — container sobe; `/api/status` = 200.

## Self-review (cobertura do spec)

- Modelo de dados / folga efetiva / override semanal → Task 1, 2.
- Unicidade + lista de livres → Task 1 (`diasOcupados`) e Task 5.
- Bloqueio `professional_folga` (criar e remarcar) → Task 3.
- Gatilho domingo + reforço diário → Task 4.
- Parser e comando a qualquer momento → Task 1 e 5.
- Prompt do cliente com folga + regra → Task 6.
- Configuração `.env` → Task 7.
- Painel (somente leitura) → Task 8.
- Aviso ao admin → Task 7.
- Casos-limite (sem telefone, sem dias livres, "não vou folgar", fuso) → Tasks 1, 4, 5.
