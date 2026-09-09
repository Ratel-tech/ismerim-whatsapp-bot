import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_CONFIG,
  loadAgentConfig,
  saveAgentConfig,
} from '../src/agent-config.js';
import { buildSystemPrompt } from '../src/prompt.js';
import { loadCatalog } from '../src/catalog.js';

const tmpFiles: string[] = [];
function tmpFile(): string {
  const f = path.join(os.tmpdir(), `agentcfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(f);
  return f;
}
afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

describe('agent-config', () => {
  it('retorna defaults quando o arquivo não existe', () => {
    const cfg = loadAgentConfig(tmpFile());
    expect(cfg.empresa).toContain('Ismerim');
    expect(cfg.transferencia.length).toBeGreaterThan(10);
  });

  it('salva e carrega configuração personalizada', () => {
    const file = tmpFile();
    saveAgentConfig({ ...DEFAULT_AGENT_CONFIG, personalidade: 'Muito formal e técnico.' }, file);
    const cfg = loadAgentConfig(file);
    expect(cfg.personalidade).toBe('Muito formal e técnico.');
  });

  it('mescla com defaults quando faltam campos', () => {
    const file = tmpFile();
    fs.writeFileSync(file, JSON.stringify({ personalidade: 'Só personalidade' }));
    const cfg = loadAgentConfig(file);
    expect(cfg.personalidade).toBe('Só personalidade');
    expect(cfg.empresa).toContain('Ismerim');
  });

  it('o prompt incorpora a personalidade e instruções configuradas', () => {
    const catalog = loadCatalog();
    const prompt = buildSystemPrompt(
      catalog,
      { ...DEFAULT_AGENT_CONFIG, personalidade: 'PERSONALIDADE-X', instrucoes: 'INSTRUCAO-Y', empresa: 'EMPRESA-Z' },
      { clientName: 'João', pendingBooking: null },
    );
    expect(prompt).toContain('PERSONALIDADE-X');
    expect(prompt).toContain('INSTRUCAO-Y');
    expect(prompt).toContain('EMPRESA-Z');
    expect(prompt).toContain('Corte');
    expect(prompt).toContain('R$');
  });

  it('o prompt anexa o campo prompt_extra do agente', () => {
    const catalog = loadCatalog();
    const prompt = buildSystemPrompt(
      catalog,
      { ...DEFAULT_AGENT_CONFIG, prompt_extra: 'Nunca ofereça descontos e sempre peça desculpas.' },
      { clientName: 'João', pendingBooking: null },
    );
    expect(prompt).toContain('Prompt personalizado');
    expect(prompt).toContain('Nunca ofereça descontos e sempre peça desculpas.');
  });

  it('config real nao contem caracteres corrompidos (U+FFFD)', () => {
    const cfg = loadAgentConfig();
    for (const v of Object.values(cfg)) {
      expect(v).not.toContain('\uFFFD');
    }
  });
});
