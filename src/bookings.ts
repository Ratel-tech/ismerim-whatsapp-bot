import { formatPreco, isWithinHours, resolveService, type Catalog } from './catalog.js';
import type { Store, Booking } from './store.js';

export type BookingOutcome =
  | { ok: true; booking: Booking }
  | { ok: false; code: string; userMessage: string };

function isRealDate(date: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return false;
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

/**
 * Valida e registra um agendamento. Nenhuma informação do LLM é aceita
 * cegamente: serviço vem do catálogo (banco de dados), data/horário são
 * validados contra o calendário e o expediente, e a vaga precisa estar livre.
 */
export function validateAndCreateBooking(
  store: Store,
  catalog: Catalog,
  input: { jid: string; clientName: string | null; serviceName: string; date: string; time: string },
): BookingOutcome {
  const service = resolveService(catalog, input.serviceName);
  if (!service) {
    return {
      ok: false,
      code: 'service_not_found',
      userMessage: 'Desculpe, não identifiquei esse serviço. Poderia me dizer qual dos nossos serviços você gostaria?',
    };
  }

  if (!isRealDate(input.date)) {
    return {
      ok: false,
      code: 'invalid_date',
      userMessage: 'A data informada não parece válida. Pode me passar no formato dia/mês/ano?',
    };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(`${input.date}T00:00:00`);
  if (date.getTime() < today.getTime()) {
    return { ok: false, code: 'past_date', userMessage: 'Essa data já passou. Poderia escolher uma data futura?' };
  }

  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) {
    return { ok: false, code: 'invalid_time', userMessage: 'O horário não parece válido. Que horário você prefere?' };
  }

  if (!isWithinHours(catalog, date, input.time)) {
    return {
      ok: false,
      code: 'outside_hours',
      userMessage: 'Esse horário está fora do nosso funcionamento. Poderia escolher um horário dentro do nosso expediente?',
    };
  }

  if (store.findBooking(input.date, input.time)) {
    return {
      ok: false,
      code: 'slot_taken',
      userMessage: 'Infelizmente esse horário acabou de ser reservado. Podemos escolher outro horário?',
    };
  }

  const booking = store.addBooking({
    clientJid: input.jid,
    clientName: input.clientName,
    service: service.nome,
    price: service.preco,
    date: input.date,
    time: input.time,
  });

  return { ok: true, booking };
}

export function formatConfirmation(booking: Booking): string {
  const [y, m, d] = booking.date.split('-');
  return [
    '✅ Agendamento confirmado!',
    '',
    `👤 Cliente: ${booking.clientName ?? '-'}`,
    `✂️ Serviço: ${booking.service}`,
    `📅 Data: ${d}/${m}/${y}`,
    `🕒 Horário: ${booking.time}`,
    `💰 Valor: ${formatPreco(booking.price)}`,
    '',
    'Até lá! Qualquer coisa, é só chamar. 😉',
  ].join('\n');
}
