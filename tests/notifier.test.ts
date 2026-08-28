import { describe, expect, it } from 'vitest';
import { buildNotification, formatPhone } from '../src/notifier.js';
import type { Booking } from '../src/store.js';

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
