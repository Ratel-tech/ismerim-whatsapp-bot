import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';
import { buildOperatorPrompt } from '../src/prompt.js';
import { DEFAULT_AGENT_CONFIG } from '../src/agent-config.js';
import type { Catalog } from '../src/catalog.js';
import { FakeAIProvider } from './helpers/fake-provider.js';

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `oper-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

const ADMIN_PHONE = '5521999990000';
const JUAN_PHONE = '5521988887777';

function makeOpCtx(provider: FakeAIProvider) {
  const store = makeStore();
  const prof = store.addProfissional({ nome: 'JUAN', telefone: JUAN_PHONE, horarioInicio: '10:00', horarioFim: '20:00' });
  const sent: { jid: string; text: string }[] = [];
  const calls = { agenda: [] as unknown[], create: [] as unknown[], done: [] as unknown[] };
  const agent = new Agent({
    store,
    complete: (messages, opts) => provider.complete(messages, opts),
    sendText: async (jid, text) => {
      sent.push({ jid, text });
      return true;
    },
    debounceMs: 0,
    adminPhone: ADMIN_PHONE,
    onListAgenda: async (i) => {
      calls.agenda.push(i);
      return 'LISTA DE AGENDAMENTOS';
    },
    onOperatorCreate: async (i) => {
      calls.create.push(i);
      return 'CRIADO PELO OPERADOR';
    },
    onMarkDone: async (i) => {
      calls.done.push(i);
      return 'MARCADO COMO FEITO';
    },
  });
  return { store, sent, agent, calls, prof };
}

describe('H3 — prompt do operador', () => {
  const catalog: Catalog = { horarios: {}, servicos: [{ nome: 'Corte', preco: 70 }], promocoes: [] };

  it('descreve as funções de operador e lista profissionais, sem telefone', () => {
    const p = buildOperatorPrompt(catalog, DEFAULT_AGENT_CONFIG, {
      papel: 'profissional',
      profissionalNome: 'JUAN',
      profissionais: [{ id: 1, nome: 'JUAN', horarioInicio: '10:00', horarioFim: '20:00', ativo: true, hasTelefone: true }],
    });
    expect(p).toContain('operador');
    expect(p).toContain('JUAN');
    expect(p).toContain('agenda');
    expect(p).not.toMatch(/\d{10,}/);
  });
});

describe('H3 — roteamento do agente por papel', () => {
  it('barbeiro pede agenda → chama onListAgenda como profissional dele', async () => {
    const provider = new FakeAIProvider([JSON.stringify({ intent: 'agenda', reply: 'ok' })]);
    const ctx = makeOpCtx(provider);
    await ctx.agent.handleInboundMessage({ jid: 'x@lid', text: 'meus agendamentos', name: 'JUAN', phone: JUAN_PHONE });
    expect(ctx.calls.agenda).toHaveLength(1);
    const a = ctx.calls.agenda[0] as { papel: string; profissionalId: number };
    expect(a.papel).toBe('profissional');
    expect(a.profissionalId).toBe(ctx.prof.id);
    expect(ctx.sent[0]?.text).toContain('LISTA DE AGENDAMENTOS');
  });

  it('admin pede agenda → chama onListAgenda como admin', async () => {
    const provider = new FakeAIProvider([JSON.stringify({ intent: 'agenda', reply: 'ok' })]);
    const ctx = makeOpCtx(provider);
    await ctx.agent.handleInboundMessage({ jid: 'adm@lid', text: 'agenda de hoje', name: 'Dono', phone: ADMIN_PHONE });
    expect((ctx.calls.agenda[0] as { papel: string }).papel).toBe('admin');
  });

  it('barbeiro cria agendamento de cliente → chama onOperatorCreate', async () => {
    const provider = new FakeAIProvider([
      JSON.stringify({
        intent: 'booking',
        reply: 'ok',
        booking: { requested: true, confirmed: true, acao: 'criar', client_name: 'Maria', service: 'Corte', date: '2099-01-05', time: '15:00', professional: null },
      }),
    ]);
    const ctx = makeOpCtx(provider);
    await ctx.agent.handleInboundMessage({ jid: 'x@lid', text: 'agendar corte pra Maria', name: 'JUAN', phone: JUAN_PHONE });
    expect(ctx.calls.create).toHaveLength(1);
    const c = ctx.calls.create[0] as { clientName: string; service: string; profissionalId: number };
    expect(c.clientName).toBe('Maria');
    expect(c.service).toBe('Corte');
    expect(c.profissionalId).toBe(ctx.prof.id);
    expect(ctx.sent[0]?.text).toContain('CRIADO');
  });

  it('barbeiro cria com telefone do cliente → repassa clientPhone', async () => {
    const provider = new FakeAIProvider([
      JSON.stringify({
        intent: 'booking',
        reply: 'ok',
        booking: { requested: true, confirmed: true, acao: 'criar', client_name: 'Maria', client_phone: '21988887777', service: 'Corte', date: '2099-01-05', time: '15:00', professional: null },
      }),
    ]);
    const ctx = makeOpCtx(provider);
    await ctx.agent.handleInboundMessage({ jid: 'x@lid', text: 'agendar corte pra Maria, tel 21988887777', name: 'JUAN', phone: JUAN_PHONE });
    expect(ctx.calls.create).toHaveLength(1);
    expect((ctx.calls.create[0] as { clientPhone: string | null }).clientPhone).toBe('21988887777');
  });

  it('barbeiro marca como feito → chama onMarkDone', async () => {
    const provider = new FakeAIProvider([
      JSON.stringify({
        intent: 'booking',
        reply: 'ok',
        booking: { requested: true, confirmed: true, acao: 'concluir', service: 'Corte', date: '2026-09-10', time: '11:00' },
      }),
    ]);
    const ctx = makeOpCtx(provider);
    await ctx.agent.handleInboundMessage({ jid: 'x@lid', text: 'marcar como feito', name: 'JUAN', phone: JUAN_PHONE });
    expect(ctx.calls.done).toHaveLength(1);
    expect((ctx.calls.done[0] as { date: string }).date).toBe('2026-09-10');
    expect(ctx.sent[0]?.text).toContain('MARCADO COMO FEITO');
  });

  it('cliente comum NÃO entra no modo operador', async () => {
    const provider = new FakeAIProvider([JSON.stringify({ intent: 'agenda', reply: 'oi' })]);
    const ctx = makeOpCtx(provider);
    await ctx.agent.handleInboundMessage({ jid: 'cliente@lid', text: 'oi', name: 'Zé', phone: '5521911112222' });
    expect(ctx.calls.agenda).toHaveLength(0);
    expect(ctx.calls.create).toHaveLength(0);
    expect(ctx.sent[0]?.text).toBe('oi');
  });
});
