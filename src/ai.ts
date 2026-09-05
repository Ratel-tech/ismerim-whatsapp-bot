import { z } from 'zod';
import { config } from './config.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class AiError extends Error {
  constructor(
    public readonly kind: 'no_api_key' | 'http' | 'rate_limit' | 'timeout' | 'invalid_response',
    message: string,
  ) {
    super(message);
    this.name = 'AiError';
  }
}

export async function complete(messages: ChatMessage[], opts: { json?: boolean; temperature?: number } = {}): Promise<string> {
  if (!config.deepseekApiKey) {
    throw new AiError('no_api_key', 'Chave da API DeepSeek não configurada no .env.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseekApiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.deepseekModel,
        messages,
        temperature: opts.temperature ?? 0.7,
        max_tokens: 1500,
        stream: false,
        ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AiError('http', `DeepSeek HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new AiError('invalid_response', 'Resposta sem conteúdo.');
    return content;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if ((err as Error).name === 'AbortError') throw new AiError('timeout', 'Tempo esgotado.');
    throw new AiError('http', `Falha na chamada: ${(err as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- parsing / validação da resposta estruturada ----------

const bookingSchema = z
  .object({
    requested: z.boolean().default(false),
    confirmed: z.boolean().default(false),
    service: z.string().nullable().default(null),
    date: z.string().nullable().default(null),
    time: z.string().nullable().default(null),
    client_name: z.string().nullable().default(null),
  })
  .strict();

const agentResponseSchema = z
  .object({
    intent: z.enum(['conversation', 'booking', 'transferir', 'finalizar']).default('conversation'),
    reply: z.string().min(1),
    booking: bookingSchema.default({}),
  })
  .strict();

export type ParsedAgentResponse = z.infer<typeof agentResponseSchema>;

export type ParseResult = { ok: true; data: ParsedAgentResponse; raw: string } | { ok: false; reason: string; raw: string };

function extractJson(raw: string): string {
  const trimmed = raw.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    /* tenta extrair bloco */
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('nenhum JSON');
  const candidate = trimmed.slice(start, end + 1);
  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    throw new Error('JSON inválido');
  }
}

export function parseAgentResponse(raw: string): ParseResult {
  let json: string;
  try {
    json = extractJson(raw);
  } catch (err) {
    return { ok: false, reason: (err as Error).message, raw };
  }
  const parsed = JSON.parse(json) as unknown;
  const result = agentResponseSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: result.error.issues.map((i) => `${i.path.join('.')} -> ${i.message}`).join('; '),
      raw,
    };
  }
  const data = result.data;
  data.booking.service = data.booking.service?.trim() || null;
  data.booking.date = data.booking.date?.trim() || null;
  data.booking.time = data.booking.time?.trim() || null;
  data.booking.client_name = data.booking.client_name?.trim() || null;
  if (data.booking.date && /^\d{2}\/\d{2}\/\d{4}$/.test(data.booking.date)) {
    const [d, m, y] = data.booking.date.split('/');
    data.booking.date = `${y}-${m}-${d}`;
  }
  if (data.booking.time && /^\d{1,2}:\d{2}$/.test(data.booking.time)) {
    const [h, m] = data.booking.time.split(':');
    data.booking.time = `${h?.padStart(2, '0')}:${m}`;
  }
  return { ok: true, data, raw };
}
