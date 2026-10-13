import type { Profissional } from './profissionais.js';

export const DIAS_UTEIS = [1, 2, 3, 4, 5, 6];
export const DIA_NOMES: Record<number, string> = {
  0: 'domingo', 1: 'segunda', 2: 'terça', 3: 'quarta', 4: 'quinta', 5: 'sexta', 6: 'sábado',
};

export function nomeDia(dia: number): string {
  return DIA_NOMES[dia] ?? String(dia);
}

/** Dias uteis que ainda podem receber folga nesta semana (do dia de hoje em diante). Domingo = todos. */
export function diasRestantes(now: Date = new Date()): number[] {
  const hoje = now.getDay();
  return DIAS_UTEIS.filter((d) => d >= hoje);
}

/** Identificador ISO da semana (ex.: 2026-W41) a partir de uma data local. */
export function semanaId(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // segunda=0 ... domingo=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // quinta da semana
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const fDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Identificador da SEMANA DA FOLGA (ciclo domingo..sábado). O domingo (loja fechada)
 * pertence à semana ISO anterior, então é ancorado na segunda-feira seguinte — assim
 * a pergunta no domingo, a cobrança durante a semana e o `folgaSemana.semanaId` do
 * comando compartilham o MESMO id.
 */
export function semanaDaFolga(date: Date): string {
  const ref = date.getDay() === 0 ? new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1) : date;
  return semanaId(ref);
}

/** Dia da semana (0=domingo..6=sabado) de uma data YYYY-MM-DD. */
export function weekdayOf(dateISO: string): number {
  return new Date(`${dateISO}T12:00:00`).getDay();
}

export function folgaEfetiva(prof: Profissional, semana: string): number | null {
  if (prof.folgaSemana && prof.folgaSemana.semanaId === semana) return prof.folgaSemana.dia;
  return prof.folgaDia ?? null;
}

export function folgaNaData(prof: Profissional, dateISO: string, hoje: Date = new Date()): number | null {
  const semanaData = semanaDaFolga(new Date(`${dateISO}T12:00:00`));
  const semanaHoje = semanaDaFolga(hoje);
  return semanaData === semanaHoje ? folgaEfetiva(prof, semanaHoje) : (prof.folgaDia ?? null);
}

export function diasOcupados(profissionais: Profissional[], semana: string, excetoId?: number): Set<number> {
  const set = new Set<number>();
  for (const p of profissionais) {
    if (!p.ativo || p.id === excetoId) continue;
    const d = folgaEfetiva(p, semana);
    if (d != null) set.add(d);
  }
  return set;
}

const NOME_PARA_DIA: [RegExp, number][] = [
  [/domingo|dom\b/, 0],
  [/segunda|seg\b/, 1],
  [/ter[cç]a|ter\b/, 2],
  [/quarta|qua\b/, 3],
  [/quinta|qui\b/, 4],
  [/sexta|sex\b/, 5],
  [/s[aá]bado|sab\b/, 6],
];

export type FolgaParsed = { tipo: 'dia'; dia: number } | { tipo: 'sem_folga' } | { tipo: 'invalido' };

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\sª]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseFolgaAnswer(text: string): FolgaParsed {
  const t = normalize(text);
  if (!t) return { tipo: 'invalido' };
  if (/\b(nao\s*(vou\s*)?folgar|nao\s*folgo|sem\s*folga|nao\s*vou\s*descansar|nenhum|nenhuma)\b/.test(t) || t === '-') {
    return { tipo: 'sem_folga' };
  }
  for (const [re, dia] of NOME_PARA_DIA) {
    if (re.test(t)) return dia === 0 ? { tipo: 'invalido' } : { tipo: 'dia', dia };
  }
  // Numeros: 1=segunda ... 6=sabado (opcional com ª/a/º), alinhado a folgaDia/DIA_NOMES.
  const num = t.match(/\b([1-6])\s*[ªaº]?\b/);
  if (num) return { tipo: 'dia', dia: Number(num[1]) };
  return { tipo: 'invalido' };
}

export function buildFolgaQuestion(nome: string, diasLivres: number[]): string {
  const livres = diasLivres.length ? diasLivres.map(nomeDia).join(', ') : '(nenhum dia livre)';
  return [
    `Oi, ${nome}! Vamos definir as folgas desta semana.`,
    '',
    `Dias livres: ${livres}.`,
    'Responda só o dia (ex.: *quarta*) ou *não vou folgar* nesta semana.',
  ].join('\n');
}

export function buildFolgaReminder(nome: string, diasLivres: number[]): string {
  const livres = diasLivres.length ? diasLivres.map(nomeDia).join(', ') : '(nenhum dia livre)';
  return `${nome}, ainda falta definir sua folga desta semana. Dias livres: ${livres}. Responda o dia ou "não vou folgar".`;
}

export function buildFolgaConfirmation(dia: number | null): string {
  return dia == null
    ? 'Combinado! Esta semana você não folga. 👍'
    : `Perfeito! Sua folga esta semana: ${nomeDia(dia)}. ✅`;
}
