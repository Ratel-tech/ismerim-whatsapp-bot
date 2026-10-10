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
