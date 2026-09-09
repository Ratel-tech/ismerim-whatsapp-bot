import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';
import { normalizeTelefone, toPublicProfissional, type Profissional } from './profissionais.js';

export interface StoredClient {
  jid: string;
  name: string | null;
  phone: string;
  createdAt: string;
  /** Observações do cliente, cada uma com autor (humano/agente) e data. */
  observations?: ObservationEntry[];
  /** Marcado quando o cliente pede atendimento humano. */
  needsHuman?: boolean;
}

/** Uma observação registrada sobre o cliente, com autor identificado. */
export interface ObservationEntry {
  text: string;
  author: 'humano' | 'agente';
  at: string;
}

export interface StoredMessage {
  role: 'cliente' | 'bot';
  content: string;
  at: string;
}

export interface PendingBooking {
  service: string | null;
  professional?: string | null;
  date: string | null;
  time: string | null;
  client_name: string | null;
}

export interface ConversationSummary {
  jid: string;
  name: string | null;
  phone: string;
  /** Timestamp (ms) da última mensagem do cliente; null se ele nunca falou. */
  lastClientAt: number | null;
  lastText: string | null;
  messageCount: number;
}

/** Pendência de agendamento não confirmada expira após este período. */
export const PENDING_BOOKING_TTL_MS = 24 * 60 * 60 * 1000;

export interface Booking {
  id: number;
  clientJid: string;
  clientName: string | null;
  service: string;
  price: number;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  /** Profissional responsável (opcional; legado não possui). Só o nome/ID, nunca o telefone. */
  professionalId?: number | null;
  professionalName?: string | null;
  /** Cancelado = mantém histórico, mas não ocupa a vaga. */
  status: 'confirmado' | 'cancelado';
  createdAt: string;
  updatedAt?: string;
  notifiedAt: string | null;
  /** Quando a notificação ao profissional foi enviada (null/ausente = pendente). */
  profissionalNotificadoEm?: string | null;
}

interface Conversation {
  jid: string;
  messages: StoredMessage[];
  pendingBooking: PendingBooking | null;
  /** Timestamp (ms) da última alteração da pendência; ausente em dados legados = expirada. */
  pendingBookingAt: number | null;
}

interface Db {
  clients: StoredClient[];
  conversations: Conversation[];
  bookings: Booking[];
  nextBookingId: number;
  profissionais: Profissional[];
  nextProfissionalId: number;
}

function emptyDb(): Db {
  return { clients: [], conversations: [], bookings: [], nextBookingId: 1, profissionais: [], nextProfissionalId: 1 };
}

export class Store {
  readonly file: string;
  private db: Db;

  constructor(file: string = config.dbFile) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) {
      this.db = emptyDb();
      this.write();
    } else {
      this.db = this.read();
    }
  }

  private read(): Db {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Db;
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !Array.isArray(parsed.clients) ||
          !Array.isArray(parsed.conversations) ||
          !Array.isArray(parsed.bookings) ||
          typeof parsed.nextBookingId !== 'number'
        ) {
          throw new Error('schema inválido');
        }
        // Migração aditiva: db.json antigo não possui profissionais — nunca zera dados existentes.
        if (!Array.isArray(parsed.profissionais)) parsed.profissionais = [];
        if (typeof parsed.nextProfissionalId !== 'number') parsed.nextProfissionalId = 1;
        // Migração: booking legado sem status é tratado como confirmado (ocupa a vaga).
        for (const b of parsed.bookings) {
          if (b.status !== 'confirmado' && b.status !== 'cancelado') b.status = 'confirmado';
        }
        // Migração: observação antiga (string única) vira registro de humano.
        for (const c of parsed.clients) {
          const obs = c.observations as unknown;
          if (typeof obs === 'string') {
            c.observations = [{ text: obs, author: 'humano', at: c.createdAt ?? new Date().toISOString() }];
          } else if (!Array.isArray(obs)) {
            c.observations = [];
          }
        }
        return parsed;
    } catch (err) {
      // Nunca zera o arquivo em silêncio: preserva uma cópia de backup antes de recomeçar.
      try {
        const backup = `${this.file}.corrompido-${Date.now()}`;
        fs.renameSync(this.file, backup);
        log('warn', `db.json ilegivel/corrompido; backup salvo em ${backup} (${(err as Error).message})`);
      } catch {
        /* backup best-effort */
      }
      return emptyDb();
    }
  }

  private write(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // ---------- clientes ----------
  upsertClient(jid: string, name: string | null): StoredClient {
    const phone = jid.split('@')[0] ?? jid;
    let client = this.db.clients.find((c) => c.jid === jid);
    if (!client) {
      client = { jid, name, phone, createdAt: new Date().toISOString() };
      this.db.clients.push(client);
      this.write();
    } else if (name && !client.name) {
      client.name = name;
      this.write();
    }
    return client;
  }

  getClient(jid: string): StoredClient | null {
    return this.db.clients.find((c) => c.jid === jid) ?? null;
  }

  /** Observações registradas do cliente (vazio se nenhuma). */
  getObservations(jid: string): ObservationEntry[] {
    return this.getClient(jid)?.observations ?? [];
  }

  /** Adiciona uma observação. `author` identifica quem registrou (humano ou agente). */
  addObservation(jid: string, text: string, author: ObservationEntry['author']): StoredClient | null {
    const t = text.trim();
    if (!t) return null;
    let client = this.getClient(jid);
    if (!client) {
      this.upsertClient(jid, null);
      client = this.getClient(jid);
    }
    if (!client) return null;
    client.observations = client.observations ?? [];
    client.observations.push({ text: t, author, at: new Date().toISOString() });
    this.write();
    return client;
  }

  /** Edita o texto de uma observação existente (preserva o autor original). */
  updateObservation(jid: string, index: number, text: string): StoredClient | null {
    const client = this.getClient(jid);
    const obs = client?.observations;
    if (!client || !obs || index < 0 || index >= obs.length) return null;
    const entry = obs[index];
    if (!entry) return null;
    entry.text = text.trim();
    entry.at = new Date().toISOString();
    this.write();
    return client;
  }

  /** Remove uma observação. */
  deleteObservation(jid: string, index: number): StoredClient | null {
    const client = this.getClient(jid);
    const obs = client?.observations;
    if (!client || !obs || index < 0 || index >= obs.length) return null;
    obs.splice(index, 1);
    this.write();
    return client;
  }

  /** Marca o cliente como "precisa de atendimento humano". */
  markNeedsHuman(jid: string): StoredClient | null {
    let client = this.getClient(jid);
    if (!client) {
      this.upsertClient(jid, null);
      client = this.getClient(jid);
    }
    if (!client) return null;
    client.needsHuman = true;
    this.write();
    return client;
  }

  /** Liga/desliga o atendimento humano (pausa ou resume a resposta automática do agente). */
  setHuman(jid: string, on: boolean): StoredClient | null {
    let client = this.getClient(jid);
    if (!client) {
      this.upsertClient(jid, null);
      client = this.getClient(jid);
    }
    if (!client) return null;
    if (on) client.needsHuman = true;
    else delete client.needsHuman;
    this.write();
    return client;
  }

  getAllMessages(jid: string): StoredMessage[] {
    const conv = this.db.conversations.find((c) => c.jid === jid);
    return conv ? conv.messages : [];
  }

  listBookingsByClient(jid: string): Booking[] {
    return this.db.bookings.filter((b) => b.clientJid === jid);
  }

  clientHasBooking(jid: string): boolean {
    return this.db.bookings.some((b) => b.clientJid === jid);
  }

  // ---------- profissionais ----------
  listProfissionais(): Profissional[] {
    return [...this.db.profissionais];
  }

  /**
   * Caminho PÚBLICO de leitura: nunca contém o telefone.
   * Use para painel/agente/front. O número fica acessível apenas via
   * getProfissional()/listProfissionais() para uso interno (notificação).
   */
  listProfissionaisPublic(): ReturnType<typeof toPublicProfissional>[] {
    return this.db.profissionais.map(toPublicProfissional);
  }

  getProfissional(id: number): Profissional | null {
    return this.db.profissionais.find((p) => p.id === id) ?? null;
  }

  addProfissional(input: {
    nome: string;
    telefone?: string | null;
    horarioInicio?: string | null;
    horarioFim?: string | null;
    ativo?: boolean;
  }): Profissional {
    const prof: Profissional = {
      id: this.db.nextProfissionalId++,
      nome: (input.nome ?? '').trim(),
      telefone: normalizeTelefone(input.telefone),
      horarioInicio: (input.horarioInicio ?? '').trim(),
      horarioFim: (input.horarioFim ?? '').trim(),
      ativo: input.ativo ?? true,
      createdAt: new Date().toISOString(),
    };
    this.db.profissionais.push(prof);
    this.write();
    return prof;
  }

  updateProfissional(
    id: number,
    patch: {
      nome?: string;
      telefone?: string | null;
      horarioInicio?: string | null;
      horarioFim?: string | null;
      ativo?: boolean;
    },
  ): Profissional | null {
    const prof = this.getProfissional(id);
    if (!prof) return null;
    if (patch.nome !== undefined) prof.nome = (patch.nome ?? '').trim();
    if (patch.telefone !== undefined) prof.telefone = normalizeTelefone(patch.telefone);
    if (patch.horarioInicio !== undefined) prof.horarioInicio = (patch.horarioInicio ?? '').trim();
    if (patch.horarioFim !== undefined) prof.horarioFim = (patch.horarioFim ?? '').trim();
    if (patch.ativo !== undefined) prof.ativo = patch.ativo;
    this.write();
    return prof;
  }

  // ---------- conversas ----------
  private conversation(jid: string): Conversation {
    let conv = this.db.conversations.find((c) => c.jid === jid);
    if (!conv) {
      conv = { jid, messages: [], pendingBooking: null, pendingBookingAt: null };
      this.db.conversations.push(conv);
    }
    return conv;
  }

  addMessage(jid: string, role: StoredMessage['role'], content: string): void {
    const conv = this.conversation(jid);
    conv.messages.push({ role, content, at: new Date().toISOString() });
    this.write();
  }

  getMessages(jid: string, limit = 12): StoredMessage[] {
    return this.conversation(jid).messages.slice(-limit);
  }

  /**
   * Resumo de todas as conversas, ordenadas da mais recente para a mais antiga.
   * `lastClientAt` é o timestamp (ms) da última mensagem enviada pelo CLIENTE —
   * usado para agrupar por recência (24h, 48h, semana, antigas).
   */
  listConversations(): ConversationSummary[] {
    const clientMap = new Map(this.db.clients.map((c) => [c.jid, c] as const));
    return this.db.conversations
      .map((conv) => {
        const client = clientMap.get(conv.jid);
        const lastClient = [...conv.messages].reverse().find((m) => m.role === 'cliente') ?? null;
        const lastMsg = conv.messages[conv.messages.length - 1] ?? null;
        return {
          jid: conv.jid,
          name: client?.name ?? null,
          phone: client?.phone ?? conv.jid.split('@')[0] ?? conv.jid,
          lastClientAt: lastClient ? new Date(lastClient.at).getTime() : null,
          lastText: lastMsg ? lastMsg.content : null,
          messageCount: conv.messages.length,
        };
      })
      .sort((a, b) => (b.lastClientAt ?? 0) - (a.lastClientAt ?? 0));
  }

  setPendingBooking(jid: string, booking: PendingBooking | null): void {
    const conv = this.conversation(jid);
    conv.pendingBooking = booking;
    conv.pendingBookingAt = booking ? Date.now() : null;
    this.write();
  }

  getPendingBooking(jid: string, now: number = Date.now()): PendingBooking | null {
    const conv = this.db.conversations.find((c) => c.jid === jid);
    if (!conv?.pendingBooking) return null;
    const at = conv.pendingBookingAt ?? 0;
    if (now - at > PENDING_BOOKING_TTL_MS) return null;
    return conv.pendingBooking;
  }

  // ---------- agendamentos ----------
  addBooking(input: Omit<Booking, 'id' | 'createdAt' | 'notifiedAt' | 'profissionalNotificadoEm' | 'status' | 'updatedAt'>): Booking {
    const booking: Booking = {
      ...input,
      id: this.db.nextBookingId++,
      status: 'confirmado',
      createdAt: new Date().toISOString(),
      notifiedAt: null,
      profissionalNotificadoEm: null,
    };
    this.db.bookings.push(booking);
    this.write();
    return booking;
  }

  getBooking(id: number): Booking | null {
    return this.db.bookings.find((b) => b.id === id) ?? null;
  }

  /** Apenas agendamentos ATIVOS (não cancelados) ocupam vaga. */
  findBooking(date: string, time: string): Booking | null {
    return this.db.bookings.find((b) => b.date === date && b.time === time && b.status !== 'cancelado') ?? null;
  }

  /** Cancela o agendamento (mantém o registro no histórico). Retorna false se não houver ativo. */
  cancelBooking(id: number): boolean {
    const b = this.getBooking(id);
    if (!b || b.status === 'cancelado') return false;
    b.status = 'cancelado';
    b.updatedAt = new Date().toISOString();
    this.write();
    return true;
  }

  /** Remarca (altera data/hora e, opcionalmente, o profissional) de um agendamento ativo. */
  rescheduleBooking(
    id: number,
    patch: { date: string; time: string; professionalId?: number | null; professionalName?: string | null },
  ): Booking | null {
    const b = this.getBooking(id);
    if (!b || b.status === 'cancelado') return null;
    b.date = patch.date;
    b.time = patch.time;
    if (patch.professionalId !== undefined) b.professionalId = patch.professionalId;
    if (patch.professionalName !== undefined) b.professionalName = patch.professionalName;
    b.updatedAt = new Date().toISOString();
    this.write();
    return b;
  }

  listBookings(limit = 20): Booking[] {
    return [...this.db.bookings].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, limit);
  }

  listUnnotifiedBookings(): Booking[] {
    return this.db.bookings.filter((b) => b.notifiedAt === null && b.status !== 'cancelado');
  }

  markNotified(id: number): void {
    const b = this.db.bookings.find((x) => x.id === id);
    if (b) {
      b.notifiedAt = new Date().toISOString();
      this.write();
    }
  }

  /** Agendamentos ativos (não cancelados) com profissional que ainda não recebeu a notificação. */
  listBookingsPendingProfissionalNotif(): Booking[] {
    return this.db.bookings.filter((b) => b.professionalId != null && b.status !== 'cancelado' && !b.profissionalNotificadoEm);
  }

  markProfissionalNotificado(id: number): void {
    const b = this.db.bookings.find((x) => x.id === id);
    if (b) {
      b.profissionalNotificadoEm = new Date().toISOString();
      this.write();
    }
  }
}
