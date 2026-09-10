import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import { Agent, type BookingInput, type CancelBookingInput, type RescheduleBookingInput } from '../src/agent.js';
import { FakeAIProvider, bookingReply } from './helpers/fake-provider.js';
import { buildNotification } from '../src/notifier.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const JID = '5511888888888@s.whatsapp.net';
const tmpFiles: string[] = [];

afterEach(() => {
  for (const f of tmpFiles.splice(0)) fs.rmSync(f, { force: true });
});

function makeStore(): Store {
  const file = path.join(os.tmpdir(), `agent-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  tmpFiles.push(file);
  return new Store(file);
}

function makeContext(
  provider: FakeAIProvider,
  onBookingConfirmed?: (i: BookingInput) => Promise<string>,
  onTransfer?: (input: { jid: string; clientName: string | null }) => void,
  onCancelBooking?: (i: CancelBookingInput) => Promise<string>,
  onRescheduleBooking?: (i: RescheduleBookingInput) => Promise<string>,
) {
  const store = makeStore();
  const sent: { jid: string; text: string }[] = [];
  const agent = new Agent({
    store,
    complete: (messages, opts) => provider.complete(messages, opts),
    sendText: async (jid, text) => {
      sent.push({ jid, text });
      return true;
    },
    debounceMs: 0,
    onBookingConfirmed,
    onTransfer,
    onCancelBooking,
    onRescheduleBooking,
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
    expect(ctx.sent[0]?.text).toContain('R$ 40,00');
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
    expect(confirmed[0]?.service).toBe('Corte');
    expect(ctx.sent[0]?.text).toContain('confirmado');
    expect(ctx.store.getPendingBooking(JID)).toBeNull();
  });

  it('cliente confirma com profissional → onBookingConfirmed recebe o profissional', async () => {
    const date = futureWeekday();
    const provider = new FakeAIProvider([
      bookingReply({ requested: true, confirmed: true, service: 'Corte', date, time: '15:30', client_name: 'João', professional: 'Juan' }),
    ]);
    const confirmed: BookingInput[] = [];
    const ctx = makeContext(provider, async (input) => {
      confirmed.push(input);
      return 'ok';
    });

    await ctx.agent.handleInboundMessage({ jid: JID, text: 'com o Juan, pode confirmar', name: 'João' });

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]?.professional).toBe('Juan');
  });

  it('agendamento em andamento (não confirmado) guarda o profissional na pendência', async () => {
    const date = futureWeekday();
    const provider = new FakeAIProvider([
      bookingReply({ requested: true, confirmed: false, service: 'Corte', date, time: '15:30', client_name: 'João', professional: 'Geani' }),
    ]);
    const ctx = makeContext(provider);
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'quero com a Geani', name: 'João' });
    expect(ctx.store.getPendingBooking(JID)?.professional).toBe('Geani');
  });

  it('confirmar cancelamento dispara onCancelBooking com data/hora', async () => {
    const date = futureWeekday();
    const provider = new FakeAIProvider([
      bookingReply({ requested: true, confirmed: true, acao: 'cancelar', service: 'Corte', date, time: '15:30', client_name: 'João' }),
    ]);
    const cancels: unknown[] = [];
    const ctx = makeContext(
      provider,
      undefined,
      undefined,
      async (input) => {
        cancels.push(input);
        return 'Seu agendamento foi cancelado!';
      },
    );
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'pode cancelar', name: 'João' });
    expect(cancels).toHaveLength(1);
    expect((cancels[0] as { date: string }).date).toBe(date);
    expect((cancels[0] as { time: string }).time).toBe('15:30');
    expect(ctx.sent[0]?.text).toContain('cancelado');
  });

  it('cancelamento sem data/hora NÃO chama o backend (pede o horário)', async () => {
    const provider = new FakeAIProvider([
      bookingReply({ requested: true, confirmed: true, acao: 'cancelar', service: 'Corte', date: null, time: null, client_name: 'João' }),
    ]);
    let called = 0;
    const ctx = makeContext(
      provider,
      undefined,
      undefined,
      async () => {
        called += 1;
        return 'x';
      },
    );
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'quero cancelar', name: 'João' });
    expect(called).toBe(0);
    expect(ctx.sent[0]?.text).toContain('Qual horário');
  });

  it('confirmar remarcação dispara onRescheduleBooking com original e novo horário', async () => {
    const originalDate = futureWeekday();
    const novaDate = futureWeekday();
    const provider = new FakeAIProvider([
      bookingReply({ requested: true, confirmed: true, acao: 'remarcar', service: 'Corte', date: novaDate, time: '17:00', original_date: originalDate, original_time: '15:30', client_name: 'João' }),
    ]);
    const reschedules: unknown[] = [];
    const ctx = makeContext(
      provider,
      undefined,
      undefined,
      undefined,
      async (input) => {
        reschedules.push(input);
        return 'Remarcado!';
      },
    );
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'pode remarcar', name: 'João' });
    expect(reschedules).toHaveLength(1);
    const r = reschedules[0] as { date: string; originalDate: string; originalTime: string };
    expect(r.date).toBe(novaDate);
    expect(r.originalDate).toBe(originalDate);
    expect(r.originalTime).toBe('15:30');
    expect(ctx.sent[0]?.text).toContain('Remarcado');
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
    expect(ctx.sent[0]?.text).toContain('serviço');
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
    expect(ctx.sent[0]?.text).toContain('data e horário');
  });

  it('JSON inválido cai no fallback sem quebrar', async () => {
    const provider = new FakeAIProvider(['não é json {{{', 'mais um erro']);
    const ctx = makeContext(provider);
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'oi?', name: 'João' });
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0]?.text).toContain('Desculpe');
  });

  it('fallback orienta o cliente sobre o que o bot pode fazer', async () => {
    const provider = new FakeAIProvider(['não é json {{{', 'mais um erro']);
    const ctx = makeContext(provider);
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'quantos profissionais trabalham aí?', name: 'João' });
    expect(ctx.sent[0]?.text).toContain('Posso te ajudar com serviços, preços, horários e agendamento');
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

  it('intent finalizar limpa o agendamento pendente', async () => {
    const ctx = makeContext(new FakeAIProvider([JSON.stringify({ intent: 'finalizar', reply: 'Até logo!', booking: {} })]));
    ctx.store.setPendingBooking(JID, { service: 'Corte', date: '2026-09-10', time: '10:00', client_name: 'João' });
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'só isso, obrigado', name: 'João' });
    expect(ctx.store.getPendingBooking(JID)).toBeNull();
    expect(ctx.sent[0]?.text).toBe('Até logo!');
  });

  it('intent transferir dispara onTransfer com jid e nome', async () => {
    const transfers: { jid: string; clientName: string | null }[] = [];
    const ctx = makeContext(
      new FakeAIProvider([JSON.stringify({ intent: 'transferir', reply: 'ok', booking: {} })]),
      undefined,
      (t) => transfers.push(t),
    );
    await ctx.agent.handleInboundMessage({ jid: JID, text: 'quero falar com um humano', name: 'João' });
    expect(transfers).toHaveLength(1);
    expect(transfers[0]?.jid).toBe(JID);
    expect(transfers[0]?.clientName).toBe('João');
  });
});
