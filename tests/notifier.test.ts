import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildNotification, buildTransferRequest, flushPendingNotifications, formatPhone } from '../src/notifier.js';
import { Store, type Booking } from '../src/store.js';

const booking: Booking = {
  id: 1,
  clientJid: '5511888888888@s.whatsapp.net',
  clientName: 'João',
  service: 'Corte + Barba',
  price: 59.9,
  date: '2026-08-28',
  time: '15:30',
  createdAt: new Date().toISOString(),
  notifiedAt: null,
};

describe('notifier', () => {
  it('formata telefone brasileiro com DDI', () => {
    expect(formatPhone('5511888888888')).toBe('+55 (11) 88888-8888');
    expect(formatPhone('5511999999999')).toBe('+55 (11) 99999-9999');
  });

  it('gera notificação completa (gerada pelo backend, nunca pelo LLM)', () => {
    const msg = buildNotification(booking);
    expect(msg).toContain('📅 NOVO AGENDAMENTO');
    expect(msg).toContain('Cliente: João');
    expect(msg).toContain('Telefone: +55 (11) 88888-8888');
    expect(msg).toContain('Serviço: Corte + Barba');
    expect(msg).toContain('Data: 28/08/2026');
    expect(msg).toContain('Horário: 15:30');
    expect(msg.replace(/\u00a0/g, ' ')).toContain('Valor: R$ 59,90');
    expect(msg).toContain('Agendamento confirmado pelo cliente.');
  });
});

describe('buildTransferRequest', () => {
  it('monta aviso de cliente pedindo atendente humano com nome e telefone', () => {
    const msg = buildTransferRequest('João', '5511888888888@s.whatsapp.net');
    expect(msg).toContain('ATENDENTE HUMANO');
    expect(msg).toContain('Cliente: João');
    expect(msg).toContain('Telefone: +55 (11) 88888-8888');
  });
});

describe('flushPendingNotifications', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
  });

  const tmpFile = (): string => {
    const f = path.join(os.tmpdir(), `flush-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tmpFiles.push(f);
    return f;
  };

  function addBooking(store: Store, name: string): Booking {
    return store.addBooking({
      clientJid: '5511888888888@s.whatsapp.net',
      clientName: name,
      service: 'Corte',
      price: 40,
      date: '2026-09-10',
      time: '10:00',
    });
  }

  it('envia apenas pendentes e marca como notificados', async () => {
    const store = new Store(tmpFile());
    const b1 = addBooking(store, 'João');
    addBooking(store, 'Maria');
    store.markNotified(b1.id);
    const sent: string[] = [];
    const count = await flushPendingNotifications({
      store,
      send: async (_jid, text) => {
        sent.push(text);
        return true;
      },
      adminPhone: '5511999999999',
    });
    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('NOVO AGENDAMENTO');
    expect(store.listUnnotifiedBookings()).toHaveLength(0);
  });

  it('nao envia quando adminPhone esta vazio', async () => {
    const store = new Store(tmpFile());
    addBooking(store, 'João');
    const count = await flushPendingNotifications({
      store,
      send: async () => true,
      adminPhone: '',
    });
    expect(count).toBe(0);
    expect(store.listUnnotifiedBookings()).toHaveLength(1);
  });

  it('mantem pendente quando o envio falha', async () => {
    const store = new Store(tmpFile());
    addBooking(store, 'João');
    const count = await flushPendingNotifications({
      store,
      send: async () => false,
      adminPhone: '5511999999999',
    });
    expect(count).toBe(0);
    expect(store.listUnnotifiedBookings()).toHaveLength(1);
  });
});
