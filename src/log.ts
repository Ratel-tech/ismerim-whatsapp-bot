import fs from 'node:fs';
import { config } from './config.js';

let logFile = config.logFile;

/** Redireciona o log em arquivo (usado pelos testes para nao poluir data/logs.txt). */
export function setLogFile(file: string): void {
  logFile = file;
}

export function log(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    /* log em arquivo é best-effort */
  }
}
