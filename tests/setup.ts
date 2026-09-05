import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setLogFile } from '../src/log.js';

// Redireciona o log em arquivo para um diretório temporário:
// os testes não poluem data/logs.txt (log de produção).
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ismerim-test-log-'));
setLogFile(path.join(dir, 'logs.txt'));
