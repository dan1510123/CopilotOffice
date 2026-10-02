import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  beginTransientSessionState,
  classifyExistingTransientBegin,
  getSessionStateDirectory,
  removeTransientSessionStateDirectories,
  restoreTransientSessionState,
  trackTransientSessionId,
  type MutableTransientSessionData,
} from '../../../electron/terminal/transient-session';

const tempDirs: string[] = [];

function data(): MutableTransientSessionData {
  return {
    sessionIds: new Map([
      ['generalist', 'persistent-current'],
      ['debugger', 'unrelated-current'],
    ]),
    sessionHistory: new Map([
      [
        'generalist',
        [
          { id: 'persistent-old', title: 'Older work' },
          { id: 'unrelated-history', title: 'Keep me' },
        ],
      ],
    ]),
    sessionMeta: new Map([
      ['generalist', { title: 'Persistent title' }],
      ['debugger', { title: 'Unrelated agent' }],
    ]),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('transient fleet session state', () => {
  it('lets a new run retry cleanup of a stuck disposing lease', () => {
    const state = data();
    const record = beginTransientSessionState(
      state,
      'generalist',
      'old-run',
      'Fleet task',
      () => 'transient-a',
    );

    expect(classifyExistingTransientBegin(record, 'old-run')).toBe('reuse');
    expect(classifyExistingTransientBegin(record, 'new-run')).toBe('reject');

    record.phase = 'disposing';
    expect(classifyExistingTransientBegin(record, 'new-run')).toBe('cleanup-first');
  });

  it('mints a fresh id while preserving the prior current/title/history snapshot', () => {
    const state = data();
    const record = beginTransientSessionState(
      state,
      'generalist',
      'fleet-run-1',
      'Fleet task',
      () => 'fresh-transient',
    );

    expect(record).toMatchObject({
      lifecycleId: 'fleet-run-1',
      sessionId: 'fresh-transient',
      previousSessionId: 'persistent-current',
      previousMeta: { title: 'Persistent title' },
      phase: 'active',
    });
    expect(record.sessionId).not.toBe(record.previousSessionId);
    expect(state.sessionIds.get('generalist')).toBe('fresh-transient');
    expect(state.sessionMeta.get('generalist')).toEqual({ title: 'Fleet task' });
    expect(state.sessionHistory.get('generalist')).toEqual([
      { id: 'persistent-old', title: 'Older work' },
      { id: 'unrelated-history', title: 'Keep me' },
    ]);
  });

  it('restores the prior pointer/title and removes only transient history entries', () => {
    const state = data();
    const record = beginTransientSessionState(
      state,
      'generalist',
      'fleet-run-1',
      'Fleet task',
      () => 'transient-a',
    );
    trackTransientSessionId(record, 'transient-after-clear');
    state.sessionIds.set('generalist', 'transient-after-clear');
    state.sessionHistory.set('generalist', [
      { id: 'persistent-old', title: 'Older work' },
      { id: 'transient-a', title: 'Fleet task' },
      { id: 'unrelated-history', title: 'Keep me' },
    ]);

    const restored = restoreTransientSessionState(state, 'generalist', record);

    expect(restored.restoredSessionId).toBe('persistent-current');
    expect(state.sessionIds.get('generalist')).toBe('persistent-current');
    expect(state.sessionMeta.get('generalist')).toEqual({ title: 'Persistent title' });
    expect(state.sessionHistory.get('generalist')).toEqual([
      { id: 'persistent-old', title: 'Older work' },
      { id: 'unrelated-history', title: 'Keep me' },
    ]);
    expect(state.sessionIds.get('debugger')).toBe('unrelated-current');
    expect(state.sessionMeta.get('debugger')).toEqual({ title: 'Unrelated agent' });
  });

  it('is idempotent when duplicate terminal events trigger restoration twice', () => {
    const state = data();
    const record = beginTransientSessionState(
      state,
      'generalist',
      'fleet-run-1',
      'Fleet task',
      () => 'transient-a',
    );

    restoreTransientSessionState(state, 'generalist', record);
    restoreTransientSessionState(state, 'generalist', record);

    expect(state.sessionIds.get('generalist')).toBe('persistent-current');
    expect(state.sessionMeta.get('generalist')).toEqual({ title: 'Persistent title' });
    expect(state.sessionHistory.get('generalist')).toEqual([
      { id: 'persistent-old', title: 'Older work' },
      { id: 'unrelated-history', title: 'Keep me' },
    ]);
  });

  it('does not overwrite a newer non-transient current pointer', () => {
    const state = data();
    const record = beginTransientSessionState(
      state,
      'generalist',
      'fleet-run-1',
      'Fleet task',
      () => 'transient-a',
    );
    state.sessionIds.set('generalist', 'newer-persistent');
    state.sessionMeta.set('generalist', { title: 'Newer work' });

    const restored = restoreTransientSessionState(state, 'generalist', record);

    expect(restored.restoredCurrent).toBe(false);
    expect(state.sessionIds.get('generalist')).toBe('newer-persistent');
    expect(state.sessionMeta.get('generalist')).toEqual({ title: 'Newer work' });
  });

  it('deletes only transient Copilot session-state directories', async () => {
    const copilotHome = fs.mkdtempSync(path.join(os.tmpdir(), 'copilot-transient-test-'));
    tempDirs.push(copilotHome);
    const state = data();
    const record = beginTransientSessionState(
      state,
      'generalist',
      'fleet-run-1',
      'Fleet task',
      () => 'transient-a',
    );
    trackTransientSessionId(record, 'transient-b');

    const persistentDir = getSessionStateDirectory('persistent-current', copilotHome);
    const transientADir = getSessionStateDirectory('transient-a', copilotHome);
    const transientBDir = getSessionStateDirectory('transient-b', copilotHome);
    for (const dir of [persistentDir, transientADir, transientBDir]) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'events.jsonl'), '{}\n');
    }

    await removeTransientSessionStateDirectories(record, copilotHome);

    expect(fs.existsSync(persistentDir)).toBe(true);
    expect(fs.existsSync(transientADir)).toBe(false);
    expect(fs.existsSync(transientBDir)).toBe(false);
  });
});
