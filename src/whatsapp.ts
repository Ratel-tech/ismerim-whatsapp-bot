import fs from 'node:fs';
import QRCode from 'qrcode';
import qrcodeTerminal from 'qrcode-terminal';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { config } from './config.js';
import { log } from './log.js';
import { audioExtension, isTranscribeEnabled, transcribeAudio } from './stt.js';

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

/**
 * Cache em memória das conversas do WhatsApp. É alimentado pelos eventos do
 * Baileys (`messaging-history.set`, `chats.upsert`, `chats.update`, `chats.delete`)
 * — assim não precisamos refetch a lista de chats a cada requisição.
 */
export interface ChatSummary {
  jid: string;
  name: string | null;
  /** Timestamp (ms) da última atividade no chat. */
  lastActivityAt: number;
}

type ChatShape = {
  id?: string | null;
  name?: string | null;
  conversationTimestamp?: unknown;
  lastMessageRecvTimestamp?: number | null;
};

function extractText(msg: WAMessage): string | null {
  const content = msg.message as Record<string, unknown> | null | undefined;
  if (!content) return null;
  const conv = content.conversation;
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

/**
 * O agente NUNCA deve responder a mensagens de grupo, canais ou listas de
 * transmissão — apenas a conversas individuais (1:1), onde cada JID é um número
 * real terminado em `@s.whatsapp.net`. Este filtro cobre grupos/comunidades
 * (`@g.us`), canais (`@newsletter`) e listas/broadcast (`@broadcast`).
 */
export function isGroupJid(jid: string | null | undefined): boolean {
  if (!jid) return true;
  return (
    jid.endsWith('@g.us') ||
    jid.endsWith('@newsletter') ||
    jid.endsWith('@broadcast')
  );
}

/** Retorna o objeto de áudio da mensagem (voice note / áudio enviado), ou null. */
function audioFromMessage(msg: WAMessage): { mime: string } | null {
  const content = msg.message as Record<string, unknown> | null | undefined;
  if (!content) return null;
  const audio = content.audioMessage as { mimetype?: string } | null | undefined;
  if (!audio || typeof audio !== 'object') return null;
  return { mime: audio.mimetype ?? 'audio/ogg' };
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
  private chatMap = new Map<string, ChatSummary>();

  constructor(private readonly sessionDir: string = config.sessionDir) {}

  isConnected(): boolean {
    return this.status === 'connected' && Boolean(this.sock);
  }

  /**
   * Lista as conversas existentes no WhatsApp a partir do cache em memória.
   * `force` não é necessário (os eventos do Baileys mantêm o cache atualizado),
   * mas é aceito por compatibilidade.
   */
  listChats(_force = false): ChatSummary[] {
    return [...this.chatMap.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
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

  /** Desconecta (desvincula) o número conectado do WhatsApp. Não gera QR novo. */
  async logout(): Promise<void> {
    await this.teardownSession();
  }

  /** Apaga a sessão e gera um QR novo. */
  async resetSession(): Promise<void> {
    await this.teardownSession();
    await this.connect();
  }

  private async teardownSession(): Promise<void> {
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
  }

  /**
   * Encerra a conexão de forma graciosa SEM apagar a sessão salva:
   * reiniciar o bot não exige novo QR Code.
   */
  async stop(): Promise<void> {
    this.shouldClose = true;
    this.clearReconnectTimer();
    this.stopSocket();
    this.qr = null;
    this.qrRaw = null;
    this.phone = null;
    this.setStatus('disconnected');
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

  private applyChats(chats: ChatShape[]): void {
    for (const c of chats) this.applyChat(c);
  }

  private applyChat(c: ChatShape): void {
    if (!c?.id) return;
    const ts = Number(c.conversationTimestamp ?? c.lastMessageRecvTimestamp ?? 0);
    const jid = normalizeJid(c.id);
    if (!jid || isGroupJid(jid)) return;
    // Não descarta chats sem timestamp de atividade: aproveita a última atividade conhecida.
    const existing = this.chatMap.get(jid);
    const at = ts > 0 ? ts * 1000 : existing?.lastActivityAt ?? 0;
    this.chatMap.set(jid, { jid, name: c.name ?? null, lastActivityAt: at });
  }

  private async startSocket(): Promise<void> {
    fs.mkdirSync(this.sessionDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
    const sock = makeWASocket({
      auth: state,
      browser: Browsers.windows('Ismerim Barbearia'),
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      logger: baileysLogger,
      shouldIgnoreJid: (jid) => isGroupJid(jid),
    });
    this.sock = sock;
    this.setStatus('connecting');

    sock.ev.on('creds.update', () => saveCreds().catch(() => undefined));
    sock.ev.on('connection.update', (u) => this.handleConnectionUpdate(u));
    sock.ev.on('messages.upsert', (e) => this.handleMessagesUpsert(e));
    // Cache de conversas: alimentado pelos eventos de chat do WhatsApp.
    sock.ev.on('messaging-history.set', ({ chats, messages }) => {
      log('info', `Histórico sincronizado pelo WhatsApp: ${chats?.length ?? 0} conversas, ${messages?.length ?? 0} mensagens.`);
      if (chats) this.applyChats(chats);
    });
    sock.ev.on('chats.upsert', (chats) => this.applyChats(chats));
    sock.ev.on('chats.update', (updates) => {
      for (const u of updates) {
        if (u?.id) this.applyChat(u as ChatShape);
      }
    });
    sock.ev.on('chats.delete', (jids) => {
      for (const j of jids) this.chatMap.delete(normalizeJid(j));
    });
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
      // Limpa o cache de chats ao reconectar; os eventos do Baileys o repovoam.
      this.chatMap.clear();
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

  private async handleMessagesUpsert(event: { messages: WAMessage[]; type?: string }): Promise<void> {
    if (event.type !== 'notify' && event.type !== 'append') return;
    for (const msg of event.messages) {
      const key = msg.key;
      if (key.fromMe) continue;
      const jid = key.remoteJid;
      if (!jid || isGroupJid(jid)) continue;

      const audio = audioFromMessage(msg);
      if (audio) {
        await this.handleAudioMessage(msg, normalizeJid(jid), audio);
        continue;
      }

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

  /**
   * Baixa o áudio, transcreve via STT e encaminha o texto ao agente.
   * Se o STT estiver desabilitado/sem chave ou falhar, informa o cliente.
   */
  private async handleAudioMessage(msg: WAMessage, jid: string, audio: { mime: string }): Promise<void> {
    const key = msg.key;
    const markRead = () =>
      this.sock?.readMessages([{ remoteJid: key.remoteJid ?? '', id: key.id ?? '' }]).catch(() => undefined);
    try {
      if (!isTranscribeEnabled()) {
        await this.sendText(jid, 'Olá! Não consigo ouvir mensagens de áudio no momento. Pode me enviar por texto, por favor? 😊');
        await markRead();
        return;
      }

      const buffer = await downloadMediaMessage(msg, 'buffer', {}, {
        logger: baileysLogger,
        reuploadRequest: async (m) => m,
      });
      const text = await transcribeAudio(buffer, `audio.${audioExtension(audio.mime)}`, audio.mime);
      await markRead();
      if (!text) {
        await this.sendText(jid, 'Não consegui entender o áudio. Pode me enviar por texto ou tentar novamente? 🙂');
        return;
      }
      log('info', `Áudio transcrito de ${jid}: ${text.slice(0, 80)}`);
      this.onMessage?.({ jid, text, waId: key.id ?? null, name: msg.pushName ?? null });
    } catch (err) {
      await markRead();
      log('error', `Falha ao transcrever áudio de ${jid}: ${(err as Error).message}`);
      await this.sendText(jid, 'Ops, tive um problema para ouvir esse áudio. Pode me enviar por texto? 🙂').catch(() => undefined);
    }
  }

  private setStatus(status: WaStatus): void {
    this.status = status;
    log('info', `Status: ${status}${status === 'awaiting_scan' ? ' — escaneie o QR (página :3081 ou terminal)' : ''}`);
  }
}
