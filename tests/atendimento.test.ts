import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { criarAgendamentoAtendimento, remarcarAgendamentoAtendimento, type AtendimentoDeps } from '../src/atendimento.js';
import type { Catalog } from '../src/catalog.js';

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `atend-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

/** Devolve um dia futuro que não seja domingo (barbearia fecha domingo). */
function futureWeekday(offset = 3): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
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

const ADMIN_JID = '5511999999999@s.whatsapp.net';

interface SentMessage {
  jid: string;
  text: string;
}

function makeDeps(store: Store, sent: SentMessage[]): AtendimentoDeps {
  store.addProfissional({ nome: 'JUAN', telefone: '5521988887777', horarioInicio: '10:00', horarioFim: '20:00' });
  return {
    store,
    catalog,
    profissionais: store.listProfissionais(),
    adminPhone: '5511999999999',
    send: async (jid, text) => {
      sent.push({ jid, text });
      return true;
    },
  };
}

describe('criarAgendamentoAtendimento — agendar pela ficha do cliente', () => {
  it('cria o agendamento e notifica admin e profissional', async () => {
    const store = makeStore();
    const sent: SentMessage[] = [];
    const deps = makeDeps(store, sent);

    const out = await criarAgendamentoAtendimento(deps, {
      jid: '5511888888888@s.whatsapp.net',
      clientName: 'João',
      service: 'Corte',
      date: futureWeekday(),
      time: '15:00',
      professional: 'JUAN',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.booking.professionalName).toBe('JUAN');
    expect(sent.find((s) => s.jid === ADMIN_JID)?.text).toContain('NOVO AGENDAMENTO');
    expect(sent.find((s) => s.jid === '5521988887777@s.whatsapp.net')?.text).toContain('NOVO AGENDAMENTO');
  });

  it('sem profissional informado, cria e não notifica profissional', async () => {
    const store = makeStore();
    const sent: SentMessage[] = [];
    const deps = makeDeps(store, sent);

    const out = await criarAgendamentoAtendimento(deps, {
      jid: '5511888888888@s.whatsapp.net',
      clientName: 'João',
      service: 'Corte',
      date: futureWeekday(),
      time: '15:00',
    });

    expect(out.ok).toBe(true);
    expect(sent.some((s) => s.jid === '5521988887777@s.whatsapp.net')).toBe(false);
    expect(sent.some((s) => s.jid === ADMIN_JID)).toBe(true);
  });

  it('rejeita serviço inexistente sem criar nada', async () => {
    const store = makeStore();
    const sent: SentMessage[] = [];
    const deps = makeDeps(store, sent);

    const out = await criarAgendamentoAtendimento(deps, {
      jid: '5511888888888@s.whatsapp.net',
      clientName: 'João',
      service: 'Sobrancelha',
      date: futureWeekday(),
      time: '15:00',
    });

    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.length).toBeGreaterThan(0);
    expect(store.listBookings(10)).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('rejeita horário fora do expediente', async () => {
    const store = makeStore();
    const sent: SentMessage[] = [];
    const deps = makeDeps(store, sent);

    const out = await criarAgendamentoAtendimento(deps, {
      jid: '5511888888888@s.whatsapp.net',
      clientName: 'João',
      service: 'Corte',
      date: futureWeekday(),
      time: '23:30',
    });

    expect(out.ok).toBe(false);
    expect(store.listBookings(10)).toHaveLength(0);
  });
});

describe('remarcarAgendamentoAtendimento — remarcar pela ficha do cliente', () => {
  it('remarca e notifica admin e profissional com o horário anterior', async () => {
    const store = makeStore();
    const sent: SentMessage[] = [];
    const deps = makeDeps(store, sent);

    const created = await criarAgendamentoAtendimento(deps, {
      jid: '5511888888888@s.whatsapp.net',
      clientName: 'João',
      service: 'Corte',
      date: futureWeekday(3),
      time: '15:00',
      professional: 'JUAN',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    sent.length = 0;

    const out = await remarcarAgendamentoAtendimento(deps, {
      id: created.booking.id,
      date: futureWeekday(4),
      time: '16:00',
    });

    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.booking.time).toBe('16:00');
    expect(out.booking.professionalName).toBe('JUAN');
    const adminMsg = sent.find((s) => s.jid === ADMIN_JID)?.text ?? '';
    expect(adminMsg).toContain('REMARCADO');
    expect(adminMsg).toContain('15:00');
    expect(sent.find((s) => s.jid === '5521988887777@s.whatsapp.net')?.text).toContain('REMARCADO');
  });

  it('responde erro quando o agendamento não existe', async () => {
    const store = makeStore();
    const sent: SentMessage[] = [];
    const deps = makeDeps(store, sent);

    const out = await remarcarAgendamentoAtendimento(deps, { id: 999, date: futureWeekday(), time: '15:00' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('not_found');
  });

  it('rejeita remarcar para um horário ocupado e mantém o original', async () => {
    const store = makeStore();
    const sent: SentMessage[] = [];
    const deps = makeDeps(store, sent);

    const first = await criarAgendamentoAtendimento(deps, {
      jid: '5511888888888@s.whatsapp.net',
      clientName: 'João',
      service: 'Corte',
      date: futureWeekday(3),
      time: '15:00',
    });
    const second = await criarAgendamentoAtendimento(deps, {
      jid: '5511777777777@s.whatsapp.net',
      clientName: 'Maria',
      service: 'Corte',
      date: futureWeekday(3),
      time: '16:00',
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    const out = await remarcarAgendamentoAtendimento(deps, { id: second.booking.id, date: futureWeekday(3), time: '15:00' });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe('slot_taken');
    expect(store.getBooking(second.booking.id)?.time).toBe('16:00');
  });
});
