import fs from 'node:fs';
import { config } from './config.js';

export function log(level: 'info' | 'warn' | 'error', message: string): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(config.logFile, `${line}\n`);
  } catch {
    /* log em arquivo é best-effort */
  }
}
