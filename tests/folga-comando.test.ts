import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';

const tmp: string[] = [];
afterEach(() => { for (const f of tmp.splice(0)) fs.rmSync(f, { force: true }); });
function makeStore(): Store {
  const f = path.join(os.tmpdir(), `fcmd-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmp.push(f);
  return new Store(f);
}

function makeAgent(store: Store, replies: string[], changes: unknown[]) {
  return new Agent({
    store,
    sendText: async (_jid: string, text: string) => { replies.push(text); return true; },
    adminPhone: '5521999999999',
    onFolgaChange: (info: { profissionalId: number; nome: string; dia: number | null }) => changes.push(info),
    debounceMs: 0,
  } as never);
}

describe('comando de folga do barbeiro', () => {
  it('grava o dia quando o barbeiro responde a pergunta pendente', async () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    // marca a semana como "perguntada"
    const { semanaDaFolga } = await import('../src/folga.js');
    store.setFolgaControle(p.id, { semanaId: semanaDaFolga(new Date()), askedAt: new Date().toISOString() });
    const replies: string[] = [];
    const changes: unknown[] = [];
    const agent = makeAgent(store, replies, changes);
    await agent.handleInboundMessage({ jid: `${p.telefone}@s.whatsapp.net`, text: 'quarta', name: 'JUAN', phone: p.telefone });
    expect(store.getProfissional(p.id)!.folgaDia).toBe(3);
    expect(store.getFolgaControle(p.id)!.answeredAt).toBeTruthy();
    expect(replies.join(' ')).toMatch(/quarta/i);
    expect(changes).toHaveLength(1);
  });

  it('recusa dia ocupado e lista os livres', async () => {
    const store = makeStore();
    const { semanaDaFolga } = await import('../src/folga.js');
    const week = semanaDaFolga(new Date());
    const a = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const b = store.addProfissional({ nome: 'GEANI', telefone: '5521977778888' });
    store.setFolga(a.id, { folgaDia: 3 });
    store.setFolgaControle(a.id, { semanaId: week, answeredAt: 'x' });
    store.setFolgaControle(b.id, { semanaId: week });
    const replies: string[] = [];
    const agent = makeAgent(store, replies, []);
    await agent.handleInboundMessage({ jid: `${b.telefone}@s.whatsapp.net`, text: 'quarta', name: 'GEANI', phone: b.telefone });
    expect(store.getProfissional(b.id)!.folgaDia ?? null).toBeNull();
    expect(replies.join(' ')).toMatch(/livre|ocupad/i);
  });

  it('aceita "nao vou folgar"', async () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const agent = makeAgent(store, [], []);
    await agent.handleInboundMessage({ jid: `${p.telefone}@s.whatsapp.net`, text: 'não vou folgar', name: 'JUAN', phone: p.telefone });
    expect(store.getProfissional(p.id)!.folgaSemana?.dia).toBeNull();
  });

  it('nao intercepta mensagem nao relacionada enquanto pendente (fluxo de operador segue)', async () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const { semanaDaFolga } = await import('../src/folga.js');
    store.setFolgaControle(p.id, { semanaId: semanaDaFolga(new Date()), askedAt: new Date().toISOString() });
    const replies: string[] = [];
    const changes: unknown[] = [];
    const opJson = JSON.stringify({
      intent: 'agenda',
      reply: 'agenda-ok',
      observations: [],
      booking: { requested: false, confirmed: false, acao: 'criar', service: null, professional: null, date: null, time: null, client_name: null },
    });
    const agent = new Agent({
      store,
      complete: async () => opJson,
      sendText: async (_jid: string, text: string) => { replies.push(text); return true; },
      adminPhone: '5521999999999',
      onFolgaChange: (info: { profissionalId: number; nome: string; dia: number | null }) => changes.push(info),
      onListAgenda: async () => 'agenda-ok',
      debounceMs: 0,
    } as never);
    await agent.handleInboundMessage({ jid: `${p.telefone}@s.whatsapp.net`, text: 'ver agenda', name: 'JUAN', phone: p.telefone });
    expect(replies.join(' ')).toContain('agenda-ok');
    expect(replies.join(' ')).not.toMatch(/folga/i);
    expect(changes).toHaveLength(0);
  });

  it('reenvia a pergunta de folga quando pendente e a mensagem nao e entendida', async () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const { semanaDaFolga } = await import('../src/folga.js');
    store.setFolgaControle(p.id, { semanaId: semanaDaFolga(new Date()), askedAt: new Date().toISOString() });
    const replies: string[] = [];
    let llmCalls = 0;
    const agent = new Agent({
      store,
      complete: async () => {
        llmCalls += 1;
        return JSON.stringify({ intent: 'conversation', reply: 'x', observations: [], booking: { requested: false, confirmed: false, acao: 'criar', service: null, professional: null, date: null, time: null, client_name: null } });
      },
      sendText: async (_jid: string, text: string) => { replies.push(text); return true; },
      adminPhone: '5521999999999',
      debounceMs: 0,
    } as never);
    await agent.handleInboundMessage({ jid: `${p.telefone}@s.whatsapp.net`, text: 'que dia e hoje?', name: 'JUAN', phone: p.telefone });
    expect(llmCalls).toBe(0);
    expect(replies.join(' ')).toMatch(/folga|segunda|terça|quarta|quinta|sexta|sábado/i);
  });

  it('reconhece o barbeiro pelo telefone salvo quando a mensagem chega sem telefone', async () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const jid = '210711229816914@lid';
    store.upsertClient(jid, 'Juan Cerqueira', p.telefone);
    const { semanaDaFolga } = await import('../src/folga.js');
    store.setFolgaControle(p.id, { semanaId: semanaDaFolga(new Date()), askedAt: new Date().toISOString() });
    const replies: string[] = [];
    const agent = makeAgent(store, replies, []);
    await agent.handleInboundMessage({ jid, text: 'quinta', name: 'Juan Cerqueira', phone: null });
    expect(store.getProfissional(p.id)!.folgaDia).toBe(4);
  });

  it('responde a data quando o barbeiro pergunta o dia, e repete a folga', async () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const { semanaDaFolga } = await import('../src/folga.js');
    store.setFolgaControle(p.id, { semanaId: semanaDaFolga(new Date()), askedAt: new Date().toISOString() });
    const replies: string[] = [];
    let llmCalls = 0;
    const agent = new Agent({
      store,
      complete: async () => {
        llmCalls += 1;
        return JSON.stringify({ intent: 'conversation', reply: 'x', observations: [], booking: { requested: false, confirmed: false, acao: 'criar', service: null, professional: null, date: null, time: null, client_name: null } });
      },
      sendText: async (_jid: string, text: string) => { replies.push(text); return true; },
      adminPhone: '5521999999999',
      debounceMs: 0,
    } as never);
    await agent.handleInboundMessage({ jid: `${p.telefone}@s.whatsapp.net`, text: 'que dia é hoje?', name: 'JUAN', phone: p.telefone });
    const out = replies.join(' ');
    expect(llmCalls).toBe(0);
    expect(out).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    expect(out).toMatch(/folga|segunda|terça|quarta|quinta|sexta|sábado/i);
    expect(store.getProfissional(p.id)!.folgaDia ?? null).toBeNull();
  });
});
