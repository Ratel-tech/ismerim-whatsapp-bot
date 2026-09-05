import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';

export interface StoredClient {
  jid: string;
  name: string | null;
  phone: string;
  createdAt: string;
}

export interface StoredMessage {
  role: 'cliente' | 'bot';
  content: string;
  at: string;
}

export interface PendingBooking {
  service: string | null;
  date: string | null;
  time: string | null;
  client_name: string | null;
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
  createdAt: string;
  notifiedAt: string | null;
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
}

function emptyDb(): Db {
  return { clients: [], conversations: [], bookings: [], nextBookingId: 1 };
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
  addBooking(input: Omit<Booking, 'id' | 'createdAt' | 'notifiedAt'>): Booking {
    const booking: Booking = {
      ...input,
      id: this.db.nextBookingId++,
      createdAt: new Date().toISOString(),
      notifiedAt: null,
    };
    this.db.bookings.push(booking);
    this.write();
    return booking;
  }

  findBooking(date: string, time: string): Booking | null {
    return this.db.bookings.find((b) => b.date === date && b.time === time) ?? null;
  }

  listBookings(limit = 20): Booking[] {
    return [...this.db.bookings].sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)).slice(0, limit);
  }

  listUnnotifiedBookings(): Booking[] {
    return this.db.bookings.filter((b) => b.notifiedAt === null);
  }

  markNotified(id: number): void {
    const b = this.db.bookings.find((x) => x.id === id);
    if (b) {
      b.notifiedAt = new Date().toISOString();
      this.write();
    }
  }
}
