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
  const f = path.join(os.tmpdir(), `contatos-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

describe('Contatos — Store', () => {
  it('salva o telefone REAL quando informado', () => {
    const store = makeStore();
    const c = store.upsertClient('123@lid', 'João', '5521988887777');
    expect(c.phone).toBe('5521988887777');
    expect(store.getClient('123@lid')?.phone).toBe('5521988887777');
  });

  it('sem telefone real, usa o JID como referência', () => {
    const store = makeStore();
    const c = store.upsertClient('123@lid', 'João', null);
    expect(c.phone).toBe('123');
  });

  it('atualiza o telefone quando um número real aparece depois', () => {
    const store = makeStore();
    store.upsertClient('123@lid', 'João', null);
    store.upsertClient('123@lid', 'João', '5521988887777');
    expect(store.getClient('123@lid')?.phone).toBe('5521988887777');
  });

  it('NÃO apaga o telefone real quando chega uma mensagem sem número', () => {
    const store = makeStore();
    store.upsertClient('123@lid', 'João', '5521988887777');
    store.upsertClient('123@lid', 'João', null);
    expect(store.getClient('123@lid')?.phone).toBe('5521988887777');
  });

  it('listClients retorna os contatos salvos', () => {
    const store = makeStore();
    store.upsertClient('a@lid', 'Ana', '5521911112222');
    store.upsertClient('b@lid', 'Bia', null);
    const list = store.listClients();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.name).sort()).toEqual(['Ana', 'Bia']);
  });
});

describe('Contatos — o agente salva o número de quem manda mensagem', () => {
  it('guarda o telefone real recebido na mensagem', async () => {
    const store = makeStore();
    const provider = new FakeAIProvider([JSON.stringify({ intent: 'conversation', reply: 'Oi!' })]);
    const agent = new Agent({
      store,
      complete: (m, o) => provider.complete(m, o),
      sendText: async () => true,
      debounceMs: 0,
    });
    await agent.handleInboundMessage({ jid: '123@lid', text: 'oi', name: 'João', phone: '5521988887777' });
    expect(store.getClient('123@lid')?.phone).toBe('5521988887777');
  });
});
