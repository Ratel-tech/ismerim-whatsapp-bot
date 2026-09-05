import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { AgentConfig } from './agent-config.js';
import type { Catalog } from './catalog.js';
import type { Booking } from './store.js';
import type { WaStatus } from './whatsapp.js';

export interface StatusPayload {
  status: WaStatus;
  phone: string | null;
  qr: string | null;
  bookings: Booking[];
  adminPhone: string;
}

export interface HttpDeps {
  getStatus(): StatusPayload;
  onReconnect(): Promise<void>;
  onPairingCode(phone: string): Promise<string>;
  getAgentConfig(): AgentConfig;
  saveAgentConfig(cfg: AgentConfig): void;
  getCatalog(): Catalog;
  saveCatalog(catalog: Catalog): void;
  getAdminPhone(): string;
  saveAdminPhone(phone: string): void;
  /** Se preenchido, toda rota /api/* exige o header "x-panel-token". */
  panelToken: string;
}

function tokenMatches(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ismerim WhatsApp Bot</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", system-ui, sans-serif; background: #0f1115; color: #e8eaed; min-height: 100vh; padding: 24px; }
  .wrap { max-width: 760px; margin: 0 auto; }
  h1 { font-size: 22px; margin-bottom: 2px; }
  .sub { color: #9aa3b2; margin-bottom: 16px; }
  .tabs { display: flex; gap: 6px; margin-bottom: 18px; flex-wrap: wrap; }
  .tab { background: #1e222b; border: 1px solid #2a2f3a; color: #9aa3b2; border-radius: 8px; padding: 8px 14px; cursor: pointer; font-size: 14px; }
  .tab:hover { color: #e8eaed; }
  .tab.on { background: #1db457; border-color: #1db457; color: #fff; }
  .card { background: #171a21; border: 1px solid #2a2f3a; border-radius: 12px; padding: 18px; margin-bottom: 16px; }
  .hidden { display: none; }
  .status-line { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 15px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: #555; }
  .dot.ok { background: #25d366; } .dot.warn { background: #f5b942; } .dot.err { background: #f25c5c; }
  .qr-box { width: 260px; height: 260px; background: #fff; border-radius: 10px; margin: 10px auto 14px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .qr-box img { width: 100%; height: 100%; object-fit: contain; }
  .qr-box .ph { color: #888; font-size: 13px; text-align: center; padding: 10px; }
  .btn { background: #1e222b; border: 1px solid #2a2f3a; color: #e8eaed; border-radius: 8px; padding: 8px 14px; font-size: 14px; cursor: pointer; margin: 4px 6px 4px 0; }
  .btn:hover { filter: brightness(1.2); }
  .btn.green { background: #1db457; border-color: #1db457; color: #fff; }
  .btn.red { background: #3a1616; border-color: #5a2424; color: #f25c5c; }
  .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 12px; }
  .field label { font-size: 12px; color: #9aa3b2; }
  .field input, .field textarea { background: #0f1115; border: 1px solid #2a2f3a; border-radius: 8px; color: #e8eaed; padding: 9px 11px; font-size: 14px; font-family: inherit; }
  .field textarea { min-height: 80px; resize: vertical; }
  .row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  .row input { background: #0f1115; border: 1px solid #2a2f3a; border-radius: 8px; color: #e8eaed; padding: 7px 9px; font-size: 13px; }
  .row .nome { width: 180px; } .row .preco { width: 90px; } .row .desc { flex: 1; min-width: 140px; }
  .row .hora { width: 90px; }
  .sec-title { font-size: 14px; font-weight: 600; margin: 16px 0 10px; color: #9aa3b2; }
  .code { font-size: 24px; font-weight: 800; letter-spacing: 5px; color: #25d366; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 7px 8px; border-bottom: 1px solid #20242d; }
  th { text-align: left; color: #9aa3b2; font-size: 11px; text-transform: uppercase; padding: 6px 8px; border-bottom: 1px solid #2a2f3a; }
  .hint { color: #9aa3b2; font-size: 12px; margin-top: 6px; }
  .ok-msg { color: #25d366; font-size: 13px; margin-top: 8px; }
  .err-msg { color: #f25c5c; font-size: 13px; margin-top: 8px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>💈 Ismerim WhatsApp Bot</h1>
  <div class="sub">Painel de controle do atendimento</div>

  <div class="tabs">
    <div class="tab on" data-tab="wa">📱 WhatsApp</div>
    <div class="tab" data-tab="agend">📅 Agendamentos</div>
    <div class="tab" data-tab="agente">🤖 Agente</div>
    <div class="tab" data-tab="catalogo">🗂️ Catálogo</div>
    <div class="tab" data-tab="config">⚙️ Config</div>
  </div>

  <!-- ================= WhatsApp ================= -->
  <div id="tab-wa">
    <div class="card">
      <div class="status-line"><span class="dot" id="dot"></span><b id="status-label">—</b><span id="phone" class="sub" style="margin:0">—</span></div>
      <div class="qr-box" id="qr-box"><div class="ph">Aguardando QR Code...</div></div>
      <div id="qr-hint" class="hint hidden">📸 O QR expira em segundos — escaneie assim que aparecer.</div>
      <div style="margin-top:10px">
        <button class="btn green" id="btn-connect">🔗 Gerar novo QR</button>
        <button class="btn" id="btn-pair">📞 Conectar por código</button>
      </div>
      <div id="pair-area"></div>
    </div>
  </div>

  <!-- ================= Agendamentos ================= -->
  <div id="tab-agend" class="hidden">
    <div class="card">
      <h3 style="margin-bottom:10px">📅 Agendamentos confirmados</h3>
      <table id="bookings"><tbody><tr><td class="sub">Nenhum agendamento ainda.</td></tr></tbody></table>
      <button class="btn" id="btn-refresh-bk" style="margin-top:10px">🔄 Atualizar</button>
    </div>
  </div>

  <!-- ================= Agente ================= -->
  <div id="tab-agente" class="hidden">
    <div class="card">
      <div class="field"><label>Empresa (apresentação)</label><textarea id="ag-empresa"></textarea></div>
      <div class="field"><label>Personalidade do agente</label><textarea id="ag-personalidade"></textarea></div>
      <div class="field"><label>Instruções / regras de atendimento</label><textarea id="ag-instrucoes"></textarea></div>
      <div class="field"><label>Mensagem de boas-vindas</label><textarea id="ag-boas-vindas"></textarea></div>
      <div class="field"><label>Mensagem de transferência para humano</label><textarea id="ag-transferencia"></textarea></div>
      <button class="btn green" id="btn-save-agent">💾 Salvar agente</button>
      <div id="agent-msg"></div>
      <div class="hint">Salvo em config/agent.json — vale para as próximas mensagens, sem reiniciar.</div>
    </div>
  </div>

  <!-- ================= Catálogo ================= -->
  <div id="tab-catalogo" class="hidden">
    <div class="card">
      <div class="sec-title">🕒 Horário de funcionamento (por dia)</div>
      <div id="hours-area"></div>

      <div class="sec-title">✂️ Serviços (nome, preço, descrição)</div>
      <div id="servicos-area"></div>
      <button class="btn" id="btn-add-servico">＋ Adicionar serviço</button>

      <div class="sec-title">🏷️ Promoções (nome, preço, "de", validade, descrição)</div>
      <div id="promos-area"></div>
      <button class="btn" id="btn-add-promo">＋ Adicionar promoção</button>

      <button class="btn green" id="btn-save-catalog" style="margin-top:14px">💾 Salvar catálogo</button>
      <div id="catalog-msg"></div>
      <div class="hint">Salvo em config/catalog.json — vale para as próximas mensagens, sem reiniciar.</div>
    </div>
  </div>

  <!-- ================= Config ================= -->
  <div id="tab-config" class="hidden">
    <div class="card">
      <div class="field"><label>WhatsApp que recebe a notificação de novo agendamento (ADMIN_PHONE)</label>
        <input id="cfg-phone" placeholder="5511999999999" />
        <div class="hint">Somente dígitos, com DDI. Ex.: 5511999999999</div>
      </div>
      <button class="btn green" id="btn-save-phone">💾 Salvar número</button>
      <div id="phone-msg"></div>
      <div class="sec-title" style="margin-top:18px">🔑 DeepSeek (IA)</div>
      <div class="hint">A chave da API fica no arquivo <b>.env</b> (DEEPSEEK_API_KEY). Edite o arquivo e reinicie o bot.</div>
    </div>
  </div>
</div>

<script>
let lastQr = null;
let catalog = null;
let agentCfg = null;
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function $(id) { return document.getElementById(id); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function okMsg(el, msg) { el.className = 'ok-msg'; el.textContent = '✅ ' + msg; }
function errMsg(el, msg) { el.className = 'err-msg'; el.textContent = '❌ ' + msg; }

// fetch autenticado: anexa o token do painel; em 401, pede o token ao usuário e tenta de novo.
async function authedFetch(path, opts) {
  let token = sessionStorage.getItem('panelToken') || '';
  const doFetch = () => fetch(path, Object.assign({}, opts, { headers: Object.assign({}, (opts && opts.headers) || {}, token ? { 'x-panel-token': token } : {}) }));
  let r = await doFetch();
  if (r.status === 401 && !token) {
    token = prompt('Este painel é protegido. Digite o token (PANEL_TOKEN):') || '';
    if (!token) return r;
    sessionStorage.setItem('panelToken', token);
    r = await doFetch();
  }
  return r;
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('on', x === t));
  document.querySelectorAll('[id^="tab-"]').forEach(x => x.classList.add('hidden'));
  $('tab-' + t.dataset.tab).classList.remove('hidden');
  if (t.dataset.tab === 'agente') loadAgentForm();
  if (t.dataset.tab === 'catalogo') loadCatalogForm();
  if (t.dataset.tab === 'config') loadConfigForm();
}));

// ---------------- WhatsApp ----------------
async function refreshWa() {
  try {
    const s = await (await authedFetch('/api/status')).json();
    const texts = { connected: '✅ Conectado', awaiting_scan: '🟡 Aguardando QR Code', connecting: '🟡 Conectando...', reconnecting: '🟡 Reconectando...', disconnected: '⚪ Desconectado', logged_out: '🔴 Sessão encerrada' };
    $('status-label').textContent = texts[s.status] || s.status;
    $('dot').className = 'dot ' + (s.status === 'connected' ? 'ok' : ['awaiting_scan','connecting','reconnecting'].includes(s.status) ? 'warn' : 'err');
    $('phone').textContent = s.phone ? '📞 ' + s.phone : '';
    $('qr-hint').classList.toggle('hidden', s.status !== 'awaiting_scan');
    const box = $('qr-box');
    if (s.status === 'awaiting_scan' && s.qr && s.qr !== lastQr) {
      lastQr = s.qr;
      box.innerHTML = '<img src="data:image/png;base64,' + s.qr + '" alt="QR Code"/>';
    } else if (s.status !== 'awaiting_scan') {
      lastQr = null;
      box.innerHTML = '<div class="ph">' + (s.status === 'connected' ? '✅ Conectado' : 'Clique em "Gerar novo QR"') + '</div>';
    }
    renderBookings(s.bookings);
  } catch (e) {}
}
function renderBookings(bookings) {
  const tb = document.querySelector('#bookings tbody');
  if (bookings && bookings.length) {
    tb.innerHTML = bookings.map(b =>
      '<tr><td>' + esc(b.clientName || '—') + '</td><td>' + esc(b.service) + '</td><td>' + b.date.split('-').reverse().join('/') + ' ' + esc(b.time) + '</td><td>R$ ' + Number(b.price).toFixed(2).replace('.', ',') + '</td></tr>'
    ).join('');
  } else {
    tb.innerHTML = '<tr><td class="sub">Nenhum agendamento ainda.</td></tr>';
  }
}
$('btn-connect').addEventListener('click', async () => {
  if (!confirm('Gerar um novo QR Code? A sessão atual será encerrada.')) return;
  await authedFetch('/api/reconnect', { method: 'POST' });
  lastQr = null;
  alert('Novo QR gerado — escaneie!');
});
$('btn-pair').addEventListener('click', async () => {
  const phone = prompt('Número do WhatsApp (com DDI, apenas dígitos).\nEx.: 5511999999999', '55');
  if (!phone) return;
  const area = $('pair-area');
  area.innerHTML = '<p class="hint">Gerando código...</p>';
  try {
    const r = await authedFetch('/api/pairing-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro');
    area.innerHTML = '<div class="code">' + esc(data.code) + '</div>' +
      '<div class="hint">1. WhatsApp no celular → ⋮ → Aparelhos conectados<br>2. Conectar um aparelho → Conectar com número de telefone<br>3. Digite o código acima</div>';
  } catch (e) { area.innerHTML = '<p class="hint" style="color:#f25c5c">' + esc(e.message) + '</p>'; }
});
$('btn-refresh-bk').addEventListener('click', refreshWa);

// ---------------- Agente ----------------
async function loadAgentForm() {
  agentCfg = await (await authedFetch('/api/agent-config')).json();
  $('ag-empresa').value = agentCfg.empresa || '';
  $('ag-personalidade').value = agentCfg.personalidade || '';
  $('ag-instrucoes').value = agentCfg.instrucoes || '';
  $('ag-boas-vindas').value = agentCfg.boas_vindas || '';
  $('ag-transferencia').value = agentCfg.transferencia || '';
}
$('btn-save-agent').addEventListener('click', async () => {
  try {
    const r = await authedFetch('/api/agent-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      empresa: $('ag-empresa').value, personalidade: $('ag-personalidade').value,
      instrucoes: $('ag-instrucoes').value, boas_vindas: $('ag-boas-vindas').value,
      transferencia: $('ag-transferencia').value,
    }) });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    okMsg($('agent-msg'), 'Agente salvo!');
  } catch (e) { errMsg($('agent-msg'), e.message); }
});

// ---------------- Catálogo ----------------
function hoursRows(c) {
  return DIAS.map((dia, i) => {
    const slots = (c.horarios[String(i)] || [])[0] || { open: '', close: '' };
    return '<div class="row"><span style="width:90px">' + dia + '</span>' +
      '<input class="hora" data-dia="' + i + '" data-k="open" value="' + esc(slots.open) + '" placeholder="abre" />' +
      '<input class="hora" data-dia="' + i + '" data-k="close" value="' + esc(slots.close) + '" placeholder="fecha" />' +
      '<span class="hint">(vazio = fechado)</span></div>';
  }).join('');
}
function servicoRow(s, idx) {
  return '<div class="row" data-idx="' + idx + '">' +
    '<input class="nome" data-k="nome" value="' + esc(s.nome) + '" placeholder="Nome" />' +
    '<input class="preco" data-k="preco" type="number" step="0.01" value="' + esc(s.preco) + '" placeholder="R$" />' +
    '<input class="desc" data-k="descricao" value="' + esc(s.descricao || '') + '" placeholder="Descrição (opcional)" />' +
    '<button class="btn red" data-rm="servicos">✕</button></div>';
}
function promoRow(p, idx) {
  return '<div class="row" data-idx="' + idx + '">' +
    '<input class="nome" data-k="nome" value="' + esc(p.nome) + '" placeholder="Nome" />' +
    '<input class="preco" data-k="preco" type="number" step="0.01" value="' + esc(p.preco) + '" placeholder="R$" />' +
    '<input class="preco" data-k="de" type="number" step="0.01" value="' + esc(p.de ?? '') + '" placeholder="de R$" />' +
    '<input class="hora" data-k="valida_ate" value="' + esc(p.valida_ate || '') + '" placeholder="até AAAA-MM-DD" />' +
    '<input class="desc" data-k="descricao" value="' + esc(p.descricao || '') + '" placeholder="Descrição" />' +
    '<button class="btn red" data-rm="promocoes">✕</button></div>';
}
async function loadCatalogForm() {
  catalog = await (await authedFetch('/api/catalog')).json();
  $('hours-area').innerHTML = hoursRows(catalog);
  $('servicos-area').innerHTML = catalog.servicos.map(servicoRow).join('');
  $('promos-area').innerHTML = catalog.promocoes.map(promoRow).join('');
}
$('btn-add-servico').addEventListener('click', () => {
  $('servicos-area').insertAdjacentHTML('beforeend', servicoRow({ nome: '', preco: '' }, $('servicos-area').children.length));
});
$('btn-add-promo').addEventListener('click', () => {
  $('promos-area').insertAdjacentHTML('beforeend', promoRow({ nome: '', preco: '' }, $('promos-area').children.length));
});
$('btn-save-catalog').addEventListener('click', async () => {
  if (!catalog) return;
  catalog.horarios = {};
  document.querySelectorAll('#hours-area [data-dia]').forEach(inp => {
    const dia = inp.dataset.dia, k = inp.dataset.k;
    if (!catalog.horarios[dia]) catalog.horarios[dia] = [{ open: '', close: '' }];
    catalog.horarios[dia][0][k] = inp.value.trim();
  });
  for (const d of Object.keys(catalog.horarios)) {
    const s = catalog.horarios[d][0];
    if (!s.open || !s.close) delete catalog.horarios[d];
  }
  const readRows = (area, key) => Array.from($(area).children).map((rowEl, i) => {
    const item = {};
    rowEl.querySelectorAll('[data-k]').forEach(inp => { if (inp.dataset.k !== 'rm') item[inp.dataset.k] = inp.value.trim(); });
    item.preco = item.preco === '' ? null : Number(item.preco);
    item.de = item.de === '' ? undefined : Number(item.de);
    return item;
  }).filter(x => x.nome);
  catalog.servicos = readRows('servicos-area');
  catalog.promocoes = readRows('promos-area');
  try {
    const r = await authedFetch('/api/catalog', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(catalog) });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    okMsg($('catalog-msg'), 'Catálogo salvo!');
  } catch (e) { errMsg($('catalog-msg'), e.message); }
});
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-rm]');
  if (btn) btn.closest('.row').remove();
});

// ---------------- Config ----------------
async function loadConfigForm() {
  const s = await (await authedFetch('/api/status')).json();
  $('cfg-phone').value = s.adminPhone || '';
}
$('btn-save-phone').addEventListener('click', async () => {
  try {
    const r = await authedFetch('/api/admin-phone', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: $('cfg-phone').value }) });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    okMsg($('phone-msg'), 'Número salvo no .env!');
  } catch (e) { errMsg($('phone-msg'), e.message); }
});

refreshWa();
setInterval(refreshWa, 3000);
</script>
</body>
</html>`;

export function createHttpServer(deps: HttpDeps): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (url.pathname.startsWith('/api/') && deps.panelToken && !tokenMatches(req.headers['x-panel-token'], deps.panelToken)) {
      json(401, { error: 'Não autorizado. Informe o token do painel (PANEL_TOKEN).' });
      return;
    }
    const readBody = async (): Promise<unknown> => {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        return JSON.parse(body);
      } catch {
        return {};
      }
    };

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      json(200, deps.getStatus());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/reconnect') {
      try {
        await deps.onReconnect();
        json(200, { ok: true });
      } catch (err) {
        json(500, { error: (err as Error).message });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pairing-code') {
      try {
        const { phone } = (await readBody()) as { phone?: string };
        const digits = (phone ?? '').replace(/\D/g, '');
        if (digits.length < 10) throw new Error('Informe o número com DDI, apenas dígitos.');
        json(200, { code: await deps.onPairingCode(digits) });
      } catch (err) {
        json(422, { error: (err as Error).message });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/agent-config') {
      json(200, deps.getAgentConfig());
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/api/agent-config') {
      const cfg = (await readBody()) as Record<string, string>;
      for (const k of ['empresa', 'personalidade', 'instrucoes', 'boas_vindas', 'transferencia']) {
        if (typeof cfg[k] !== 'string') {
          json(422, { error: `Campo "${k}" é obrigatório.` });
          return;
        }
      }
      deps.saveAgentConfig(cfg as never);
      json(200, { ok: true });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/catalog') {
      json(200, deps.getCatalog());
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/api/catalog') {
      const catalog = (await readBody()) as Catalog;
      if (!catalog || !Array.isArray(catalog.servicos) || !Array.isArray(catalog.promocoes) || typeof catalog.horarios !== 'object') {
        json(422, { error: 'Catálogo inválido.' });
        return;
      }
      deps.saveCatalog(catalog);
      json(200, { ok: true });
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/api/admin-phone') {
      const { phone } = (await readBody()) as { phone?: string };
      deps.saveAdminPhone((phone ?? '').replace(/\D/g, ''));
      json(200, { ok: true });
      return;
    }

    json(404, { error: 'Não encontrado' });
  });
}
