import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createDiagnosticLog } from '../../electron/diagnostics';

let directory: string;
afterEach(() => {
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('local diagnostics', () => {
  it('persists timestamped lifecycle and error records across logger instances', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'office-diagnostics-'));
    createDiagnosticLog(directory, 'main')('start', { code: 0 });
    createDiagnosticLog(directory, 'main')('fatal', new Error('test failure'));
    const records = fs.readFileSync(path.join(directory, 'main.log'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ pid: process.pid, event: 'start', details: { code: 0 } });
    expect(Date.parse(records[0].time)).not.toBeNaN();
    expect(records[1].details).toMatchObject({ message: 'test failure', stack: expect.stringContaining('test failure') });
  });

  it('rotates files and retains only three archives', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'office-diagnostics-'));
    const file = path.join(directory, 'main.log');
    fs.writeFileSync(file, 'x'.repeat(5 * 1024 * 1024));
    for (let i = 1; i <= 3; i++) fs.writeFileSync(`${file}.${i}`, `archive-${i}`);
    createDiagnosticLog(directory, 'main')('start');
    expect(fs.statSync(`${file}.1`).size).toBe(5 * 1024 * 1024);
    expect(fs.readFileSync(`${file}.3`, 'utf8')).toBe('archive-2');
    expect(fs.existsSync(`${file}.4`)).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).event).toBe('start');
  });

  it('reports a write failure once without crashing the app', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'office-diagnostics-'));
    const blocked = path.join(directory, 'file');
    fs.writeFileSync(blocked, '');
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const log = createDiagnosticLog(blocked, 'main');
    expect(() => { log('one'); log('two'); }).not.toThrow();
    expect(error).toHaveBeenCalledOnce();
  });

  it('bounds oversized error records and rotates before exceeding the file budget', () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'office-diagnostics-'));
    const file = path.join(directory, 'main.log');
    fs.writeFileSync(file, 'x'.repeat(5 * 1024 * 1024 - 10));
    createDiagnosticLog(directory, 'main')('fatal', new Error('x'.repeat(100_000)));
    expect(fs.existsSync(`${file}.1`)).toBe(true);
    expect(fs.statSync(file).size).toBeLessThan(64 * 1024);
    const record = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(record.event).toBe('fatal');
    expect(record.details.truncated).toBe(true);
    expect(record.details.preview).toContain('fatal');
  });
});
