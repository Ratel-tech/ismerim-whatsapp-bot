import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { concluirAgendamento, listarAgenda, professionalNameForCreate } from '../src/operador.js';
import type { Profissional } from '../src/profissionais.js';

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `op-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

const NOW = new Date('2026-09-15T12:00:00-03:00');

function seed(store: Store) {
  const juan = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777', horarioInicio: '10:00', horarioFim: '20:00' });
  const geani = store.addProfissional({ nome: 'GEANI', telefone: '5521977778888', horarioInicio: '09:00', horarioFim: '19:00' });
  // Juan — hoje (dia vigente) e futuro
  store.addBooking({ clientJid: '', clientName: 'Ana', service: 'Corte', price: 70, date: '2026-09-15', time: '10:00', professionalId: juan.id, professionalName: 'JUAN' });
  store.addBooking({ clientJid: '', clientName: 'Maria', service: 'Corte', price: 70, date: '2026-09-22', time: '14:30', professionalId: juan.id, professionalName: 'JUAN' });
  // Geani — passado e hoje
  store.addBooking({ clientJid: '', clientName: 'Deirdre', service: 'Corte', price: 70, date: '2026-09-12', time: '11:50', professionalId: geani.id, professionalName: 'GEANI' });
  store.addBooking({ clientJid: '', clientName: 'Bia', service: 'Barba', price: 80, date: '2026-09-15', time: '16:00', professionalId: geani.id, professionalName: 'GEANI' });
  return { juan, geani };
}

describe('H4 — listarAgenda', () => {
  it('admin vê todos os agendamentos', () => {
    const store = makeStore();
    seed(store);
    const txt = listarAgenda(store, { papel: 'admin', profissionalId: null, now: NOW });
    expect(txt).toContain('Ana');
    expect(txt).toContain('Maria');
    expect(txt).toContain('Deirdre');
    expect(txt).toContain('Bia');
  });

  it('barbeiro vê apenas os agendamentos DO DIA (não antigos, não futuros)', () => {
    const store = makeStore();
    const { juan } = seed(store);
    const txt = listarAgenda(store, { papel: 'profissional', profissionalId: juan.id, now: NOW });
    expect(txt).toContain('Ana');
    expect(txt).not.toContain('Maria'); // futuro
    expect(txt).not.toContain('Deirdre'); // outro profissional/passado
    expect(txt).not.toContain('Bia'); // outro profissional
  });

  it('admin identifica os que já passaram', () => {
    const store = makeStore();
    seed(store);
    const txt = listarAgenda(store, { papel: 'admin', profissionalId: null, now: NOW });
    expect(txt).toMatch(/passou|passado/i);
  });

  it('não expõe telefone (nem dígitos longos)', () => {
    const store = makeStore();
    seed(store);
    const txt = listarAgenda(store, { papel: 'admin', profissionalId: null, now: NOW });
    expect(txt).not.toMatch(/\d{10,}/);
  });

  it('avisa quando não há agendamentos', () => {
    const store = makeStore();
    const txt = listarAgenda(store, { papel: 'admin', profissionalId: null, now: NOW });
    expect(txt.toLowerCase()).toContain('nenhum');
  });
});

describe('H4 — concluirAgendamento (marcar feito)', () => {
  it('barbeiro marca um agendamento passado dele como feito', () => {
    const store = makeStore();
    const { geani } = seed(store);
    const out = concluirAgendamento(store, { papel: 'profissional', profissionalId: geani.id, date: '2026-09-12', time: '11:50', now: NOW });
    expect(out.ok).toBe(true);
    const b = store.listBookings(50).find((x) => x.date === '2026-09-12' && x.time === '11:50');
    expect(b?.status).toBe('feito');
  });

  it('admin marca qualquer agendamento passado como feito', () => {
    const store = makeStore();
    seed(store);
    const out = concluirAgendamento(store, { papel: 'admin', profissionalId: null, date: '2026-09-12', time: '11:50', now: NOW });
    expect(out.ok).toBe(true);
    const b = store.listBookings(50).find((x) => x.date === '2026-09-12');
    expect(b?.status).toBe('feito');
  });

  it('barbeiro NÃO marca agendamento de outro profissional', () => {
    const store = makeStore();
    const { juan } = seed(store);
    const out = concluirAgendamento(store, { papel: 'profissional', profissionalId: juan.id, date: '2026-09-12', time: '11:50', now: NOW });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('not_found');
  });

  it('não marca agendamento futuro', () => {
    const store = makeStore();
    const { juan } = seed(store);
    const out = concluirAgendamento(store, { papel: 'profissional', profissionalId: juan.id, date: '2026-09-22', time: '14:30', now: NOW });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('future');
  });

  it('não marca duas vezes (já feito)', () => {
    const store = makeStore();
    const { geani } = seed(store);
    concluirAgendamento(store, { papel: 'profissional', profissionalId: geani.id, date: '2026-09-12', time: '11:50', now: NOW });
    const again = concluirAgendamento(store, { papel: 'profissional', profissionalId: geani.id, date: '2026-09-12', time: '11:50', now: NOW });
    expect(again.ok).toBe(false);
  });
});

describe('H4 — professionalNameForCreate', () => {
  const profs: Profissional[] = [
    { id: 1, nome: 'JUAN', telefone: '5521988887777', horarioInicio: '10:00', horarioFim: '20:00', ativo: true, createdAt: '2026-01-01T00:00:00.000Z' },
  ];

  it('barbeiro: padrão é ele mesmo', () => {
    expect(professionalNameForCreate(profs, { papel: 'profissional', profissionalId: 1, requestedName: null })).toBe('JUAN');
  });

  it('admin sem indicar: fica sem profissional', () => {
    expect(professionalNameForCreate(profs, { papel: 'admin', profissionalId: null, requestedName: null })).toBeNull();
  });

  it('nome indicado é repassado (validação resolve depois)', () => {
    expect(professionalNameForCreate(profs, { papel: 'admin', profissionalId: null, requestedName: 'JUAN' })).toBe('JUAN');
  });
});
