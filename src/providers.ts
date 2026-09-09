import type { ChatMessage } from './ai.js';

/**
 * Adaptadores de provedor de IA. Cada um implementa o mesmo contrato:
 *  - buildRequest(): monta URL, headers e corpo da chamada
 *  - parseResponse(): extrai o texto da resposta
 *
 * Para adicionar um novo provedor, basta criar um adaptador e registrá-lo
 * em PROVIDERS (e em AI_PROVIDER_IDS).
 */
export type AIProviderId = 'deepseek' | 'openai' | 'codex' | 'gemini';

export interface BuildRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
}

export interface ProviderAdapter {
  id: AIProviderId;
  label: string;
  defaultModel: string;
  buildRequest(apiKey: string, model: string, messages: ChatMessage[], opts: ChatRequestOpts, signal: AbortSignal): BuildRequest;
  parseResponse(data: unknown): string;
}

export interface ChatRequestOpts {
  json?: boolean;
  temperature?: number;
}

export interface ProviderSummary {
  id: AIProviderId;
  label: string;
  defaultModel: string;
}

// ---------- OpenAI-compatível (DeepSeek, OpenAI, Codex) ----------
function openAICompatible(
  id: AIProviderId,
  label: string,
  defaultModel: string,
  baseUrl: string,
): ProviderAdapter {
  return {
    id,
    label,
    defaultModel,
    buildRequest(apiKey, model, messages, opts, signal) {
      return {
        url: baseUrl,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens: 1500,
          stream: false,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal,
      };
    },
    parseResponse(data) {
      const d = data as { choices?: { message?: { content?: string } }[] };
      const content = d.choices?.[0]?.message?.content;
      if (!content) throw new Error('Resposta sem conteúdo.');
      return content;
    },
  };
}

// ---------- Google Gemini ----------
const gemini: ProviderAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  defaultModel: 'gemini-2.0-flash',
  buildRequest(apiKey, model, messages, opts, signal) {
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
    const system = messages.find((m) => m.role === 'system')?.content;
    const generationConfig: Record<string, unknown> = {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: 1500,
    };
    if (opts.json) generationConfig.responseMimeType = 'application/json';
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig,
      }),
      signal,
    };
  },
  parseResponse(data) {
    const d = data as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
    if (!text) throw new Error('Resposta sem conteúdo.');
    return text;
  },
};

export const PROVIDERS: Record<AIProviderId, ProviderAdapter> = {
  deepseek: openAICompatible('deepseek', 'DeepSeek', 'deepseek-chat', 'https://api.deepseek.com/chat/completions'),
  openai: openAICompatible('openai', 'OpenAI', 'gpt-4o-mini', 'https://api.openai.com/v1/chat/completions'),
  codex: openAICompatible('codex', 'OpenAI Codex', 'gpt-4o', 'https://api.openai.com/v1/chat/completions'),
  gemini,
};

export function isProviderId(value: string): value is AIProviderId {
  return value in PROVIDERS;
}

/** Retorna o adaptador do provedor; desconhecido cai no DeepSeek. */
export function getProvider(id: string): ProviderAdapter {
  return isProviderId(id) ? PROVIDERS[id] : PROVIDERS.deepseek;
}

export function listProviders(): ProviderSummary[] {
  return Object.values(PROVIDERS).map((p) => ({ id: p.id, label: p.label, defaultModel: p.defaultModel }));
}
