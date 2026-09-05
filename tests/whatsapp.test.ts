import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WhatsAppClient } from '../src/whatsapp.js';

describe('WhatsAppClient.stop', () => {
  it('encerra sem apagar a sessao salva', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-stop-'));
    try {
      fs.writeFileSync(path.join(dir, 'creds.json'), '{}');
      const client = new WhatsAppClient(dir);
      await client.stop();
      expect(fs.existsSync(path.join(dir, 'creds.json'))).toBe(true);
      expect(client.status).toBe('disconnected');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
