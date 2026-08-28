import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { Agent, type BookingInput } from '../src/agent.js';
import { loadCatalog } from '../src/catalog.js';
import { FakeAIProvider, bookingReply } from './helpers/fake-provider.js';
import { buildNotification } from '../src/notifier.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const JID = '5511888888888@s.whatsapp.net';
const tmpFiles: string[] = [];

function makeStore(): Store {
  const file = path.join(os.tmpdir(), `agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(file);
  return new Store(file);
}

function makeContext(provider: FakeAIProvider, onBookingConfirmed?: (i: BookingInput) => Promise<string>) {
  const store = makeStore();
  const sent: { jid: string; text: string }[] = [];
  const agent = new Agent({
    store,
    complete: (messages, opts) => provider.complete(messages, opts),
    sendText: async (jid, text) => {
      sent.push({ jid, text });
      return true;
    },
    onBookingConfirmed,
  });
  return { store, sent, agent, provider };
}

function futureWeekday(): string {
  for (let i = 3; i < 13; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (d.getDay() !== 0) {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${dd}`;
    }
  }
  return '2099-01-01';
}

describe('Agent — fluxo completo com agendamento', () => {
  it('mensagem de info responde com o catálogo', async () => {
    const provider = new FakeAIProvider([JSON.stringify({ intent: 'conversation', reply: 'O corte custa R$ 40,00!' })]);
    const ctx = makeContext(provider);
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'quanto custa o corte?', name: 'João' });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0]!.text).toContain('R$ 40,00');
  });

  it('cliente confirma → onBookingConfirmed recebe os dados validados', async () => {
    const date = futureWeekday();
    const provider = new FakeAIProvider([
      bookingReply({ requested: true, confirmed: true, service: 'Corte', date, time: '15:30', client_name: 'João' }),
    ]);
    const confirmed: BookingInput[] = [];
    const ctx = makeContext(provider, async (input) => {
      confirmed.push(input);
      return `confirmado: ${input.service} ${input.date} ${input.time}`;
    });

    await ctx.agent.handleInboundMessage({ jid: JID, text: 'pode confirmar', name: 'João' });

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.service).toBe('Corte');
    expect(ctx.sent[0]!.text).toContain('confirmado');
    expect(ctx.store.getPendingBooking(JID)).toBeNull();
  });

  it('LLM inventou serviço → NÃO chama onBookingConfirmed e responde corretivo', async () => {
    const provider = new FakeAIProvider([
      bookingReply({ requested: true, confirmed: true, service: 'Serviço Fantasma', date: futureWeekday(), time: '15:30', client_name: 'João' }),
    ]);
    const confirmed: BookingInput[] = [];
    const ctx = makeContext(provider, async (input) => {
      confirmed.push(input);
      return 'x';
    });

    await ctx.agent.handleInboundMessage({ jid: JID, text: 'quero o serviço fantasma', name: 'João' });

    expect(confirmed).toHaveLength(0);
    expect(ctx.sent[0]!.text).toContain('serviço');
  });

  it('confirmação com dados incompletos pede mais informações', async () => {
    const provider = new FakeAIProvider([
      bookingReply({ requested: true, confirmed: true, service: 'Corte', date: null, time: null, client_name: 'João' }),
    ]);
    const confirmed: BookingInput[] = [];
    const ctx = makeContext(provider, async (input) => {
      confirmed.push(input);
      return 'x';
    });

    await ctx.agent.handleInboundMessage({ jid: JID, text: 'confirma', name: 'João' });

    expect(confirmed).toHaveLength(0);
    expect(ctx.sent[0]!.text).toContain('data e horário');
  });

  it('JSON inválido cai no fallback sem quebrar', async () => {
    const provider = new FakeAIProvider(['não é json {{{', 'mais um erro']);
    const ctx = makeContext(provider);
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'oi?', name: 'João' });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0]!.text).toContain('Desculpe');
  });

  it('notificação gerada contém todos os dados', () => {
    const store = makeStore();
    const booking = store.addBooking({
      clientJid: JID,
      clientName: 'João',
      service: 'Corte',
      price: 40,
      date: '2026-09-04',
      time: '16:00',
    });
    const msg = buildNotification(booking);
    expect(msg).toContain('Cliente: João');
    expect(msg).toContain('Telefone: +55 (11) 88888-8888');
    expect(msg).toContain('Serviço: Corte');
    expect(msg).toContain('04/09/2026');
    expect(msg).toContain('16:00');
    expect(msg).toContain('Agendamento confirmado pelo cliente.');
  });

  it('anti-spam: duas mensagens em menos de 2s só geram uma resposta', async () => {
    const provider = new FakeAIProvider([
      JSON.stringify({ intent: 'conversation', reply: 'primeira' }),
      JSON.stringify({ intent: 'conversation', reply: 'segunda' }),
    ]);
    const ctx = makeContext(provider);
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'oi', name: 'João' });
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'oi de novo', name: 'João' });
    expect(ctx.sent).toHaveLength(1);
  });
});
