import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildCancellationNotification, buildProfessionalNotification, buildRescheduleNotification, flushPendingNotifications, flushPendingProfessionalNotifications, notifyProfessionalCancellation, notifyProfessionalForBooking, notifyProfessionalReschedule, type ProfessionalNotifyResult } from '../src/notifier.js';
import { Store } from '../src/store.js';
import type { Profissional } from '../src/profissionais.js';

const tmpFiles: string[] = [];
const JID = '5511888888888@s.whatsapp.net';

afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `notif-prof-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

function addProf(store: Store, over: Partial<Profissional> = {}): Profissional {
  return store.addProfissional({ nome: 'Juan', telefone: '5521988887777', horarioInicio: '10:00', horarioFim: '20:00', ativo: true, ...over });
}

describe('notificação do profissional (Fase 4/5)', () => {
  it('conteúdo tem Cliente, Serviço, Data, Horário, Profissional — sem telefones', () => {
    const msg = buildProfessionalNotification({
      id: 1,
      clientJid: JID,
      clientName: 'João',
      service: 'Corte',
      price: 40,
      date: '2026-09-10',
      time: '15:30',
      professionalId: 1,
      professionalName: 'Juan',
      status: 'confirmado',
      createdAt: new Date().toISOString(),
      notifiedAt: null,
    });
    expect(msg).toContain('🔔 NOVO AGENDAMENTO');
    expect(msg).toContain('Cliente: João');
    expect(msg).toContain('Serviço: Corte');
    expect(msg).toContain('Data: 10/09/2026');
    expect(msg).toContain('Horário: 15:30');
    expect(msg).toContain('Profissional: Juan');
    expect(msg).not.toContain('88888888');
    expect(msg).not.toContain('988887777');
  });

  it('sem profissional no agendamento → não tenta enviar', async () => {
    const store = makeStore();
    const booking = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-10', time: '15:30' });
    let calls = 0;
    const result = await notifyProfessionalForBooking({ store, booking, send: async () => { calls += 1; return true; } });
    expect(result).toBe('no_professional');
    expect(calls).toBe(0);
  });

  it('profissional sem telefone → agendamento não é bloqueado e não envia', async () => {
    const store = makeStore();
    const prof = addProf(store, { telefone: '' });
    const booking = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-10', time: '15:30', professionalId: prof.id, professionalName: prof.nome });
    let calls = 0;
    const result = await notifyProfessionalForBooking({ store, booking, send: async () => { calls += 1; return true; } });
    expect(result).toBe('no_phone');
    expect(calls).toBe(0);
  });

  it('profissional inativo → não envia (skip silencioso)', async () => {
    const store = makeStore();
    const prof = addProf(store, { ativo: false });
    const booking = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-10', time: '15:30', professionalId: prof.id, professionalName: prof.nome });
    let calls = 0;
    const result = await notifyProfessionalForBooking({ store, booking, send: async () => { calls += 1; return true; } });
    expect(result).toBe('inactive');
    expect(calls).toBe(0);
  });

  it('envia para o telefone privado do profissional (sem expor o número na mensagem)', async () => {
    const store = makeStore();
    const prof = addProf(store);
    const booking = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-10', time: '15:30', professionalId: prof.id, professionalName: prof.nome });
    const sent: { jid: string; text: string }[] = [];
    const result = await notifyProfessionalForBooking({
      store,
      booking,
      send: async (jid, text) => {
        sent.push({ jid, text });
        return true;
      },
    });
    expect(result).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.jid).toBe('5521988887777@s.whatsapp.net');
    expect(sent[0]?.text).toContain('Juan');
    expect(sent[0]?.text).not.toContain('5521988887777');
    expect(store.listBookings()[0]?.profissionalNotificadoEm).toBeTruthy();
  });

  it('falha no envio → não marca e não lança erro', async () => {
    const store = makeStore();
    const prof = addProf(store);
    const booking = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-10', time: '15:30', professionalId: prof.id, professionalName: prof.nome });
    const result = await notifyProfessionalForBooking({ store, booking, send: async () => false });
    expect(result).toBe('send_failed');
    expect(store.listBookings()[0]?.profissionalNotificadoEm).toBeFalsy();
  });

  it('flush reenvia pendentes do profissional e não duplica após sucesso', async () => {
    const store = makeStore();
    const prof = addProf(store);
    const booking = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-10', time: '15:30', professionalId: prof.id, professionalName: prof.nome });
    expect(booking.profissionalNotificadoEm).toBeNull();
    let calls = 0;
    const count = await flushPendingProfessionalNotifications({
      store,
      send: async () => {
        calls += 1;
        return true;
      },
    });
    expect(count).toBe(1);
    expect(calls).toBe(1);
    const again = await flushPendingProfessionalNotifications({
      store,
      send: async () => {
        calls += 1;
        return true;
      },
    });
    expect(again).toBe(0);
    expect(calls).toBe(1);
    expect(store.listBookings()[0]?.profissionalNotificadoEm).toBeTruthy();
  });

  it('tipo do resultado cobre os cenários esperados', () => {
    const results: ProfessionalNotifyResult[] = ['sent', 'no_professional', 'no_phone', 'inactive', 'send_failed'];
    expect(results).toHaveLength(5);
  });
});

describe('Fase 6 — tratamento de erros (independência do agendamento e do ADMIN)', () => {
  it('profissional sem telefone não bloqueia o agendamento e o ADMIN segue notificado', async () => {
    const store = makeStore();
    const prof = addProf(store, { telefone: '' });
    const booking = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-11', time: '11:00', professionalId: prof.id, professionalName: prof.nome });
    const result = await notifyProfessionalForBooking({ store, booking, send: async () => true });
    expect(result).toBe('no_phone');
    expect(store.listBookings()).toHaveLength(1);
    const adminSent: string[] = [];
    const count = await flushPendingNotifications({
      store,
      adminPhone: '5511999999999',
      send: async (_jid, text) => {
        adminSent.push(text);
        return true;
      },
    });
    expect(count).toBe(1);
    expect(adminSent[0]).toContain('NOVO AGENDAMENTO');
  });

  it('falha de envio ao profissional não cancela o agendamento; ADMIN segue notificado', async () => {
    const store = makeStore();
    const prof = addProf(store);
    const booking = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-11', time: '11:30', professionalId: prof.id, professionalName: prof.nome });
    const result = await notifyProfessionalForBooking({ store, booking, send: async () => false });
    expect(result).toBe('send_failed');
    expect(store.listBookings()).toHaveLength(1);
    const adminSent: string[] = [];
    const count = await flushPendingNotifications({
      store,
      adminPhone: '5511999999999',
      send: async (_jid, text) => {
        adminSent.push(text);
        return true;
      },
    });
    expect(count).toBe(1);
    expect(adminSent[0]).toContain('NOVO AGENDAMENTO');
  });
});

describe('Fase 7 — cenários completos', () => {
  it('agendamento com Juan → ADMIN e Juan recebem', async () => {
    const store = makeStore();
    const juan = addProf(store, { nome: 'Juan' });
    const booking = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-12', time: '14:00', professionalId: juan.id, professionalName: juan.nome });
    const jids: string[] = [];
    const profRes = await notifyProfessionalForBooking({
      store,
      booking,
      send: async (jid, _t) => {
        jids.push(jid);
        return true;
      },
    });
    await flushPendingNotifications({
      store,
      adminPhone: '5511999999999',
      send: async (jid, _t) => {
        jids.push(jid);
        return true;
      },
    });
    expect(profRes).toBe('sent');
    expect(jids).toContain('5521988887777@s.whatsapp.net');
    expect(jids).toContain('5511999999999@s.whatsapp.net');
  });

  it('agendamento com Geani → ADMIN e Geani recebem', async () => {
    const store = makeStore();
    const geani = addProf(store, { nome: 'Geani', telefone: '5521977770002' });
    const booking = store.addBooking({ clientJid: JID, clientName: 'Maria', service: 'Barba', price: 50, date: '2026-09-12', time: '15:00', professionalId: geani.id, professionalName: geani.nome });
    const jids: string[] = [];
    const profRes = await notifyProfessionalForBooking({
      store,
      booking,
      send: async (jid, _t) => {
        jids.push(jid);
        return true;
      },
    });
    await flushPendingNotifications({
      store,
      adminPhone: '5511999999999',
      send: async (jid, _t) => {
        jids.push(jid);
        return true;
      },
    });
    expect(profRes).toBe('sent');
    expect(jids).toContain('5521977770002@s.whatsapp.net');
    expect(jids).toContain('5511999999999@s.whatsapp.net');
  });

  it('dois profissionais: Juan só recebe o dele; Geani só o dela (sem cruzamento)', async () => {
    const store = makeStore();
    const juan = addProf(store, { nome: 'Juan', telefone: '5521988880001' });
    const geani = addProf(store, { nome: 'Geani', telefone: '5521977770002' });
    const bJuan = store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-13', time: '09:00', professionalId: juan.id, professionalName: juan.nome });
    const bGeani = store.addBooking({ clientJid: JID, clientName: 'Maria', service: 'Barba', price: 50, date: '2026-09-13', time: '10:00', professionalId: geani.id, professionalName: geani.nome });
    const jids: string[] = [];
    const send = async (jid: string) => {
      jids.push(jid);
      return true;
    };
    await notifyProfessionalForBooking({ store, booking: bJuan, send });
    await notifyProfessionalForBooking({ store, booking: bGeani, send });
    expect(jids).toEqual(['5521988880001@s.whatsapp.net', '5521977770002@s.whatsapp.net']);
  });
});

describe('Fase gestão — notificações de cancelamento/remarcação (G4)', () => {
  function bookingAt(store: Store, over: Record<string, unknown> = {}) {
    return store.addBooking({ clientJid: JID, clientName: 'João', service: 'Corte', price: 40, date: '2026-09-20', time: '15:00', ...over });
  }

  it('cancelamento p/ ADMIN inclui telefone do cliente; p/ profissional não inclui telefones', () => {
    const store = makeStore();
    const b = bookingAt(store);
    const admin = buildCancellationNotification(b, true);
    expect(admin).toContain('❌ AGENDAMENTO CANCELADO');
    expect(admin).toContain('Telefone: +55 (11) 88888-8888');
    const prof = buildCancellationNotification(b, false);
    expect(prof).not.toContain('Telefone');
    expect(prof).toContain('Serviço: Corte');
    expect(prof).toContain('20/09/2026');
    expect(prof).toContain('15:00');
  });

  it('remarcação p/ ADMIN mostra De/Para; p/ profissional sem telefones', () => {
    const store = makeStore();
    const b = bookingAt(store);
    const from = { date: '2026-09-20', time: '15:00' };
    const admin = buildRescheduleNotification(b, from, true);
    expect(admin).toContain('🔄 AGENDAMENTO REMARCADO');
    expect(admin).toContain('De: 20/09/2026 às 15:00');
    expect(admin).toContain('Telefone: +55 (11) 88888-8888');
    const prof = buildRescheduleNotification(b, from, false);
    expect(prof).not.toContain('Telefone');
    expect(prof).not.toMatch(/\d{10,}/);
  });

  it('notifyProfessionalCancellation envia ao telefone privado sem expor o número', async () => {
    const store = makeStore();
    const prof = addProf(store);
    const b = bookingAt(store, { professionalId: prof.id, professionalName: prof.nome });
    const sent: { jid: string; text: string }[] = [];
    const ok = await notifyProfessionalCancellation({
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
  });

  it('notifyProfessionalReschedule envia remarcação ao profissional', async () => {
    const store = makeStore();
    const prof = addProf(store);
    const b = bookingAt(store, { professionalId: prof.id, professionalName: prof.nome });
    const sent: string[] = [];
    const ok = await notifyProfessionalReschedule({
      store,
      booking: b,
      from: { date: '2026-09-20', time: '15:00' },
      send: async (jid, text) => {
        sent.push(jid);
        return true;
      },
    });
    expect(ok).toBe(true);
    expect(sent).toContain('5521988887777@s.whatsapp.net');
  });

  it('filas de reenvio ignoram agendamentos cancelados', async () => {
    const store = makeStore();
    const prof = addProf(store);
    const b = bookingAt(store, { professionalId: prof.id, professionalName: prof.nome });
    expect(store.listUnnotifiedBookings()).toHaveLength(1);
    expect(store.listBookingsPendingProfissionalNotif()).toHaveLength(1);
    store.cancelBooking(b.id);
    expect(store.listUnnotifiedBookings()).toHaveLength(0);
    expect(store.listBookingsPendingProfissionalNotif()).toHaveLength(0);
  });
});
