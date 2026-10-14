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

function fakeClient(): { client: WhatsAppClient; calls: unknown[]; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-typing-'));
  const client = new WhatsAppClient(dir);
  const calls: unknown[] = [];
  const sock = {
    sendPresenceUpdate: async (p: string, j: string) => { calls.push(['presence', p, j]); },
    sendMessage: async (j: string, m: unknown) => { calls.push(['msg', j, m]); return {}; },
    presenceSubscribe: async () => undefined,
    readMessages: async () => undefined,
  };
  (client as unknown as { sock: unknown }).sock = sock;
  (client as unknown as { status: string }).status = 'connected';
  return { client, calls, dir };
}

describe('WhatsAppClient — digitando e atividade humana', () => {
  it('sendTyping envia composing e depois paused', async () => {
    const { client, calls, dir } = fakeClient();
    try {
      await client.sendTyping('5511@s.whatsapp.net', 0);
      expect(calls).toEqual([
        ['presence', 'composing', '5511@s.whatsapp.net'],
        ['presence', 'paused', '5511@s.whatsapp.net'],
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mensagem fromMe dispara onOutgoing (atividade humana) e nao onMessage', async () => {
    const { client, dir } = fakeClient();
    try {
      const outgoing: { jid: string; text: string }[] = [];
      const incoming: unknown[] = [];
      client.onOutgoing = (m) => outgoing.push(m);
      client.onMessage = (m) => incoming.push(m);
      await (client as unknown as { handleMessagesUpsert: (e: unknown) => Promise<void> }).handleMessagesUpsert({
        type: 'notify',
        messages: [{ key: { fromMe: true, remoteJid: '5511@s.whatsapp.net', id: '1' }, message: { conversation: 'ja te respondo' } }],
      });
      expect(outgoing).toEqual([{ jid: '5511@s.whatsapp.net', text: 'ja te respondo' }]);
      expect(incoming).toHaveLength(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('mensagem de cliente dispara onMessage', async () => {
    const { client, dir } = fakeClient();
    try {
      const incoming: unknown[] = [];
      client.onMessage = (m) => incoming.push(m);
      await (client as unknown as { handleMessagesUpsert: (e: unknown) => Promise<void> }).handleMessagesUpsert({
        type: 'notify',
        messages: [{ key: { fromMe: false, remoteJid: '5511@s.whatsapp.net', id: '2' }, message: { conversation: 'oi' } }],
      });
      expect(incoming).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
