import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpServer, type HttpDeps } from '../src/http.js';
import type { AgentConfig } from '../src/agent-config.js';
import type { Catalog } from '../src/catalog.js';

function makeDeps(overrides: Partial<HttpDeps> = {}): HttpDeps {
  const emptyCatalog: Catalog = { horarios: {}, servicos: [], promocoes: [] };
  const agentCfg: AgentConfig = {
    empresa: 'x',
    personalidade: 'x',
    instrucoes: 'x',
    boas_vindas: 'x',
    transferencia: 'x',
  };
  return {
    getStatus: () => ({ status: 'connected', phone: '5511999999999', qr: null, bookings: [], adminPhone: '5511999999999' }),
    onReconnect: async () => undefined,
    onPairingCode: async () => 'ABC-DEF',
    getAgentConfig: () => agentCfg,
    saveAgentConfig: () => undefined,
    getCatalog: () => emptyCatalog,
    saveCatalog: () => undefined,
    getAdminPhone: () => '5511999999999',
    saveAdminPhone: () => undefined,
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
});
