import { config } from './config.js';

/** STT habilitado se a flag não desativou e há chave configurada. */
export function isTranscribeEnabled(): boolean {
  return config.transcribeEnabled && Boolean(config.transcribeApiKey.trim());
}

/** Extensão de arquivo de áudio a partir do mimetype (padrão ogg, usado pelo WhatsApp). */
export function audioExtension(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mp3')) return 'mp3';
  if (m.includes('mp4') || m.includes('m4a')) return 'm4a';
  return 'ogg';
}

/**
 * Transcreve um buffer de áudio por endpoint OpenAI-compatível
 * (/audio/transcriptions). Funciona com OpenAI Whisper, Groq e afins.
 */
export async function transcribeAudio(buffer: Buffer, filename: string, mimeType: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType.split(';')[0]?.trim() || 'audio/ogg' }), filename);
  form.append('model', config.transcribeModel);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(config.transcribeBaseUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.transcribeApiKey}` },
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Transcrição HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { text?: string };
    return data.text?.trim() ?? '';
  } finally {
    clearTimeout(timeout);
  }
}
