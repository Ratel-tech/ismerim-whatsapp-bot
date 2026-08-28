import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { config } from './config.js';
import { log } from './log.js';

const baileysLogger = pino({ level: 'warn' });

export type WaStatus =
  | 'disconnected'
  | 'connecting'
  | 'awaiting_scan'
  | 'connected'
  | 'reconnecting'
  | 'logged_out';

export interface InboundMessage {
  jid: string;
  text: string;
  waId: string | null;
  name: string | null;
}

/** Tempo mínimo que cada QR fica visível antes de aceitar um novo (evita rotação rápida). */
const QR_MIN_DISPLAY_MS = 12_000;

function extractText(msg: WAMessage): string | null {
  const content = msg.message as Record<string, unknown> | null | undefined;
  if (!content) return null;
  const conv = content['conversation'];
  if (typeof conv === 'string' && conv.trim()) return conv.trim();
  for (const key of ['extendedTextMessage', 'imageMessage', 'videoMessage', 'documentMessage', 'audioMessage']) {
    const part = content[key] as { text?: unknown; caption?: unknown } | undefined;
    if (!part) continue;
    const t = part.text ?? part.caption;
    if (typeof t === 'string' && t.trim()) return t.trim();
  }
  return null;
}

function normalizeJid(jid?: string | null): string {
  return (jid ?? '').split(':')[0] as string;
}

export class WhatsAppClient {
  status: WaStatus = 'disconnected';
  phone: string | null = null;
  /** QR em PNG base64 (para a página :3081) */
  qr: string | null = null;
  onMessage: ((msg: InboundMessage) => void) | null = null;

  private sock: WASocket | null = null;
  private qrRaw: string | null = null;
  private qrShownAt: number | null = null;
  private shouldClose = true;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private readonly sessionDir: string = config.sessionDir) {}

  isConnected(): boolean {
    return this.status === 'connected' && Boolean(this.sock);
  }

  async connect(): Promise<void> {
    if (this.status === 'connecting' || this.status === 'awaiting_scan' || this.status === 'connected') {
      log('info', `connect ignorado (status ${this.status})`);
      return;
    }
    this.shouldClose = false;
    this.reconnectAttempts = 0;
    if (this.sock) {
      const old = this.sock;
      this.sock = null;
      this.shouldClose = true;
      try { old.end(new Error('reconnect')); } catch { /* noop */ }
      this.shouldClose = false;
    }
    await this.startSocket();
  }

  /** Apaga a sessão e gera um QR novo. */
  async resetSession(): Promise<void> {
    this.shouldClose = true;
    this.clearReconnectTimer();
    try { await this.sock?.logout(); } catch { /* noop */ }
    this.stopSocket();
    fs.rmSync(this.sessionDir, { recursive: true, force: true });
    fs.mkdirSync(this.sessionDir, { recursive: true });
    this.qr = null;
    this.qrRaw = null;
    this.phone = null;
    this.status = 'disconnected';
    await this.connect();
  }

  async sendText(jid: string, text: string): Promise<boolean> {
    if (!this.sock || !this.isConnected()) return false;
    try {
      await this.sock.sendMessage(jid, { text });
      return true;
    } catch (err) {
      log('error', `Falha ao enviar mensagem: ${(err as Error).message}`);
      return false;
    }
  }

  /** Código de pareamento (alternativa ao QR: Aparelhos conectados -> Conectar com número). */
  async requestPairingCode(phone: string): Promise<string> {
    const sock = this.sock;
    if (!sock) throw new Error('Inicie a conexão antes (botão Conectar).');
    if (sock.authState.creds.registered) throw new Error('Este WhatsApp já está conectado.');
    const waitOpen = (sock as unknown as { waitForSocketOpen?: () => Promise<void> }).waitForSocketOpen;
    if (waitOpen) {
      await Promise.race([
        waitOpen(),
        new Promise((_r, reject) => setTimeout(() => reject(new Error('Tempo esgotado aguardando conexão com o WhatsApp.')), 30_000)),
      ]);
    }
    const code = await sock.requestPairingCode(phone);
    log('info', `Código de pareamento gerado: ${code}`);
    return code;
  }

  // ---------------- internos ----------------

  private async startSocket(): Promise<void> {
    fs.mkdirSync(this.sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
    const sock = makeWASocket({
      auth: state,
      browser: Browsers.windows('Ismerim Barbearia'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      logger: baileysLogger,
      shouldIgnoreJid: (jid) => jid.endsWith('@g.us'),
    });
    this.sock = sock;
    this.setStatus('connecting');

    sock.ev.on('creds.update', () => saveCreds().catch(() => undefined));
    sock.ev.on('connection.update', (u) => this.handleConnectionUpdate(u));
    sock.ev.on('messages.upsert', (e) => this.handleMessagesUpsert(e));
  }

  private handleConnectionUpdate(update: { connection?: string; lastDisconnect?: { error?: Error }; qr?: string }): void {
    if (update.qr && this.status !== 'connected') {
      const now = Date.now();
      const isFirst = this.qrRaw === null;
      const changed = update.qr !== this.qrRaw;
      const elapsed = this.qrShownAt === null || now - this.qrShownAt >= QR_MIN_DISPLAY_MS;

      if (isFirst || (changed && elapsed)) {
        this.qrRaw = update.qr;
        this.qrShownAt = now;
        this.setStatus('awaiting_scan');
        qrcodeTerminal.generate(update.qr, { small: true }, (out: string) => console.log(out));
        QRCode.toBuffer(update.qr, { type: 'png', width: 480, margin: 1, errorCorrectionLevel: 'M' })
          .then((buf) => { this.qr = buf.toString('base64'); })
          .catch((err) => log('error', `Falha ao gerar imagem do QR: ${(err as Error).message}`));
      } else {
        this.setStatus('awaiting_scan');
      }
      return;
    }

    if (update.connection === 'connecting') {
      this.setStatus('connecting');
      return;
    }

    if (update.connection === 'open') {
      this.reconnectAttempts = 0;
      this.phone = normalizeJid(this.sock?.user?.id) || this.phone;
      this.qr = null;
      this.qrRaw = null;
      this.setStatus('connected');
      log('info', `Conectado como ${this.phone}`);
      return;
    }

    if (update.connection === 'close') {
      const boom = update.lastDisconnect?.error;
      const statusCode = boom instanceof Boom ? boom.output.statusCode : undefined;
      if (statusCode === DisconnectReason.loggedOut) {
        log('warn', 'Sessão encerrada (logged out). Use "Gerar novo QR" para reconectar.');
        this.qr = null;
        this.setStatus('logged_out');
        return;
      }
      if (this.shouldClose) {
        this.setStatus('disconnected');
        return;
      }
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(5000 * 2 ** Math.min(this.reconnectAttempts, 5), 60_000);
    this.reconnectAttempts += 1;
    this.setStatus('reconnecting');
    log('warn', `Conexão perdida. Reconectando em ${Math.round(delay / 1000)}s (tentativa ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnectLoop();
    }, delay);
  }

  private async reconnectLoop(): Promise<void> {
    if (this.shouldClose) {
      this.setStatus('disconnected');
      return;
    }
    this.stopSocket();
    try {
      await this.startSocket();
    } catch (err) {
      log('error', `Falha ao reconectar: ${(err as Error).message}`);
      this.scheduleReconnect();
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private stopSocket(): void {
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    try { sock.end(new Error('stop')); } catch { /* noop */ }
  }

  private handleMessagesUpsert(event: { messages: WAMessage[]; type?: string }): void {
    if (event.type !== 'notify' && event.type !== 'append') return;
    for (const msg of event.messages) {
      const key = msg.key;
      if (key.fromMe) continue;
      const jid = key.remoteJid;
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
      const text = extractText(msg);
      if (text === null) continue;
      this.onMessage?.({
        jid: normalizeJid(jid),
        text,
        waId: key.id ?? null,
        name: msg.pushName ?? null,
      });
      void this.sock?.readMessages([{ remoteJid: jid, id: key.id ?? '' }]).catch(() => undefined);
    }
  }

  private setStatus(status: WaStatus): void {
    this.status = status;
    log('info', `Status: ${status}${status === 'awaiting_scan' ? ' — escaneie o QR (página :3081 ou terminal)' : ''}`);
  }
}
