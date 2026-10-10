import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/prompt.js';
import type { Catalog } from '../src/catalog.js';
import type { AgentConfig } from '../src/agent-config.js';

const catalog: Catalog = { horarios: { '4': [{ open: '09:00', close: '19:00' }] }, servicos: [{ nome: 'Corte', preco: 70 }], promocoes: [] };
const cfg: AgentConfig = { empresa: 'X', personalidade: 'p', instrucoes: 'i', prompt_extra: 'x', boas_vindas: 'b', transferencia: 't' };

describe('prompt inclui folga', () => {
  it('mostra o dia de folga do profissional', () => {
    const p = buildSystemPrompt(catalog, cfg, { clientName: 'Ana', pendingBooking: null, profissionais: [{ id: 1, nome: 'JUAN', horarioInicio: '10:00', horarioFim: '20:00', ativo: true, hasTelefone: true, folgaDia: 3, folgaSemanaDia: 3 }] });
    expect(p).toContain('JUAN');
    expect(p).toMatch(/folga/i);
    expect(p).toContain('quarta');
  });
});
