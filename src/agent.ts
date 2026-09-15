import { AiError, complete, parseAgentResponse, type ChatMessage, type ParsedAgentResponse } from './ai.js';
import { loadCatalog, resolveService } from './catalog.js';
import { loadAgentConfig } from './agent-config.js';
import { buildOperatorPrompt, buildSystemPrompt } from './prompt.js';
import { resolverPapel, type PapelResolvido } from './papeis.js';
import type { Store, PendingBooking } from './store.js';
import { log } from './log.js';

const FALLBACK_REPLY =
  'Desculpe, não consegui processar sua mensagem. Pode tentar de novo, por favor? 🙂 Posso te ajudar com serviços, preços, horários e agendamento.';
const NOT_CONFIGURED_REPLY = 'Olá! Ainda estou sendo configurado. Tente novamente em instantes. 😊';

export interface BookingInput {
  jid: string;
  clientName: string | null;
  service: string;
  professional: string | null;
  date: string;
  time: string;
}

export interface CancelBookingInput {
  jid: string;
  clientName: string | null;
  service: string | null;
  date: string;
  time: string;
}

export interface RescheduleBookingInput {
  jid: string;
  clientName: string | null;
  service: string | null;
  professional: string | null;
  date: string; // novo horário
  time: string;
  originalDate: string; // horário atual a ser remarcado
  originalTime: string;
}

export interface ListAgendaInput {
  jid: string;
  papel: 'admin' | 'profissional';
  profissionalId: number | null;
}

export interface OperatorCreateInput {
  jid: string;
  papel: 'admin' | 'profissional';
  profissionalId: number | null;
  clientName: string;
  clientPhone: string | null;
  service: string;
  date: string;
  time: string;
  professional: string | null;
}

export interface MarkDoneInput {
  jid: string;
  papel: 'admin' | 'profissional';
  profissionalId: number | null;
  service: string | null;
  date: string;
  time: string;
}

export interface AgentOptions {
  store: Store;
  sendText(jid: string, text: string): Promise<boolean>;
  /** Injetável para testes; padrão: chamada real ao DeepSeek. */
  complete?(messages: ChatMessage[], opts?: { json?: boolean; temperature?: number }): Promise<string>;
  /**
   * Fase 2: valida, salva e notifica o agendamento confirmado.
   * Deve retornar a mensagem final enviada ao cliente.
   */
  onBookingConfirmed?(input: BookingInput): Promise<string>;
  /**
   * Disparado quando o cliente pede para falar com um humano (intent "transferir").
   */
  onTransfer?(input: { jid: string; clientName: string | null }): void;
  /** Confirmação de CANCELAMENTO (backend executa; retorna msg final ao cliente). */
  onCancelBooking?(input: CancelBookingInput): Promise<string>;
  /** Confirmação de REMARCAÇÃO (backend executa; retorna msg final ao cliente). */
  onRescheduleBooking?(input: RescheduleBookingInput): Promise<string>;
  /** Telefone do ADMIN (para identificar o papel de quem fala). */
  adminPhone?: string;
  /** Operador (admin/barbeiro) pediu para VER os agendamentos. */
  onListAgenda?(input: ListAgendaInput): Promise<string>;
  /** Operador (admin/barbeiro) criou um agendamento para um cliente. */
  onOperatorCreate?(input: OperatorCreateInput): Promise<string>;
  /** Operador marcou um agendamento como feito. */
  onMarkDone?(input: MarkDoneInput): Promise<string>;
  /** Tempo (ms) de pausa após um humano responder; passou disso, o agente retoma. 0 = nunca. */
  humanPauseMs?: number;
  /**
   * Agrupa mensagens picadas: espera este tempo (ms) de silêncio antes de
   * responder, juntando os fragmentos. `<= 0` desativa (responde na hora).
   */
  debounceMs?: number;
  /** Teto (ms) desde o primeiro fragmento de uma rajada, para não esperar indefinidamente. */
  maxWaitMs?: number;
  /** Tempo (ms) para responder depois que o cliente para de digitar ("paused"). */
  graceMs?: number;
}

/** Presença do contato no chat (subconjunto do WAPresence do Baileys). */
export type TypingPresence = 'composing' | 'recording' | 'paused' | 'available' | 'unavailable';

interface PendingBuffer {
  parts: string[];
  name: string | null;
  phone: string | null;
  timer: NodeJS.Timeout | null;
  firstAt: number;
  /** O cliente está digitando agora (presence "composing"). */
  typing: boolean;
  /** Já recebemos algum sinal de presença (para distinguir do fallback). */
  sawPresence: boolean;
}

export class Agent {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly lastTurnAt = new Map<string, number>();
  private readonly debounceMs: number;
  private readonly maxWaitMs: number;
  private readonly graceMs: number;
  private readonly humanPauseMs: number;
  private readonly buffers = new Map<string, PendingBuffer>();

  constructor(private readonly opts: AgentOptions) {
    this.debounceMs = opts.debounceMs ?? 2000;
    this.maxWaitMs = opts.maxWaitMs ?? 15000;
    this.graceMs = opts.graceMs ?? 1000;
    this.humanPauseMs = opts.humanPauseMs ?? 30 * 60_000;
  }

  async handleInboundMessage(input: { jid: string; text: string; name: string | null; phone?: string | null }): Promise<void> {
    const { jid, text } = input;
    const client = this.opts.store.upsertClient(jid, input.name);

    // Atendimento humano ativo: registra a mensagem, mas o bot não responde —
    // a menos que o tempo de pausa já tenha passado (aí o agente retoma).
    const atual = this.opts.store.getClient(jid);
    if (atual?.needsHuman) {
      const since = atual.humanSince ?? 0;
      const expirou = this.humanPauseMs > 0 && since > 0 && Date.now() - since >= this.humanPauseMs;
      if (!expirou) {
        log('info', `Atendimento humano ativo para ${jid}; resposta automática pausada.`);
        this.opts.store.addMessage(jid, 'cliente', text);
        this.lastTurnAt.set(jid, Date.now());
        return;
      }
      log('info', `Pausa de atendimento humano expirou; agente retomando para ${jid}.`);
      this.opts.store.setHuman(jid, false);
    }

    // Sem agrupamento: processa imediatamente (com anti-spam de 2s).
    if (this.debounceMs <= 0) {
      const last = this.lastTurnAt.get(jid) ?? 0;
      if (Date.now() - last < 2000) return;
      this.opts.store.addMessage(jid, 'cliente', text);
      await this.processTurn(jid, client.name, text, input.phone ?? null);
      return;
    }

    // Com agrupamento: acumula os fragmentos e responde após o silêncio.
    const buf = this.buffers.get(jid) ?? { parts: [], name: null, phone: null, timer: null, firstAt: Date.now(), typing: false, sawPresence: false };
    buf.parts.push(text);
    buf.name = input.name ?? buf.name;
    buf.phone = input.phone ?? buf.phone;
    this.buffers.set(jid, buf);
    this.scheduleFlush(jid);
  }

  /**
   * Sinal de presença do contato (ex.: "digitando..."). Enquanto o cliente
   * digita, o bot segura a resposta; ao parar, responde após `graceMs`.
   */
  handlePresence(jid: string, presence: TypingPresence): void {
    const buf = this.buffers.get(jid);
    if (!buf) return;
    if (presence === 'composing' || presence === 'recording') {
      buf.typing = true;
    } else {
      buf.typing = false;
      buf.sawPresence = true;
    }
    this.scheduleFlush(jid);
  }

  /** (Re)agenda o processamento do buffer respeitando presença, debounce e o teto máximo. */
  private scheduleFlush(jid: string): void {
    const buf = this.buffers.get(jid);
    if (!buf) return;
    if (buf.timer) clearTimeout(buf.timer);
    const elapsed = Date.now() - buf.firstAt;
    const remainingCap = Math.max(0, this.maxWaitMs - elapsed);
    const base = buf.typing ? remainingCap : buf.sawPresence ? this.graceMs : this.debounceMs;
    const delay = Math.min(base, remainingCap);
    const timer = setTimeout(() => {
      buf.timer = null;
      // Se a IA ainda está respondendo, o término do turno reagenda o flush.
      if (this.inFlight.has(jid)) return;
      void this.flushBuffer(jid).catch((err) => log('error', `Erro ao processar mensagens de ${jid}: ${(err as Error).message}`));
    }, delay);
    const maybeUnref = timer as unknown as { unref?: () => void };
    if (typeof maybeUnref.unref === 'function') maybeUnref.unref();
    buf.timer = timer;
  }

  /** Junta os fragmentos do buffer e roda um turno com o texto combinado. */
  private async flushBuffer(jid: string): Promise<void> {
    const buf = this.buffers.get(jid);
    if (!buf || buf.parts.length === 0) return;
    const text = buf.parts.join(' ').replace(/\s+/g, ' ').trim();
    const name = buf.name;
    const phone = buf.phone;
    this.buffers.delete(jid);
    if (!text) return;
    this.opts.store.addMessage(jid, 'cliente', text);
    await this.processTurn(jid, name, text, phone);
  }

  /** Roda um turno com exclusão mútua por cliente e reagenda se houver buffer pendente. */
  private async processTurn(jid: string, name: string | null, text: string, phone: string | null): Promise<void> {
    const turn = this.runTurn(jid, name, text, phone);
    this.inFlight.set(jid, turn);
    try {
      await turn;
    } finally {
      this.inFlight.delete(jid);
      this.lastTurnAt.set(jid, Date.now());
      if ((this.buffers.get(jid)?.parts.length ?? 0) > 0) this.scheduleFlush(jid);
    }
  }

  private async runTurn(jid: string, clientName: string | null, text: string, phone: string | null): Promise<void> {
    const catalog = loadCatalog();
    const agentCfg = loadAgentConfig();
    const pending = this.opts.store.getPendingBooking(jid);
    const papelResolvido = resolverPapel({
      jid,
      phone,
      adminPhone: this.opts.adminPhone ?? '',
      profissionais: this.opts.store.listProfissionais(),
      vinculos: this.opts.store.listVinculos(),
    });
    const system =
      papelResolvido.papel === 'cliente'
        ? buildSystemPrompt(catalog, agentCfg, {
            clientName,
            pendingBooking: pending ? JSON.stringify(pending) : null,
            profissionais: this.opts.store.listProfissionaisPublic(),
            clientBookings: this.opts.store
              .listBookingsByClient(jid)
              .filter((bk) => bk.status === 'confirmado')
              .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
              .map((bk) => ({ date: bk.date, time: bk.time, service: bk.service, professionalName: bk.professionalName ?? null })),
          })
        : buildOperatorPrompt(catalog, agentCfg, {
            papel: papelResolvido.papel,
            profissionalNome: papelResolvido.profissionalNome,
            profissionais: this.opts.store.listProfissionaisPublic(),
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
    const call = this.opts.complete ?? complete;
    try {
      parsed = parseAgentResponse(await call(messages, { json: true, temperature: 0.7 }));
      if (!parsed.ok) {
        log('warn', `Falha de parsing (1ª tentativa): ${parsed.reason}`);
        // retry com lembrete explícito do contrato JSON
        parsed = parseAgentResponse(
          await call(
            [
              ...messages,
              { role: 'user', content: 'ATENÇÃO: responda APENAS com o objeto JSON no formato especificado, sem texto fora dele.' },
            ],
            { json: true, temperature: 0.3 },
          ),
        );
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

    if (data.booking.requested) {
      const b = data.booking;
      log(
        'info',
        `Ação de agendamento: ${b.acao} confirmado=${b.confirmed} novo=${b.date ?? '-'} ${b.time ?? '-'}` +
          (b.original_date ? ` original=${b.original_date} ${b.original_time ?? '-'}` : ''),
      );
    }

    // Registra observações que o agente julgou úteis sobre o cliente.
    for (const note of data.observations ?? []) {
      if (note?.trim()) this.opts.store.addObservation(jid, note, 'agente');
    }

    if (papelResolvido.papel !== 'cliente') {
      reply = await this.handleOperador(jid, data, papelResolvido);
    } else if (data.intent === 'finalizar') {
      // Cliente encerrou a conversa: descarta qualquer agendamento em andamento.
      this.opts.store.setPendingBooking(jid, null);
    } else if (data.intent === 'transferir') {
      reply = agentCfg.transferencia || 'Sem problemas! Vou encaminhar você para o nosso atendente humano. Um momento, por favor. 🙌';
      this.opts.onTransfer?.({ jid, clientName });
    } else if (data.booking.requested) {
      const b = data.booking;
      if (b.acao === 'cancelar' || b.acao === 'remarcar') {
        // Ações de gestão (cancelar/remarcar): só executam no backend após confirmação.
        this.opts.store.setPendingBooking(jid, null);
        if (!b.confirmed) {
          // Turno de pergunta/confirmação: mantém o texto do modelo.
        } else if (b.acao === 'cancelar') {
          reply = !b.date || !b.time
            ? 'Claro! Qual horário você gostaria de cancelar? Pode me dizer o dia e o horário do seu agendamento. 🙂'
            : this.opts.onCancelBooking
              ? await this.opts.onCancelBooking({ jid, clientName: b.client_name ?? clientName, service: b.service, date: b.date, time: b.time })
              : 'Tudo bem, seu agendamento foi cancelado. ✅';
        } else {
          reply = !(b.date && b.time && b.original_date && b.original_time)
            ? 'Claro! Me confirma para qual dia e horário você quer remarcar? 🙂'
            : this.opts.onRescheduleBooking
              ? await this.opts.onRescheduleBooking({
                  jid,
                  clientName: b.client_name ?? clientName,
                  service: b.service,
                  professional: b.professional,
                  date: b.date,
                  time: b.time,
                  originalDate: b.original_date,
                  originalTime: b.original_time,
                })
              : 'Pronto, seu agendamento foi remarcado. ✅';
        }
      } else {
        const draft: PendingBooking = { service: b.service, date: b.date, time: b.time, client_name: b.client_name, professional: b.professional };

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
              professional: b.professional,
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
    }

    await this.reply(jid, reply);
  }

  /** Turno de OPERADOR (ADMIN/BARBEIRO): ver agenda, criar p/ cliente, marcar feito. */
  private async handleOperador(jid: string, data: ParsedAgentResponse, papel: PapelResolvido): Promise<string> {
    const papelOp = papel.papel as 'admin' | 'profissional';
    if (data.intent === 'agenda') {
      if (!this.opts.onListAgenda) return 'Não consegui carregar a agenda agora.';
      return this.opts.onListAgenda({ jid, papel: papelOp, profissionalId: papel.profissionalId });
    }
    if (data.intent === 'finalizar') {
      this.opts.store.setPendingBooking(jid, null);
      return data.reply;
    }
    if (data.booking.requested) {
      const b = data.booking;
      if (b.acao === 'concluir') {
        if (!b.date || !b.time) return 'Qual agendamento você quer marcar como feito? Me diga a data e o horário.';
        if (!b.confirmed) return data.reply;
        if (!this.opts.onMarkDone) return 'Não consegui marcar como feito agora.';
        return this.opts.onMarkDone({ jid, papel: papelOp, profissionalId: papel.profissionalId, service: b.service, date: b.date, time: b.time });
      }
      if (b.acao === 'criar') {
        if (!b.client_name || !b.service || !b.date || !b.time) return 'Para agendar preciso do nome do cliente, serviço, data e horário.';
        if (!b.confirmed) return data.reply;
        if (!this.opts.onOperatorCreate) return 'Não consegui criar o agendamento agora.';
        return this.opts.onOperatorCreate({
          jid,
          papel: papelOp,
          profissionalId: papel.profissionalId,
          clientName: b.client_name,
          clientPhone: b.client_phone,
          service: b.service,
          date: b.date,
          time: b.time,
          professional: b.professional,
        });
      }
      return 'Não consigo executar essa ação por aqui.';
    }
    return data.reply;
  }

  private async reply(jid: string, text: string): Promise<void> {
    this.opts.store.addMessage(jid, 'bot', text);
    const sent = await this.opts.sendText(jid, text);
    if (!sent) log('warn', `WhatsApp desconectado; resposta não enviada para ${jid}`);
  }
}
