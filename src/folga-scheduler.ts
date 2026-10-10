import { DIAS_UTEIS, buildFolgaQuestion, buildFolgaReminder, diasOcupados, semanaDaFolga } from './folga.js';
import { log } from './log.js';
import type { Store } from './store.js';

export interface FolgaSchedulerDeps {
  store: Store;
  send: (jid: string, text: string) => Promise<boolean>;
  adminPhone: string;
  now?: Date;
  /** Dia da pergunta (0=domingo). */
  askWeekday?: number;
  askHour?: number;
  remindHour?: number;
}

function soDigitos(v: string): string {
  return (v ?? '').replace(/\D/g, '');
}

function mesmoDia(a: string | null, now: Date): boolean {
  if (!a) return false;
  const d = new Date(a);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export async function processFolgaSchedule(deps: FolgaSchedulerDeps): Promise<{ perguntados: number; cobrados: number }> {
  const now = deps.now ?? new Date();
  const week = semanaDaFolga(now);
  const today = now.getDay();
  const hour = now.getHours();
  const askWeekday = deps.askWeekday ?? 0;
  const askHour = deps.askHour ?? 9;
  const remindHour = deps.remindHour ?? 9;
  // Gatilho ativo: e domingo e ja passou da hora, OU ja passou do domingo (recupera se o bot ficou offline).
  const gatilhoAtivo = today !== askWeekday || hour >= askHour;
  let perguntados = 0;
  let cobrados = 0;

  for (const prof of deps.store.listProfissionais()) {
    if (!prof.ativo) continue;
    const fone = soDigitos(prof.telefone);
    if (fone.length < 10) continue;
    const jid = `${fone}@s.whatsapp.net`;
    const controle = deps.store.getFolgaControle(prof.id);
    const doCiclo = controle?.semanaId === week;

    if (!doCiclo) {
      // Primeira vez nesta semana: pergunta (a partir do gatilho).
      if (!gatilhoAtivo) continue;
      const livres = DIAS_UTEIS.filter((d) => !diasOcupados(deps.store.listProfissionais(), week, prof.id).has(d));
      const ok = await deps.send(jid, buildFolgaQuestion(prof.nome, livres)).catch(() => false);
      if (ok) {
        // remindedAt = agora: o lembrete só pode sair a partir do dia seguinte (guard !mesmoDia).
        deps.store.setFolgaControle(prof.id, { semanaId: week, askedAt: now.toISOString(), remindedAt: now.toISOString(), answeredAt: null });
        perguntados += 1;
      } else {
        log('warn', `Folga: falha ao perguntar a ${prof.nome} (WhatsApp desconectado).`);
      }
      continue;
    }

    // Ja perguntado nesta semana: cobra 1x por dia enquanto nao responder.
    if (!controle?.answeredAt && hour >= remindHour && !mesmoDia(controle.remindedAt, now)) {
      const livres = DIAS_UTEIS.filter((d) => !diasOcupados(deps.store.listProfissionais(), week, prof.id).has(d));
      const ok = await deps.send(jid, buildFolgaReminder(prof.nome, livres)).catch(() => false);
      if (ok) {
        deps.store.setFolgaControle(prof.id, { remindedAt: now.toISOString() });
        cobrados += 1;
      }
    }
  }
  return { perguntados, cobrados };
}
