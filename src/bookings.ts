import { formatPreco, isWithinHours, localDateString, normalizeName, resolveService, type Catalog } from './catalog.js';
import type { Profissional } from './profissionais.js';
import type { Store, Booking } from './store.js';

export type BookingOutcome =
  | { ok: true; booking: Booking }
  | { ok: false; code: string; userMessage: string };

/** Resultado de cancelamento/remarcação (agendamento gerenciado pelo backend). */
export type BookingManageOutcome =
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
  input: { jid: string; clientName: string | null; serviceName: string; date: string; time: string; professionalName?: string | null },
  profissionais: Profissional[] = [],
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

  // Associação ao profissional (opcional): resolve por nome entre os ATIVOS.
  // O telefone do profissional NUNCA transita por aqui — apenas id + nome.
  const professionalName = (input.professionalName ?? '').trim();
  let professionalId: number | null = null;
  let resolvedProfessionalName: string | null = null;
  if (professionalName) {
    const wanted = normalizeName(professionalName);
    const prof =
      profissionais.find((p) => p.ativo && normalizeName(p.nome) === wanted) ??
      profissionais.find((p) => p.ativo && normalizeName(p.nome).includes(wanted)) ??
      null;
    if (!prof) {
      return {
        ok: false,
        code: 'professional_not_found',
        userMessage: 'Não encontrei esse profissional no nosso time. Com qual dos nossos profissionais você gostaria de agendar?',
      };
    }
    professionalId = prof.id;
    resolvedProfessionalName = prof.nome;
  }

  const booking = store.addBooking({
    clientJid: input.jid,
    clientName: input.clientName,
    service: service.nome,
    price: service.preco,
    date: input.date,
    time: input.time,
    professionalId,
    professionalName: resolvedProfessionalName,
  });

  return { ok: true, booking };
}

/**
 * Cancela um agendamento FUTURO do próprio cliente.
 * O registro é mantido como "cancelado" (histórico) e a vaga é liberada.
 */
export function cancelBookingCliente(
  store: Store,
  input: { jid: string; date: string; time: string },
): BookingManageOutcome {
  const hoje = localDateString(new Date());
  if (input.date < hoje) {
    return {
      ok: false,
      code: 'past_booking',
      userMessage: 'Esse agendamento já passou, então não precisa ser cancelado. 🙂 Se quiser, posso marcar um novo horário para você.',
    };
  }
  const candidatos = store.listBookingsByClient(input.jid).filter(
    (b) => b.status !== 'cancelado' && b.date === input.date && b.time === input.time,
  );
  const booking = candidatos[0] ?? null;
  if (!booking) {
    return {
      ok: false,
      code: 'not_found',
      userMessage: 'Não encontrei esse agendamento no seu nome. Pode confirmar o dia e o horário? (ex.: quarta às 15h)',
    };
  }
  store.cancelBooking(booking.id);
  return { ok: true, booking };
}

/**
 * Valida e executa a REMARCAÇÃO de um agendamento futuro do próprio cliente.
 * O novo horário passa pelas mesmas regras da criação (data real/futura,
 * expediente e vaga livre); o profissional é preservado (ou trocado apenas se
 * o cliente escolher outro profissional ativo).
 */
export function validateAndRescheduleBooking(
  store: Store,
  catalog: Catalog,
  profissionais: Profissional[],
  input: {
    jid: string;
    originalDate: string;
    originalTime: string;
    date: string;
    time: string;
    professionalName?: string | null;
  },
): BookingManageOutcome {
  const hoje = localDateString(new Date());
  const original = store.listBookingsByClient(input.jid).find(
    (b) => b.status !== 'cancelado' && b.date === input.originalDate && b.time === input.originalTime,
  );
  if (!original) {
    return {
      ok: false,
      code: 'original_not_found',
      userMessage: 'Não encontrei o agendamento original para remarcar. Pode confirmar o dia e o horário atuais?',
    };
  }
  if (original.date < hoje) {
    return {
      ok: false,
      code: 'past_booking',
      userMessage: 'Esse agendamento já passou e não pode ser remarcado. Posso marcar um novo horário para você?',
    };
  }

  if (!isRealDate(input.date)) {
    return { ok: false, code: 'invalid_date', userMessage: 'A data informada não parece válida. Pode me passar no formato dia/mês/ano?' };
  }
  const date = new Date(`${input.date}T00:00:00`);
  if (date.getTime() < new Date(`${hoje}T00:00:00`).getTime()) {
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

  if (input.date === original.date && input.time === original.time) {
    return {
      ok: false,
      code: 'same_slot',
      userMessage: 'Esse já é o horário atual do seu agendamento. Para qual dia/horário você gostaria de remarcar?',
    };
  }
  if (store.findBooking(input.date, input.time)) {
    return {
      ok: false,
      code: 'slot_taken',
      userMessage: 'Infelizmente esse horário acabou de ser reservado. Podemos escolher outro horário?',
    };
  }

  let professionalId: number | null | undefined;
  let professionalName: string | null | undefined;
  const novoProfissional = (input.professionalName ?? '').trim();
  if (novoProfissional) {
    const wanted = normalizeName(novoProfissional);
    const prof =
      profissionais.find((p) => p.ativo && normalizeName(p.nome) === wanted) ??
      profissionais.find((p) => p.ativo && normalizeName(p.nome).includes(wanted)) ??
      null;
    if (!prof) {
      return {
        ok: false,
        code: 'professional_not_found',
        userMessage: 'Não encontrei esse profissional no nosso time. Com qual profissional você gostaria de remarcar?',
      };
    }
    professionalId = prof.id;
    professionalName = prof.nome;
  }

  const booking = store.rescheduleBooking(original.id, {
    date: input.date,
    time: input.time,
    professionalId: professionalId === undefined ? original.professionalId ?? null : professionalId,
    professionalName: professionalName === undefined ? original.professionalName ?? null : professionalName,
  });
  if (!booking) {
    return {
      ok: false,
      code: 'original_not_found',
      userMessage: 'Não consegui remarcar agora. Pode tentar novamente?',
    };
  }
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
