import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));

const envFile = path.join(ROOT, '.env');

dotenv.config({ path: envFile });

export interface AppConfig {
  port: number;
  /** Provedor de IA ativo: deepseek | openai | codex | gemini. */
  aiProvider: string;
  /** Chave da API do provedor (AI_API_KEY, com fallback p/ DEEPSEEK_API_KEY). */
  aiApiKey: string;
  /** Modelo do provedor (AI_MODEL, com fallback p/ DEEPSEEK_MODEL). */
  aiModel: string;
  /** Transcrição de áudio (STT) via endpoint OpenAI-compatível (/audio/transcriptions). */
  transcribeEnabled: boolean;
  transcribeApiKey: string;
  transcribeBaseUrl: string;
  transcribeModel: string;
  adminPhone: string;
  panelToken: string;
  dataDir: string;
  dbFile: string;
  logFile: string;
  catalogFile: string;
  agentFile: string;
  sessionDir: string;
  broadcastFile: string;
  broadcastStateFile: string;
}

/** Configuração em memória; chaves selecionadas podem ser atualizadas em runtime (ver updateEnv). */
export const config: AppConfig = {
  port: Number(process.env.PORT ?? 3081),
  aiProvider: process.env.AI_PROVIDER ?? 'deepseek',
  aiApiKey: process.env.AI_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '',
  aiModel: process.env.AI_MODEL ?? process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
  transcribeEnabled: process.env.TRANSCRIBE_ENABLED !== 'false',
  transcribeApiKey: process.env.TRANSCRIBE_API_KEY ?? '',
  transcribeBaseUrl: process.env.TRANSCRIBE_BASE_URL ?? 'https://api.openai.com/v1/audio/transcriptions',
  transcribeModel: process.env.TRANSCRIBE_MODEL ?? 'whisper-1',
  adminPhone: process.env.ADMIN_PHONE ?? '',
  panelToken: process.env.PANEL_TOKEN ?? '',
  dataDir: path.join(ROOT, 'data'),
  dbFile: path.join(ROOT, 'data', 'db.json'),
  logFile: path.join(ROOT, 'data', 'logs.txt'),
  catalogFile: path.join(ROOT, 'config', 'catalog.json'),
  agentFile: path.join(ROOT, 'config', 'agent.json'),
  sessionDir: path.join(ROOT, 'data', 'sessions'),
  broadcastFile: path.join(ROOT, 'config', 'broadcast.json'),
  broadcastStateFile: path.join(ROOT, 'data', 'broadcast-state.json'),
};

/** Chaves cujo valor salvo no .env também é refletido em memória (sem reiniciar). */
const LIVE_KEYS: Record<string, (value: string) => void> = {
  ADMIN_PHONE: (value) => {
    config.adminPhone = value;
  },
  AI_PROVIDER: (value) => {
    config.aiProvider = value;
  },
  AI_API_KEY: (value) => {
    config.aiApiKey = value;
  },
  AI_MODEL: (value) => {
    config.aiModel = value;
  },
  TRANSCRIBE_API_KEY: (value) => {
    config.transcribeApiKey = value;
  },
  TRANSCRIBE_BASE_URL: (value) => {
    config.transcribeBaseUrl = value;
  },
  TRANSCRIBE_MODEL: (value) => {
    config.transcribeModel = value;
  },
};

/**
 * Atualiza uma chave do arquivo .env (mantém as demais).
 * Para chaves em LIVE_KEYS, também atualiza a configuração em memória —
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
  LIVE_KEYS[key]?.(value);
}
