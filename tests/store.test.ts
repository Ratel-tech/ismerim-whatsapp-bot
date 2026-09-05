import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';

const tmpFiles: string[] = [];

function makeStore(): Store {
  const file = path.join(os.tmpdir(), `store-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(file);
  return new Store(file);
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

describe('Store (db.json)', () => {
  it('cria o arquivo automaticamente', () => {
    const store = makeStore();
    expect(fs.existsSync(store.file)).toBe(true);
  });

  it('registra cliente e recupera', () => {
    const store = makeStore();
    store.upsertClient('5511888888888@s.whatsapp.net', 'João');
    const client = store.getClient('5511888888888@s.whatsapp.net');
    expect(client?.name).toBe('João');
    expect(client?.phone).toBe('5511888888888');
  });

  it('não duplica cliente', () => {
    const store = makeStore();
    store.upsertClient('jid@s.whatsapp.net', 'João');
    store.upsertClient('jid@s.whatsapp.net', 'João');
    expect(store.getClient('jid@s.whatsapp.net')).not.toBeNull();
  });

  it('salva mensagens da conversa', () => {
    const store = makeStore();
    store.addMessage('jid@s.whatsapp.net', 'cliente', 'Oi');
    store.addMessage('jid@s.whatsapp.net', 'bot', 'Olá!');
    const msgs = store.getMessages('jid@s.whatsapp.net');
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.role).toBe('cliente');
    expect(msgs[1]!.role).toBe('bot');
  });

  it('persiste dados entre instâncias (arquivo)', () => {
    const file = path.join(os.tmpdir(), `store-test-persist-${Date.now()}.json`);
    tmpFiles.push(file);
    const s1 = new Store(file);
    s1.addMessage('jid@s.whatsapp.net', 'cliente', 'Oi');
    const s2 = new Store(file);
    expect(s2.getMessages('jid@s.whatsapp.net')).toHaveLength(1);
  });

  it('detecta vaga ocupada no mesmo horário', () => {
    const store = makeStore();
    expect(store.findBooking('2026-09-04', '16:00')).toBeNull();
    store.addBooking({
      clientJid: 'jid@s.whatsapp.net',
      clientName: 'João',
      service: 'Corte',
      price: 40,
      date: '2026-09-04',
      time: '16:00',
    });
    expect(store.findBooking('2026-09-04', '16:00')).not.toBeNull();
    expect(store.findBooking('2026-09-04', '16:30')).toBeNull();
  });

  it('lista agendamentos e atribui id', () => {
    const store = makeStore();
    const b = store.addBooking({
      clientJid: 'jid@s.whatsapp.net',
      clientName: 'João',
      service: 'Corte',
      price: 40,
      date: '2026-09-04',
      time: '16:00',
    });
    expect(b.id).toBeGreaterThan(0);
    expect(store.listBookings()).toHaveLength(1);
  });

  it('guarda e limpa agendamento pendente da conversa', () => {
    const store = makeStore();
    store.setPendingBooking('jid@s.whatsapp.net', { service: 'Corte', date: '2026-09-04', time: '16:00', client_name: null });
    expect(store.getPendingBooking('jid@s.whatsapp.net')?.service).toBe('Corte');
    store.setPendingBooking('jid@s.whatsapp.net', null);
    expect(store.getPendingBooking('jid@s.whatsapp.net')).toBeNull();
  });
});
