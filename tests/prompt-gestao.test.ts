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
    expect(p).toContain('nenhum agendamento futuro');
  });

  it('não inclui telefones do cliente nem do profissional', () => {
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, { clientName: 'João', pendingBooking: null, clientBookings: bookings });
    expect(p).not.toMatch(/\d{10,}/);
  });
});
