import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { resolverPapel, senderPhone, type Vinculo } from '../src/papeis.js';
import type { Profissional } from '../src/profissionais.js';

const tmpFiles: string[] = [];
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const f = path.join(os.tmpdir(), `papeis-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return new Store(f);
}

function makeProf(over: Partial<Profissional> = {}): Profissional {
  return {
    id: 1,
    nome: 'JUAN',
    telefone: '5521988887777',
    horarioInicio: '10:00',
    horarioFim: '20:00',
    ativo: true,
    createdAt: '2026-09-09T00:00:00.000Z',
    ...over,
  };
}

describe('Store — vínculos (H1)', () => {
  it('guarda, lê e remove vínculo', () => {
    const store = makeStore();
    expect(store.getVinculo('x@s.whatsapp.net')).toBeNull();
    store.setVinculo('x@s.whatsapp.net', { tipo: 'profissional', profissionalId: 2 });
    expect(store.getVinculo('x@s.whatsapp.net')).toEqual({ tipo: 'profissional', profissionalId: 2 });
    store.setVinculo('x@s.whatsapp.net', null);
    expect(store.getVinculo('x@s.whatsapp.net')).toBeNull();
  });

  it('persiste vínculos entre instâncias', () => {
    const f = path.join(os.tmpdir(), `papeis-persist-${Date.now()}.json`);
    tmpFiles.push(f);
    const s1 = new Store(f);
    s1.setVinculo('a@lid', { tipo: 'admin' });
    const s2 = new Store(f);
    expect(s2.getVinculo('a@lid')).toEqual({ tipo: 'admin' });
  });

  it('migra db legado sem vínculos sem apagar dados', () => {
    const f = path.join(os.tmpdir(), `papeis-legacy-${Date.now()}.json`);
    tmpFiles.push(f);
    fs.writeFileSync(
      f,
      JSON.stringify({ clients: [{ jid: 'a@lid', name: 'X', phone: '1', createdAt: '2026-01-01T00:00:00.000Z' }], conversations: [], bookings: [], nextBookingId: 1 }),
    );
    const store = new Store(f);
    expect(store.getVinculo('a@lid')).toBeNull();
    expect(store.getClient('a@lid')?.name).toBe('X');
  });
});

describe('senderPhone (H1)', () => {
  it('extrai o telefone de remoteJid @s.whatsapp.net', () => {
    expect(senderPhone({ remoteJid: '5521988887777@s.whatsapp.net' })).toBe('5521988887777');
  });

  it('extrai o telefone de remoteJidAlt quando o JID vem como @lid', () => {
    expect(senderPhone({ remoteJid: '123456789@lid', remoteJidAlt: '5521988887777@s.whatsapp.net' })).toBe('5521988887777');
  });

  it('retorna null quando só há @lid sem alternativo', () => {
    expect(senderPhone({ remoteJid: '123456789@lid' })).toBeNull();
  });
});

describe('resolverPapel (H1)', () => {
  const juan = makeProf({ id: 1, nome: 'JUAN', telefone: '5521988887777' });
  const geani = makeProf({ id: 2, nome: 'GEANI', telefone: '5521977778888' });
  const base = { adminPhone: '5521999990000', profissionais: [juan, geani] };

  it('admin por vínculo explícito', () => {
    const vinculos: Record<string, Vinculo> = { 'x@lid': { tipo: 'admin' } };
    expect(resolverPapel({ jid: 'x@lid', phone: null, vinculos, ...base }).papel).toBe('admin');
  });

  it('profissional por vínculo explícito', () => {
    const vinculos: Record<string, Vinculo> = { 'x@lid': { tipo: 'profissional', profissionalId: 2 } };
    const r = resolverPapel({ jid: 'x@lid', phone: null, vinculos, ...base });
    expect(r.papel).toBe('profissional');
    expect(r.profissionalNome).toBe('GEANI');
  });

  it('admin por telefone (ADMIN_PHONE)', () => {
    expect(resolverPapel({ jid: 'x@lid', phone: '5521999990000', vinculos: {}, ...base }).papel).toBe('admin');
  });

  it('profissional por telefone', () => {
    const r = resolverPapel({ jid: 'x@lid', phone: '5521988887777', vinculos: {}, ...base });
    expect(r.papel).toBe('profissional');
    expect(r.profissionalId).toBe(1);
  });

  it('não casa profissional inativo', () => {
    const inativo = [makeProf({ id: 3, nome: 'X', telefone: '5521900000000', ativo: false })];
    expect(resolverPapel({ jid: 'x@lid', phone: '5521900000000', vinculos: {}, adminPhone: '', profissionais: inativo }).papel).toBe('cliente');
  });

  it('cliente quando não casa nada (ou sem telefone)', () => {
    expect(resolverPapel({ jid: 'x@lid', phone: '5521911112222', vinculos: {}, ...base }).papel).toBe('cliente');
    expect(resolverPapel({ jid: 'x@lid', phone: null, vinculos: {}, ...base }).papel).toBe('cliente');
  });
});
