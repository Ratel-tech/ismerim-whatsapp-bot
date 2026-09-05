import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { config, updateEnv } from '../src/config.js';

describe('config/updateEnv', () => {
  it('grava chave e preserva as demais linhas (arquivo custom)', () => {
    const file = path.join(os.tmpdir(), `.env-test-${Date.now()}-${Math.random().toString(36).slice(2)}.env`);
    fs.writeFileSync(file, 'PORT=3081\nDEEPSEEK_API_KEY=x\n');
    updateEnv('OUTRA_CHAVE', 'valor', file);
    const c = fs.readFileSync(file, 'utf8');
    expect(c).toContain('PORT=3081');
    expect(c).toContain('DEEPSEEK_API_KEY=x');
    expect(c).toContain('OUTRA_CHAVE=valor');
    fs.rmSync(file, { force: true });
  });

  it('substitui valor existente sem duplicar a linha', () => {
    const file = path.join(os.tmpdir(), `.env-test-${Date.now()}-${Math.random().toString(36).slice(2)}.env`);
    fs.writeFileSync(file, 'ADMIN_PHONE=111\n');
    updateEnv('ADMIN_PHONE', '222', file);
    const c = fs.readFileSync(file, 'utf8');
    expect(c.match(/ADMIN_PHONE=/g)).toHaveLength(1);
    expect(c).toContain('ADMIN_PHONE=222');
    fs.rmSync(file, { force: true });
  });

  it('ADMIN_PHONE atualiza o valor em memoria (sem reiniciar)', () => {
    const prev = config.adminPhone;
    try {
      const file = path.join(os.tmpdir(), `.env-test-${Date.now()}-${Math.random().toString(36).slice(2)}.env`);
      fs.writeFileSync(file, 'PORT=3081\n');
      updateEnv('ADMIN_PHONE', '5511888888888', file);
      expect(config.adminPhone).toBe('5511888888888');
      fs.rmSync(file, { force: true });
    } finally {
      config.adminPhone = prev;
    }
  });
});
