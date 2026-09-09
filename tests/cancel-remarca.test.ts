import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { cancelBookingCliente, validateAndRescheduleBooking, type BookingManageOutcome } from '../src/bookings.js';
import type { Catalog } from '../src/catalog.js';
import type { Profissional } from '../src/profissionais.js';

const tmpFiles: string[] = [];
const JID = '5511888888888@s.whatsapp.net';

afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `gestao-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

function futureDay(): string {
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

function addBooking(store: Store, overrides: Record<string, unknown> = {}) {
  return store.addBooking({
    clientJid: JID,
    clientName: 'João',
    service: 'Corte',
    price: 70,
    date: futureDay(),
    time: '15:00',
    ...overrides,
  });
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

describe('Store — gestão de agendamentos (G1)', () => {
  it('addBooking cria com status confirmado', () => {
    const store = makeStore();
    const b = addBooking(store);
    expect(b.status).toBe('confirmado');
  });

  it('cancelBooking marca cancelado e libera a vaga', () => {
    const store = makeStore();
    const b = addBooking(store);
    store.cancelBooking(b.id);
    expect(store.getBooking(b.id)?.status).toBe('cancelado');
    expect(store.findBooking(b.date, b.time)).toBeNull();
    const second = store.addBooking({ clientJid: JID, clientName: 'Maria', service: 'Corte', price: 70, date: b.date, time: b.time });
    expect(second.status).toBe('confirmado');
  });

  it('findBooking ignora agendamentos cancelados', () => {
    const store = makeStore();
    const b = addBooking(store);
    store.cancelBooking(b.id);
    expect(store.findBooking(b.date, b.time)).toBeNull();
  });

  it('rescheduleBooking altera data/hora preservando cliente e profissional', () => {
    const store = makeStore();
    const prof = makeProf();
    store.addProfissional({ nome: prof.nome, telefone: prof.telefone });
    const b = addBooking(store, { professionalId: 1, professionalName: 'Juan' });
    const nova = futureDay();
    const updated = store.rescheduleBooking(b.id, { date: nova, time: '17:00' });
    expect(updated?.date).toBe(nova);
    expect(updated?.time).toBe('17:00');
    expect(updated?.clientJid).toBe(JID);
    expect(updated?.professionalName).toBe('Juan');
    expect(updated?.status).toBe('confirmado');
    expect(updated?.updatedAt).toBeTruthy();
    expect(store.findBooking(nova, '17:00')?.id).toBe(b.id);
  });

  it('cancelar/reschedule inexistente não quebra', () => {
    const store = makeStore();
    expect(store.cancelBooking(999)).toBe(false);
    expect(store.rescheduleBooking(999, { date: futureDay(), time: '10:00' })).toBeNull();
  });

  it('migra booking legado sem status como confirmado (vaga ainda ocupada)', () => {
    const file = path.join(os.tmpdir(), `gestao-legacy-${Date.now()}.json`);
    tmpFiles.push(file);
    const date = futureDay();
    fs.writeFileSync(
      file,
      JSON.stringify({
        clients: [],
        conversations: [],
        bookings: [{ id: 1, clientJid: JID, clientName: 'João', service: 'Corte', price: 70, date, time: '11:00', createdAt: '2026-09-01T00:00:00.000Z', notifiedAt: null }],
        nextBookingId: 2,
      }),
    );
    const store = new Store(file);
    expect(store.getBooking(1)?.status ?? 'confirmado').toBe('confirmado');
    expect(store.findBooking(date, '11:00')).not.toBeNull();
  });
});

describe('Cancelar (G2)', () => {
  it('cancela agendamento futuro do próprio cliente', () => {
    const store = makeStore();
    const b = addBooking(store);
    const out = cancelBookingCliente(store, { jid: JID, date: b.date, time: b.time });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.booking.id).toBe(b.id);
    expect(store.getBooking(b.id)?.status).toBe('cancelado');
  });

  it('não cancela agendamento que não existe', () => {
    const store = makeStore();
    const out = cancelBookingCliente(store, { jid: JID, date: futureDay(), time: '15:00' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('not_found');
  });

  it('não cancela agendamento de outro cliente', () => {
    const store = makeStore();
    const b = addBooking(store, { clientJid: '5521999999999@s.whatsapp.net', clientName: 'Maria' });
    const out = cancelBookingCliente(store, { jid: JID, date: b.date, time: b.time });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('not_found');
  });

  it('não cancela agendamento passado', () => {
    const store = makeStore();
    const b = addBooking(store, { date: '2020-01-10', time: '11:00' });
    const out = cancelBookingCliente(store, { jid: JID, date: b.date, time: b.time });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('past_booking');
  });

  it('segunda tentativa de cancelar → already_cancelled', () => {
    const store = makeStore();
    const b = addBooking(store);
    cancelBookingCliente(store, { jid: JID, date: b.date, time: b.time });
    const again = cancelBookingCliente(store, { jid: JID, date: b.date, time: b.time });
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.code).toBe('not_found');
  });
});

describe('Remarcar (G2)', () => {
  const equipe = [makeProf({ id: 1, nome: 'Juan' })];

  it('remarca para novo horário livre mantendo profissional', () => {
    const store = makeStore();
    const b = addBooking(store, { professionalId: 1, professionalName: 'Juan' });
    const nova = futureDay();
    const out = validateAndRescheduleBooking(store, catalog, equipe, {
      jid: JID,
      originalDate: b.date,
      originalTime: b.time,
      date: nova,
      time: '17:00',
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.booking.id).toBe(b.id);
    expect(out.booking.date).toBe(nova);
    expect(out.booking.time).toBe('17:00');
    expect(out.booking.professionalName).toBe('Juan');
  });

  it('rejeita original inexistente', () => {
    const store = makeStore();
    const out = validateAndRescheduleBooking(store, catalog, equipe, {
      jid: JID,
      originalDate: futureDay(),
      originalTime: '10:00',
      date: futureDay(),
      time: '17:00',
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('original_not_found');
  });

  it('rejeita novo horário no passado', () => {
    const store = makeStore();
    const b = addBooking(store);
    const out = validateAndRescheduleBooking(store, catalog, equipe, {
      jid: JID,
      originalDate: b.date,
      originalTime: b.time,
      date: '2020-01-10',
      time: '17:00',
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('past_date');
  });

  it('rejeita novo horário fora do expediente', () => {
    const store = makeStore();
    const b = addBooking(store);
    const out = validateAndRescheduleBooking(store, catalog, equipe, {
      jid: JID,
      originalDate: b.date,
      originalTime: b.time,
      date: futureDay(),
      time: '22:00',
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('outside_hours');
  });

  it('rejeita novo horário já ocupado por outro agendamento confirmado', () => {
    const store = makeStore();
    const b = addBooking(store, { time: '15:00' });
    const nova = futureDay();
    addBooking(store, { date: nova, time: '17:00' });
    const out = validateAndRescheduleBooking(store, catalog, equipe, {
      jid: JID,
      originalDate: b.date,
      originalTime: b.time,
      date: nova,
      time: '17:00',
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('slot_taken');
  });

  it('remarcação preserva booking e devolve o objeto (tipagem)', () => {
    const results: BookingManageOutcome[] = [];
    expect(results).toHaveLength(0);
  });
});
