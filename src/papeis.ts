import type { Profissional } from './profissionais.js';

export type Papel = 'cliente' | 'admin' | 'profissional';

/** Vínculo manual de um JID do WhatsApp a um papel (usado quando não há telefone). */
export interface Vinculo {
  tipo: 'admin' | 'profissional';
  profissionalId?: number;
}

export interface PapelResolvido {
  papel: Papel;
  profissionalId: number | null;
  profissionalNome: string | null;
}

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/**
 * Telefone real do remetente. O WhatsApp pode entregar o JID como `@lid`
 * (sem número); nesse caso usamos o `remoteJidAlt` (`@s.whatsapp.net`).
 */
export function senderPhone(key: { remoteJid?: string | null; remoteJidAlt?: string | null }): string | null {
  const pick = (jid?: string | null): string | null =>
    jid && jid.endsWith('@s.whatsapp.net') ? (jid.split('@')[0] ?? null) : null;
  return pick(key.remoteJidAlt) ?? pick(key.remoteJid);
}

export function phoneMatches(phone: string | null | undefined, target: string | null | undefined): boolean {
  const a = onlyDigits(phone);
  const b = onlyDigits(target);
  return a.length >= 10 && a === b;
}

/**
 * Resolve o papel de quem está falando:
 * 1) vínculo explícito do JID; 2) telefone real (ADMIN_PHONE / telefone do
 * profissional ativo); 3) cliente.
 */
export function resolverPapel(input: {
  jid: string;
  phone: string | null;
  adminPhone: string;
  profissionais: Profissional[];
  vinculos: Record<string, Vinculo>;
}): PapelResolvido {
  const vinculo = input.vinculos[input.jid];
  if (vinculo?.tipo === 'admin') {
    return { papel: 'admin', profissionalId: null, profissionalNome: null };
  }
  if (vinculo?.tipo === 'profissional') {
    const prof = input.profissionais.find((p) => p.id === vinculo.profissionalId) ?? null;
    if (prof) return { papel: 'profissional', profissionalId: prof.id, profissionalNome: prof.nome };
  }

  if (phoneMatches(input.phone, input.adminPhone)) {
    return { papel: 'admin', profissionalId: null, profissionalNome: null };
  }
  const prof = input.profissionais.find((p) => p.ativo && phoneMatches(input.phone, p.telefone)) ?? null;
  if (prof) return { papel: 'profissional', profissionalId: prof.id, profissionalNome: prof.nome };

  return { papel: 'cliente', profissionalId: null, profissionalNome: null };
}
