import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/catalog.js';
import { DEFAULT_AGENT_CONFIG } from '../src/agent-config.js';
import { buildOperatorPrompt, buildSystemPrompt } from '../src/prompt.js';

const descLonga = 'X'.repeat(400);
const catalog: Catalog = {
  horarios: {},
  servicos: [
    { nome: 'Corte', preco: 70 },
    { nome: 'Corte Infantil', preco: 70, descricao: descLonga },
  ],
  promocoes: [{ nome: 'Promo', preco: 50, de: 80, descricao: descLonga }],
};

describe('prompt — economia de tokens', () => {
  it('encurta descrições longas de serviços', () => {
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, { clientName: null, pendingBooking: null });
    expect(p).not.toContain(descLonga);
    expect(p).toContain('…');
    // sobrou o começo da descrição
    expect(p).toContain('X'.repeat(100));
  });

  it('encurta descrições longas de promoções', () => {
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, { clientName: null, pendingBooking: null });
    expect(p).not.toContain(descLonga);
  });

  it('coloca "Data atual" (dinâmico) DEPOIS do formato (prefixo estável p/ cache)', () => {
    const p = buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, { clientName: 'João', pendingBooking: null });
    expect(p.indexOf('## Data atual')).toBeGreaterThan(p.indexOf('## Formato de saída OBRIGATÓRIO'));
  });

  it('no prompt do operador, "Data atual" também fica no fim', () => {
    const p = buildOperatorPrompt(catalog, DEFAULT_AGENT_CONFIG, { papel: 'admin', profissionalNome: null, profissionais: [] });
    expect(p.indexOf('## Data atual')).toBeGreaterThan(p.indexOf('## Formato de saída OBRIGATÓRIO'));
  });
});
