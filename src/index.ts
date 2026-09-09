import fs from 'node:fs';
import { config, updateEnv } from './config.js';
import { log } from './log.js';
import { Store } from './store.js';
import { WhatsAppClient } from './whatsapp.js';
import { Agent } from './agent.js';
import { bucketFor, createHttpServer, type ConversationDetailPayload, type ConversationListEntry } from './http.js';
import { BroadcastManager } from './broadcast.js';
import { loadCatalog, saveCatalog, localDateString } from './catalog.js';
import { computeFunnel } from './funnel.js';
import { loadAgentConfig, saveAgentConfig } from './agent-config.js';
import { formatConfirmation, validateAndCreateBooking } from './bookings.js';
import { buildNotification, buildTransferRequest, flushPendingNotifications } from './notifier.js';
import { isProviderId, listProviders } from './providers.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.sessionDir, { recursive: true });

if (!config.adminPhone) {
  log('warn', 'ADMIN_PHONE não configurado no .env — notificações de agendamento ao dono desativadas.');
}

const store = new Store();
const whatsapp = new WhatsAppClient();
const broadcaster = new BroadcastManager((jid, text) => whatsapp.sendText(jid, text));
const agent = new Agent({
  store,
  sendText: (jid, text) => whatsapp.sendText(jid, text),
  onBookingConfirmed: async (input) => {
    const outcome = validateAndCreateBooking(store, loadCatalog(), {
      ...input,
      serviceName: input.service,
    });
    if (!outcome.ok) {
      log('warn', `Agendamento rejeitado (${outcome.code}): ${input.service} ${input.date} ${input.time}`);
      return outcome.userMessage;
    }
    const booking = outcome.booking;
    log('info', `Agendamento criado #${booking.id}: ${booking.clientName} | ${booking.service} | ${booking.date} ${booking.time}`);

    if (config.adminPhone) {
      const sent = await whatsapp.sendText(`${config.adminPhone}@s.whatsapp.net`, buildNotification(booking));
      if (sent) {
        store.markNotified(booking.id);
        log('info', `Notificação enviada para o administrador (${config.adminPhone}).`);
      } else {
        log('warn', 'WhatsApp desconectado; notificação ao administrador pendente.');
      }
    } else {
      log('warn', 'ADMIN_PHONE não configurado no .env — notificação não enviada.');
    }

    return formatConfirmation(booking);
  },
  onTransfer: ({ jid, clientName }) => {
    store.markNeedsHuman(jid);
    if (!config.adminPhone) {
      log('warn', 'Cliente pediu atendente humano, mas ADMIN_PHONE não está configurado.');
      return;
    }
    const text = buildTransferRequest(clientName, jid);
    void whatsapp.sendText(`${config.adminPhone}@s.whatsapp.net`, text).then((ok) => {
      if (!ok) log('warn', 'WhatsApp desconectado; aviso de transferência não enviado ao dono.');
    });
  },
});

whatsapp.onMessage = (msg) => {
  log('info', `Mensagem de ${msg.jid}: ${msg.text.slice(0, 80)}`);
  void agent.handleInboundMessage(msg).catch((err) => {
    log('error', `Erro ao processar mensagem: ${(err as Error).message}`);
  });
};

function bookingsStatus(jid: string, today: string): { hasFuture: boolean; hasPast: boolean; agendou: boolean } {
  const bookings = store.listBookingsByClient(jid);
  return {
    hasFuture: bookings.some((b) => b.date >= today),
    hasPast: bookings.some((b) => b.date < today),
    agendou: bookings.length > 0,
  };
}

function funnelFor(jid: string, messageCount: number): ReturnType<typeof computeFunnel> {
  const today = localDateString(new Date());
  const bs = bookingsStatus(jid, today);
  const interesse = store.getPendingBooking(jid)?.service ?? store.listBookingsByClient(jid).at(-1)?.service ?? null;
  return computeFunnel({
    hasMessages: messageCount > 0,
    interest: interesse,
    hasFutureBooking: bs.hasFuture,
    hasPastBooking: bs.hasPast,
  });
}

/**
 * Lista de conversas: une os chats do WhatsApp (cache em memória) com os dados
 * guardados em `db.json` (nome, última mensagem, agendamento, observações, funil).
 */
function listConversations(refresh = false): ConversationListEntry[] {
  const chats = whatsapp.listChats(refresh);
  const stored = new Map(store.listConversations().map((c) => [c.jid, c] as const));
  // Une o cache do WhatsApp com as conversas já registradas no db.json:
  // assim nenhuma conversa some se o sync do Baileys ainda estiver em andamento.
  const jids = new Set([...stored.keys(), ...chats.map((c) => c.jid)]);
  return [...jids]
    .map((jid) => {
      const ch = chats.find((c) => c.jid === jid);
      const s = stored.get(jid);
      const messageCount = s?.messageCount ?? 0;
      const client = store.getClient(jid);
      const bs = bookingsStatus(jid, localDateString(new Date()));
      return {
        jid,
        name: ch?.name ?? s?.name ?? null,
        phone: jid.split('@')[0] ?? jid,
        lastClientAt: s?.lastClientAt ?? ch?.lastActivityAt ?? null,
        lastText: s?.lastText ?? null,
        messageCount,
        needsHuman: client?.needsHuman ?? false,
        agendou: bs.agendou,
        inAttendance: messageCount > 0,
        funil: funnelFor(jid, messageCount),
      };
    })
    .sort((a, b) => (b.lastClientAt ?? 0) - (a.lastClientAt ?? 0));
}

function conversationDetail(jid: string): ConversationDetailPayload {
  const chat = whatsapp.listChats().find((c) => c.jid === jid);
  const stored = store.getClient(jid);
  const messages = store.getAllMessages(jid);
  const bookings = store.listBookingsByClient(jid);
  const interesse = store.getPendingBooking(jid)?.service ?? bookings.at(-1)?.service ?? null;
  const last = messages.at(-1);
  return {
    client: {
      jid,
      name: stored?.name ?? chat?.name ?? null,
      phone: jid.split('@')[0] ?? jid,
      createdAt: stored?.createdAt ?? null,
      observations: stored?.observations ?? [],
      needsHuman: stored?.needsHuman ?? false,
      agendou: bookings.length > 0,
      interesse,
      funil: funnelFor(jid, messages.length),
      lastActivityAt: last ? new Date(last.at).getTime() : chat?.lastActivityAt ?? null,
      lastText: last?.content ?? null,
      messageCount: messages.length,
    },
    messages,
    bookings,
  };
}

const server = createHttpServer({
  getStatus: () => ({
    status: whatsapp.status,
    phone: whatsapp.phone,
    qr: whatsapp.qr,
    bookings: store.listBookings(10),
    adminPhone: config.adminPhone,
  }),
  onReconnect: () => whatsapp.resetSession(),
  onLogout: () => whatsapp.logout(),
  onPairingCode: (phone) => whatsapp.requestPairingCode(phone),
  getAgentConfig: () => loadAgentConfig(),
  saveAgentConfig: (cfg) => saveAgentConfig(cfg),
  getCatalog: () => loadCatalog(),
  saveCatalog: (catalog) => saveCatalog(catalog),
  getAdminPhone: () => config.adminPhone,
  saveAdminPhone: (phone) => updateEnv('ADMIN_PHONE', phone),
  getAiConfig: () => ({
    provider: config.aiProvider,
    model: config.aiModel,
    hasKey: Boolean(config.aiApiKey),
    providers: listProviders(),
  }),
  saveAiConfig: ({ provider, model, apiKey }) => {
    if (!isProviderId(provider)) throw new Error(`Provedor de IA inválido: ${provider}`);
    updateEnv('AI_PROVIDER', provider);
    updateEnv('AI_MODEL', model);
    if (apiKey?.trim()) updateEnv('AI_API_KEY', apiKey.trim());
  },
  listConversations: (refresh) => listConversations(refresh),
  getConversationDetail: (jid) => conversationDetail(jid),
  addObservation: (jid, text) => {
    store.addObservation(jid, text, 'humano');
    return conversationDetail(jid).client;
  },
  updateObservation: (jid, index, text) => {
    store.updateObservation(jid, index, text);
    return conversationDetail(jid).client;
  },
  deleteObservation: (jid, index) => {
    store.deleteObservation(jid, index);
    return conversationDetail(jid).client;
  },
  setHuman: (jid, on) => {
    store.setHuman(jid, on);
    return conversationDetail(jid).client;
  },
  sendManualMessage: async (jid, text) => {
    const ok = await whatsapp.sendText(jid, text);
    if (ok) store.addMessage(jid, 'bot', text);
    return ok;
  },
  getBroadcast: () => ({ settings: broadcaster.getSettings(), status: broadcaster.status() }),
  startBroadcast: ({ bucket, text, overrides }) => {
    if (!whatsapp.isConnected()) throw new Error('WhatsApp não conectado. Conecte antes de enviar.');
    const now = Date.now();
    const targets = listConversations()
      .filter((c) => bucket === 'all' || bucketFor(c.lastClientAt, now) === bucket)
      .map((c) => ({ jid: c.jid, name: c.name }));
    broadcaster.start(targets, text, overrides);
    return broadcaster.status();
  },
  stopBroadcast: () => broadcaster.stop(),
  saveBroadcastSettings: (s) => broadcaster.saveSettings(s),
  panelToken: config.panelToken,
});

// Tenta iniciar na porta configurada; se estiver ocupada, sobe +1 até conectar.
const MAX_PORT_TRIES = 20;
const IS_LISTENING_ERR = (err: NodeJS.ErrnoException) => err.code === 'EADDRINUSE';
let bindPort = config.port;
let alreadyListened = false;

function bindServer(): void {
  const onError = (err: NodeJS.ErrnoException) => {
    if (IS_LISTENING_ERR(err) && bindPort < config.port + MAX_PORT_TRIES) {
      bindPort += 1;
      log('warn', `Porta ${bindPort - 1} ocupada. Tentando porta ${bindPort}…`);
      bindServer();
      return;
    }
    log('error', `Falha ao iniciar o servidor na porta ${bindPort}: ${err.message}`);
    process.exit(1);
  };
  const onListening = () => {
    // Node dispara 'listening' duas vezes ao rebindar o mesmo http.Server; guarda evita log duplicado.
    if (alreadyListened) return;
    alreadyListened = true;
    log('info', `Página/QR disponível em http://localhost:${bindPort}`);
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(bindPort, '127.0.0.1');
}

bindServer();

void whatsapp.connect().catch((err) => {
  log('error', `Falha ao iniciar WhatsApp: ${(err as Error).message}`);
});

// Reenvia notificações que falharam enquanto o WhatsApp estava desconectado.
setInterval(() => {
  if (!whatsapp.isConnected()) return;
  void flushPendingNotifications({
    store,
    send: (jid, text) => whatsapp.sendText(jid, text),
    adminPhone: config.adminPhone,
  }).catch((err) => log('error', `Falha ao reenviar notificações: ${(err as Error).message}`));
}, 60_000);

function shutdown(signal: string): void {
  log('info', `Encerrando (${signal})...`);
  server.close();
  // stop() preserva a sessão salva — reiniciar não exige novo QR.
  void whatsapp.stop().finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
