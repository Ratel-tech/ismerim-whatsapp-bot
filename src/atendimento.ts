import { createBookingFromAgent } from './booking-flow.js';
import { validateAndRescheduleBooking } from './bookings.js';
import type { Catalog } from './catalog.js';
import { log } from './log.js';
import {
  buildNotification,
  buildRescheduleNotification,
  notifyProfessionalForBooking,
  notifyProfessionalReschedule,
} from './notifier.js';
import type { Profissional } from './profissionais.js';
import type { Booking, Store } from './store.js';

/** Dependências do atendimento humano (painel) para criar/remarcar agendamentos. */
export interface AtendimentoDeps {
  store: Store;
  catalog: Catalog;
  profissionais: Profissional[];
  adminPhone: string;
  send: (jid: string, text: string) => Promise<boolean>;
}

export type AtendimentoOutcome =
  | { ok: true; booking: Booking }
  | { ok: false; code: string; error: string };

export interface NovoAgendamentoInput {
  jid: string;
  clientName: string | null;
  service: string;
  date: string;
  time: string;
  professional?: string | null;
}

export interface RemarcarAgendamentoInput {
  id: number;
  date: string;
  time: string;
  professional?: string | null;
}

/** Notifica o ADMIN (best-effort): falha não bloqueia o agendamento. */
async function notificarAdmin(deps: AtendimentoDeps, text: string, bookingId: number): Promise<void> {
  if (!deps.adminPhone) {
    log('warn', 'ADMIN_PHONE não configurado — agendamento do atendimento sem notificação ao ADMIN.');
    return;
  }
  const sent = await deps.send(`${deps.adminPhone}@s.whatsapp.net`, text).catch(() => false);
  if (sent) deps.store.markNotified(bookingId);
  else log('warn', 'WhatsApp desconectado; agendamento do atendimento não notificado ao ADMIN.');
}

/**
 * Cria um agendamento a partir do painel (atendimento humano), reusando as
 * mesmas validações do fluxo do cliente e notificando ADMIN e profissional.
 */
export async function criarAgendamentoAtendimento(
  deps: AtendimentoDeps,
  input: NovoAgendamentoInput,
): Promise<AtendimentoOutcome> {
  const outcome = createBookingFromAgent(deps.store, deps.catalog, deps.profissionais, {
    jid: input.jid,
    clientName: input.clientName,
    service: input.service,
    date: input.date,
    time: input.time,
    professional: input.professional ?? null,
  });
  if (!outcome.ok) {
    log('warn', `Agendamento pelo atendimento rejeitado (${outcome.code}): ${input.service} ${input.date} ${input.time}`);
    return { ok: false, code: outcome.code, error: outcome.userMessage };
  }
  const booking = outcome.booking;
  log('info', `Agendamento #${booking.id} criado pelo atendimento: ${booking.clientName} | ${booking.service} | ${booking.date} ${booking.time}`);
  await notificarAdmin(deps, buildNotification(booking), booking.id);
  await notifyProfessionalForBooking({ store: deps.store, booking, send: deps.send });
  return { ok: true, booking };
}

/**
 * Remarca um agendamento existente pelo painel (atendimento humano). O horário
 * original é preservado como referência na notificação; as regras de validação
 * são as mesmas da remarcação do cliente.
 */
export async function remarcarAgendamentoAtendimento(
  deps: AtendimentoDeps,
  input: RemarcarAgendamentoInput,
): Promise<AtendimentoOutcome> {
  const original = deps.store.getBooking(input.id);
  if (!original || original.status === 'cancelado') {
    return { ok: false, code: 'not_found', error: 'Agendamento não encontrado.' };
  }
  const from = { date: original.date, time: original.time };
  const outcome = validateAndRescheduleBooking(deps.store, deps.catalog, deps.profissionais, {
    jid: original.clientJid,
    originalDate: original.date,
    originalTime: original.time,
    date: input.date,
    time: input.time,
    professionalName: input.professional ?? null,
  });
  if (!outcome.ok) {
    log('warn', `Remarcação pelo atendimento rejeitada (${outcome.code}): ${from.date} ${from.time} → ${input.date} ${input.time}`);
    return { ok: false, code: outcome.code, error: outcome.userMessage };
  }
  const booking = outcome.booking;
  log('info', `Agendamento #${booking.id} remarcado pelo atendimento: ${booking.clientName} | ${from.date} ${from.time} → ${booking.date} ${booking.time}`);
  await notificarAdmin(deps, buildRescheduleNotification(booking, from, true), booking.id);
  await notifyProfessionalReschedule({ store: deps.store, booking, from, send: deps.send });
  return { ok: true, booking };
}
