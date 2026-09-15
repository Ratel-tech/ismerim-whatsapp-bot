import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { isBookingPast } from '../src/bookings.js';

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `feito-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

function addBooking(store: Store, over: Record<string, unknown> = {}) {
  return store.addBooking({ clientJid: 'a@lid', clientName: 'João', service: 'Corte', price: 70, date: '2026-09-10', time: '11:00', ...over });
}

describe('H2 — status feito', () => {
  it('marca como feito a partir de confirmado', () => {
    const store = makeStore();
    const b = addBooking(store);
    expect(store.markFeito(b.id)).toBe(true);
    const after = store.getBooking(b.id);
    expect(after?.status).toBe('feito');
    expect(after?.feitoEm).toBeTruthy();
  });

  it('não marca como feito um cancelado nem um inexistente', () => {
    const store = makeStore();
    const b = addBooking(store);
    store.cancelBooking(b.id);
    expect(store.markFeito(b.id)).toBe(false);
    expect(store.getBooking(b.id)?.status).toBe('cancelado');
    expect(store.markFeito(999)).toBe(false);
  });

  it('desfaz o feito voltando para confirmado', () => {
    const store = makeStore();
    const b = addBooking(store);
    store.markFeito(b.id);
    expect(store.unmarkFeito(b.id)).toBe(true);
    const after = store.getBooking(b.id);
    expect(after?.status).toBe('confirmado');
    expect(after?.feitoEm ?? null).toBeNull();
  });

  it('persiste o status feito entre instâncias', () => {
    const f = path.join(os.tmpdir(), `feito-persist-${Date.now()}.json`);
    tmpFiles.push(f);
    const s1 = new Store(f);
    const b = addBooking(s1);
    s1.markFeito(b.id);
    const s2 = new Store(f);
    expect(s2.getBooking(b.id)?.status).toBe('feito');
  });

  it('migra status legado desconhecido para confirmado (sem quebrar)', () => {
    const f = path.join(os.tmpdir(), `feito-legacy-${Date.now()}.json`);
    tmpFiles.push(f);
    fs.writeFileSync(
      f,
      JSON.stringify({ clients: [], conversations: [], bookings: [{ id: 1, clientJid: 'a@lid', clientName: 'X', service: 'Corte', price: 70, date: '2026-09-10', time: '11:00', createdAt: '2026-01-01T00:00:00.000Z', notifiedAt: null }], nextBookingId: 2 }),
    );
    const store = new Store(f);
    expect(store.getBooking(1)?.status).toBe('confirmado');
  });
});

describe('H2 — identificação de passado', () => {
  it('identifica data anterior a hoje como passada', () => {
    const now = new Date('2026-09-15T12:00:00-03:00');
    expect(isBookingPast('2026-09-12', now)).toBe(true);
    expect(isBookingPast('2026-09-15', now)).toBe(false);
    expect(isBookingPast('2026-09-22', now)).toBe(false);
  });
});
