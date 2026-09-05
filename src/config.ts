import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

const envFile = path.join(ROOT, '.env');

dotenv.config({ path: envFile });

export interface AppConfig {
  port: number;
  deepseekApiKey: string;
  deepseekModel: string;
  adminPhone: string;
  panelToken: string;
  dataDir: string;
  dbFile: string;
  logFile: string;
  catalogFile: string;
  agentFile: string;
  sessionDir: string;
}

/** Configuração em memória; adminPhone pode ser atualizado em runtime (ver updateEnv). */
export const config: AppConfig = {
  port: Number(process.env.PORT ?? 3081),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  adminPhone: process.env.ADMIN_PHONE ?? '',
  panelToken: process.env.PANEL_TOKEN ?? '',
  dataDir: path.join(ROOT, 'data'),
  dbFile: path.join(ROOT, 'data', 'db.json'),
  logFile: path.join(ROOT, 'data', 'logs.txt'),
  catalogFile: path.join(ROOT, 'config', 'catalog.json'),
  agentFile: path.join(ROOT, 'config', 'agent.json'),
  sessionDir: path.join(ROOT, 'data', 'sessions'),
};

/**
 * Atualiza uma chave do arquivo .env (mantém as demais).
 * Para ADMIN_PHONE, também atualiza a configuração em memória —
 * salvar pela UI passa a valer sem reiniciar o processo.
 */
export function updateEnv(key: string, value: string, file: string = envFile): void {
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
  if (key === 'ADMIN_PHONE') {
    config.adminPhone = value;
  }
}
