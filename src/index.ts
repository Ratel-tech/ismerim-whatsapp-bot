import fs from 'node:fs';
import { config, updateEnv } from './config.js';
import { log } from './log.js';
import { Store } from './store.js';
import { WhatsAppClient } from './whatsapp.js';
import { Agent } from './agent.js';
import { createHttpServer } from './http.js';
import { loadCatalog, saveCatalog } from './catalog.js';
import { loadAgentConfig, saveAgentConfig } from './agent-config.js';
import { formatConfirmation, validateAndCreateBooking } from './bookings.js';
import { buildNotification, flushPendingNotifications } from './notifier.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.sessionDir, { recursive: true });

const store = new Store();
const whatsapp = new WhatsAppClient();
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
});

whatsapp.onMessage = (msg) => {
  log('info', `Mensagem de ${msg.jid}: ${msg.text.slice(0, 80)}`);
  void agent.handleInboundMessage(msg).catch((err) => {
    log('error', `Erro ao processar mensagem: ${(err as Error).message}`);
  });
};

const server = createHttpServer({
  getStatus: () => ({
    status: whatsapp.status,
    phone: whatsapp.phone,
    qr: whatsapp.qr,
    bookings: store.listBookings(10),
    adminPhone: config.adminPhone,
  }),
  onReconnect: () => whatsapp.resetSession(),
  onPairingCode: (phone) => whatsapp.requestPairingCode(phone),
  getAgentConfig: () => loadAgentConfig(),
  saveAgentConfig: (cfg) => saveAgentConfig(cfg),
  getCatalog: () => loadCatalog(),
  saveCatalog: (catalog) => saveCatalog(catalog),
  getAdminPhone: () => config.adminPhone,
  saveAdminPhone: (phone) => updateEnv('ADMIN_PHONE', phone),
});

server.listen(config.port, '127.0.0.1', () => {
  log('info', `Página/QR disponível em http://localhost:${config.port}`);
});

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
