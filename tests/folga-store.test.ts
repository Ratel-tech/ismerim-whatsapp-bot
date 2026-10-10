import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';

const tmp: string[] = [];
afterEach(() => { for (const f of tmp.splice(0)) fs.rmSync(f, { force: true }); });
function makeStore(): Store {
  const f = path.join(os.tmpdir(), `folga-store-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmp.push(f);
  return new Store(f);
}

describe('store — folga', () => {
  it('grava folga recorrente e da semana', () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    store.setFolga(p.id, { folgaDia: 3, folgaSemana: { semanaId: '2026-W41', dia: 3 } });
    const salvo = store.getProfissional(p.id)!;
    expect(salvo.folgaDia).toBe(3);
    expect(salvo.folgaSemana).toEqual({ semanaId: '2026-W41', dia: 3 });
  });

  it('controle de cobranca persiste', () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN' });
    store.setFolgaControle(p.id, { semanaId: '2026-W41', askedAt: 'x' });
    expect(store.getFolgaControle(p.id)).toEqual({ semanaId: '2026-W41', askedAt: 'x', remindedAt: null, answeredAt: null });
  });

  it('DTO publico expoe folga efetiva sem telefone', () => {
    const store = makeStore();
    const p = store.addProfissional({ nome: 'JUAN', telefone: '5521988887777' });
    store.setFolga(p.id, { folgaDia: 3 });
    const pub = store.listProfissionaisPublic(new Date('2026-10-08T12:00:00'))[0]!;
    expect(pub.folgaSemanaDia).toBe(3);
    expect(JSON.stringify(pub)).not.toContain('telefone');
    expect(JSON.stringify(pub)).not.toContain('5521988887777');
  });
});
