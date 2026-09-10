import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';
import { loadCatalog } from '../src/catalog.js';
import { formatConfirmation } from '../src/bookings.js';
import { createBookingFromAgent } from '../src/booking-flow.js';
import { buildNotification } from '../src/notifier.js';

const store = new Store('data/db.json');
const sent: string[] = [];
const agent = new Agent({
  store,
  sendText: async (_jid, text) => {
    sent.push(text);
    console.log('--- BOT RESPONDEU ---');
    console.log(text);
    return true;
  },
  // mesmo fluxo do index.ts (valida -> salva -> notifica), sem enviar no WhatsApp
  onBookingConfirmed: async (input) => {
    const outcome = createBookingFromAgent(store, loadCatalog(), store.listProfissionais(), input);
    if (!outcome.ok) {
      console.log('REJEITADO:', outcome.code);
      return outcome.userMessage;
    }
    console.log('--- AGENDAMENTO CRIADO (db.json) ---');
    console.log(JSON.stringify(outcome.booking, null, 2));
    console.log('--- NOTIFICAÇÃO PARA O ADMIN (ADMIN_PHONE) ---');
    console.log(buildNotification(outcome.booking));
    return formatConfirmation(outcome.booking);
  },
});

const JID = '5511888888888@s.whatsapp.net';

const turn = async (msg: string) => {
  console.log();
  console.log('=== CLIENTE ===');
  console.log(msg);
  await agent.handleInboundMessage({ jid: JID, text: msg, name: 'Cliente Teste' });
  await new Promise((r) => setTimeout(r, 2500)); // respeita o anti-spam de 2s
};

const arg1 = process.argv[2];
if (arg1) {
  await turn(arg1);
} else {
  await turn('Oi! Quero agendar um corte de cabelo. Pode ser na quinta-feira às 16:00? Meu nome é João');
  await turn('Confirmo, pode marcar!');
}

console.log();
console.log('Agendamentos salvos em db.json:', store.listBookings().length);
console.log('Mensagens na conversa:', store.getMessages(JID).length);

