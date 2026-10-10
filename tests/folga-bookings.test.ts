import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/store.js';
import { validateAndCreateBooking, validateAndRescheduleBooking } from '../src/bookings.js';
import type { Catalog } from '../src/catalog.js';

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
  it('permite agendar fora do dia de folga', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00')); // quinta
    const store = makeStore();
    const juan = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    store.setFolga(juan.id, { folgaDia: 4 }); // quinta
    const out = validateAndCreateBooking(store, catalog, { jid: 'x@s.whatsapp.net', clientName: 'Ana', serviceName: 'Corte', date: '2026-10-09', time: '10:00', professionalName: 'JUAN' }, store.listProfissionais());
    expect(out.ok).toBe(true); // sexta ok
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

describe('folga bloqueia remarcacao', () => {
  it('remarcar informando profissional em folga no novo dia -> rejeitado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00')); // quinta
    const store = makeStore();
    const juan = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    store.setFolga(juan.id, { folgaDia: 4 }); // quinta
    store.addBooking({ clientJid: 'x@s.whatsapp.net', clientName: 'Ana', service: 'Corte', price: 70, date: '2026-10-09', time: '10:00' }); // sexta
    const out = validateAndRescheduleBooking(store, catalog, store.listProfissionais(), {
      jid: 'x@s.whatsapp.net',
      originalDate: '2026-10-09',
      originalTime: '10:00',
      date: '2026-10-15',
      time: '10:00',
      professionalName: 'JUAN',
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('professional_folga');
  });

  it('remarcar sem informar profissional (usa o original) para folga dele -> rejeitado', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00')); // quinta
    const store = makeStore();
    const juan = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    store.setFolga(juan.id, { folgaDia: 4 }); // quinta
    store.addBooking({ clientJid: 'x@s.whatsapp.net', clientName: 'Ana', service: 'Corte', price: 70, date: '2026-10-09', time: '10:00', professionalId: juan.id, professionalName: 'JUAN' }); // sexta
    const out = validateAndRescheduleBooking(store, catalog, store.listProfissionais(), {
      jid: 'x@s.whatsapp.net',
      originalDate: '2026-10-09',
      originalTime: '10:00',
      date: '2026-10-15',
      time: '10:00',
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('professional_folga');
  });

  it('remarcar agendamento sem profissional -> permitido', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-08T12:00:00')); // quinta
    const store = makeStore();
    const juan = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    store.setFolga(juan.id, { folgaDia: 4 }); // quinta
    store.addBooking({ clientJid: 'x@s.whatsapp.net', clientName: 'Ana', service: 'Corte', price: 70, date: '2026-10-09', time: '10:00' }); // sexta
    const out = validateAndRescheduleBooking(store, catalog, store.listProfissionais(), {
      jid: 'x@s.whatsapp.net',
      originalDate: '2026-10-09',
      originalTime: '10:00',
      date: '2026-10-15',
      time: '10:00',
    });
    expect(out.ok).toBe(true);
  });
});
