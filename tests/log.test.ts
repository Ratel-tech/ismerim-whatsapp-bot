import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { log, setLogFile } from '../src/log.js';

describe('log com arquivo injetavel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-test-'));

  it('escreve no arquivo configurado via setLogFile', () => {
    const file = path.join(dir, 'logs.txt');
    setLogFile(file);
    log('info', 'mensagem de teste');
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('INFO mensagem de teste');
  });

  it('nao toca no arquivo de producao quando redirecionado', () => {
    const prodFile = path.join(dir, 'producao.txt');
    fs.writeFileSync(prodFile, 'antes');
    setLogFile(path.join(dir, 'logs.txt'));
    log('warn', 'outra mensagem');
    expect(fs.readFileSync(prodFile, 'utf8')).toBe('antes');
  });
});
