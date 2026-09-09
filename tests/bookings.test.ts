import { afterEach, describe, expect, it } from 'vitest';
import {
  formatConfirmation,
  validateAndCreateBooking,
} from '../src/bookings.js';
import type { Catalog } from '../src/catalog.js';
import type { Profissional } from '../src/profissionais.js';
import { Store } from '../src/store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpFiles: string[] = [];
function makeStore(): Store {
  const file = path.join(os.tmpdir(), `booking-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(file);
  return new Store(file);
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

// Catálogo fixo no teste: independente de o dono editar config/catalog.json no painel.
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
  servicos: [
    { nome: 'Corte', preco: 40 },
    { nome: 'Barba', preco: 30 },
    { nome: 'Corte + Barba', preco: 65 },
  ],
  promocoes: [
    { nome: 'Corte + Barba', preco: 59.9, de: 65, valida_ate: '2099-12-31' },
  ],
};

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    jid: '5511888888888@s.whatsapp.net',
    clientName: 'João',
    serviceName: 'Corte',
    date: futureWeekday(),
    time: '15:30',
    ...overrides,
  };
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

describe('validateAndCreateBooking', () => {
  it('cria agendamento válido com preço do catálogo', () => {
    const store = makeStore();
    const out = validateAndCreateBooking(store, catalog, validInput());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.booking.service).toBe('Corte');
    expect(out.booking.price).toBe(40);
    expect(out.booking.clientName).toBe('João');
  });

  it('REJEITA serviço inventado pelo LLM', () => {
    const store = makeStore();
    const out = validateAndCreateBooking(store, catalog, validInput({ serviceName: 'Lavagem Premium XYZ' }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('service_not_found');
    expect(store.listBookings()).toHaveLength(0);
  });

  it('REJEITA data no passado', () => {
    const store = makeStore();
    const out = validateAndCreateBooking(store, catalog, validInput({ date: '2020-01-01' }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('past_date');
  });

  it('REJEITA horário inválido', () => {
    const store = makeStore();
    const out = validateAndCreateBooking(store, catalog, validInput({ time: '25:99' }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('invalid_time');
  });

  it('REJEITA horário fora do expediente', () => {
    const store = makeStore();
    const out = validateAndCreateBooking(store, catalog, validInput({ time: '22:00' }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('outside_hours');
  });

  it('REJEITA horário em dia fechado (domingo)', () => {
    const store = makeStore();
    const d = new Date();
    d.setDate(d.getDate() + 7 - d.getDay());
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const out = validateAndCreateBooking(store, catalog, validInput({ date: `${y}-${m}-${dd}`, time: '10:00' }));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('outside_hours');
  });

  it('REJEITA vaga já ocupada', () => {
    const store = makeStore();
    const input = validInput();
    validateAndCreateBooking(store, catalog, input);
    const second = validateAndCreateBooking(store, catalog, input);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('slot_taken');
    expect(store.listBookings()).toHaveLength(1);
  });

  it('formata mensagem de confirmação com dados reais', () => {
    const store = makeStore();
    const date = futureWeekday();
    const [y, m, d] = date.split('-');
    const out = validateAndCreateBooking(store, catalog, validInput({ date }));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const msg = formatConfirmation(out.booking);
    expect(msg).toContain('✅ Agendamento confirmado');
    expect(msg).toContain('Corte');
    expect(msg).toContain(`${d}/${m}/${y}`);
    expect(msg).toContain('15:30');
  });
});

function makeProf(overrides: Partial<Profissional> = {}): Profissional {
  return {
    id: 1,
    nome: 'Juan',
    telefone: '5521988887777',
    horarioInicio: '10:00',
    horarioFim: '20:00',
    ativo: true,
    createdAt: '2026-09-09T00:00:00.000Z',
    ...overrides,
  };
}

describe('validateAndCreateBooking — associação com profissional', () => {
  const equipe = [makeProf({ id: 1, nome: 'Juan' }), makeProf({ id: 2, nome: 'Geani' })];

  it('associa o agendamento ao profissional ativo pelo nome', () => {
    const store = makeStore();
    const out = validateAndCreateBooking(store, catalog, validInput({ professionalName: 'Juan' }), equipe);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.booking.professionalId).toBe(1);
    expect(out.booking.professionalName).toBe('Juan');
    expect(store.listBookings()[0]?.professionalId).toBe(1);
  });

  it('resolve variação de caixa/acento no nome', () => {
    const store = makeStore();
    const out = validateAndCreateBooking(store, catalog, validInput({ professionalName: 'geani' }), equipe);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.booking.professionalId).toBe(2);
  });

  it('REJEITA profissional inexistente (não cria agendamento)', () => {
    const store = makeStore();
    const out = validateAndCreateBooking(store, catalog, validInput({ professionalName: 'Zeca' }), equipe);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('professional_not_found');
    expect(store.listBookings()).toHaveLength(0);
  });

  it('REJEITA profissional inativo', () => {
    const store = makeStore();
    const out = validateAndCreateBooking(store, catalog, validInput({ professionalName: 'Juan' }), [makeProf({ ativo: false })]);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('professional_not_found');
  });

  it('sem profissional o agendamento continua válido (comportamento atual preservado)', () => {
    const store = makeStore();
    const out = validateAndCreateBooking(store, catalog, validInput(), equipe);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.booking.professionalId).toBeNull();
    expect(out.booking.professionalName).toBeNull();
  });
});
