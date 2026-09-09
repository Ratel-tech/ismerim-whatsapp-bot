import fs from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  formatHorarios,
  isWithinHours,
  loadCatalog,
  localDateString,
  normalizeName,
  resolvePromocao,
  resolveService,
  saveCatalog,
  type Catalog,
} from '../src/catalog.js';

const sample: Catalog = {
  horarios: {
    '1': [{ open: '09:00', close: '19:00' }],
    '6': [{ open: '08:00', close: '12:00' }],
  },
  servicos: [
    { nome: 'Corte', preco: 40, descricao: 'Corte de cabelo' },
    { nome: 'Barba', preco: 30 },
    { nome: 'Corte + Barba', preco: 65 },
  ],
  promocoes: [
    { nome: 'Corte + Barba', preco: 59.9, de: 65, valida_ate: '2099-12-31' },
    { nome: 'Promo Antiga', preco: 10, valida_ate: '2020-01-01' },
    { nome: 'Promo Sem Validade', preco: 5 },
  ],
};

describe('catalog', () => {
  it('carrega o catalog.json real com estrutura válida', () => {
    const catalog = loadCatalog();
    expect(Array.isArray(catalog.servicos)).toBe(true);
    expect(Array.isArray(catalog.promocoes)).toBe(true);
    expect(typeof catalog.horarios).toBe('object');
    expect(catalog.servicos.length).toBeGreaterThan(0);
  });

  it('normaliza nomes (acentos e espaços)', () => {
    expect(normalizeName('Corte + Barba')).toBe('cortebarba');
    expect(normalizeName('PÉzinho')).toBe('pezinho');
  });

  it('resolve serviço exato e por normalização', () => {
    expect(resolveService(sample, 'Corte')?.preco).toBe(40);
    expect(resolveService(sample, 'CÓRTE')?.nome).toBe('Corte');
  });

  it('NÃO resolve serviço inexistente (anti-invenção)', () => {
    expect(resolveService(sample, 'Lavagem de Motor')).toBeNull();
  });

  it('resolve promoção vigente', () => {
    expect(resolvePromocao(sample, 'Corte + Barba')?.preco).toBe(59.9);
  });

  it('exclui promoção expirada', () => {
    expect(resolvePromocao(sample, 'Promo Antiga')).toBeNull();
  });

  it('aceita promoção sem validade definida', () => {
    expect(resolvePromocao(sample, 'Promo Sem Validade')?.preco).toBe(5);
  });

  it('NÃO resolve promoção inexistente (anti-invenção)', () => {
    expect(resolvePromocao(sample, 'Black Friday -80%')).toBeNull();
  });

  it('valida horário dentro do expediente', () => {
    const segunda = new Date('2026-08-31T10:00:00'); // segunda-feira
    expect(isWithinHours(sample, segunda, '10:00')).toBe(true);
    expect(isWithinHours(sample, segunda, '20:00')).toBe(false);
    expect(isWithinHours(sample, segunda, '08:59')).toBe(false);
  });

  it('valida horário por dia da semana (domingo fechado)', () => {
    const domingo = new Date('2026-08-30T10:00:00'); // domingo
    expect(isWithinHours(sample, domingo, '10:00')).toBe(false);
    const sabado = new Date('2026-08-29T10:00:00'); // sábado (08:00-12:00)
    expect(isWithinHours(sample, sabado, '09:00')).toBe(true);
    expect(isWithinHours(sample, sabado, '13:00')).toBe(false);
  });

  it('formata horários para o prompt', () => {
    const text = formatHorarios(sample);
    expect(text).toContain('segunda');
    expect(text).toContain('09:00 às 19:00');
  });

  it('salva catalogo em caminho com separador / (cross-platform)', () => {
    const dir = os.tmpdir().replaceAll('\\', '/');
    const file = `${dir}/catalog-save-${Date.now()}-${Math.random().toString(36).slice(2)}/catalog.json`;
    saveCatalog(sample, file);
    expect(fs.existsSync(file)).toBe(true);
    expect(loadCatalog(file).servicos.some((s) => s.nome === 'Corte')).toBe(true);
    fs.rmSync(file, { force: true });
  });

  it('localDateString usa o dia local conforme o offset informado', () => {
    // 02:30 UTC com offset +180 min (UTC-3) ainda é 31/08 no horário local.
    expect(localDateString(new Date('2026-09-01T02:30:00Z'), 180)).toBe('2026-08-31');
    // 02:30 UTC com offset -540 min (UTC+9) já é 01/09 no horário local.
    expect(localDateString(new Date('2026-09-01T02:30:00Z'), -540)).toBe('2026-09-01');
    // Sem offset explícito, usa o fuso da máquina (mesmo comportamento do dia atual).
    expect(localDateString(new Date('2026-09-01T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
