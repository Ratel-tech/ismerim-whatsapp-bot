import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { semanaDaFolga } from '../src/folga.js';
import { processFolgaSchedule } from '../src/folga-scheduler.js';

const tmp: string[] = [];
afterEach(() => { for (const f of tmp.splice(0)) fs.rmSync(f, { force: true }); });
function makeStore(): Store {
  const f = path.join(os.tmpdir(), `fsched-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmp.push(f);
  return new Store(f);
}

describe('folga scheduler', () => {
  it('pergunta no domingo a partir da hora configurada', async () => {
    const store = makeStore();
    store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const sent: string[] = [];
    const r = await processFolgaSchedule({
      store,
      send: async (_jid, text) => { sent.push(text); return true; },
      adminPhone: '',
      now: new Date('2026-10-11T09:05:00'), // domingo
      askWeekday: 0, askHour: 9, remindHour: 9,
    });
    expect(r.perguntados).toBe(1);
    expect(sent[0]).toContain('JUAN');
    expect(sent[0]).toContain('folga');
    expect(sent[0]).not.toContain('domingo');
  });

  it('nao pergunta duas vezes na mesma semana', async () => {
    const store = makeStore();
    store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const deps = { store, send: async () => true, adminPhone: '', askWeekday: 0, askHour: 9, remindHour: 9 };
    await processFolgaSchedule({ ...deps, now: new Date('2026-10-11T09:05:00') });
    const r2 = await processFolgaSchedule({ ...deps, now: new Date('2026-10-11T10:00:00') });
    expect(r2.perguntados).toBe(0);
  });

  it('cobra 1x por dia enquanto nao responder', async () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const deps = { store, send: async () => true, adminPhone: '', askWeekday: 0, askHour: 9, remindHour: 9 };
    await processFolgaSchedule({ ...deps, now: new Date('2026-10-11T09:05:00') }); // domingo pergunta
    const seg = await processFolgaSchedule({ ...deps, now: new Date('2026-10-12T09:30:00') }); // segunda cobra
    expect(seg.cobrados).toBe(1);
    const seg2 = await processFolgaSchedule({ ...deps, now: new Date('2026-10-12T15:00:00') }); // segunda, ja cobrou
    expect(seg2.cobrados).toBe(0);
    // respondeu -> para de cobrar
    store.setFolgaControle(p.id, { semanaId: semanaDaFolga(new Date('2026-10-13T09:30:00')), answeredAt: new Date().toISOString() });
    const ter = await processFolgaSchedule({ ...deps, now: new Date('2026-10-13T09:30:00') });
    expect(ter.perguntados).toBe(0);
    expect(ter.cobrados).toBe(0);
  });

  it('nao cobra no mesmo dia da pergunta (lembrete so a partir do dia seguinte)', async () => {
    const store = makeStore();
    store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const deps = { store, send: async () => true, adminPhone: '', askWeekday: 0, askHour: 9, remindHour: 9 };
    const dom1 = await processFolgaSchedule({ ...deps, now: new Date('2026-10-11T09:05:00') }); // domingo pergunta
    expect(dom1.perguntados).toBe(1);
    const dom2 = await processFolgaSchedule({ ...deps, now: new Date('2026-10-11T09:06:00') }); // mesmo dia
    expect(dom2.perguntados).toBe(0);
    expect(dom2.cobrados).toBe(0);
    const seg = await processFolgaSchedule({ ...deps, now: new Date('2026-10-12T09:05:00') }); // dia seguinte
    expect(seg.cobrados).toBe(1);
  });

  it('ignora profissional sem telefone', async () => {
    const store = makeStore();
    store.addProfissional({ nome: 'SEM FONE', telefone: '' });
    const r = await processFolgaSchedule({ store, send: async () => true, adminPhone: '', now: new Date('2026-10-11T09:05:00'), askWeekday: 0, askHour: 9, remindHour: 9 });
    expect(r.perguntados).toBe(0);
  });

  it('nao oferece dias que ja passaram (pergunta na terca)', async () => {
    const store = makeStore();
    store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    const sent: string[] = [];
    await processFolgaSchedule({
      store,
      send: async (_j: string, t: string) => { sent.push(t); return true; },
      adminPhone: '',
      now: new Date('2026-10-13T09:05:00'), // terca
      askWeekday: 0, askHour: 9, remindHour: 9,
    });
    expect(sent[0]).toContain('terça');
    expect(sent[0]).not.toContain('segunda');
  });
});
