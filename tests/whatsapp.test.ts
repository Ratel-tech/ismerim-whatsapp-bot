import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WhatsAppClient, isGroupJid } from '../src/whatsapp.js';

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

describe('isGroupJid', () => {
  it('identifica grupos, comunidades, canais e broadcasts', () => {
    expect(isGroupJid('120363123456789012@g.us')).toBe(true);
    expect(isGroupJid('120363123456789012@newsletter')).toBe(true);
    expect(isGroupJid('status@broadcast')).toBe(true);
    expect(isGroupJid('10000000000000000@broadcast')).toBe(true);
    expect(isGroupJid('')).toBe(true);
    expect(isGroupJid(null)).toBe(true);
    expect(isGroupJid(undefined)).toBe(true);
  });

  it('não marca conversas individuais como grupo', () => {
    expect(isGroupJid('5521987819040@s.whatsapp.net')).toBe(false);
    expect(isGroupJid('5511999999999@s.whatsapp.net')).toBe(false);
  });
});

describe('WhatsAppClient.logout', () => {
  it('desconecta e apaga a sessao salva (exige novo QR)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-logout-'));
    try {
      fs.writeFileSync(path.join(dir, 'creds.json'), '{}');
      const client = new WhatsAppClient(dir);
      client.phone = '5521987819040';
      await client.logout();
      expect(fs.existsSync(path.join(dir, 'creds.json'))).toBe(false);
      expect(fs.existsSync(dir)).toBe(true);
      expect(client.status).toBe('disconnected');
      expect(client.phone).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
