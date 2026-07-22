import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { createAutoImageRenderer } from '../../../electron/teams/autoImageRenderer';

/** Minimal fake ChildProcess that emits a valid sentinel then closes with exit 0. */
function fakeChild(sentinel: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { end: (d?: unknown) => void };
    kill: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: () => void 0 };
  child.kill = () => void 0;
  // Emit output + close on next tick so listeners are attached first.
  setImmediate(() => {
    child.stdout.emit('data', Buffer.from(sentinel));
    child.emit('close', 0);
  });
  return child;
}

describe('autoImageRenderer — render() passes workingDir straight through as --cwd', () => {
  it('forwards the (already-normalized) workingDir verbatim to the child', async () => {
    const spawnCalls: string[][] = [];
    const spawn = vi.fn((_exe: string, args: readonly string[]) => {
      spawnCalls.push([...args]);
      return fakeChild('<!--office-image:.office-images/reply-x.png-->') as never;
    });

    const renderer = createAutoImageRenderer({
      rendererPath: 'C:\\repo\\.github\\skills\\office-image-teams-reply\\render-markdown-image.mjs',
      probe: () => true,
      spawn: spawn as never,
    });

    const res = await renderer.render('# hi\n\n' + 'x'.repeat(1200), 'C:\\Users\\me\\repos\\proj');
    expect(res.ok).toBe(true);

    // args = [rendererPath, '--cwd', cwd]
    const args = spawnCalls[0];
    const cwdIdx = args.indexOf('--cwd');
    expect(cwdIdx).toBeGreaterThanOrEqual(0);
    expect(args[cwdIdx + 1]).toBe('C:\\Users\\me\\repos\\proj');
  });
});
