import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';

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
});

const JID = '5511888888888@s.whatsapp.net';
const msg = process.argv[2] ?? 'Oi! Quanto custa o corte e a barba? E até que horas vocês funcionam?';
console.log('=== SIMULANDO CLIENTE ===');
console.log('Cliente:', msg);
console.log();
await agent.handleInboundMessage({ jid: JID, text: msg, name: 'Cliente Teste' });
console.log();
console.log('Mensagens na conversa:', store.getMessages(JID).length);
