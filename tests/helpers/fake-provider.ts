import type { ChatMessage } from '../../src/ai.js';

export class FakeAIProvider {
  calls = 0;
  private queue: string[] = [];

  constructor(responses: string[] = []) {
    this.queue = [...responses];
  }

  async complete(_messages: ChatMessage[], _opts?: { json?: boolean; temperature?: number }): Promise<string> {
    this.calls += 1;
    const next = this.queue.shift();
    if (next !== undefined) return next;
    return JSON.stringify({ intent: 'conversation', reply: 'Olá! Como posso ajudar?' });
  }
}

export function bookingReply(partial: Record<string, unknown> = {}): string {
  return JSON.stringify({
    intent: 'booking',
    reply: 'Perfeito, vamos confirmar!',
    booking: {
      requested: true,
      confirmed: false,
      service: null,
      date: null,
      time: null,
      client_name: null,
      ...partial,
    },
  });
}
