import { describe, expect, it } from 'vitest';
import { parseAgentResponse } from '../src/ai.js';

describe('parseAgentResponse', () => {
  it('parseia JSON válido completo', () => {
    const r = parseAgentResponse(
      JSON.stringify({
        intent: 'booking',
        reply: 'Perfeito, vou confirmar!',
        booking: {
          requested: true,
          confirmed: false,
          service: 'Corte',
          date: '2026-08-28',
          time: '15:30',
          client_name: 'João',
        },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.intent).toBe('booking');
    expect(r.data.booking?.requested).toBe(true);
    expect(r.data.booking?.service).toBe('Corte');
  });

  it('parseia JSON com markdown e texto extra', () => {
    const raw = 'Claro:\n```json\n{"intent":"conversation","reply":"Olá!"}\n```\nAté!';
    const r = parseAgentResponse(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.reply).toBe('Olá!');
  });

  it('normaliza data dd/mm/aaaa para aaaa-mm-dd', () => {
    const r = parseAgentResponse(
      JSON.stringify({
        intent: 'booking',
        reply: 'ok',
        booking: { requested: true, confirmed: true, service: 'Corte', date: '28/08/2026', time: '9:05', client_name: 'João' },
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.booking?.date).toBe('2026-08-28');
    expect(r.data.booking?.time).toBe('09:05');
  });

  it('aplica defaults quando booking ausente', () => {
    const r = parseAgentResponse('{"intent":"conversation","reply":"Oi"}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.booking?.requested).toBe(false);
  });

  it('falha com JSON quebrado', () => {
    const r = parseAgentResponse('{isto não é json');
    expect(r.ok).toBe(false);
  });

  it('falha com intent fora do contrato', () => {
    const r = parseAgentResponse('{"intent":"hackear","reply":"oi"}');
    expect(r.ok).toBe(false);
  });

  it('falha com campos desconhecidos (schema estrito)', () => {
    const r = parseAgentResponse('{"intent":"conversation","reply":"oi","preco_inventado":1.99}');
    expect(r.ok).toBe(false);
  });

  it('falha com reply vazio', () => {
    const r = parseAgentResponse('{"intent":"conversation","reply":""}');
    expect(r.ok).toBe(false);
  });
});
