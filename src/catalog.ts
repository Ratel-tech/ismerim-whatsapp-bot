import fs from 'node:fs';
import { config } from './config.js';

export interface Service {
  nome: string;
  preco: number;
  descricao?: string;
}

export interface Promocao {
  nome: string;
  preco: number;
  de?: number;
  valida_ate?: string; // YYYY-MM-DD (opcional; ausente = sempre válida)
  descricao?: string;
}

export interface HorarioSlot {
  open: string; // HH:MM
  close: string; // HH:MM
}

export interface Catalog {
  horarios: Record<string, HorarioSlot[]>;
  servicos: Service[];
  promocoes: Promocao[];
}

const DIAS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function loadCatalog(file: string = config.catalogFile): Catalog {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Catalog;
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export function resolveService(catalog: Catalog, name: string | null | undefined): Service | null {
  if (!name) return null;
  const wanted = normalizeName(name);
  if (!wanted) return null;
  return (
    catalog.servicos.find((s) => normalizeName(s.nome) === wanted) ??
    catalog.servicos.find((s) => normalizeName(s.nome).includes(wanted)) ??
    null
  );
}

export function resolvePromocao(
  catalog: Catalog,
  name: string | null | undefined,
  now: Date = new Date(),
): Promocao | null {
  if (!name) return null;
  const wanted = normalizeName(name);
  if (!wanted) return null;
  const hoje = now.toISOString().slice(0, 10);
  return (
    catalog.promocoes.find((p) => {
      const match = normalizeName(p.nome) === wanted || normalizeName(p.nome).includes(wanted);
      if (!match) return false;
      return !p.valida_ate || p.valida_ate >= hoje;
    }) ?? null
  );
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function isWithinHours(catalog: Catalog, date: Date, time: string): boolean {
  const slots = catalog.horarios[String(date.getDay())];
  if (!slots?.length) return false;
  const t = timeToMinutes(time);
  return slots.some((s) => t >= timeToMinutes(s.open) && t <= timeToMinutes(s.close));
}

export function formatHorarios(catalog: Catalog): string {
  const lines: string[] = [];
  for (let i = 0; i < 7; i++) {
    const slots = catalog.horarios[String(i)];
    lines.push(
      slots?.length
        ? `${DIAS_PT[i]}: ${slots.map((s) => `${s.open} às ${s.close}`).join(' e ')}`
        : `${DIAS_PT[i]}: fechado`,
    );
  }
  return lines.join('\n');
}

export function formatPreco(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
