import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { buildClientConfirmationNotification, buildClientReminder, notifyProfessionalConfirmation } from '../src/notifier.js';
import { confirmBookingCliente } from '../src/bookings.js';
import { Agent } from '../src/agent.js';
import { FakeAIProvider } from './helpers/fake-provider.js';

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `lembrete-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

function addBooking(store: Store, over: Record<string, unknown> = {}) {
  return store.addBooking({
    clientJid: '5511888888888@s.whatsapp.net',
    clientName: 'João',
    service: 'Corte',
    price: 70,
    date: '2026-09-15',
    time: '12:00',
    ...over,
  });
}

function futureDay(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const WINDOW = 120 * 60_000;

describe('Lembrete — Store', () => {
  it('lista agendamentos que vencem em até 2h (não passados, não longe)', () => {
    const store = makeStore();
    addBooking(store, { time: '12:00' }); // daqui a 2h → vence
    addBooking(store, { time: '11:30' }); // 1h30 → vence
    addBooking(store, { time: '14:00' }); // 4h → não
    addBooking(store, { time: '09:00' }); // passado → não
    const now = new Date('2026-09-15T10:00:00-03:00').getTime();
    const due = store.listBookingsDueForReminder(now, WINDOW);
    expect(due.map((b) => b.time).sort()).toEqual(['11:30', '12:00']);
  });

  it('ignora cancelados, feitos, já lembrados e sem contato do cliente', () => {
    const store = makeStore();
    const a = addBooking(store, { time: '12:00' });
    const b = addBooking(store, { time: '12:00' });
    const c = addBooking(store, { time: '12:00' });
    addBooking(store, { time: '12:00', clientJid: '' });
    store.cancelBooking(a.id);
    store.markFeito(b.id);
    store.markReminded(c.id);
    const now = new Date('2026-09-15T10:00:00-03:00').getTime();
    expect(store.listBookingsDueForReminder(now, WINDOW)).toHaveLength(0);
  });

  it('markReminded e markClientConfirmed registram timestamp', () => {
    const store = makeStore();
    const b = addBooking(store);
    expect(store.getBooking(b.id)?.remindedAt ?? null).toBeNull();
    store.markReminded(b.id);
    expect(store.getBooking(b.id)?.remindedAt).toBeTruthy();
    store.markClientConfirmed(b.id);
    expect(store.getBooking(b.id)?.confirmedByClientAt).toBeTruthy();
  });
});

describe('Lembrete — mensagens', () => {
  it('monta o lembrete ao cliente pedindo confirmação', () => {
    const store = makeStore();
    const b = addBooking(store);
    const msg = buildClientReminder(b);
    expect(msg).toContain('⏰');
    expect(msg).toContain('Corte');
    expect(msg).toContain('12:00');
    expect(msg.toUpperCase()).toContain('SIM');
    expect(msg.toUpperCase()).toContain('CANCELAR');
  });

  it('monta o aviso ao ADMIN quando o cliente confirma', () => {
    const store = makeStore();
    const b = addBooking(store);
    const msg = buildClientConfirmationNotification(b);
    expect(msg).toContain('✅');
    expect(msg.toUpperCase()).toContain('CONFIRM');
    expect(msg).toContain('João');
    expect(msg).toContain('Corte');
    expect(msg).toContain('12:00');
  });

  it('aviso de confirmação ao PROFISSIONAL não inclui telefone', () => {
    const store = makeStore();
    const b = addBooking(store);
    const msg = buildClientConfirmationNotification(b, false);
    expect(msg).not.toContain('Telefone');
    expect(msg).toContain('João');
  });

  it('notifyProfessionalConfirmation envia ao telefone privado sem expor o número', async () => {
    const store = makeStore();
    const prof = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const b = addBooking(store, { professionalId: prof.id, professionalName: 'JUAN' });
    const sent: { jid: string; text: string }[] = [];
    const ok = await notifyProfessionalConfirmation({
      store,
      booking: b,
      send: async (jid, text) => {
        sent.push({ jid, text });
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(sent[0]?.jid).toBe('5521988887777@s.whatsapp.net');
    expect(sent[0]?.text).not.toContain('5521988887777');
    expect(sent[0]?.text).toContain('CONFIRM');
  });
});

describe('Lembrete — confirmação do cliente', () => {
  it('confirma um agendamento futuro do próprio cliente', () => {
    const store = makeStore();
    const b = addBooking(store, { date: futureDay() });
    const out = confirmBookingCliente(store, { jid: '5511888888888@s.whatsapp.net', date: b.date, time: b.time });
    expect(out.ok).toBe(true);
    expect(store.getBooking(b.id)?.confirmedByClientAt).toBeTruthy();
  });

  it('não confirma agendamento inexistente', () => {
    const store = makeStore();
    const out = confirmBookingCliente(store, { jid: '5511888888888@s.whatsapp.net', date: futureDay(), time: '23:00' });
    expect(out.ok).toBe(false);
  });
});

describe('Lembrete — agente roteia confirmação (acao=confirmar)', () => {
  it('cliente confirma presença → chama onConfirmBooking', async () => {
    const store = makeStore();
    const provider = new FakeAIProvider([
      JSON.stringify({
        intent: 'booking',
        reply: 'ok',
        booking: { requested: true, confirmed: true, acao: 'confirmar', service: 'Corte', date: '2026-09-15', time: '12:00' },
      }),
    ]);
    const calls: unknown[] = [];
    const sent: string[] = [];
    const agent = new Agent({
      store,
      complete: (m, o) => provider.complete(m, o),
      sendText: async (_jid, text) => {
        sent.push(text);
        return true;
      },
      debounceMs: 0,
      onConfirmBooking: async (input) => {
        calls.push(input);
        return 'Presença confirmada! ✅';
      },
    });
    await agent.handleInboundMessage({ jid: '5511888888888@s.whatsapp.net', text: 'SIM', name: 'João' });
    expect(calls).toHaveLength(1);
    expect((calls[0] as { date: string }).date).toBe('2026-09-15');
    expect(sent[0]).toContain('confirmada');
  });
});
