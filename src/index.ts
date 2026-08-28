import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { log } from './log.js';
import { Store } from './store.js';
import { WhatsAppClient } from './whatsapp.js';
import { Agent } from './agent.js';
import { createHttpServer } from './http.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.sessionDir, { recursive: true });

const store = new Store();
const whatsapp = new WhatsAppClient();
const agent = new Agent({
  store,
  sendText: (jid, text) => whatsapp.sendText(jid, text),
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
});

server.listen(config.port, '127.0.0.1', () => {
  log('info', `Página/QR disponível em http://localhost:${config.port}`);
});

void whatsapp.connect().catch((err) => {
  log('error', `Falha ao iniciar WhatsApp: ${(err as Error).message}`);
});

function shutdown(signal: string): void {
  log('info', `Encerrando (${signal})...`);
  server.close();
  void whatsapp.resetSession().finally(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
