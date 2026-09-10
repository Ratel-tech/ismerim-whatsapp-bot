/**
 * Roteiro de smoke para MEDIR a qualidade do agente com o DeepSeek real.
 * Uso (execução manual, fora do CI — consome a chave da API):
 *   npx tsx scripts/smoke-roteiro.ts
 *
 * Roda N perguntas variadas e imprime, por turno, se a resposta caiu no
 * fallback genérico ("não consegui processar") — a métrica de confiabilidade.
 * Também grava agendamentos confirmados no db.json (mesmo comportamento do
 * smoke.ts). Use um banco de testes se não quiser misturar com o de produção.
 */
import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';
import { loadCatalog } from '../src/catalog.js';
import { formatConfirmation } from '../src/bookings.js';
import { createBookingFromAgent } from '../src/booking-flow.js';
import { buildNotification } from '../src/notifier.js';

const FALLBACK_MARKER = 'não consegui processar';

const ROTEIRO: { mensagem: string; nome: string; observacao: string }[] = [
  { mensagem: 'Oi! Quais serviços vocês têm?', nome: 'Ana', observacao: 'lista de serviços' },
  { mensagem: 'Quanto custa o corte e a barba juntos?', nome: 'Ana', observacao: 'preço/promoção' },
  { mensagem: 'Qual o horário de funcionamento?', nome: 'Ana', observacao: 'horários' },
  { mensagem: 'Vocês fazem platinado? Qual o preço?', nome: 'Ana', observacao: 'serviço específico' },
  { mensagem: 'Quero agendar um corte para a próxima terça-feira às 15:00. Meu nome é João', nome: 'João', observacao: 'condução de agendamento' },
  { mensagem: 'Confirmo, pode marcar!', nome: 'João', observacao: 'confirmação (cria agendamento)' },
  { mensagem: 'Você sabe quanto é 2 + 2?', nome: 'Ana', observacao: 'fora de escopo — deve recusar sem quebrar' },
  { mensagem: 'Quando o Pelé morreu?', nome: 'Ana', observacao: 'fora de escopo — deve recusar sem quebrar' },
  { mensagem: 'Quero falar com um atendente humano agora.', nome: 'Ana', observacao: 'intent transferir' },
  { mensagem: 'Obrigado, era só isso. Tchau!', nome: 'Ana', observacao: 'encerramento' },
];

const dbFile = process.argv[2] ?? 'data/db.json';
const store = new Store(dbFile);
const sent: { jid: string; text: string }[] = [];

const agent = new Agent({
  store,
  debounceMs: 0,
  sendText: async (jid, text) => {
    sent.push({ jid, text });
    return true;
  },
  onBookingConfirmed: async (input) => {
    const outcome = createBookingFromAgent(store, loadCatalog(), store.listProfissionais(), input);
    if (!outcome.ok) {
      console.log(`   [backend rejeitou: ${outcome.code}]`);
      return outcome.userMessage;
    }
    console.log(`   [agendamento #${outcome.booking.id} criado]`);
    console.log(buildNotification(outcome.booking));
    return formatConfirmation(outcome.booking);
  },
});

const JID = '5511888888888@s.whatsapp.net';
let fallbacks = 0;

for (const [i, passo] of ROTEIRO.entries()) {
  console.log(`\n=== ${i + 1}/${ROTEIRO.length} (${passo.observacao}) ===`);
  console.log(`CLIENTE: ${passo.mensagem}`);
  sent.length = 0;
  await agent.handleInboundMessage({ jid: JID, text: passo.mensagem, name: passo.nome });
  const resposta = sent.at(-1)?.text ?? '(sem resposta)';
  const isFallback = resposta.includes(FALLBACK_MARKER);
  if (isFallback) fallbacks += 1;
  console.log(isFallback ? `BOT: ${resposta}  ⚠️ FALLBACK` : `BOT: ${resposta}`);
  await new Promise((r) => setTimeout(r, 2500)); // respeita o anti-spam de 2s
}

console.log(`\n========== RESUMO ==========`);
console.log(`Turnos: ${ROTEIRO.length} | Fallbacks: ${fallbacks} (${Math.round((fallbacks / ROTEIRO.length) * 100)}%)`);
console.log(`Meta: 0 fallback em perguntas dentro do escopo do catálogo.`);
console.log(`DB usado: ${dbFile}`);
