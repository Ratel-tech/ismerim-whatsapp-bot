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
  sessionDir: path.join(ROOT, 'data', 'sessions'),
} as const;
