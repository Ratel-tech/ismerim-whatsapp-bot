export interface Profissional {
  id: number;
  nome: string;
  /** Telefone para notificação — PRIVADO. Nunca sai do backend. Somente dígitos com DDI. */
  telefone: string;
  horarioInicio: string; // HH:MM (vazio = não definido)
  horarioFim: string; // HH:MM (vazio = não definido)
  ativo: boolean;
  createdAt: string;
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
  };
}
