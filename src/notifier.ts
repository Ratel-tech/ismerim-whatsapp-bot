import { formatPreco } from './catalog.js';
import { Store, type Booking } from './store.js';
import { log } from './log.js';

export function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 13) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 12) {
    return `+${digits.slice(0, 2)} (${digits.slice(2, 4)}) ${digits.slice(4, 8)}-${digits.slice(8)}`;
  }
  return `+${digits}`;
}

/**
 * Mensagem de notificação GERADA PELO BACKEND (nunca pelo LLM),
 * enviada ao número do administrador quando um agendamento é confirmado.
 */
export function buildNotification(booking: Booking): string {
  const [y, m, d] = booking.date.split('-');
  return [
    '📅 NOVO AGENDAMENTO',
    '',
    `Cliente: ${booking.clientName ?? '—'}`,
    `Telefone: ${formatPhone(booking.clientJid)}`,
    `Serviço: ${booking.service}`,
    `Data: ${d}/${m}/${y}`,
    `Horário: ${booking.time}`,
    `Valor: ${formatPreco(booking.price)}`,
    '',
    'Agendamento confirmado pelo cliente.',
  ].join('\n');
}

export interface FlushOptions {
  store: Store;
  send: (jid: string, text: string) => Promise<boolean>;
  adminPhone: string | null;
}

/**
 * Reenvia as notificações pendentes (ex.: WhatsApp estava desconectado no
 * momento da confirmação). Retorna quantas foram enviadas com sucesso.
 */
export async function flushPendingNotifications({ store, send, adminPhone }: FlushOptions): Promise<number> {
  const pending = store.listUnnotifiedBookings();
  if (!adminPhone || pending.length === 0) return 0;
  const adminJid = `${adminPhone}@s.whatsapp.net`;
  let sentCount = 0;
  for (const booking of pending) {
    const ok = await send(adminJid, buildNotification(booking));
    if (ok) {
      store.markNotified(booking.id);
      sentCount += 1;
    } else {
      log('warn', `Notificação pendente não enviada (booking #${booking.id}); será re-tentada.`);
    }
  }
  if (sentCount > 0) log('info', `Notificações pendentes reenviadas: ${sentCount}.`);
  return sentCount;
}
