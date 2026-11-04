import * as fs from 'fs';
import * as path from 'path';

const MAX_BYTES = 5 * 1024 * 1024;
const ARCHIVES = 3;

export function createDiagnosticLog(directory: string, role: string): (event: string, details?: unknown) => void {
  const file = path.join(directory, `${role}.log`);
  let warned = false;
  return (event, details) => {
    try {
      fs.mkdirSync(directory, { recursive: true });
      const record = {
        time: new Date().toISOString(), pid: process.pid, role, event,
        details: details instanceof Error
          ? { name: details.name, message: details.message, stack: details.stack }
          : details,
      };
      let line = JSON.stringify(record);
      if (Buffer.byteLength(line, 'utf8') > 64 * 1024) {
        line = JSON.stringify({
          ...record,
          details: { truncated: true, originalBytes: Buffer.byteLength(line, 'utf8'), preview: line.slice(0, 8000) },
        });
      }
      if (fs.existsSync(file) && fs.statSync(file).size + Buffer.byteLength(line, 'utf8') + 1 > MAX_BYTES) {
        const oldest = `${file}.${ARCHIVES}`;
        if (fs.existsSync(oldest)) fs.unlinkSync(oldest);
        for (let i = ARCHIVES - 1; i >= 1; i--) {
          if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
        }
        fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, `${line}\n`, 'utf8');
    } catch (error) {
      if (!warned) {
        warned = true;
        console.error(`[Diagnostics] Cannot write ${file}:`, error);
      }
    }
  };
}

export function installProcessDiagnostics(role: string) {
  const directory = path.resolve(process.cwd(), '.logs');
  const log = createDiagnosticLog(directory, role);
  log('process-start', {
    parentPid: process.ppid, node: process.versions.node,
    electron: process.versions.electron, platform: process.platform,
  });
  // Monitoring observes fatal exceptions without suppressing Node's normal termination.
  process.on('uncaughtExceptionMonitor', (error, origin) => log('uncaught-exception', {
    origin, name: error.name, message: error.message, stack: error.stack,
  }));
  process.on('warning', (warning) => log('process-warning', warning));
  process.on('disconnect', () => log('parent-ipc-disconnected'));
  process.on('exit', (code) => log('process-exit', { code }));
  const heartbeat = setInterval(() => log('heartbeat', {
    uptimeSeconds: Math.round(process.uptime()), memory: process.memoryUsage(),
  }), 60_000);
  heartbeat.unref();
  console.log(`[Diagnostics] ${role} log: ${path.join(directory, `${role}.log`)}`);
  return log;
}
