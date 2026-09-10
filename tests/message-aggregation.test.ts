import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';
import type { ChatMessage } from '../src/ai.js';

const JID = '5511888888888@s.whatsapp.net';
const OTHER = '5511999999999@s.whatsapp.net';
const tmpFiles: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const file = path.join(os.tmpdir(), `agg-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(file);
  return new Store(file);
}

class RecordingProvider {
  calls: ChatMessage[][] = [];
  constructor(private readonly reply = 'ok') {}
  async complete(messages: ChatMessage[], _opts?: { json?: boolean; temperature?: number }): Promise<string> {
    this.calls.push(messages);
    return JSON.stringify({ intent: 'conversation', reply: this.reply });
  }
}

function makeAgent(provider: RecordingProvider, debounceMs = 5000, maxWaitMs = 15000) {
  const store = makeStore();
  const sent: { jid: string; text: string }[] = [];
  const agent = new Agent({
    store,
    complete: (messages, opts) => provider.complete(messages, opts),
    sendText: async (jid, text) => {
      sent.push({ jid, text });
      return true;
    },
    debounceMs,
    maxWaitMs,
  });
  return { store, sent, agent, provider };
}

describe('agregação de mensagens picadas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('junta fragmentos em sequência e responde uma única vez', async () => {
    const provider = new RecordingProvider('Oi! Tudo bem?');
    const { sent, agent } = makeAgent(provider);

    await agent.handleInboundMessage({ jid: JID, text: 'oi..............', name: 'João' });
    await agent.handleInboundMessage({ jid: JID, text: 'tudo', name: 'João' });
    await agent.handleInboundMessage({ jid: JID, text: 'bem?', name: 'João' });
    await agent.handleInboundMessage({ jid: JID, text: 'com', name: 'João' });
    await agent.handleInboundMessage({ jid: JID, text: 'vc?', name: 'João' });

    expect(sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5000);

    expect(sent).toHaveLength(1);
    expect(provider.calls).toHaveLength(1);
  });

  it('envia à IA o texto unido dos fragmentos', async () => {
    const provider = new RecordingProvider();
    const { agent } = makeAgent(provider);

    await agent.handleInboundMessage({ jid: JID, text: 'oi..............', name: 'João' });
    await agent.handleInboundMessage({ jid: JID, text: 'tudo', name: 'João' });
    await agent.handleInboundMessage({ jid: JID, text: 'bem?', name: 'João' });
    await agent.handleInboundMessage({ jid: JID, text: 'com', name: 'João' });
    await agent.handleInboundMessage({ jid: JID, text: 'vc?', name: 'João' });

    await vi.advanceTimersByTimeAsync(5000);

    const lastCall = provider.calls[0];
    expect(lastCall?.at(-1)?.content).toBe('oi.............. tudo bem? com vc?');
  });

  it('mensagens separadas por mais de 5s geram respostas separadas', async () => {
    const provider = new RecordingProvider();
    const { sent, agent } = makeAgent(provider);

    await agent.handleInboundMessage({ jid: JID, text: 'primeira', name: 'João' });
    await vi.advanceTimersByTimeAsync(5000);
    await agent.handleInboundMessage({ jid: JID, text: 'segunda', name: 'João' });
    await vi.advanceTimersByTimeAsync(5000);

    expect(sent).toHaveLength(2);
    expect(provider.calls).toHaveLength(2);
  });

  it('respeita o teto de 15s mesmo com mensagens contínuas', async () => {
    const provider = new RecordingProvider();
    const { sent, agent } = makeAgent(provider);

    await agent.handleInboundMessage({ jid: JID, text: 'a', name: 'João' });
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(4000);
      await agent.handleInboundMessage({ jid: JID, text: `frag${i}`, name: 'João' });
    }
    expect(sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(3000);
    expect(sent).toHaveLength(1);
  });

  it('não mistura mensagens de clientes diferentes', async () => {
    const provider = new RecordingProvider();
    const { sent, agent } = makeAgent(provider);

    await agent.handleInboundMessage({ jid: JID, text: 'oi', name: 'João' });
    await agent.handleInboundMessage({ jid: OTHER, text: 'bom dia', name: 'Maria' });
    await vi.advanceTimersByTimeAsync(5000);

    expect(sent).toHaveLength(2);
    expect(sent.map((s) => s.jid).sort()).toEqual([JID, OTHER].sort());
  });

  it('debounceMs 0 processa imediatamente (compatibilidade)', async () => {
    const provider = new RecordingProvider();
    const { sent, agent } = makeAgent(provider, 0);

    await agent.handleInboundMessage({ jid: JID, text: 'oi', name: 'João' });

    expect(sent).toHaveLength(1);
  });
});
