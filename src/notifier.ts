import { formatPreco } from './catalog.js';
import type { Booking } from './store.js';

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
