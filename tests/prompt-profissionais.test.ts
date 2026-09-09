import { describe, expect, it } from 'vitest';
import type { Catalog } from '../src/catalog.js';
import { DEFAULT_AGENT_CONFIG } from '../src/agent-config.js';
import type { ProfissionalPublic } from '../src/profissionais.js';
import { buildSystemPrompt } from '../src/prompt.js';

const catalog: Catalog = { horarios: {}, servicos: [], promocoes: [] };

function build(profissionais: ProfissionalPublic[]): string {
  return buildSystemPrompt(catalog, DEFAULT_AGENT_CONFIG, { clientName: null, pendingBooking: null, profissionais });
}

describe('prompt — profissionais no contexto do agente (privacidade)', () => {
  const equipe: ProfissionalPublic[] = [
    { id: 1, nome: 'Juan', horarioInicio: '10:00', horarioFim: '20:00', ativo: true, hasTelefone: true },
    { id: 2, nome: 'Geani', horarioInicio: '09:00', horarioFim: '19:00', ativo: true, hasTelefone: true },
  ];

  it('lista nome e horário dos profissionais ativos', () => {
    const p = build(equipe);
    expect(p).toContain('Juan');
    expect(p).toContain('Geani');
    expect(p).toContain('10:00 às 20:00');
    expect(p).toContain('09:00 às 19:00');
  });

  it('NUNCA inclui o telefone do profissional no contexto do agente', () => {
    const p = build(equipe);
    expect(p).not.toContain('988887777');
    expect(p).not.toMatch(/\d{10,}/);
    expect(p.toLowerCase()).not.toContain('telefone do juan');
  });

  it('exibe aviso quando não há profissionais cadastrados', () => {
    const p = build([]);
    expect(p).toContain('nenhum profissional cadastrado');
  });

  it('não lista profissionais inativos na seção', () => {
    const p = build([{ ...equipe[0]!, ativo: false }]);
    expect(p).not.toContain('- Juan ');
    expect(p).not.toContain('10:00 às 20:00');
  });
});
