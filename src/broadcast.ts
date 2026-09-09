import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { localDateString } from './catalog.js';
import { log } from './log.js';

export interface BroadcastSettings {
  /** Máximo de mensagens por dia (0 = ilimitado). */
  dailyLimit: number;
  /** Quantas mensagens por lote. */
  batchSize: number;
  /** Atraso base entre mensagens (randomizado ±40% para parecer humano). */
  messageDelayMs: number;
  /** Atraso mínimo entre lotes. */
  gapMinMs: number;
  /** Atraso máximo entre lotes. */
  gapMaxMs: number;
}

export const DEFAULT_BROADCAST_SETTINGS: BroadcastSettings = {
  dailyLimit: 200,
  batchSize: 5,
  messageDelayMs: 12_000,
  gapMinMs: 60_000,
  gapMaxMs: 300_000,
};

export interface BroadcastTarget {
  jid: string;
  name: string | null;
}

export interface BroadcastStatus {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  total: number;
  sent: number;
  failed: number;
  sentToday: number;
}

interface PersistedState {
  date: string;
  sentToday: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadJson<T>(file: string, fallback: T): T {
  try {
    return { ...fallback, ...(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<T>) };
  } catch {
    return { ...fallback };
  }
}

function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/**
 * Envia mensagens em massa de forma "humana": lotes pequenos, pausas
 * aleatórias entre mensagens e entre lotes, e limite diário configurável.
 * Roda em segundo plano (não bloqueia a requisição HTTP) e expõe progresso.
 */
export class BroadcastManager {
  private readonly stateFile: string;
  private readonly settingsFile: string;
  settings: BroadcastSettings;
  private state: PersistedState;

  private running = false;
  private startedAt: number | null = null;
  private finishedAt: number | null = null;
  private error: string | null = null;
  private total = 0;
  private sent = 0;
  private failed = 0;
  private stopRequested = false;

  constructor(
    private readonly sendText: (jid: string, text: string) => Promise<boolean>,
    settingsFile: string = config.broadcastFile,
    stateFile: string = config.broadcastStateFile,
  ) {
    this.settingsFile = settingsFile;
    this.stateFile = stateFile;
    this.settings = loadJson(settingsFile, DEFAULT_BROADCAST_SETTINGS);
    this.state = loadJson(stateFile, { date: localDateString(new Date()), sentToday: 0 });
    if (this.state.date !== localDateString(new Date())) {
      this.state = { date: localDateString(new Date()), sentToday: 0 };
      writeJson(this.stateFile, this.state);
    }
  }

  getSettings(): BroadcastSettings {
    return { ...this.settings };
  }

  saveSettings(next: Partial<BroadcastSettings>): BroadcastSettings {
    const merged = { ...this.settings, ...next };
    const dailyLimit = Math.max(0, Math.floor(merged.dailyLimit));
    const batchSize = Math.max(1, Math.floor(merged.batchSize));
    const messageDelayMs = Math.max(500, Math.floor(merged.messageDelayMs));
    const gapMinMs = Math.max(1_000, Math.floor(merged.gapMinMs));
    const gapMaxMs = Math.max(gapMinMs + 1_000, Math.floor(merged.gapMaxMs));
    this.settings = { dailyLimit, batchSize, messageDelayMs, gapMinMs, gapMaxMs };
    writeJson(this.settingsFile, this.settings);
    return this.getSettings();
  }

  isRunning(): boolean {
    return this.running;
  }

  status(): BroadcastStatus {
    return {
      running: this.running,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error,
      total: this.total,
      sent: this.sent,
      failed: this.failed,
      sentToday: this.state.sentToday,
    };
  }

  /** Inicia um envio em massa. Lança erro se já houver um em andamento. */
  start(targets: BroadcastTarget[], text: string, overrides: Partial<BroadcastSettings> = {}): void {
    if (this.running) throw new Error('Já existe um envio em andamento. Pare o atual antes de iniciar outro.');
    if (!targets.length) throw new Error('Nenhum destino neste filtro.');
    if (!text.trim()) throw new Error('A mensagem não pode estar vazia.');

    const settings = this.saveSettings(overrides);
    this.stopRequested = false;
    this.running = true;
    this.startedAt = Date.now();
    this.finishedAt = null;
    this.error = null;
    this.total = targets.length;
    this.sent = 0;
    this.failed = 0;

    log('info', `Broadcast iniciado: ${targets.length} destinos, lote=${settings.batchSize}, limite diário=${settings.dailyLimit}`);
    void this.run(targets, text, settings);
  }

  /** Solicita a interrupção do envio atual (para na próxima checagem). */
  stop(): void {
    this.stopRequested = true;
  }

  private async run(targets: BroadcastTarget[], text: string, settings: BroadcastSettings): Promise<void> {
    try {
      for (let i = 0; i < targets.length; i += 1) {
        if (this.stopRequested) {
          this.error = 'Envio interrompido manualmente.';
          break;
        }
        if (settings.dailyLimit > 0 && this.state.sentToday >= settings.dailyLimit) {
          this.error = `Limite diário atingido (${settings.dailyLimit}). Aumente o limite ou aguarde o próximo dia.`;
          break;
        }
        const t = targets[i];
        if (!t) continue;
        try {
          if (await this.sendText(t.jid, text)) {
            this.sent += 1;
            this.state.sentToday += 1;
            this.persistState();
          } else {
            this.failed += 1;
          }
        } catch {
          this.failed += 1;
        }

        if (i < targets.length - 1 && !this.stopRequested) {
          // pausa humana entre mensagens
          await sleep(this.jitter(settings.messageDelayMs * 0.6, settings.messageDelayMs * 1.4));
        }
        // pausa longa após cada lote
        if ((i + 1) % settings.batchSize === 0 && i < targets.length - 1 && !this.stopRequested) {
          await sleep(this.jitter(settings.gapMinMs, settings.gapMaxMs));
        }
      }
    } finally {
      this.running = false;
      this.finishedAt = Date.now();
      log('info', `Broadcast finalizado: ${this.sent} enviadas, ${this.failed} falhas, hoje=${this.state.sentToday}`);
    }
  }

  private jitter(min: number, max: number): number {
    return Math.round(min + Math.random() * (max - min));
  }

  private persistState(): void {
    this.state = { date: localDateString(new Date()), sentToday: this.state.sentToday };
    writeJson(this.stateFile, this.state);
  }
}
