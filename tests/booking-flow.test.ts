import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { createBookingFromAgent } from '../src/booking-flow.js';
import type { Catalog } from '../src/catalog.js';
import type { Profissional } from '../src/profissionais.js';

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `flow-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

function futureWeekday(): string {
  for (let i = 3; i < 13; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (d.getDay() !== 0) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }
  }
  return '2099-01-01';
}

const catalog: Catalog = {
  horarios: {
    '0': [],
    '1': [{ open: '09:00', close: '19:00' }],
    '2': [{ open: '09:00', close: '19:00' }],
    '3': [{ open: '09:00', close: '19:00' }],
    '4': [{ open: '09:00', close: '19:00' }],
    '5': [{ open: '09:00', close: '19:00' }],
    '6': [{ open: '09:00', close: '19:00' }],
  },
  servicos: [{ nome: 'Corte', preco: 70 }],
  promocoes: [],
};

const juan: Profissional = {
  id: 1,
  nome: 'JUAN',
  telefone: '5521973786250',
  horarioInicio: '10:00',
  horarioFim: '20:00',
  ativo: true,
  createdAt: '2026-09-09T00:00:00.000Z',
};

describe('createBookingFromAgent — vínculo do profissional', () => {
  it('vincula o profissional quando o agente informa o nome (campo professional)', () => {
    const store = makeStore();
    const out = createBookingFromAgent(store, catalog, [juan], {
      jid: '5511888888888@s.whatsapp.net',
      clientName: 'João',
      service: 'Corte',
      professional: 'JUAN',
      date: futureWeekday(),
      time: '15:00',
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.booking.professionalId).toBe(1);
    expect(out.booking.professionalName).toBe('JUAN');
  });

  it('sem profissional informado, cria sem vínculo', () => {
    const store = makeStore();
    const out = createBookingFromAgent(store, catalog, [juan], {
      jid: '5511888888888@s.whatsapp.net',
      clientName: 'João',
      service: 'Corte',
      professional: null,
      date: futureWeekday(),
      time: '15:00',
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.booking.professionalId ?? null).toBeNull();
  });
});
