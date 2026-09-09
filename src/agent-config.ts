import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export interface AgentConfig {
  empresa: string;
  personalidade: string;
  instrucoes: string;
  /** Prompt personalizado / regras adicionais anexadas ao system prompt. */
  prompt_extra: string;
  boas_vindas: string;
  transferencia: string;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  empresa: 'Ismerim Barbearia — barbearia tradicional com atendimento de qualidade em corte, barba e cuidados masculinos.',
  personalidade:
    'Simpático, atencioso, descontraído e profissional. Trata o cliente pelo nome e usa tom de conversa natural de WhatsApp.',
  instrucoes:
    'Responda em português do Brasil, com mensagens curtas e diretas, usando emojis com moderação. Nunca informe dados que não estejam no catálogo.',
  prompt_extra: '',
  boas_vindas:
    'Olá! 😊 Sou o assistente virtual da Ismerim Barbearia. Posso te ajudar com serviços, preços, horários e agendamentos!',
  transferencia:
    'Sem problemas! Vou encaminhar você para o nosso atendente humano. Um momento, por favor. 🙌',
};

export function loadAgentConfig(file: string = config.agentFile): AgentConfig {
  try {
    return { ...DEFAULT_AGENT_CONFIG, ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AgentConfig>) };
  } catch {
    return { ...DEFAULT_AGENT_CONFIG };
  }
}

export function saveAgentConfig(cfg: AgentConfig, file: string = config.agentFile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
}
