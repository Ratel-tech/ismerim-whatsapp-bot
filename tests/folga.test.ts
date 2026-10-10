import { describe, expect, it } from 'vitest';
import {
  DIAS_UTEIS, DIA_NOMES, nomeDia, semanaId, weekdayOf,
  folgaEfetiva, folgaNaData, diasOcupados, parseFolgaAnswer,
} from '../src/folga.js';
import type { Profissional } from '../src/profissionais.js';

function prof(patch: Partial<Profissional>): Profissional {
  return { id: 1, nome: 'JUAN', telefone: '5521988887777', horarioInicio: '', horarioFim: '', ativo: true, createdAt: '2026-01-01T00:00:00.000Z', ...patch };
}

describe('folga — nomes e semana', () => {
  it('nomeia os dias uteis', () => {
    expect(nomeDia(1)).toBe('segunda');
    expect(nomeDia(6)).toBe('sábado');
    expect(DIA_NOMES[3]).toBe('quarta');
    expect(DIAS_UTEIS).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('calcula o id ISO da semana', () => {
    expect(semanaId(new Date('2026-10-08T12:00:00'))).toBe('2026-W41');
    expect(semanaId(new Date('2026-01-01T12:00:00'))).toBe('2026-W01');
  });

  it('converte data para dia da semana', () => {
    expect(weekdayOf('2026-10-08')).toBe(4); // quinta
    expect(weekdayOf('2026-10-11')).toBe(0); // domingo
  });
});

describe('folga efetiva e na data', () => {
  it('usa a recorrente quando nao ha decisao da semana', () => {
    expect(folgaEfetiva(prof({ folgaDia: 3 }), '2026-W41')).toBe(3);
  });
  it('decisao da semana corrente tem prioridade (inclusive sem folga)', () => {
    expect(folgaEfetiva(prof({ folgaDia: 3, folgaSemana: { semanaId: '2026-W41', dia: null } }), '2026-W41')).toBeNull();
    expect(folgaEfetiva(prof({ folgaDia: 3, folgaSemana: { semanaId: '2026-W41', dia: 2 } }), '2026-W41')).toBe(2);
  });
  it('decisao de outra semana cai na recorrente', () => {
    expect(folgaEfetiva(prof({ folgaDia: 3, folgaSemana: { semanaId: '2026-W40', dia: 2 } }), '2026-W41')).toBe(3);
  });
  it('folgaNaData: semana corrente usa efetiva; futura usa recorrente', () => {
    const p = prof({ folgaDia: 4, folgaSemana: { semanaId: '2026-W41', dia: null } });
    expect(folgaNaData(p, '2026-10-08', new Date('2026-10-08T12:00:00'))).toBeNull(); // semana atual, sem folga
    expect(folgaNaData(p, '2026-10-22', new Date('2026-10-08T12:00:00'))).toBe(4); // semana futura, recorrente
  });
});

describe('folga — ocupados', () => {
  it('lista os dias ocupados, exceto o proprio', () => {
    const a = prof({ id: 1, folgaDia: 3 });
    const b = prof({ id: 2, folgaDia: 5 });
    const c = prof({ id: 3, folgaDia: 5, ativo: false });
    expect([...diasOcupados([a, b, c], '2026-W41')].sort()).toEqual([3, 5]);
    expect([...diasOcupados([a, b, c], '2026-W41', 1)].sort()).toEqual([5]);
  });
});

describe('folga — parser', () => {
  it('reconhece nomes e abreviacoes', () => {
    expect(parseFolgaAnswer('quarta')).toEqual({ tipo: 'dia', dia: 3 });
    expect(parseFolgaAnswer('QUA')).toEqual({ tipo: 'dia', dia: 3 });
    expect(parseFolgaAnswer('sábado')).toEqual({ tipo: 'dia', dia: 6 });
    expect(parseFolgaAnswer('terca')).toEqual({ tipo: 'dia', dia: 2 });
    expect(parseFolgaAnswer('6ª')).toEqual({ tipo: 'dia', dia: 6 }); // sabado
    expect(parseFolgaAnswer('2')).toEqual({ tipo: 'dia', dia: 2 }); // terca
    expect(parseFolgaAnswer('1')).toEqual({ tipo: 'dia', dia: 1 }); // segunda
    expect(parseFolgaAnswer('4')).toEqual({ tipo: 'dia', dia: 4 }); // quinta
    expect(parseFolgaAnswer('vou folgar quinta')).toEqual({ tipo: 'dia', dia: 4 }); // quinta
  });
  it('reconhece "nao vou folgar"', () => {
    expect(parseFolgaAnswer('não vou folgar')).toEqual({ tipo: 'sem_folga' });
    expect(parseFolgaAnswer('sem folga')).toEqual({ tipo: 'sem_folga' });
    expect(parseFolgaAnswer('nao folgo')).toEqual({ tipo: 'sem_folga' });
  });
  it('domingo e invalido', () => {
    expect(parseFolgaAnswer('domingo')).toEqual({ tipo: 'invalido' });
  });
  it('texto irrelevante e invalido', () => {
    expect(parseFolgaAnswer('bom dia')).toEqual({ tipo: 'invalido' });
  });
});
