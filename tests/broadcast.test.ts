import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BroadcastManager } from '../src/broadcast.js';

const tmpFiles: string[] = [];
function tmpFile(prefix: string): string {
  const f = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return f;
}
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function fastManager(sendText: (jid: string, text: string) => Promise<boolean>): BroadcastManager {
  return new BroadcastManager(
    sendText,
    tmpFile('bc-settings'),
    tmpFile('bc-state'),
  );
}

async function waitUntil(fn: () => boolean, timeoutMs = 20000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('timeout aguardando envio terminar');
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('BroadcastManager', () => {
  it('salva configuração com limites e normalização', () => {
    const m = fastManager(async () => true);
    const s = m.saveSettings({ dailyLimit: -5, batchSize: 0, messageDelayMs: 10, gapMinMs: 100, gapMaxMs: 100 });
    expect(s.dailyLimit).toBe(0);
    expect(s.batchSize).toBe(1);
    expect(s.messageDelayMs).toBe(500);
    expect(s.gapMaxMs).toBeGreaterThanOrEqual(s.gapMinMs + 1000);
  });

  it('envia todos os destinos e relata envios', async () => {
    const sent: string[] = [];
    const m = fastManager(async (jid) => { sent.push(jid); return true; });
    m.saveSettings({ batchSize: 2, messageDelayMs: 500, gapMinMs: 1000, gapMaxMs: 1200 });
    m.start(
      [{ jid: 'a@s.whatsapp.net', name: null }, { jid: 'b@s.whatsapp.net', name: null }, { jid: 'c@s.whatsapp.net', name: null }],
      'Oi',
      { batchSize: 2, messageDelayMs: 500, gapMinMs: 1000, gapMaxMs: 1200 },
    );
    await waitUntil(() => !m.isRunning());
    const st = m.status();
    expect(st.sent).toBe(3);
    expect(st.failed).toBe(0);
    expect(st.sentToday).toBe(3);
    expect(sent).toHaveLength(3);
  });

  it('conta falhas quando a mensagem não é enviada', async () => {
    const m = fastManager(async () => false);
    m.start([{ jid: 'a@s.whatsapp.net', name: null }, { jid: 'b@s.whatsapp.net', name: null }], 'Oi', { batchSize: 2, messageDelayMs: 500, gapMinMs: 1000, gapMaxMs: 1200 });
    await waitUntil(() => !m.isRunning());
    expect(m.status().failed).toBe(2);
    expect(m.status().sent).toBe(0);
  });

  it('respeita o limite diário', async () => {
    const m = fastManager(async () => true);
    const targets = Array.from({ length: 5 }, (_, i) => ({ jid: `${i}@s.whatsapp.net`, name: null }));
    m.start(targets, 'Oi', { batchSize: 2, messageDelayMs: 500, gapMinMs: 1000, gapMaxMs: 1200, dailyLimit: 2 });
    await waitUntil(() => !m.isRunning());
    const st = m.status();
    expect(st.sent).toBe(2);
    expect(st.sentToday).toBe(2);
    expect(st.error).toContain('Limite diário');
  });

  it('interrompe quando solicitado', async () => {
    const m = fastManager(async () => true);
    const targets = Array.from({ length: 20 }, (_, i) => ({ jid: `${i}@s.whatsapp.net`, name: null }));
    m.start(targets, 'Oi', { batchSize: 1, messageDelayMs: 500, gapMinMs: 1000, gapMaxMs: 1200 });
    setTimeout(() => m.stop(), 400);
    await waitUntil(() => !m.isRunning());
    expect(m.status().error).toContain('interrompido');
    expect(m.status().sent).toBeLessThan(20);
  });

  it('rejeita início com destino vazio', () => {
    const m = fastManager(async () => true);
    expect(() => m.start([], 'Oi')).toThrow(/Nenhum destino/);
  });
});
