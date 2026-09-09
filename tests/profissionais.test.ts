import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { normalizeTelefone, toPublicProfissional, type Profissional } from '../src/profissionais.js';

const tmpFiles: string[] = [];

function makeStore(): Store {
  const file = path.join(os.tmpdir(), `prof-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(file);
  return new Store(file);
}

afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

describe('Store — profissionais', () => {
  it('cria profissional com id, nome, telefone (só dígitos) e horários', () => {
    const store = makeStore();
    const p = store.addProfissional({
      nome: 'Juan',
      telefone: '+55 (21) 98888-7777',
      horarioInicio: '10:00',
      horarioFim: '20:00',
      ativo: true,
    });
    expect(p.id).toBeGreaterThan(0);
    expect(p.nome).toBe('Juan');
    expect(p.telefone).toBe('5521988887777');
    expect(p.horarioInicio).toBe('10:00');
    expect(p.horarioFim).toBe('20:00');
    expect(p.ativo).toBe(true);
    expect(store.listProfissionais()).toHaveLength(1);
  });

  it('cria profissional ativo por padrão e sem telefone quando omitido', () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'Geani', horarioInicio: '09:00', horarioFim: '19:00' });
    expect(p.ativo).toBe(true);
    expect(p.telefone).toBe('');
    expect(store.getProfissional(p.id)?.nome).toBe('Geani');
  });

  it('atribui ids sequenciais distintos', () => {
    const store = makeStore();
    const a = store.addProfissional({ nome: 'Juan' });
    const b = store.addProfissional({ nome: 'Geani' });
    expect(b.id).toBe(a.id + 1);
  });

  it('persiste profissionais entre instâncias (arquivo)', () => {
    const file = path.join(os.tmpdir(), `prof-persist-${Date.now()}.json`);
    tmpFiles.push(file);
    const s1 = new Store(file);
    s1.addProfissional({ nome: 'Juan', telefone: '5521988887777', horarioInicio: '10:00', horarioFim: '20:00' });
    const s2 = new Store(file);
    const list = s2.listProfissionais();
    expect(list).toHaveLength(1);
    expect(list[0]?.nome).toBe('Juan');
    expect(list[0]?.telefone).toBe('5521988887777');
  });

  it('edita nome, horários, telefone e status ativo', () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'Juan', telefone: '5521988887777', horarioInicio: '10:00', horarioFim: '20:00', ativo: true });
    const updated = store.updateProfissional(p.id, { nome: 'Juan Souza', horarioInicio: '09:00', ativo: false });
    expect(updated?.nome).toBe('Juan Souza');
    expect(updated?.horarioInicio).toBe('09:00');
    expect(updated?.horarioFim).toBe('20:00'); // não enviado = mantém
    expect(updated?.telefone).toBe('5521988887777'); // não enviado = mantém
    expect(updated?.ativo).toBe(false);
    const after = store.getProfissional(p.id);
    expect(after?.nome).toBe('Juan Souza');
  });

  it('limpa o telefone quando enviado vazio', () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'Geani', telefone: '5521977778888' });
    const updated = store.updateProfissional(p.id, { telefone: '' });
    expect(updated?.telefone).toBe('');
  });

  it('atualizar profissional inexistente retorna null', () => {
    const store = makeStore();
    expect(store.updateProfissional(999, { nome: 'X' })).toBeNull();
    expect(store.getProfissional(999)).toBeNull();
  });

  it('migra db.json legado sem profissionais sem apagar dados existentes', () => {
    const file = path.join(os.tmpdir(), `prof-legacy-${Date.now()}.json`);
    tmpFiles.push(file);
    fs.writeFileSync(
      file,
      JSON.stringify({
        clients: [{ jid: 'jid@s.whatsapp.net', name: 'João', phone: '5511', createdAt: '2026-09-01T00:00:00.000Z' }],
        conversations: [],
        bookings: [
          {
            id: 1,
            clientJid: 'jid@s.whatsapp.net',
            clientName: 'João',
            service: 'Corte',
            price: 70,
            date: '2026-09-10',
            time: '11:00',
            createdAt: '2026-09-01T00:00:00.000Z',
            notifiedAt: null,
          },
        ],
        nextBookingId: 2,
      }),
    );
    const store = new Store(file);
    expect(store.listProfissionais()).toEqual([]);
    expect(store.listBookings()).toHaveLength(1);
    expect(store.getClient('jid@s.whatsapp.net')?.name).toBe('João');
    const p = store.addProfissional({ nome: 'Juan' });
    expect(p.id).toBe(1);
    expect(store.getProfissional(p.id)?.nome).toBe('Juan');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).profissionais).toHaveLength(1);
  });

  it('listProfissionaisPublic remove o telefone (privacidade)', () => {
    const store = makeStore();
    store.addProfissional({ nome: 'Juan', telefone: '5521988887777' });
    store.addProfissional({ nome: 'Geani' });
    const pubs = store.listProfissionaisPublic();
    expect(pubs).toHaveLength(2);
    for (const pub of pubs) {
      expect(pub).not.toHaveProperty('telefone');
      expect(JSON.stringify(pub)).not.toMatch(/\d{10,}/);
    }
    expect(pubs[0]?.hasTelefone).toBe(true);
    expect(pubs[1]?.hasTelefone).toBe(false);
  });
});

describe('profissionais — domínio e privacidade (DTO)', () => {
  const juan: Profissional = {
    id: 1,
    nome: 'Juan',
    telefone: '5521988887777',
    horarioInicio: '10:00',
    horarioFim: '20:00',
    ativo: true,
    createdAt: '2026-09-09T00:00:00.000Z',
  };

  it('normaliza telefone para apenas dígitos', () => {
    expect(normalizeTelefone('+55 (21) 98888-7777')).toBe('5521988887777');
    expect(normalizeTelefone('')).toBe('');
    expect(normalizeTelefone('  ')).toBe('');
  });

  it('remove o telefone e expõe apenas hasTelefone', () => {
    const pub = toPublicProfissional(juan);
    expect(pub).not.toHaveProperty('telefone');
    expect(pub).not.toHaveProperty('createdAt');
    expect(pub.id).toBe(1);
    expect(pub.nome).toBe('Juan');
    expect(pub.hasTelefone).toBe(true);
  });

  it('marca hasTelefone false quando não há telefone', () => {
    const pub = toPublicProfissional({ ...juan, telefone: '' });
    expect(pub.hasTelefone).toBe(false);
  });
});
