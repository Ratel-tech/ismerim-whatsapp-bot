import http from 'node:http';
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
}

const PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Ismerim WhatsApp Bot</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: "Segoe UI", system-ui, sans-serif; background: #0f1115; color: #e8eaed; min-height: 100vh; padding: 28px; }
  .wrap { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  .sub { color: #9aa3b2; margin-bottom: 20px; }
  .card { background: #171a21; border: 1px solid #2a2f3a; border-radius: 12px; padding: 18px; margin-bottom: 16px; }
  .status-line { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; font-size: 15px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; background: #555; }
  .dot.ok { background: #25d366; } .dot.warn { background: #f5b942; } .dot.err { background: #f25c5c; }
  .qr-box { width: 260px; height: 260px; background: #fff; border-radius: 10px; margin: 10px auto 14px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .qr-box img { width: 100%; height: 100%; object-fit: contain; }
  .qr-box .ph { color: #888; font-size: 13px; text-align: center; padding: 10px; }
  .btn { background: #1e222b; border: 1px solid #2a2f3a; color: #e8eaed; border-radius: 8px; padding: 9px 14px; font-size: 14px; cursor: pointer; margin-right: 8px; }
  .btn:hover { filter: brightness(1.2); }
  .btn.green { background: #1db457; border-color: #1db457; color: #fff; }
  .code { font-size: 24px; font-weight: 800; letter-spacing: 5px; color: #25d366; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  td { padding: 7px 8px; border-bottom: 1px solid #20242d; }
  th { text-align: left; color: #9aa3b2; font-size: 11px; text-transform: uppercase; padding: 6px 8px; border-bottom: 1px solid #2a2f3a; }
  .hint { color: #9aa3b2; font-size: 12px; margin-top: 8px; }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="wrap">
  <h1>💈 Ismerim WhatsApp Bot</h1>
  <div class="sub">Status da conexão — <span id="status-text">carregando...</span></div>

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

  <div class="card">
    <h3 style="margin-bottom:10px">📅 Últimos agendamentos</h3>
    <table id="bookings"><tbody><tr><td class="sub">Nenhum agendamento ainda.</td></tr></tbody></table>
  </div>
</div>

<script>
let lastQr = null;
async function refresh() {
  try {
    const r = await fetch('/api/status');
    const s = await r.json();
    const dot = document.getElementById('dot');
    const label = document.getElementById('status-label');
    const texts = { connected: '✅ Conectado', awaiting_scan: '🟡 Aguardando QR Code', connecting: '🟡 Conectando...', reconnecting: '🟡 Reconectando...', disconnected: '⚪ Desconectado', logged_out: '🔴 Sessão encerrada' };
    label.textContent = texts[s.status] || s.status;
    dot.className = 'dot ' + (s.status === 'connected' ? 'ok' : s.status === 'awaiting_scan' || s.status === 'connecting' || s.status === 'reconnecting' ? 'warn' : 'err');
    document.getElementById('phone').textContent = s.phone ? '📞 ' + s.phone : '';
    document.getElementById('qr-hint').classList.toggle('hidden', s.status !== 'awaiting_scan');
    const box = document.getElementById('qr-box');
    if (s.status === 'awaiting_scan' && s.qr && s.qr !== lastQr) {
      lastQr = s.qr;
      box.innerHTML = '<img src="data:image/png;base64,' + s.qr + '" alt="QR Code"/>';
    } else if (s.status !== 'awaiting_scan') {
      lastQr = null;
      box.innerHTML = '<div class="ph">' + (s.status === 'connected' ? '✅ Conectado' : 'Clique em "Gerar novo QR"') + '</div>';
    }
    const tb = document.querySelector('#bookings tbody');
    if (s.bookings && s.bookings.length) {
      tb.innerHTML = s.bookings.map(b =>
        '<tr><td>' + (b.clientName || '—') + '</td><td>' + b.service + '</td><td>' + b.date.split('-').reverse().join('/') + ' ' + b.time + '</td><td>R$ ' + Number(b.price).toFixed(2).replace('.', ',') + '</td></tr>'
      ).join('');
    } else {
      tb.innerHTML = '<tr><td class="sub">Nenhum agendamento ainda.</td></tr>';
    }
  } catch (e) { /* servidor reiniciando */ }
}

document.getElementById('btn-connect').addEventListener('click', async () => {
  if (!confirm('Gerar um novo QR Code? A sessão atual será encerrada.')) return;
  await fetch('/api/reconnect', { method: 'POST' });
  lastQr = null;
  toast('Novo QR gerado — escaneie!');
});

document.getElementById('btn-pair').addEventListener('click', async () => {
  const phone = prompt('Número do WhatsApp (com DDI, apenas dígitos).\nEx.: 5511999999999', '55');
  if (!phone) return;
  const area = document.getElementById('pair-area');
  area.innerHTML = '<p class="hint">Gerando código...</p>';
  try {
    const r = await fetch('/api/pairing-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro');
    area.innerHTML = '<div class="code">' + data.code + '</div>' +
      '<div class="hint">1. WhatsApp no celular → ⋮ → Aparelhos conectados<br>2. Conectar um aparelho → Conectar com número de telefone<br>3. Digite o código acima</div>';
  } catch (e) {
    area.innerHTML = '<p class="hint" style="color:#f25c5c">' + e.message + '</p>';
  }
});

function toast(msg) {
  alert(msg);
}

refresh();
setInterval(refresh, 3000);
</script>
</body>
</html>`;

export function createHttpServer(deps: HttpDeps): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const status = deps.getStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/reconnect') {
      try {
        await deps.onReconnect();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/pairing-code') {
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const { phone } = JSON.parse(body) as { phone?: string };
        const digits = (phone ?? '').replace(/\D/g, '');
        if (digits.length < 10) throw new Error('Informe o número com DDI, apenas dígitos.');
        const code = await deps.onPairingCode(digits);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code }));
      } catch (err) {
        res.writeHead(422, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (err as Error).message }));
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Não encontrado' }));
  });
}
