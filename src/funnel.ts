export interface Funnel {
  /** Etapa alcançada (1..5). */
  stage: number;
  total: number;
  label: string;
}

/**
 * Deriva a etapa do funil (5 etapas) a partir de sinais já capturados:
 *  1 Novo lead → 2 Em conversa → 3 Interesse identificado → 4 Agendado → 5 Atendido/Horário passou.
 */
export function computeFunnel(opts: {
  hasMessages: boolean;
  interest: string | null;
  hasFutureBooking: boolean;
  hasPastBooking: boolean;
}): Funnel {
  const total = 5;
  if (opts.hasPastBooking) return { stage: 5, total, label: 'Horário já passou' };
  if (opts.hasFutureBooking) return { stage: 4, total, label: 'Agendado' };
  if (opts.interest) return { stage: 3, total, label: 'Interesse identificado' };
  if (opts.hasMessages) return { stage: 2, total, label: 'Em conversa' };
  return { stage: 1, total, label: 'Novo lead' };
}
