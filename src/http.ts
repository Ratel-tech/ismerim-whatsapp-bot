import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { AgentConfig } from './agent-config.js';
import type { Catalog } from './catalog.js';
import type { Booking } from './store.js';
import type { WaStatus } from './whatsapp.js';
import type { ProviderSummary } from './providers.js';
import type { ConversationSummary, StoredMessage } from './store.js';
import type { ObservationEntry } from './store.js';
import type { BroadcastSettings, BroadcastStatus } from './broadcast.js';
import type { Funnel } from './funnel.js';

export type BroadcastBucket = 'h24' | 'd1_2' | 'd2_7' | 'old';
export type BroadcastFilter = 'all' | BroadcastBucket;

export const BUCKET_LABELS: Record<BroadcastBucket, string> = {
  h24: 'Últimas 24 horas',
  d1_2: 'Há 1–2 dias',
  d2_7: 'Há 2–7 dias',
  old: 'Há mais de 1 semana',
};

/** Classifica uma conversa por recência da última mensagem do CLIENTE. */
export function bucketFor(lastClientAt: number | null, now: number): BroadcastBucket {
  const H = 3_600_000;
  if (lastClientAt == null) return 'old';
  if (lastClientAt >= now - 24 * H) return 'h24';
  if (lastClientAt >= now - 48 * H) return 'd1_2';
  if (lastClientAt >= now - 7 * 24 * H) return 'd2_7';
  return 'old';
}

export interface ConversationListEntry extends ConversationSummary {
  needsHuman: boolean;
  agendou: boolean;
  inAttendance: boolean;
  funil: Funnel;
}

export interface ConversationsPayload {
  now: number;
  bucket: BroadcastFilter;
  count: number;
  conversations: (ConversationListEntry & { bucket: BroadcastBucket })[];
}

export interface CustomerDetail {
  jid: string;
  name: string | null;
  phone: string;
  createdAt: string | null;
  observations: ObservationEntry[];
  needsHuman: boolean;
  agendou: boolean;
  interesse: string | null;
  funil: Funnel;
  lastActivityAt: number | null;
  lastText: string | null;
  messageCount: number;
}

export interface ConversationDetailPayload {
  client: CustomerDetail;
  messages: StoredMessage[];
  bookings: Booking[];
}

export interface BroadcastPayload {
  settings: BroadcastSettings;
  status: BroadcastStatus;
}

export interface StartBroadcastInput {
  bucket: BroadcastFilter;
  text: string;
  overrides?: Partial<BroadcastSettings>;
}

export interface StatusPayload {
  status: WaStatus;
  phone: string | null;
  qr: string | null;
  bookings: Booking[];
  adminPhone: string;
}

export interface AiConfigPayload {
  provider: string;
  model: string;
  hasKey: boolean;
  providers: ProviderSummary[];
}

export interface SaveAiConfigInput {
  provider: string;
  model: string;
  /** Nova chave; vazio/undefined = não alterar a chave salva. */
  apiKey?: string;
}

export interface HttpDeps {
  getStatus(): StatusPayload;
  onReconnect(): Promise<void>;
  onLogout(): Promise<void>;
  onPairingCode(phone: string): Promise<string>;
  getAgentConfig(): AgentConfig;
  saveAgentConfig(cfg: AgentConfig): void;
  getCatalog(): Catalog;
  saveCatalog(catalog: Catalog): void;
  getAdminPhone(): string;
  saveAdminPhone(phone: string): void;
  getAiConfig(): AiConfigPayload;
  saveAiConfig(cfg: SaveAiConfigInput): void;
  /** `refresh` força a reconstrução do cache de chats do WhatsApp. */
  listConversations(refresh?: boolean): ConversationListEntry[];
  getConversationDetail(jid: string): ConversationDetailPayload;
  /** Adiciona uma observação (autor 'human' = atendente humano). */
  addObservation(jid: string, text: string): CustomerDetail;
  updateObservation(jid: string, index: number, text: string): CustomerDetail;
  deleteObservation(jid: string, index: number): CustomerDetail;
  /** Liga/desliga o atendimento humano (pausa/resume a resposta automática do agente). */
  setHuman(jid: string, on: boolean): CustomerDetail;
  sendManualMessage(jid: string, text: string): Promise<boolean>;
  getBroadcast(): BroadcastPayload;
  startBroadcast(input: StartBroadcastInput): BroadcastStatus;
  stopBroadcast(): void;
  saveBroadcastSettings(s: Partial<BroadcastSettings>): BroadcastSettings;
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
  :root { --green:#00a884; --green2:#25d366; --bg:#f0f2f5; --panel:#fff; --panel2:#f7f8fa; --txt:#111b21; --muted:#667781; --line:#e6e9ed; --out:#d9fdd3; }
  html, body { height: 100%; }
  body { font-family:"Segoe UI", system-ui, sans-serif; background:var(--bg); color:var(--txt); min-height:100vh; padding:0 0 0 66px; transition:padding-left .25s ease; }
  body.rail-open { padding-left:226px; }
  .wrap { width:100%; max-width:1360px; margin:0 auto; padding:20px 28px 28px; }
  h1 { font-size:22px; margin-bottom:2px; }
  .sub { color:var(--muted); margin-bottom:16px; }
  .tabs { display:flex; gap:6px; margin-bottom:14px; flex-wrap:wrap; }
  .tab { background:#fff; border:1px solid var(--line); color:var(--muted); border-radius:20px; padding:6px 14px; cursor:pointer; font-size:13px; }
  .tab:hover { color:var(--txt); }
  .tab.on { background:#e7f8f3; border-color:var(--green); color:var(--green); font-weight:600; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px; margin-bottom:16px; }
  .hidden { display:none; }
  .status-line { display:flex; align-items:center; gap:10px; margin-bottom:12px; font-size:15px; }
  .dot { width:12px; height:12px; border-radius:50%; background:#ccc; }
  .dot.ok { background:var(--green2); } .dot.warn { background:#f5b942; } .dot.err { background:#f25c5c; }
  .qr-box { width:260px; height:260px; background:#fff; border-radius:10px; margin:10px auto 14px; display:flex; align-items:center; justify-content:center; overflow:hidden; }
  .qr-box img { width:100%; height:100%; object-fit:contain; }
  .qr-box .ph { color:#888; font-size:13px; text-align:center; padding:10px; }
  .btn { background:#fff; border:1px solid var(--line); color:var(--txt); border-radius:8px; padding:8px 14px; font-size:14px; cursor:pointer; margin:4px 6px 4px 0; }
  .btn:hover { background:#f0f2f5; }
  .btn.green { background:var(--green); border-color:var(--green); color:#fff; }
  .btn.green:hover { background:#008f72; }
  .btn.red { background:#fff; border-color:#f2c2c2; color:#e05252; }
  .field { display:flex; flex-direction:column; gap:5px; margin-bottom:12px; }
  .field label { font-size:12px; color:var(--muted); }
  .field input, .field textarea, .row input, .conv-search, .chat-input input { background:#fff; border:1px solid var(--line); border-radius:8px; color:var(--txt); padding:9px 11px; font-size:14px; font-family:inherit; }
  .field textarea { min-height:80px; resize:vertical; }
  .row { display:flex; gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap; }
  .row .nome { width:180px; } .row .preco { width:90px; } .row .desc { flex:1; min-width:140px; }
  .row .hora { width:90px; }
  .sec-title { font-size:14px; font-weight:600; margin:16px 0 10px; color:var(--muted); }
  .code { font-size:24px; font-weight:800; letter-spacing:5px; color:var(--green2); margin:10px 0; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  td { padding:7px 8px; border-bottom:1px solid var(--line); }
  th { text-align:left; color:var(--muted); font-size:11px; text-transform:uppercase; padding:6px 8px; border-bottom:1px solid var(--line); }
  .hint { color:var(--muted); font-size:12px; margin-top:6px; }
  .ok-msg { color:#1b9a5b; font-size:13px; margin-top:8px; }
  .err-msg { color:#e05252; font-size:13px; margin-top:8px; }
  .inbox { display:grid; grid-template-columns:360px minmax(0,1fr) 360px; height:calc(100vh - 150px); border:1px solid var(--line); border-radius:16px; overflow:hidden; box-shadow:0 2px 14px rgba(0,0,0,.06); }
  .panel { background:#fff; display:flex; flex-direction:column; min-width:0; }
  .panel-list { border-right:1px solid var(--line); background:var(--panel2); }
  .panel-detail { border-left:1px solid var(--line); background:#fff; overflow-y:auto; }
  .chat-area { background:#efeae2; }
  .panel-head { padding:14px 16px; border-bottom:1px solid var(--line); background:#fff; }
  .panel-head b { font-size:16px; }
  .conv-search { width:100%; background:#f0f2f5; border:none; border-radius:8px; color:var(--txt); padding:9px 12px; margin-top:10px; }
  .scroll { overflow-y:auto; flex:1; }
  .conv-item { display:flex; gap:12px; padding:11px 14px; cursor:pointer; border-bottom:1px solid var(--line); align-items:flex-start; background:#fff; }
  .conv-item:hover { background:#f5f6f6; }
  .conv-item.on { background:#f0f2f5; }
  .avatar { width:50px; height:50px; border-radius:50%; color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:16px; flex:none; }
  .conv-item .txt { flex:1; min-width:0; }
  .conv-item .n { display:flex; justify-content:space-between; gap:6px; }
  .conv-item .nm { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .conv-item .tm { color:var(--muted); font-size:11px; flex:none; }
  .conv-item .prev { color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px; }
  .dots { display:flex; gap:6px; margin-top:5px; }
  .badge { font-size:10px; padding:1px 8px; border-radius:10px; color:#fff; font-weight:600; }
  .badge.h { background:#e05252; } .badge.g { background:var(--green2); }
  .chat-head { padding:12px 16px; border-bottom:1px solid #d9d3cc; display:flex; align-items:center; gap:12px; background:#f7f5f0; }
  .chat-body { flex:1; overflow-y:auto; padding:18px; display:flex; flex-direction:column; gap:6px; }
  .msg { display:flex; flex-direction:column; max-width:70%; }
  .msg.me { align-self:flex-end; align-items:flex-end; }
  .msg.them { align-self:flex-start; align-items:flex-start; }
  .bubble { padding:8px 12px; border-radius:12px; font-size:14px; white-space:pre-wrap; word-break:break-word; box-shadow:0 1px 1px rgba(0,0,0,.08); }
  .msg.them .bubble { background:#fff; color:var(--txt); border-top-left-radius:2px; }
  .msg.me .bubble { background:var(--out); color:var(--txt); border-top-right-radius:2px; }
  .bubble .t { display:block; font-size:10px; color:#8a9a9f; text-align:right; margin-top:4px; }
  .msg .role { font-size:10px; color:var(--muted); margin:2px 6px; }
  .chat-input { display:flex; gap:8px; padding:12px 16px; border-top:1px solid #d9d3cc; background:#f0f2f5; }
  .chat-input input { border-radius:24px; padding:11px 16px; }
  .detail-avatar { width:70px; height:70px; border-radius:50%; color:#fff; display:flex; align-items:center; justify-content:center; font-size:26px; font-weight:700; margin:0 auto 10px; }
  .detail-actions { display:flex; gap:8px; margin:12px 0; }
  .detail-actions .btn { flex:1; margin:0; }
  .btn-block { width:100%; margin:0 0 8px; padding:11px 12px; border-radius:10px; display:flex; align-items:center; justify-content:center; gap:8px; font-weight:600; font-size:14px; }
  .mode-chip { display:inline-flex; align-items:center; gap:6px; padding:4px 13px; border-radius:14px; font-size:12px; font-weight:700; margin-top:8px; background:#e7f8f3; color:#008f72; }
  .mode-chip.human { background:#fdeeee; color:#e05252; }
  .human-note { margin:0 0 10px; padding:8px 10px; border-radius:8px; background:#e7f8f3; color:#008f72; font-size:12px; }
  .obs-item { padding:9px 10px; border:1px solid var(--line); border-radius:8px; margin-bottom:8px; background:#fff; }
  .obs-a { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
  .obs-author { font-size:11px; font-weight:700; padding:2px 9px; border-radius:10px; }
  .obs-author.human { background:#e7f8f3; color:#008f72; }
  .obs-author.agent { background:#eef1ff; color:#4b5bd4; }
  .obs-t { font-size:13px; white-space:pre-wrap; word-break:break-word; }
  .obs-b { display:flex; gap:6px; margin-top:6px; }
  .btn-mini { background:#fff; border:1px solid var(--line); border-radius:6px; padding:3px 8px; font-size:11px; color:var(--muted); cursor:pointer; }
  .btn-mini:hover { background:#f0f2f5; }
  .sec2 { font-size:11px; color:#008f72; text-transform:uppercase; letter-spacing:.6px; margin:16px 0 8px; font-weight:700; }
  .ficha-row { display:flex; justify-content:space-between; gap:8px; padding:9px 10px; border:1px solid var(--line); border-bottom:none; font-size:13px; background:#fff; }
  .ficha-row:last-of-type { border-bottom:1px solid var(--line); }
  .ficha-row .k { color:var(--muted); }
  .ficha-row b { text-align:right; }
  .summary-card { background:#111b21; color:#fff; border-radius:12px; padding:14px; margin:18px 0 6px; }
  .summary-card .top { display:flex; justify-content:space-between; font-size:13px; }
  .summary-card .bar { height:7px; border-radius:4px; background:#333e4d; margin-top:9px; overflow:hidden; }
  .summary-card .bar span { display:block; height:100%; background:var(--green2); }
  .summary-card .sub { color:#a9b3bf; }
  .funnel-bar { display:flex; gap:3px; margin:8px 0; }
  .funnel-bar span { flex:1; height:8px; border-radius:3px; background:#e2e6ea; }
  .funnel-bar span.ok { background:var(--green2); }
  .detail-empty { color:var(--muted); text-align:center; padding:40px 12px; }
  .rail { position:fixed; top:0; left:0; bottom:0; width:66px; background:#fff; border-right:1px solid var(--line); display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 0 14px; overflow-y:auto; overflow-x:hidden; z-index:5; transition:width .25s ease; }
  .rail-toggle { background:transparent; border:none; width:46px; height:40px; border-radius:8px; font-size:20px; color:var(--muted); cursor:pointer; margin-bottom:2px; display:flex; align-items:center; justify-content:center; flex:none; }
  .rail-toggle:hover { background:#f0f2f5; color:var(--txt); }
  .rail-brand { font-size:24px; margin-bottom:6px; }
  .rail-btn { background:transparent; border:none; border-radius:10px; width:46px; height:46px; font-size:20px; color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; flex:none; }
  .rail-btn:hover { background:#f0f2f5; color:var(--txt); }
  .rail-btn.on { background:#e7f8f3; color:var(--green); }
  .rail-btn .lb { display:none; }
  .rail.open { width:220px; align-items:stretch; }
  .rail.open .rail-toggle { width:100%; }
  .rail.open .rail-btn { width:100%; justify-content:flex-start; gap:12px; padding:0 14px; }
  .rail.open .rail-btn .ic { width:20px; text-align:center; flex:none; }
  .rail.open .rail-btn .lb { display:inline; font-size:14px; font-weight:600; color:var(--txt); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .rail.open .rail-btn.on .lb { color:var(--green); }
  #obs-note { width:100%; min-height:64px; background:#fff; border:1px solid var(--line); border-radius:8px; color:var(--txt); padding:8px; font-family:inherit; }
  .center-msg { text-align:center; color:var(--muted); margin:auto; }
</style>
</head>
<body>
<div class="rail" id="rail">
  <button class="rail-toggle" id="rail-toggle" title="Expandir/recolher menu">☰</button>
  <div class="rail-brand">💈</div>
  <button class="rail-btn on" data-tab="wa" title="WhatsApp"><span class="ic">📱</span><span class="lb">WhatsApp</span></button>
  <button class="rail-btn" data-tab="agend" title="Agendamentos"><span class="ic">📅</span><span class="lb">Agendamentos</span></button>
  <button class="rail-btn" data-tab="conv" title="Conversas"><span class="ic">💬</span><span class="lb">Conversas</span></button>
  <button class="rail-btn" data-tab="agente" title="Agente"><span class="ic">🤖</span><span class="lb">Agente</span></button>
  <button class="rail-btn" data-tab="catalogo" title="Catálogo"><span class="ic">🗂️</span><span class="lb">Catálogo</span></button>
  <button class="rail-btn" data-tab="config" title="Config"><span class="ic">⚙️</span><span class="lb">Config</span></button>
</div>
<div class="wrap">
  <h1>💈 Ismerim WhatsApp Bot</h1>
  <div class="sub">Painel de controle do atendimento</div>

  

  <!-- ================= WhatsApp ================= -->
  <div id="tab-wa">
    <div class="card">
      <div class="status-line"><span class="dot" id="dot"></span><b id="status-label">—</b><span id="phone" class="sub" style="margin:0">—</span></div>
      <div class="qr-box" id="qr-box"><div class="ph">Aguardando QR Code...</div></div>
      <div id="qr-hint" class="hint hidden">📸 O QR expira em segundos — escaneie assim que aparecer.</div>
      <div style="margin-top:10px">
        <button class="btn green" id="btn-connect">🔗 Gerar novo QR</button>
        <button class="btn" id="btn-pair">📞 Conectar por código</button>
        <button class="btn red" id="btn-logout">🚪 Sair do WhatsApp</button>
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

  <!-- ================= Conversas ================= -->
  <div id="tab-conv" class="hidden">
    <details class="card" style="margin-bottom:12px">
      <summary class="sub" style="cursor:pointer">📣 Enviar mensagem em massa (filtro por tempo, lotes e limite diário)</summary>
      <div style="margin-top:12px">
        <div class="field"><label>Mensagem</label><textarea id="bc-msg" placeholder="Escreva a mensagem (ex.: aviso de horário, promoção...)"></textarea></div>
        <div class="row">
          <label style="width:150px">Mensagens por lote</label><input id="bc-batch" type="number" min="1" style="width:70px" />
          <label style="width:130px">Pausa mín (min)</label><input id="bc-gapmin" type="number" min="1" style="width:70px" />
          <label style="width:130px">Pausa máx (min)</label><input id="bc-gapmax" type="number" min="1" style="width:70px" />
          <label style="width:130px">Limite por dia</label><input id="bc-limit" type="number" min="0" style="width:70px" />
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
          <button class="btn green" id="btn-bc-start">➤ Enviar para todos do filtro</button>
          <button class="btn red" id="btn-bc-stop">⏹ Parar envio</button>
          <button class="btn" id="btn-bc-settings">💾 Salvar configuração</button>
        </div>
        <div class="status-line" id="bc-status" style="margin-top:10px"></div>
        <div id="bc-err" class="sub"></div>
      </div>
    </details>

    <div class="inbox">
      <div class="panel panel-list">
        <div class="panel-head">
          <b id="conv-count">Conversas</b>
          <input id="conv-search" class="conv-search" placeholder="Buscar nome ou telefone" />
          <div class="tabs" id="conv-filters" style="margin-top:10px;margin-bottom:2px"></div>
          <div class="tabs" id="conv-classes" style="margin-top:6px"></div>
          <button class="btn" id="conv-refresh" style="margin-top:2px">🔄 Atualizar (recarregar chat)</button>
        </div>
        <div id="conv-list" class="scroll"></div>
      </div>
      <div class="panel chat-area">
        <div class="chat-head" id="chat-head"><b>Selecione uma conversa</b></div>
        <div id="chat-body" class="chat-body"><div class="sub" style="text-align:center">Escolha uma conversa ao lado para ver o chat.</div></div>
        <div class="chat-input">
          <input id="chat-text" placeholder="Escreva uma mensagem..." disabled />
          <button class="btn green" id="chat-send">➤</button>
        </div>
      </div>
      <div class="panel panel-detail">
        <div id="conv-detail"><div class="detail-empty">Selecione uma conversa</div></div>
      </div>
    </div>
  </div>

  <!-- ================= Agente ================= -->
  <div id="tab-agente" class="hidden">
    <div class="card">
      <div class="field"><label>Empresa (apresentação)</label><textarea id="ag-empresa"></textarea></div>
      <div class="field"><label>Personalidade do agente</label><textarea id="ag-personalidade"></textarea></div>
      <div class="field"><label>Instruções / regras de atendimento</label><textarea id="ag-instrucoes"></textarea></div>
      <div class="field"><label>Prompt personalizado — regras adicionais (o que o agente pode/não pode fazer; tem prioridade)</label><textarea id="ag-prompt-extra"></textarea></div>
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

      <div class="sec-title" style="margin-top:18px">🤖 IA — escolha do agente</div>
      <div class="field">
        <label>Provedor de IA (qual API o agente vai usar)</label>
        <select id="ai-provider"></select>
      </div>
      <div class="field">
        <label>Modelo</label>
        <input id="ai-model" placeholder="ex.: deepseek-chat" />
      </div>
      <div class="field">
        <label>Chave da API (AI_API_KEY)</label>
        <input id="ai-key" type="password" placeholder="cole sua chave aqui" autocomplete="off" />
        <div class="hint" id="ai-key-hint">Salva no arquivo .env. Deixe em branco para manter a chave atual.</div>
      </div>
      <button class="btn green" id="btn-save-ai">💾 Salvar IA</button>
      <div id="ai-msg"></div>
      <div class="hint">Vale para as próximas mensagens, sem reiniciar. A chave fica no arquivo <b>.env</b> do servidor (não vai para o Git).</div>
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

document.querySelectorAll('.rail-btn').forEach((t) =>
  t.addEventListener('click', () => {
    document.querySelectorAll('.rail-btn').forEach((x) => x.classList.toggle('on', x === t));
    document.querySelectorAll('[id^="tab-"]').forEach((x) => x.classList.add('hidden'));
    $('tab-' + t.dataset.tab).classList.remove('hidden');
    if (t.dataset.tab === 'agente') loadAgentForm();
    if (t.dataset.tab === 'catalogo') loadCatalogForm();
    if (t.dataset.tab === 'config') loadConfigForm();
    if (t.dataset.tab === 'conv') loadConversations();
  }));

// Navegação lateral: expandir/recolher (ícones ⇄ ícones + nomes)
$('rail-toggle').addEventListener('click', () => {
  const open = document.body.classList.toggle('rail-open');
  $('rail').classList.toggle('open', open);
  $('rail-toggle').textContent = open ? '‹' : '☰';
});

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
$('btn-logout').addEventListener('click', async () => {
  if (!confirm('Desconectar o número do WhatsApp? Para reconectar você precisará escanear um novo QR Code.')) return;
  try {
    const r = await authedFetch('/api/logout', { method: 'POST' });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    lastQr = null;
    alert('Número desconectado do WhatsApp.');
  } catch (e) { alert('Erro: ' + e.message); }
});
$('btn-pair').addEventListener('click', async () => {
  const phone = prompt('Número do WhatsApp (com DDI, apenas dígitos).\\nEx.: 5511999999999', '55');
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
  $('ag-prompt-extra').value = agentCfg.prompt_extra || '';
  $('ag-boas-vindas').value = agentCfg.boas_vindas || '';
  $('ag-transferencia').value = agentCfg.transferencia || '';
}
$('btn-save-agent').addEventListener('click', async () => {
  try {
    const r = await authedFetch('/api/agent-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      empresa: $('ag-empresa').value, personalidade: $('ag-personalidade').value,
      instrucoes: $('ag-instrucoes').value, prompt_extra: $('ag-prompt-extra').value,
      boas_vindas: $('ag-boas-vindas').value, transferencia: $('ag-transferencia').value,
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
  await loadAiForm();
}
$('btn-save-phone').addEventListener('click', async () => {
  try {
    const r = await authedFetch('/api/admin-phone', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: $('cfg-phone').value }) });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    okMsg($('phone-msg'), 'Número salvo no .env!');
  } catch (e) { errMsg($('phone-msg'), e.message); }
});

// ---------------- IA (agente) ----------------
let aiProviders = [];
async function loadAiForm() {
  const ai = await (await authedFetch('/api/ai-config')).json();
  aiProviders = ai.providers || [];
  const sel = $('ai-provider');
  sel.innerHTML = '';
  for (const p of aiProviders) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.label + ' (' + p.id + ')';
    sel.appendChild(o);
  }
  sel.value = ai.provider;
  const modelInput = $('ai-model');
  modelInput.value = ai.model || '';
  if (!modelInput.value) {
    const cur = aiProviders.find((p) => p.id === ai.provider);
    if (cur) modelInput.value = cur.defaultModel;
  }
  const hint = $('ai-key-hint');
  hint.textContent = ai.hasKey
    ? 'Chave já configurada. Deixe em branco para manter, ou cole uma nova para trocar.'
    : 'Nenhuma chave configurada — cole a chave da API acima.';
}
$('ai-provider').addEventListener('change', () => {
  const modelInput = $('ai-model');
  if (modelInput.value) return;
  const cur = aiProviders.find((p) => p.id === $('ai-provider').value);
  if (cur) modelInput.value = cur.defaultModel;
});
$('btn-save-ai').addEventListener('click', async () => {
  try {
    const payload = {
      provider: $('ai-provider').value,
      model: $('ai-model').value.trim(),
      apiKey: $('ai-key').value.trim(),
    };
    if (!payload.model) { errMsg($('ai-msg'), 'Informe o modelo.'); return; }
    const r = await authedFetch('/api/ai-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error((await r.json()).error || 'Erro');
    $('ai-key').value = '';
    okMsg($('ai-msg'), 'Configuração de IA salva!');
  } catch (e) { errMsg($('ai-msg'), e.message); }
});

// ---------------- Conversas (inbox) ----------------
const BC_FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'h24', label: 'Últimas 24h' },
  { id: 'd1_2', label: 'Há 1–2 dias' },
  { id: 'd2_7', label: 'Há 2–7 dias' },
  { id: 'old', label: 'Mais de 1 semana' },
];
// Classificação por etapa do funil / status do atendimento.
const CLASS_FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'novo', label: 'Novo' },
  { id: 'conversa', label: 'Em conversa' },
  { id: 'interesse', label: 'Interesse' },
  { id: 'agendou', label: 'Agendou' },
  { id: 'humano', label: 'Precisa humano' },
  { id: 'atendido', label: 'Atendido' },
];
function classMatch(c, id) {
  switch (id) {
    case 'novo': return c.funil.stage === 1;
    case 'conversa': return c.funil.stage === 2;
    case 'interesse': return c.funil.stage === 3;
    case 'agendou': return c.agendou || c.funil.stage === 4;
    case 'humano': return c.needsHuman;
    case 'atendido': return c.funil.stage === 5;
    default: return true;
  }
}
let convFilter = 'all';
let convClass = 'all';
const convsAll = [];
let selectedJid = null;
let convSearch = '';
let bcBusy = false;
const AV_COLORS = ['#25d366', '#1db4b4', '#b46a1d', '#9b25d3', '#d3256a'];
function escName(s) { return String(s == null ? '' : s); }
function initials(name, phone) {
  const base = name || phone || '?';
  const parts = String(base).replace(/[^A-Za-zÀ-ú0-9 ]/g, ' ').trim().split(/[ ]+/);
  const txt = parts.slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
  return txt || '?';
}
function fmtTime(now, ts) {
  if (!ts) return '';
  const d = new Date(ts); const n = new Date(now);
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function renderConvFilters() {
  $('conv-filters').innerHTML = BC_FILTERS.map((f) => '<div class="tab' + (f.id === convFilter ? ' on' : '') + '" data-cf="' + f.id + '">' + f.label + '</div>').join('');
  $('conv-classes').innerHTML = CLASS_FILTERS.map((f) => '<div class="tab' + (f.id === convClass ? ' on' : '') + '" data-ccl="' + f.id + '">' + f.label + '</div>').join('');
}
$('conv-filters').addEventListener('click', (e) => {
  const t = e.target.closest('[data-cf]');
  if (!t) return;
  convFilter = t.dataset.cf;
  renderConvFilters();
  loadConversations();
});
$('conv-classes').addEventListener('click', (e) => {
  const t = e.target.closest('[data-ccl]');
  if (!t) return;
  convClass = t.dataset.ccl;
  renderConvFilters();
  renderConvList();
});
$('conv-search').addEventListener('input', (e) => { convSearch = e.target.value.toLowerCase(); renderConvList(); });
$('conv-refresh').addEventListener('click', () => loadConversations(true));
async function loadConversations(force) {
  try {
    const r = await authedFetch('/api/conversations?bucket=' + encodeURIComponent(convFilter) + (force ? '&refresh=1' : ''));
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro');
    convsAll.length = 0;
    for (const c of (data.conversations || [])) convsAll.push(c);
    renderConvFilters();
    renderConvList();
  } catch (e) { $('conv-list').innerHTML = '<div class="err-msg">' + esc(e.message) + '</div>'; }
}
function renderConvList() {
  const now = Date.now();
  const q = convSearch;
  const base = q ? convsAll.filter((c) => (c.name || '').toLowerCase().includes(q) || c.phone.includes(q)) : convsAll;
  const list = base.filter((c) => classMatch(c, convClass));
  $('conv-count').textContent = 'Conversas (' + list.length + ')';
  if (!list.length) { $('conv-list').innerHTML = '<div class="detail-empty">Nenhuma conversa.</div>'; return; }
  $('conv-list').innerHTML = list.map((c) => {
    const color = AV_COLORS[Math.abs(c.jid.length) % AV_COLORS.length];
    const badge = c.needsHuman ? '<span class="badge h">atendente humano</span>' : (c.agendou ? '<span class="badge g">agendou</span>' : '');
    return '<div class="conv-item' + (c.jid === selectedJid ? ' on' : '') + '" data-jid="' + esc(c.jid) + '">' +
      '<div class="avatar" style="background:' + color + '">' + esc(initials(c.name, c.phone)) + '</div>' +
      '<div class="txt"><div class="n"><span class="nm">' + esc(c.name || c.phone) + '</span><span class="tm">' + fmtTime(now, c.lastClientAt) + '</span></div>' +
      '<div class="prev">' + esc(c.lastText || '') + '</div>' +
      (badge ? '<div class="dots">' + badge + '</div>' : '') + '</div></div>';
  }).join('');
}
$('conv-list').addEventListener('click', (e) => {
  const it = e.target.closest('[data-jid]');
  if (it) selectConversation(it.dataset.jid);
});
async function selectConversation(jid) {
  selectedJid = jid;
  renderConvList();
  try {
    const r = await authedFetch('/api/conversations/' + encodeURIComponent(jid));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    renderChat(d);
    renderDetail(d);
    $('chat-text').disabled = false;
  } catch (e) { $('chat-body').innerHTML = '<div class="err-msg">' + esc(e.message) + '</div>'; }
}
function renderChat(d) {
  const color = AV_COLORS[Math.abs(d.client.jid.length) % AV_COLORS.length];
  $('chat-head').innerHTML =
    '<div class="avatar" style="background:' + color + ';width:42px;height:42px;font-size:15px">' + esc(initials(d.client.name, d.client.phone)) + '</div>' +
    '<div><b>' + esc(d.client.name || d.client.phone) + '</b><div class="sub" style="margin:0">' + esc(d.client.phone) + '</div></div>';
  if (!d.messages.length) {
    $('chat-body').innerHTML = '<div class="center-msg">Sem mensagens no histórico do bot.</div>';
    return;
  }
  $('chat-body').innerHTML = d.messages.map((m) => {
    const me = m.role === 'bot';
    const role = me ? 'Atendente' : 'Escrita por você';
    return '<div class="msg ' + (me ? 'me' : 'them') + '"><span class="role">' + role + '</span><div class="bubble">' + esc(m.content) +
      '<span class="t">' + new Date(m.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '</span></div></div>';
  }).join('');
  const el = $('chat-body');
  el.scrollTop = el.scrollHeight;
}
function renderDetail(d) {
  const c = d.client;
  const color = AV_COLORS[Math.abs(c.jid.length) % AV_COLORS.length];
  const pct = c.funil.total ? Math.round((c.funil.stage / c.funil.total) * 100) : 0;
  $('conv-detail').innerHTML =
    '<div style="text-align:center;padding:18px 0 4px"><div class="detail-avatar" style="background:' + color + '">' + esc(initials(c.name, c.phone)) + '</div><h3>' + esc(c.name || c.phone) + '</h3><div class="sub" style="margin:2px 0 0">' + esc(c.phone) + '</div>' +
    '<span class="mode-chip ' + (c.needsHuman ? 'human' : '') + '">' + (c.needsHuman ? '🧑 Atendimento humano' : '🤖 Agente de IA') + '</span></div>' +
    '<div class="detail-actions"><button class="btn green" id="btn-wa">Abrir WhatsApp</button><button class="btn" id="btn-copy">Copiar</button></div>' +
    '<button class="btn btn-block ' + (c.needsHuman ? 'green' : '') + '" id="btn-human" style="margin-top:2px">' + (c.needsHuman ? '🤖 Voltar para o agente de IA' : '🧑 Atender manualmente (pausar IA)') + '</button>' +
    (c.needsHuman ? '<div class="human-note">Atendimento humano ativo nesta conversa — o agente está pausado. Use o campo abaixo para responder.</div>' : '') +
    '<div class="sec2">Ficha (planilha)</div>' +
    '<div class="ficha-row"><span class="k">Interesse</span><b>' + esc(c.interesse || '—') + '</b></div>' +
    '<div class="ficha-row"><span class="k">Agendou?</span><b>' + (c.agendou ? 'sim' : 'não') + '</b></div>' +
    '<div class="ficha-row"><span class="k">Primeiro contato</span><b>' + fmtDateTime(c.createdAt) + '</b></div>' +
    '<div class="sec2" style="margin-top:14px">Observações</div>' +
    '<div id="obs-list">' + obsListHtml(c.observations || []) + '</div>' +
    '<div class="field" style="margin-top:10px"><textarea id="obs-note" placeholder="Nova observação (ficará marcada como Humano)"></textarea></div>' +
    '<button class="btn green" id="btn-add-obs" data-obs-add style="width:100%;margin:0">➕ Adicionar observação</button>' +
    '<div class="summary-card"><div class="top"><b>Etapa do funil</b><span>' + esc(c.funil.label) + '</span></div><div class="bar"><span style="width:' + pct + '%"></span></div><div class="sub" style="margin:8px 0 0">' + c.funil.stage + ' de ' + c.funil.total + ' etapas</div></div>' +
    '<div class="sec2">Agendamentos</div>' + (d.bookings.length ? d.bookings.map((b) => '<div class="ficha-row"><span class="k">' + esc(b.service || '') + '</span><b>' + b.date.split('-').reverse().join('/') + ' ' + esc(b.time) + '</b></div>').join('') : '<div class="sub">Nenhum agendamento.</div>') +
    '<div style="height:20px"></div>';
  $('btn-wa').addEventListener('click', () => window.open('https://wa.me/' + (c.phone || ''), '_blank'));
  $('btn-copy').addEventListener('click', () => { navigator.clipboard.writeText(c.phone || ''); alert('Copiado'); });
  $('btn-human').addEventListener('click', async () => {
    try {
      const r = await authedFetch('/api/conversations/' + encodeURIComponent(selectedJid) + '/human', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ on: !c.needsHuman }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erro');
      renderDetail(d);
      renderConvList();
    } catch (e) { alert('Erro: ' + e.message); }
  });
}
function obsListHtml(list) {
  if (!list || !list.length) return '<div class="sub">Nenhuma observação.</div>';
  return list.map((o, i) => {
    const human = o.author === 'humano';
    return '<div class="obs-item">' +
      '<div class="obs-a"><span class="obs-author ' + (human ? 'human' : 'agent') + '">' + (human ? '🙋 Humano' : '🤖 Agente') + '</span><span class="sub" style="font-size:10px">' + fmtDateTime(o.at) + '</span></div>' +
      '<div class="obs-t">' + esc(o.text) + '</div>' +
      '<div class="obs-b"><button class="btn-mini" data-obs-edit="' + i + '">✏️ Editar</button><button class="btn-mini" data-obs-del="' + i + '">🗑️ Excluir</button></div>' +
      '</div>';
  }).join('');
}
async function obsReload(d) {
  renderDetail(d);
  renderConvList();
}
async function obsAdd() {
  const txt = $('obs-note').value.trim();
  if (!txt || !selectedJid) return;
  $('obs-note').value = '';
  try {
    const r = await authedFetch('/api/conversations/' + encodeURIComponent(selectedJid) + '/observations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: txt }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    await obsReload(d);
  } catch (e) { alert('Erro: ' + e.message); }
}
async function obsEdit(index) {
  const item = document.querySelector('[data-obs-edit="' + index + '"]')?.closest('.obs-item');
  const cur = item?.querySelector('.obs-t')?.textContent || '';
  const t = prompt('Editar observação:', cur);
  if (t == null) return;
  try {
    const r = await authedFetch('/api/conversations/' + encodeURIComponent(selectedJid) + '/observations/' + index, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: t }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    await obsReload(d);
  } catch (e) { alert('Erro: ' + e.message); }
}
async function obsDelete(index) {
  if (!confirm('Excluir esta observação?')) return;
  try {
    const r = await authedFetch('/api/conversations/' + encodeURIComponent(selectedJid) + '/observations/' + index, { method: 'DELETE' });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    await obsReload(d);
  } catch (e) { alert('Erro: ' + e.message); }
}
// Delegação: botões de observação são recriados a cada render da ficha.
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-obs-add]')) { e.preventDefault(); void obsAdd(); return; }
  const ed = e.target.closest('[data-obs-edit]');
  if (ed) { void obsEdit(Number(ed.dataset.obsEdit)); return; }
  const del = e.target.closest('[data-obs-del]');
  if (del) { void obsDelete(Number(del.dataset.obsDel)); return; }
});
$('chat-send').addEventListener('click', sendChat);
$('chat-text').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });
async function sendChat() {
  const text = $('chat-text').value.trim();
  if (!text || !selectedJid) return;
  $('chat-text').value = '';
  try {
    const r = await authedFetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jid: selectedJid, text }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    selectConversation(selectedJid);
  } catch (e) { alert('Erro: ' + e.message); }
}

// ---------------- Broadcast (envio em massa) ----------------
function fillBroadcastSettings(s) {
  $('bc-batch').value = s.batchSize;
  $('bc-gapmin').value = Math.round(s.gapMinMs / 60000);
  $('bc-gapmax').value = Math.round(s.gapMaxMs / 60000);
  $('bc-limit').value = s.dailyLimit;
}
function currentBroadcastOverrides() {
  return {
    batchSize: Number($('bc-batch').value) || 1,
    gapMinMs: (Number($('bc-gapmin').value) || 1) * 60000,
    gapMaxMs: (Number($('bc-gapmax').value) || 5) * 60000,
    dailyLimit: Math.max(0, Number($('bc-limit').value) || 0),
  };
}
async function refreshBroadcast() {
  try {
    const r = await authedFetch('/api/broadcast');
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Erro');
    fillBroadcastSettings(data.settings);
    renderBroadcastStatus(data.status, data.settings);
  } catch (e) { $('bc-err').textContent = e.message; }
}
function renderBroadcastStatus(st, settings) {
  const el = $('bc-status');
  const limit = settings ? settings.dailyLimit : 0;
  if (!st || !st.total) { el.innerHTML = '<span class="dot"></span><span class="sub">Nenhum envio em andamento.</span>'; }
  else {
    const pct = st.total ? Math.round(((st.sent + st.failed) / st.total) * 100) : 0;
    const label = st.running ? '🟡 Enviando' : (st.error ? '⛔ ' + esc(st.error) : '✅ Concluído');
    el.innerHTML = '<span class="dot ' + (st.running ? 'warn' : st.error ? 'err' : 'ok') + '"></span><b>' + label + '</b><span class="sub"> ' + st.sent + ' enviadas / ' + st.total + ' (falhas ' + st.failed + ') • hoje ' + st.sentToday + (limit > 0 ? ' de ' + limit : ' (sem limite)') + ' • ' + pct + '%</span>';
  }
  bcBusy = !!(st && st.running);
  $('btn-bc-start').disabled = bcBusy;
  $('btn-bc-stop').disabled = !bcBusy;
}
$('btn-bc-start').addEventListener('click', async () => {
  const msg = $('bc-msg').value.trim();
  if (!msg) { alert('Escreva a mensagem antes de enviar.'); return; }
  const label = BC_FILTERS.find((f) => f.id === convFilter).label;
  if (!confirm('Enviar para todas as conversas do filtro "' + label + '" (usa o limite diário e as pausas configuradas)?')) return;
  try {
    const r = await authedFetch('/api/broadcast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bucket: convFilter, text: msg, overrides: currentBroadcastOverrides() }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    refreshBroadcast();
  } catch (e) { alert('Erro: ' + e.message); }
});
$('btn-bc-stop').addEventListener('click', async () => {
  await authedFetch('/api/broadcast/stop', { method: 'POST' });
  refreshBroadcast();
});
$('btn-bc-settings').addEventListener('click', async () => {
  try {
    const r = await authedFetch('/api/broadcast/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(currentBroadcastOverrides()) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Erro');
    fillBroadcastSettings(d);
    alert('Configuração salva.');
  } catch (e) { alert('Erro: ' + e.message); }
});
setInterval(refreshBroadcast, 5000);

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
    if (req.method === 'GET' && url.pathname === '/api/conversations') {
      const now = Date.now();
      const bucketParam = url.searchParams.get('bucket') ?? 'all';
      const refresh = url.searchParams.get('refresh') === '1';
      if (bucketParam !== 'all' && !(bucketParam in BUCKET_LABELS)) {
        json(422, { error: 'Filtro inválido.' });
        return;
      }
      const all = deps.listConversations(refresh);
      const list = bucketParam === 'all' ? all : all.filter((c) => bucketFor(c.lastClientAt, now) === bucketParam);
      json(200, {
        now,
        bucket: bucketParam as BroadcastFilter,
        count: list.length,
        conversations: list.map((c) => ({ ...c, bucket: bucketFor(c.lastClientAt, now) })),
      });
      return;
    }
    const humanMatch = url.pathname.match(/^\/api\/conversations\/(.+)\/human$/);
    if (req.method === 'PUT' && humanMatch) {
      const jid = decodeURIComponent(humanMatch[1] ?? '');
      const body = (await readBody()) as { on?: boolean };
      deps.setHuman(jid, body.on === true);
      json(200, deps.getConversationDetail(jid));
      return;
    }
    const obsIndexMatch = url.pathname.match(/^\/api\/conversations\/(.+)\/observations\/(\d+)$/);
    if (req.method === 'PUT' && obsIndexMatch) {
      const jid = decodeURIComponent(obsIndexMatch[1] ?? '');
      const index = Number(obsIndexMatch[2] ?? -1);
      const body = (await readBody()) as { text?: string };
      deps.updateObservation(jid, index, typeof body.text === 'string' ? body.text : '');
      json(200, deps.getConversationDetail(jid));
      return;
    }
    if (req.method === 'DELETE' && obsIndexMatch) {
      const jid = decodeURIComponent(obsIndexMatch[1] ?? '');
      const index = Number(obsIndexMatch[2] ?? -1);
      deps.deleteObservation(jid, index);
      json(200, deps.getConversationDetail(jid));
      return;
    }
    const obsMatch = url.pathname.match(/^\/api\/conversations\/(.+)\/observations$/);
    if (req.method === 'PUT' && obsMatch) {
      const jid = decodeURIComponent(obsMatch[1] ?? '');
      const body = (await readBody()) as { text?: string };
      deps.addObservation(jid, typeof body.text === 'string' ? body.text : '');
      json(200, deps.getConversationDetail(jid));
      return;
    }
    const convDetail = url.pathname.match(/^\/api\/conversations\/(.+)$/);
    if (req.method === 'GET' && convDetail) {
      const jid = decodeURIComponent(convDetail[1] ?? '');
      json(200, deps.getConversationDetail(jid));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/send') {
      const body = (await readBody()) as { jid?: string; text?: string };
      const jid = (body.jid ?? '').toString();
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!jid) {
        json(422, { error: 'Destinatário é obrigatório.' });
        return;
      }
      if (!text) {
        json(422, { error: 'Informe a mensagem a enviar.' });
        return;
      }
      const ok = await deps.sendManualMessage(jid, text);
      json(ok ? 200 : 409, ok ? { ok: true } : { error: 'WhatsApp não conectado ou falha no envio.' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/broadcast') {
      json(200, deps.getBroadcast());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/broadcast') {
      const body = (await readBody()) as { bucket?: string; text?: string; overrides?: Partial<BroadcastSettings> };
      const bucket = body.bucket ?? 'all';
      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (bucket !== 'all' && !(bucket in BUCKET_LABELS)) {
        json(422, { error: 'Filtro inválido.' });
        return;
      }
      if (!text) {
        json(422, { error: 'Informe a mensagem a enviar.' });
        return;
      }
      try {
        json(200, deps.startBroadcast({ bucket: bucket as BroadcastFilter, text, overrides: body.overrides }));
      } catch (err) {
        json(409, { error: (err as Error).message });
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/broadcast/stop') {
      deps.stopBroadcast();
      json(200, { ok: true });
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/api/broadcast/settings') {
      const body = (await readBody()) as Partial<BroadcastSettings>;
      json(200, deps.saveBroadcastSettings(body));
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
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      try {
        await deps.onLogout();
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
      for (const k of ['empresa', 'personalidade', 'instrucoes', 'prompt_extra', 'boas_vindas', 'transferencia']) {
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
    if (req.method === 'GET' && url.pathname === '/api/ai-config') {
      json(200, deps.getAiConfig());
      return;
    }
    if (req.method === 'PUT' && url.pathname === '/api/ai-config') {
      const cfg = (await readBody()) as Partial<SaveAiConfigInput>;
      if (typeof cfg.provider !== 'string' || !cfg.provider) {
        json(422, { error: 'Provedor é obrigatório.' });
        return;
      }
      if (typeof cfg.model !== 'string' || !cfg.model) {
        json(422, { error: 'Modelo é obrigatório.' });
        return;
      }
      if (cfg.apiKey !== undefined && typeof cfg.apiKey !== 'string') {
        json(422, { error: 'Chave de API inválida.' });
        return;
      }
      deps.saveAiConfig({ provider: cfg.provider, model: cfg.model, apiKey: cfg.apiKey });
      json(200, { ok: true });
      return;
    }

    json(404, { error: 'Não encontrado' });
  });
}
