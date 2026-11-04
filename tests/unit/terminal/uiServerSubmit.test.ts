import { describe, expect, it, vi } from 'vitest';
import { answerTransport, UiServerProcess } from '../../../electron/terminal/terminal-backend';

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

describe('UiServerProcess.submitAnswer', () => {
  function makeAnswerFakes() {
    const handlePendingUserInput = vi.fn(async (_request: {
      requestId: string;
      response: { answer: string; wasFreeform: boolean };
    }) => ({ success: true }));
    const send = vi.fn(async () => 'msg-id');
    const write = vi.fn();
    const proc = new UiServerProcess(
      'sess-1',
      { send, disconnect: vi.fn(), rpc: { ui: { handlePendingUserInput } } },
      { status: 'ready', rawPty: { write } } as never,
      { setForeground: vi.fn() } as never,
    );
    return { proc, handlePendingUserInput, send, write };
  }

  it.each([false, true])('resolves the exact runtime request without a local callback (freeform=%s)', async (wasFreeform) => {
    const { proc, handlePendingUserInput, send, write } = makeAnswerFakes();
    expect(answerTransport(proc)).toBe('bridge');
    await proc.submitAnswer({ requestId: 'req-1', answer: 'Option A', wasFreeform });
    expect(handlePendingUserInput).toHaveBeenCalledExactlyOnceWith({
      requestId: 'req-1',
      response: { answer: 'Option A', wasFreeform },
    });
    expect(send).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects an unresolved request instead of reporting success or typing a fallback', async () => {
    const { proc, handlePendingUserInput, send, write } = makeAnswerFakes();
    handlePendingUserInput.mockResolvedValue({ success: false });
    await expect(proc.submitAnswer({ requestId: 'stale', answer: 'A', wasFreeform: false }))
      .rejects.toThrow('no longer pending');
    expect(send).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('propagates RPC failure without sending a prompt or keystrokes', async () => {
    const { proc, handlePendingUserInput, send, write } = makeAnswerFakes();
    handlePendingUserInput.mockRejectedValue(new Error('connection lost'));
    await expect(proc.submitAnswer({ requestId: 'req-1', answer: 'A', wasFreeform: false }))
      .rejects.toThrow('connection lost');
    expect(send).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects a missing request ID before calling the runtime', async () => {
    const { proc, handlePendingUserInput } = makeAnswerFakes();
    await expect(proc.submitAnswer({ answer: 'A', wasFreeform: false })).rejects.toThrow('request ID');
    expect(handlePendingUserInput).not.toHaveBeenCalled();
  });

  it('rejects answers on a closed session', async () => {
    const { proc, handlePendingUserInput } = makeAnswerFakes();
    proc.kill();
    await expect(proc.submitAnswer({ requestId: 'req-1', answer: 'A', wasFreeform: false }))
      .rejects.toThrow('closed session');
    expect(handlePendingUserInput).not.toHaveBeenCalled();
  });

  it('reports an unsupported RPC explicitly', async () => {
    const { proc, send, runtime } = makeFakes();
    await expect(proc.submitAnswer({ requestId: 'req-1', answer: 'A', wasFreeform: false }))
      .rejects.toThrow('not supported');
    expect(send).not.toHaveBeenCalled();
    expect(runtime.rawPty.write).not.toHaveBeenCalled();
  });
});

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

describe('UiServerProcess.write readiness gating (T028 / FR-020)', () => {
  function makeWithStatus(status: string) {
    const rawWrite = vi.fn();
    const runtime = { status, rawPty: { write: rawWrite } };
    const proc = new UiServerProcess(
      'sess-w',
      { send: vi.fn(() => Promise.resolve('id')), disconnect: vi.fn() } as never,
      runtime as never,
      { setForeground: vi.fn(() => Promise.resolve()) } as never,
    );
    return { proc, rawWrite };
  }

  it('drops human input while the runtime is still launching (not yet ready)', () => {
    const { proc, rawWrite } = makeWithStatus('launching');
    proc.write('keystrokes');
    expect(rawWrite).not.toHaveBeenCalled();
  });

  it.each(['crashed', 'stopped'])('drops input when the runtime is %s', (status) => {
    const { proc, rawWrite } = makeWithStatus(status);
    proc.write('x');
    expect(rawWrite).not.toHaveBeenCalled();
  });

  it.each(['listening', 'ready'])('forwards input once the runtime is %s', (status) => {
    const { proc, rawWrite } = makeWithStatus(status);
    proc.write('hello');
    expect(rawWrite).toHaveBeenCalledWith('hello');
  });
});

describe('UiServerProcess.setForeground (T023 / US3)', () => {
  it('asks the control-plane client to foreground this session', async () => {
    const setForeground = vi.fn(() => Promise.resolve());
    const proc = new UiServerProcess(
      'sess-fg',
      { send: vi.fn(() => Promise.resolve('id')), disconnect: vi.fn() } as never,
      { status: 'ready', rawPty: { write: vi.fn() } } as never,
      { setForeground } as never,
    );
    await proc.setForeground!();
    expect(setForeground).toHaveBeenCalledWith('sess-fg');
  });
});
