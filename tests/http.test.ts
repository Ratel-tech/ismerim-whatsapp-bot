import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { bucketFor, createHttpServer, type HttpDeps } from '../src/http.js';
import { DEFAULT_BROADCAST_SETTINGS } from '../src/broadcast.js';
import type { AgentConfig } from '../src/agent-config.js';
import type { Catalog } from '../src/catalog.js';

const customer = {
  jid: '5511999999999@s.whatsapp.net',
  name: 'João',
  phone: '5511999999999',
  createdAt: null,
  observations: [],
  needsHuman: false,
  agendou: false,
  interesse: null,
  funil: { stage: 1, total: 5, label: 'Novo lead' },
  lastActivityAt: null,
  lastText: null,
  messageCount: 0,
};

function makeDeps(overrides: Partial<HttpDeps> = {}): HttpDeps {
  const emptyCatalog: Catalog = { horarios: {}, servicos: [], promocoes: [] };
  const agentCfg: AgentConfig = {
    empresa: 'x',
    personalidade: 'x',
    instrucoes: 'x',
    prompt_extra: 'x',
    boas_vindas: 'x',
    transferencia: 'x',
  };
  return {
    getStatus: () => ({ status: 'connected', phone: '5511999999999', qr: null, bookings: [], adminPhone: '5511999999999' }),
    onReconnect: async () => undefined,
    onLogout: async () => undefined,
    onPairingCode: async () => 'ABC-DEF',
    getAgentConfig: () => agentCfg,
    saveAgentConfig: () => undefined,
    getCatalog: () => emptyCatalog,
    saveCatalog: () => undefined,
    getAdminPhone: () => '5511999999999',
    saveAdminPhone: () => undefined,
    getAiConfig: () => ({ provider: 'deepseek', model: 'deepseek-chat', hasKey: true, providers: [] }),
    saveAiConfig: () => undefined,
    getConversationDetail: () => ({ client: customer, messages: [], bookings: [] }),
    addObservation: () => customer,
    updateObservation: () => customer,
    deleteObservation: () => customer,
    setHuman: () => customer,
    sendManualMessage: async () => true,
    listConversations: () => [],
    getBroadcast: () => ({ settings: { ...DEFAULT_BROADCAST_SETTINGS }, status: { running: false, startedAt: null, finishedAt: null, error: null, total: 0, sent: 0, failed: 0, sentToday: 0 } }),
    startBroadcast: () => ({ running: true, startedAt: 1, finishedAt: null, error: null, total: 1, sent: 0, failed: 0, sentToday: 0 }),
    stopBroadcast: () => undefined,
    saveBroadcastSettings: (s) => ({ ...DEFAULT_BROADCAST_SETTINGS, ...s }),
    panelToken: '',
    ...overrides,
  };
}

const servers: ReturnType<typeof createHttpServer>[] = [];

async function withServer<T>(deps: HttpDeps, fn: (base: string) => Promise<T>): Promise<T> {
  const server = createHttpServer(deps);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(async () => {
  while (servers.length) {
    const s = servers.pop();
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

describe('http api', () => {
  it('GET / responde a página', async () => {
    await withServer(makeDeps(), async (base) => {
      const r = await fetch(`${base}/`);
      expect(r.status).toBe(200);
      expect(await r.text()).toContain('Ismerim WhatsApp Bot');
    });
  });

  it('sem token configurado, /api/status responde 200', async () => {
    await withServer(makeDeps({ panelToken: '' }), async (base) => {
      const r = await fetch(`${base}/api/status`);
      expect(r.status).toBe(200);
    });
  });

  it('com token configurado, sem header responde 401', async () => {
    await withServer(makeDeps({ panelToken: 'segredo123' }), async (base) => {
      const r = await fetch(`${base}/api/status`);
      expect(r.status).toBe(401);
    });
  });

  it('com token errado responde 401', async () => {
    await withServer(makeDeps({ panelToken: 'segredo123' }), async (base) => {
      const r = await fetch(`${base}/api/status`, { headers: { 'x-panel-token': 'errado' } });
      expect(r.status).toBe(401);
    });
  });

  it('com token correto responde 200', async () => {
    await withServer(makeDeps({ panelToken: 'segredo123' }), async (base) => {
      const r = await fetch(`${base}/api/status`, { headers: { 'x-panel-token': 'segredo123' } });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { status: string };
      expect(body.status).toBe('connected');
    });
  });

  it('PUT /api/catalog rejeita corpo malformado (422)', async () => {
    await withServer(makeDeps(), async (base) => {
      const r = await fetch(`${base}/api/catalog`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nao: 'e-um-catalogo' }),
      });
      expect(r.status).toBe(422);
    });
  });

  it('GET /api/conversations retorna conversas classificadas por bucket', async () => {
    await withServer(
      makeDeps({
        listConversations: () => [
          { jid: 'a@s.whatsapp.net', name: 'João', phone: '5511', lastClientAt: Date.now(), lastText: 'Oi', messageCount: 1, needsHuman: false, agendou: false, inAttendance: true, funil: { stage: 2, total: 5, label: 'Em conversa' } },
          { jid: 'b@s.whatsapp.net', name: 'Maria', phone: '5522', lastClientAt: Date.now() - 3 * 24 * 3600000, lastText: 'Bom dia', messageCount: 2, needsHuman: true, agendou: true, inAttendance: true, funil: { stage: 4, total: 5, label: 'Agendado' } },
        ],
      }),
      async (base) => {
        const r = await fetch(`${base}/api/conversations`);
        expect(r.status).toBe(200);
        const b = (await r.json()) as { now: number; conversations: { phone: string; bucket: string }[] };
        expect(b.conversations.find((c) => c.phone === '5511')?.bucket).toBe('h24');
        expect(b.conversations.find((c) => c.phone === '5522')?.bucket).toBe('d2_7');
      },
    );
  });

  it('PUT /api/conversations/:jid/human alterna atendimento humano', async () => {
    let received: { jid: string; on: boolean } | null = null;
    await withServer(
      makeDeps({ setHuman: (jid, on) => { received = { jid, on }; return customer; } }),
      async (base) => {
        const r = await fetch(`${base}/api/conversations/5511%40s.whatsapp.net/human`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ on: true }),
        });
        expect(r.status).toBe(200);
        expect(received).toEqual({ jid: '5511@s.whatsapp.net', on: true });
      },
    );
  });

  it('PUT /api/conversations/:jid/observations adiciona observação (humano)', async () => {
    let received: { jid: string; text: string } | null = null;
    await withServer(
      makeDeps({ addObservation: (jid, text) => { received = { jid, text }; return customer; } }),
      async (base) => {
        const r = await fetch(`${base}/api/conversations/5511%40s.whatsapp.net/observations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'prefere corte navalhado' }),
        });
        expect(r.status).toBe(200);
        expect(received).toEqual({ jid: '5511@s.whatsapp.net', text: 'prefere corte navalhado' });
      },
    );
  });

  it('GET /api/broadcast retorna config e status', async () => {
    await withServer(makeDeps(), async (base) => {
      const r = await fetch(`${base}/api/broadcast`);
      expect(r.status).toBe(200);
      const b = (await r.json()) as { settings: { batchSize: number; dailyLimit: number }; status: { total: number } };
      expect(b.settings.batchSize).toBe(DEFAULT_BROADCAST_SETTINGS.batchSize);
      expect(b.status.total).toBe(0);
    });
  });

  it('POST /api/broadcast valida filtro e texto (422)', async () => {
    await withServer(makeDeps(), async (base) => {
      const bad = await fetch(`${base}/api/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: 'nao-existe', text: 'oi' }),
      });
      expect(bad.status).toBe(422);
      const empty = await fetch(`${base}/api/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: 'h24', text: '' }),
      });
      expect(empty.status).toBe(422);
    });
  });

  it('POST /api/broadcast inicia via startBroadcast e retorna status', async () => {
    let received: unknown = null;
    await withServer(
      makeDeps({
        startBroadcast: (input) => {
          received = input;
          return { running: true, startedAt: 1, finishedAt: null, error: null, total: 3, sent: 0, failed: 0, sentToday: 0 };
        },
      }),
      async (base) => {
        const r = await fetch(`${base}/api/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bucket: 'd1_2', text: 'Olá' }),
        });
        expect(r.status).toBe(200);
        const b = (await r.json()) as { total: number };
        expect(b.total).toBe(3);
        expect((received as { bucket: string; text: string }).bucket).toBe('d1_2');
      },
    );
  });

  it('POST /api/broadcast/stop chama stopBroadcast', async () => {
    let stopped = 0;
    await withServer(makeDeps({ stopBroadcast: () => { stopped += 1; } }), async (base) => {
      const r = await fetch(`${base}/api/broadcast/stop`, { method: 'POST' });
      expect(r.status).toBe(200);
      expect(stopped).toBe(1);
    });
  });

  it('PUT /api/broadcast/settings salva a configuração', async () => {
    let saved: unknown = null;
    await withServer(
      makeDeps({ saveBroadcastSettings: (s) => { saved = s; return { ...DEFAULT_BROADCAST_SETTINGS, ...s }; } }),
      async (base) => {
        const r = await fetch(`${base}/api/broadcast/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dailyLimit: 5 }),
        });
        expect(r.status).toBe(200);
        expect((saved as { dailyLimit: number }).dailyLimit).toBe(5);
      },
    );
  });

  it('bucketFor classifica por recencia (24h / 1-2d / 2-7d / antiga)', () => {
    const H = 3600000;
    const now = 1_000_000_000_000;
    expect(bucketFor(now, now)).toBe('h24');
    expect(bucketFor(now - 23 * H, now)).toBe('h24');
    expect(bucketFor(now - 30 * H, now)).toBe('d1_2');
    expect(bucketFor(now - 6 * 24 * H, now)).toBe('d2_7');
    expect(bucketFor(now - 10 * 24 * H, now)).toBe('old');
    expect(bucketFor(null, now)).toBe('old');
  });

  it('POST /api/logout chama onLogout e retorna ok', async () => {
    let called = 0;
    await withServer(makeDeps({ onLogout: async () => { called += 1; } }), async (base) => {
      const r = await fetch(`${base}/api/logout`, { method: 'POST' });
      expect(r.status).toBe(200);
      expect(called).toBe(1);
    });
  });

  it('POST /api/logout com token retorna 401 sem header', async () => {
    await withServer(makeDeps({ panelToken: 'segredo123' }), async (base) => {
      const r = await fetch(`${base}/api/logout`, { method: 'POST' });
      expect(r.status).toBe(401);
    });
  });

  it('POST /api/pairing-code rejeita numero curto (422)', async () => {
    await withServer(makeDeps(), async (base) => {
      const r = await fetch(`${base}/api/pairing-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '123' }),
      });
      expect(r.status).toBe(422);
    });
  });

  it('POST /api/pairing-code com token retorna 401 sem header', async () => {
    await withServer(makeDeps({ panelToken: 'segredo123' }), async (base) => {
      const r = await fetch(`${base}/api/pairing-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '5511999999999' }),
      });
      expect(r.status).toBe(401);
    });
  });

  it('GET /api/ai-config retorna provedor, modelo e hasKey', async () => {
    await withServer(
      makeDeps({ getAiConfig: () => ({ provider: 'gemini', model: 'gemini-2.0-flash', hasKey: false, providers: [{ id: 'gemini', label: 'Google Gemini', defaultModel: 'gemini-2.0-flash' }] }) }),
      async (base) => {
        const r = await fetch(`${base}/api/ai-config`);
        expect(r.status).toBe(200);
        const b = (await r.json()) as { provider: string; hasKey: boolean };
        expect(b.provider).toBe('gemini');
        expect(b.hasKey).toBe(false);
      },
    );
  });

  it('PUT /api/ai-config valida provedor e modelo (422 sem eles)', async () => {
    await withServer(makeDeps(), async (base) => {
      const r = await fetch(`${base}/api/ai-config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'deepseek' }),
      });
      expect(r.status).toBe(422);
    });
  });

  it('PUT /api/ai-config salva config valida e retorna ok', async () => {
    const saved: unknown[] = [];
    await withServer(
      makeDeps({ saveAiConfig: (cfg) => saved.push(cfg) }),
      async (base) => {
        const r = await fetch(`${base}/api/ai-config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'openai', model: 'gpt-4o-mini', apiKey: 'sk-teste' }),
        });
        expect(r.status).toBe(200);
        expect(saved).toHaveLength(1);
        expect((saved[0] as { provider: string }).provider).toBe('openai');
      },
    );
  });
});
