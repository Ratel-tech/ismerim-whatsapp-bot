import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `typing-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

const replyJson = JSON.stringify({
  intent: 'conversation',
  reply: 'Olá! Como posso ajudar?',
  observations: [],
  booking: { requested: false, confirmed: false, acao: 'criar', service: null, professional: null, date: null, time: null, client_name: null },
});

describe('digitando antes de responder', () => {
  it('mostra "digitando" antes de enviar a resposta', async () => {
    const store = makeStore();
    const events: string[] = [];
    const agent = new Agent({
      store,
      complete: async () => replyJson,
      sendTyping: async () => { events.push('typing'); },
      sendText: async () => { events.push('send'); return true; },
      typingMs: 0,
      debounceMs: 0,
    } as never);
    await agent.handleInboundMessage({ jid: '5511@s.whatsapp.net', text: 'oi', name: 'Ana', phone: '5511999999999' });
    expect(events).toEqual(['typing', 'send']);
  });
});

describe('contexto completo da conversa', () => {
  it('inclui uma mensagem antiga (do atendente) que ficaria fora de uma janela de 12', async () => {
    const store = makeStore();
    const jid = '5511@s.whatsapp.net';
    store.addMessage(jid, 'bot', 'CONTEXTO-ANTIGO-HUMANO');
    for (let i = 0; i < 20; i++) store.addMessage(jid, 'cliente', `msg ${i}`);
    let recebido = '';
    const agent = new Agent({
      store,
      complete: async (messages: unknown) => { recebido = JSON.stringify(messages); return replyJson; },
      sendText: async () => true,
      typingMs: 0,
      debounceMs: 0,
    } as never);
    await agent.handleInboundMessage({ jid, text: 'oi', name: 'Ana', phone: '5511999999999' });
    expect(recebido).toContain('CONTEXTO-ANTIGO-HUMANO');
  });
});
