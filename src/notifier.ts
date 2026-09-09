import { formatPreco } from './catalog.js';
import type { Store, Booking } from './store.js';
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

/** Aviso ao dono quando um cliente pede para falar com um atendente humano. */
export function buildTransferRequest(clientName: string | null, clientJid: string): string {
  return [
    '🙋 CLIENTE PEDIU ATENDENTE HUMANO',
    '',
    `Cliente: ${clientName ?? '—'}`,
    `Telefone: ${formatPhone(clientJid)}`,
    '',
    'Responda o quanto antes para não perder o atendimento.',
  ].join('\n');
}

export interface FlushOptions {
  store: Store;
  send: (jid: string, text: string) => Promise<boolean>;
  adminPhone: string | null;
}

/**
 * Mensagem enviada ao PROFISSIONAL quando um novo agendamento é criado para ele.
 * Gerada pelo backend. NUNCA contém o telefone (nem do cliente, nem do próprio
 * profissional) — o número fica apenas no destinatário do envio.
 */
export function buildProfessionalNotification(booking: Booking): string {
  const [y, m, d] = booking.date.split('-');
  return [
    '🔔 NOVO AGENDAMENTO',
    '',
    `Cliente: ${booking.clientName ?? '—'}`,
    `Serviço: ${booking.service}`,
    `Data: ${d}/${m}/${y}`,
    `Horário: ${booking.time}`,
    `Profissional: ${booking.professionalName ?? '—'}`,
    '',
    'Você tem um novo horário reservado.',
  ].join('\n');
}

export type ProfessionalNotifyResult = 'sent' | 'no_professional' | 'no_phone' | 'inactive' | 'send_failed';

export interface ProfessionalNotifyDeps {
  store: Store;
  booking: Booking;
  send: (jid: string, text: string) => Promise<boolean>;
}

/**
 * Notifica o profissional responsável pelo agendamento.
 * - NUNCA bloqueia o agendamento (falhas/ausência de telefone só geram log).
 * - O telefone é resolvido AQUI no backend, por professionalId, e só é usado
 *   como destinatário — nunca entra no conteúdo nem sai para o agente/cliente.
 * - Em sucesso, marca `profissionalNotificadoEm` (evita duplicidade/reenvio).
 */
export async function notifyProfessionalForBooking({ store, booking, send }: ProfessionalNotifyDeps): Promise<ProfessionalNotifyResult> {
  const pid = booking.professionalId;
  if (!pid) return 'no_professional';
  const prof = store.getProfissional(pid);
  if (!prof || !prof.ativo) {
    log('warn', `Notificação ao profissional ignorada: profissional #${pid} não encontrado ou inativo (booking #${booking.id}).`);
    return 'inactive';
  }
  if (!prof.telefone) {
    log('warn', `Profissional "${prof.nome}" (#${pid}) não possui telefone cadastrado — apenas o ADMIN será notificado (booking #${booking.id}).`);
    return 'no_phone';
  }
  const jid = `${prof.telefone}@s.whatsapp.net`;
  const ok = await send(jid, buildProfessionalNotification(booking)).catch(() => false);
  if (!ok) {
    log('warn', `Falha ao notificar profissional "${prof.nome}" (booking #${booking.id}); será re-tentado.`);
    return 'send_failed';
  }
  store.markProfissionalNotificado(booking.id);
  log('info', `Profissional "${prof.nome}" notificado sobre o agendamento #${booking.id}.`);
  return 'sent';
}

/**
 * Reenvia notificações pendentes ao PROFISSIONAL (ex.: WhatsApp estava
 * desconectado no momento da confirmação). Retorna quantas foram enviadas.
 */
export async function flushPendingProfessionalNotifications(deps: { store: Store; send: (jid: string, text: string) => Promise<boolean> }): Promise<number> {
  const pending = deps.store.listBookingsPendingProfissionalNotif();
  let sentCount = 0;
  for (const booking of pending) {
    const result = await notifyProfessionalForBooking({ store: deps.store, booking, send: deps.send });
    if (result === 'sent') sentCount += 1;
  }
  if (sentCount > 0) log('info', `Notificações ao profissional reenviadas: ${sentCount}.`);
  return sentCount;
}

function fmtData(date: string): string {
  const [y, m, d] = date.split('-');
  return d && m && y ? `${d}/${m}/${y}` : date;
}

/**
 * Notificação de CANCELAMENTO (backend). Com telefone do cliente quando
 * destinada ao ADMIN; sem qualquer telefone quando destinada ao profissional.
 */
export function buildCancellationNotification(booking: Booking, includeClientPhone = true): string {
  const lines = [
    '❌ AGENDAMENTO CANCELADO',
    '',
    `Cliente: ${booking.clientName ?? '—'}`,
  ];
  if (includeClientPhone) lines.push(`Telefone: ${formatPhone(booking.clientJid)}`);
  lines.push(
    `Serviço: ${booking.service}`,
    `Data: ${fmtData(booking.date)}`,
    `Horário: ${booking.time}`,
    `Profissional: ${booking.professionalName ?? '—'}`,
    '',
    'Agendamento cancelado pelo cliente.',
  );
  return lines.join('\n');
}

/** Notificação de REMARCAÇÃO (backend). `from` = horário anterior. */
export function buildRescheduleNotification(booking: Booking, from: { date: string; time: string }, includeClientPhone = true): string {
  const lines = [
    '🔄 AGENDAMENTO REMARCADO',
    '',
    `Cliente: ${booking.clientName ?? '—'}`,
  ];
  if (includeClientPhone) lines.push(`Telefone: ${formatPhone(booking.clientJid)}`);
  lines.push(
    `Serviço: ${booking.service}`,
    `De: ${fmtData(from.date)} às ${from.time}`,
    `Para: ${fmtData(booking.date)} às ${booking.time}`,
    `Profissional: ${booking.professionalName ?? '—'}`,
    '',
    'Agendamento remarcado pelo cliente.',
  );
  return lines.join('\n');
}

interface ProfessionalTarget {
  nome: string;
  telefone: string;
}

function resolveProfessionalTarget(store: Store, booking: Booking): ProfessionalTarget | null {
  const pid = booking.professionalId;
  if (!pid) return null;
  const prof = store.getProfissional(pid);
  if (!prof || !prof.ativo || !prof.telefone) return null;
  return { nome: prof.nome, telefone: prof.telefone };
}

/** Envia cancelamento ao profissional (best-effort, nunca bloqueia). */
export async function notifyProfessionalCancellation(deps: { store: Store; booking: Booking; send: (jid: string, text: string) => Promise<boolean> }): Promise<boolean> {
  const target = resolveProfessionalTarget(deps.store, deps.booking);
  if (!target) return false;
  const ok = await deps.send(`${target.telefone}@s.whatsapp.net`, buildCancellationNotification(deps.booking, false)).catch(() => false);
  if (!ok) log('warn', `Falha ao notificar cancelamento ao profissional "${target.nome}" (booking #${deps.booking.id}).`);
  return ok;
}

/** Envia remarcação ao profissional (best-effort, nunca bloqueia). */
export async function notifyProfessionalReschedule(deps: { store: Store; booking: Booking; from: { date: string; time: string }; send: (jid: string, text: string) => Promise<boolean> }): Promise<boolean> {
  const target = resolveProfessionalTarget(deps.store, deps.booking);
  if (!target) return false;
  const ok = await deps.send(`${target.telefone}@s.whatsapp.net`, buildRescheduleNotification(deps.booking, deps.from, false)).catch(() => false);
  if (!ok) log('warn', `Falha ao notificar remarcação ao profissional "${target.nome}" (booking #${deps.booking.id}).`);
  return ok;
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
