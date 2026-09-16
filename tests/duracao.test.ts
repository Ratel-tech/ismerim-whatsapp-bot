import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/catalog.js';
import { DEFAULT_AGENT_CONFIG } from '../src/agent-config.js';
import { buildOperatorPrompt, buildSystemPrompt } from '../src/prompt.js';

const catalog: Catalog = {
  horarios: {},
  servicos: [
    { nome: 'Corte', preco: 70, duracao: 25 },
    { nome: 'Corte + Barba', preco: 140, duracao: 45 },
  ],
  promocoes: [],
};

describe('duração dos serviços no prompt', () => {
  it('mostra a duração no prompt do cliente', () => {
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, { clientName: null, pendingBooking: null }).replace(/\u00a0/g, ' ');
    expect(p).toContain('Corte — R$ 70,00 (25 min)');
    expect(p).toContain('Corte + Barba — R$ 140,00 (45 min)');
  });

  it('mostra a duração no prompt do operador', () => {
    const p = buildOperatorPrompt(catalog, DEFAULT_AGENT_CONFIG, { papel: 'admin', profissionalNome: null, profissionais: [] }).replace(/\u00a0/g, ' ');
    expect(p).toContain('Corte — R$ 70,00 (25 min)');
  });
});
