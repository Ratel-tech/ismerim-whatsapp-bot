import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

dotenv.config({ path: path.join(ROOT, '.env') });

export const config = {
  port: Number(process.env.PORT ?? 3081),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  adminPhone: process.env.ADMIN_PHONE ?? '',
  dataDir: path.join(ROOT, 'data'),
  dbFile: path.join(ROOT, 'data', 'db.json'),
  logFile: path.join(ROOT, 'data', 'logs.txt'),
  catalogFile: path.join(ROOT, 'config', 'catalog.json'),
  agentFile: path.join(ROOT, 'config', 'agent.json'),
  sessionDir: path.join(ROOT, 'data', 'sessions'),
} as const;

/** Atualiza uma chave do arquivo .env (mantém as demais). */
export function updateEnv(key: string, value: string): void {
  const file = path.join(ROOT, '.env');
  let content = '';
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    /* arquivo ainda não existe */
  }
  const re = new RegExp(`^${key}=.*$`, 'm');
  const line = `${key}=${value}`;
  content = re.test(content) ? content.replace(re, line) : `${content.trimEnd()}\n${line}\n`;
  fs.writeFileSync(file, content, 'utf8');
}
