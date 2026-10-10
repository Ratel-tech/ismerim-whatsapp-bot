export interface Profissional {
  id: number;
  nome: string;
  /** Telefone para notificação — PRIVADO. Nunca sai do backend. Somente dígitos com DDI. */
  telefone: string;
  horarioInicio: string; // HH:MM (vazio = não definido)
  horarioFim: string; // HH:MM (vazio = não definido)
  ativo: boolean;
  createdAt: string;
  /** Preferencia recorrente de folga: 1=segunda ... 6=sabado. null/undefined = nunca definiu. */
  folgaDia?: number | null;
  /** Decisao da semana corrente. dia=null = "nao vou folgar nesta semana". */
  folgaSemana?: { semanaId: string; dia: number | null } | null;
}

/**
 * DTO público do profissional: NUNCA contém o telefone.
 * `hasTelefone` informa apenas se há número cadastrado (para a UI).
 */
export interface ProfissionalPublic {
  id: number;
  nome: string;
  horarioInicio: string;
  horarioFim: string;
  ativo: boolean;
  hasTelefone: boolean;
  /** Preferência recorrente de folga (1=segunda ... 6=sábado). null = nunca definiu. */
  folgaDia?: number | null;
  /** Folga efetiva da semana corrente (preenchida por listProfissionaisPublic). */
  folgaSemanaDia?: number | null;
}

export function normalizeTelefone(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

export function toPublicProfissional(p: Profissional): ProfissionalPublic {
  return {
    id: p.id,
    nome: p.nome,
    horarioInicio: p.horarioInicio,
    horarioFim: p.horarioFim,
    ativo: p.ativo,
    hasTelefone: normalizeTelefone(p.telefone).length > 0,
    folgaDia: p.folgaDia ?? null,
    folgaSemanaDia: null,
  };
}
