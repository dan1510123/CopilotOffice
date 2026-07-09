import { describe, expect, it, vi } from 'vitest';
import { UiServerProcess } from '../../../electron/terminal/terminal-backend';

/**
 * T012 (US1): UiServerProcess.submitPrompt must submit programmatic prompts as a
 * single atomic SDK turn via session.send({ mode: 'enqueue' }), be multi-line safe,
 * and NEVER include the display-only label in the text sent to the agent (FR-004/017).
 */

function makeFakes(sendImpl?: (req: unknown) => Promise<unknown>) {
  const send = vi.fn(sendImpl ?? (() => Promise.resolve('msg-id')));
  const session = { send, disconnect: vi.fn(() => Promise.resolve()) };
  const runtime = { status: 'ready', rawPty: { write: vi.fn() } };
  const client = { setForeground: vi.fn(() => Promise.resolve()) };
  const proc = new UiServerProcess(
    'sess-1',
    session as never,
    runtime as never,
    client as never,
  );
  return { proc, send, runtime };
}

const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

describe('UiServerProcess.submitPrompt (T012)', () => {
  it('sends a single enqueue turn with the exact prompt text', async () => {
    const { proc, send } = makeFakes();
    proc.submitPrompt!('hello world');
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ prompt: 'hello world', mode: 'enqueue' });
  });

  it('preserves multi-line prompts as one turn (no early submit on newlines)', async () => {
    const { proc, send } = makeFakes();
    const multi = 'line one\nline two\nline three';
    proc.submitPrompt!(multi);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({ prompt: multi, mode: 'enqueue' });
  });

  it('never includes the display-only label in the text sent to the agent', async () => {
    const { proc, send } = makeFakes();
    proc.submitPrompt!('do the thing', 'Teams · Alice');
    await flush();
    const arg = send.mock.calls[0][0] as { prompt: string };
    expect(arg.prompt).toBe('do the thing');
    expect(arg.prompt).not.toContain('Teams');
    expect(arg.prompt).not.toContain('Alice');
  });

  it('serializes multiple prompts in order behind one another', async () => {
    const order: string[] = [];
    const { proc } = makeFakes(async (req) => { order.push((req as { prompt: string }).prompt); return 'id'; });
    proc.submitPrompt!('first');
    proc.submitPrompt!('second');
    await flush();
    expect(order).toEqual(['first', 'second']);
  });

  it('does not submit once the process is closed', async () => {
    const { proc, send } = makeFakes();
    proc.kill();
    proc.submitPrompt!('after close');
    await flush();
    expect(send).not.toHaveBeenCalled();
  });
});
