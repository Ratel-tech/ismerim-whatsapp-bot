import { AiError, complete, parseAgentResponse } from './ai.js';
import { loadCatalog, resolveService } from './catalog.js';
import { buildSystemPrompt } from './prompt.js';
import { Store, type PendingBooking } from './store.js';
import { log } from './log.js';

const FALLBACK_REPLY = 'Desculpe, não consegui processar sua mensagem. Pode tentar de novo, por favor?';
const NOT_CONFIGURED_REPLY = 'Olá! Ainda estou sendo configurado. Tente novamente em instantes. 😊';

export interface BookingInput {
  jid: string;
  clientName: string | null;
  service: string;
  date: string;
  time: string;
}

export interface AgentOptions {
  store: Store;
  sendText(jid: string, text: string): Promise<boolean>;
  /**
   * Fase 2: valida, salva e notifica o agendamento confirmado.
   * Deve retornar a mensagem final enviada ao cliente.
   */
  onBookingConfirmed?(input: BookingInput): Promise<string>;
}

export class Agent {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly lastTurnAt = new Map<string, number>();

  constructor(private readonly opts: AgentOptions) {}

  async handleInboundMessage(input: { jid: string; text: string; name: string | null }): Promise<void> {
    const { jid, text } = input;
    const client = this.opts.store.upsertClient(jid, input.name);

    // anti-spam: no mínimo 2s entre respostas do mesmo cliente
    const last = this.lastTurnAt.get(jid) ?? 0;
    if (Date.now() - last < 2000) return;

    this.opts.store.addMessage(jid, 'cliente', text);
    const inFlight = this.inFlight.get(jid);
    if (inFlight) {
      log('warn', `Mensagem ignorada (turno anterior em andamento): ${jid}`);
      return;
    }

    const turn = this.runTurn(jid, client.name, text);
    this.inFlight.set(jid, turn);
    try {
      await turn;
    } finally {
      this.inFlight.delete(jid);
      this.lastTurnAt.set(jid, Date.now());
    }
  }

  private async runTurn(jid: string, clientName: string | null, text: string): Promise<void> {
    const catalog = loadCatalog();
    const pending = this.opts.store.getPendingBooking(jid);
    const system = buildSystemPrompt(catalog, {
      clientName,
      pendingBooking: pending ? JSON.stringify(pending) : null,
    });

    const history = this.opts.store.getMessages(jid, 12);
    const messages = [
      { role: 'system' as const, content: system },
      ...history.map((m) =>
        m.role === 'cliente'
          ? ({ role: 'user' as const, content: m.content } as const)
          : ({ role: 'assistant' as const, content: m.content } as const),
      ),
      { role: 'user' as const, content: text },
    ];

    let parsed: ReturnType<typeof parseAgentResponse> | null = null;
    let noKey = false;
    try {
      parsed = parseAgentResponse(await complete(messages, { json: true, temperature: 0.7 }));
      if (!parsed.ok) {
        log('warn', `Falha de parsing (1ª tentativa): ${parsed.reason}`);
        parsed = parseAgentResponse(await complete(messages, { json: true, temperature: 0.2 }));
      }
    } catch (err) {
      noKey = err instanceof AiError && err.kind === 'no_api_key';
      log('error', `Erro na chamada à IA: ${(err as Error).message}`);
      parsed = null;
    }

    if (!parsed?.ok) {
      await this.reply(jid, noKey ? NOT_CONFIGURED_REPLY : FALLBACK_REPLY);
      return;
    }

    const data = parsed.data;
    let reply = data.reply;

    if (data.intent === 'transferir') {
      reply = 'Sem problemas! Vou encaminhar você para o nosso atendente humano. Um momento, por favor. 🙌';
    } else if (data.booking.requested) {
      const b = data.booking;
      const draft: PendingBooking = { service: b.service, date: b.date, time: b.time, client_name: b.client_name };

      if (b.confirmed) {
        const service = resolveService(catalog, b.service);
        if (!service) {
          reply = 'Desculpe, não identifiquei esse serviço. Poderia me dizer qual dos nossos serviços você gostaria?';
          log('warn', `Agendamento rejeitado: serviço inventado "${b.service}"`);
        } else if (!b.date || !b.time) {
          reply = 'Para confirmar, preciso do serviço, data e horário. Pode me passar?';
        } else if (this.opts.onBookingConfirmed) {
          reply = await this.opts.onBookingConfirmed({
            jid,
            clientName: b.client_name ?? clientName,
            service: service.nome,
            date: b.date,
            time: b.time,
          });
          this.opts.store.setPendingBooking(jid, null);
        } else {
          reply = `✅ Recebemos seu pedido de agendamento!\n\n✂️ Serviço: ${service.nome}\n📅 Data: ${b.date}\n🕒 Horário: ${b.time}\n\nEm instantes nossa equipe confirma com você. 😉`;
          log('info', `PEDIDO DE AGENDAMENTO (sem notificação): ${clientName ?? '?'} | ${service.nome} | ${b.date} ${b.time}`);
          this.opts.store.setPendingBooking(jid, null);
        }
      } else {
        this.opts.store.setPendingBooking(jid, draft);
      }
    }

    await this.reply(jid, reply);
  }

  private async reply(jid: string, text: string): Promise<void> {
    this.opts.store.addMessage(jid, 'bot', text);
    const sent = await this.opts.sendText(jid, text);
    if (!sent) log('warn', `WhatsApp desconectado; resposta não enviada para ${jid}`);
  }
}
