import { isBookingPast } from './bookings.js';
import { localDateString } from './catalog.js';
import type { Profissional } from './profissionais.js';
import type { Booking, Store } from './store.js';

export type PapelOperador = 'admin' | 'profissional';

/**
 * Lista os agendamentos visíveis ao operador.
 * - ADMIN: todos.
 * - BARBEIRO: apenas os DELE e DO DIA VIGENTE (não mostra antigos nem futuros).
 */
export function listarAgenda(
  store: Store,
  input: { papel: PapelOperador; profissionalId: number | null; now?: Date },
): string {
  const now = input.now ?? new Date();
  const hoje = localDateString(now);
  const todos = store.listBookings(200);
  const visiveis =
    input.papel === 'admin'
      ? todos
      : todos.filter((b) => b.professionalId === input.profissionalId && b.date === hoje);
  if (visiveis.length === 0) {
    return input.papel === 'admin' ? 'Nenhum agendamento por aqui.' : 'Você não tem agendamentos para hoje.';
  }
  const linhas = visiveis
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    .map((b) => {
      const [y, m, d] = b.date.split('-');
      const data = d && m && y ? `${d}/${m}/${y}` : b.date;
      const passou = isBookingPast(b.date, now);
      const status = b.status === 'feito' ? 'feito' : b.status === 'cancelado' ? 'cancelado' : passou ? 'passou' : 'confirmado';
      return `- ${data} ${b.time} — ${b.service} — ${b.clientName ?? '—'} — ${b.professionalName ?? 'sem profissional'} — ${status}`;
    });
  const titulo = input.papel === 'admin' ? '📅 Todos os agendamentos:' : '📅 Seus agendamentos de hoje:';
  return [titulo, ...linhas].join('\n');
}

export interface ConcluirResult {
  ok: boolean;
  code?: string;
  message: string;
  booking?: Booking;
}

/** Marca um agendamento PASSADO como feito (admin: qualquer; barbeiro: só os dele). */
export function concluirAgendamento(
  store: Store,
  input: { papel: PapelOperador; profissionalId: number | null; date: string; time: string; service?: string | null; now?: Date },
): ConcluirResult {
  const now = input.now ?? new Date();
  const candidatos = store.listBookings(500).filter((b) => b.date === input.date && b.time === input.time);
  const doEscopo = input.papel === 'admin' ? candidatos : candidatos.filter((b) => b.professionalId === input.profissionalId);
  const booking = doEscopo.find((b) => b.status === 'confirmado') ?? doEscopo[0] ?? null;
  if (!booking) return { ok: false, code: 'not_found', message: 'Não encontrei esse agendamento. Confere a data e o horário?' };
  if (booking.status === 'feito') return { ok: false, code: 'already_done', message: 'Esse agendamento já está marcado como feito. ✅' };
  if (booking.status === 'cancelado') return { ok: false, code: 'cancelled', message: 'Esse agendamento está cancelado.' };
  if (!isBookingPast(booking.date, now)) {
    return { ok: false, code: 'future', message: 'Só dá para marcar como feito um agendamento que já passou.' };
  }
  store.markFeito(booking.id);
  return { ok: true, message: 'Marcado como feito! ✅', booking: store.getBooking(booking.id) ?? booking };
}

/** Define o profissional do agendamento criado pelo operador (padrão: ele mesmo). */
export function professionalNameForCreate(
  profissionais: Profissional[],
  input: { papel: PapelOperador; profissionalId: number | null; requestedName: string | null },
): string | null {
  const requested = (input.requestedName ?? '').trim();
  if (requested) return requested;
  if (input.papel === 'profissional' && input.profissionalId != null) {
    return profissionais.find((p) => p.id === input.profissionalId)?.nome ?? null;
  }
  return null;
}
