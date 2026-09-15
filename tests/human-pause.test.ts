import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';
import { FakeAIProvider } from './helpers/fake-provider.js';

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `pause-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

function makeCtx(humanPauseMs: number) {
  const store = makeStore();
  const provider = new FakeAIProvider([JSON.stringify({ intent: 'conversation', reply: 'Olá! Como posso ajudar?' })]);
  const sent: { jid: string; text: string }[] = [];
  const agent = new Agent({
    store,
    complete: (messages, opts) => provider.complete(messages, opts),
    sendText: async (jid, text) => {
      sent.push({ jid, text });
      return true;
    },
    debounceMs: 0,
    humanPauseMs,
  });
  return { store, sent, agent, provider };
}

describe('Pausa por atendimento humano', () => {
  it('Store: setHuman liga/desliga com timestamp', () => {
    const store = makeStore();
    store.upsertClient('a@lid', 'João');
    store.setHuman('a@lid', true);
    expect(store.getClient('a@lid')?.needsHuman).toBe(true);
    expect(typeof store.getClient('a@lid')?.humanSince).toBe('number');
    store.setHuman('a@lid', false);
    expect(store.getClient('a@lid')?.needsHuman ?? false).toBe(false);
    expect(store.getClient('a@lid')?.humanSince ?? null).toBeNull();
  });

  it('não responde enquanto o humano está no controle', async () => {
    const { store, sent, agent, provider } = makeCtx(60_000);
    store.upsertClient('x@lid', 'João');
    store.setHuman('x@lid', true);
    await agent.handleInboundMessage({ jid: 'x@lid', text: 'oi', name: 'João' });
    expect(provider.calls).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('retoma sozinho quando o cliente volta a falar depois do tempo de pausa', async () => {
    const { store, sent, agent, provider } = makeCtx(1);
    store.upsertClient('x@lid', 'João');
    store.setHuman('x@lid', true);
    await new Promise((r) => setTimeout(r, 8));
    await agent.handleInboundMessage({ jid: 'x@lid', text: 'oi de novo', name: 'João' });
    expect(provider.calls).toBe(1);
    expect(sent[0]?.text).toContain('Olá');
    expect(store.getClient('x@lid')?.needsHuman ?? false).toBe(false);
  });
});
