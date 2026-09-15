import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/catalog.js';
import { DEFAULT_AGENT_CONFIG } from '../src/agent-config.js';
import { buildSystemPrompt } from '../src/prompt.js';

const catalog: Catalog = { horarios: {}, servicos: [], promocoes: [] };

describe('prompt — agendamentos do cliente (cancelar/remarcar)', () => {
  const bookings = [
    { date: '2026-09-12', time: '15:00', service: 'Corte', professionalName: 'Juan' as string | null },
    { date: '2026-09-14', time: '10:00', service: 'Barba', professionalName: null },
  ];

  it('lista os agendamentos futuros do cliente com data legível', () => {
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, { clientName: 'João', pendingBooking: null, clientBookings: bookings });
    expect(p).toContain('Corte em 12/09/2026 às 15:00 (com Juan)');
    expect(p).toContain('Barba em 14/09/2026 às 10:00');
  });

  it('sem agendamentos mostra aviso', () => {
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, { clientName: 'João', pendingBooking: null, clientBookings: [] });
    expect(p).toContain('nenhum agendamento');
  });

  it('não inclui telefones do cliente nem do profissional', () => {
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, { clientName: 'João', pendingBooking: null, clientBookings: bookings });
    expect(p).not.toMatch(/\d{10,}/);
  });

  it('marca agendamento PASSADO como JÁ PASSOU (não tratar como ativo)', () => {
    const now = new Date('2026-09-15T12:00:00-03:00');
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, {
      clientName: 'Deirdre',
      pendingBooking: null,
      now,
      clientBookings: [{ date: '2026-09-12', time: '11:50', service: 'Corte', professionalName: 'GEANI' }],
    });
    expect(p).toContain('Corte em 12/09/2026 às 11:50 (com GEANI) — JÁ PASSOU');
  });

  it('marca agendamento futuro como futuro', () => {
    const now = new Date('2026-09-15T12:00:00-03:00');
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, {
      clientName: 'Deirdre',
      pendingBooking: null,
      now,
      clientBookings: [{ date: '2026-09-22', time: '14:30', service: 'Corte', professionalName: 'GEANI' }],
    });
    expect(p).toContain('Corte em 22/09/2026 às 14:30 (com GEANI) — futuro');
    expect(p).not.toContain('(com GEANI) — JÁ PASSOU');
  });

  it('instrui o agente a não tratar agendamento passado como ativo', () => {
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, { clientName: 'João', pendingBooking: null, clientBookings: [] });
    expect(p).toContain('JÁ ACONTECERAM');
  });
});
