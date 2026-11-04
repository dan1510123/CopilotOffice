import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceController, type VoiceDependencies } from '../../../src/voice/VoiceController';
import type { VoiceTarget } from '../../../src/voice/types';

const target: VoiceTarget = { officeId: 'office-a', agentId: 'dynamic-agent', sessionId: 'session-1' };

function setup(overrides: Partial<VoiceDependencies> = {}) {
  const recording = { stop: vi.fn().mockResolvedValue(new Float32Array(1600).fill(0.1)), cancel: vi.fn() };
  const deps = {
    resolveTarget: vi.fn().mockResolvedValue(target),
    isCurrent: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(undefined),
    record: vi.fn().mockResolvedValue(recording),
    transcribe: vi.fn().mockResolvedValue('Explain this change'),
    submit: vi.fn().mockResolvedValue({ success: true }),
    speak: vi.fn().mockResolvedValue(undefined),
    stopSpeaking: vi.fn(),
    changed: vi.fn(),
    ...overrides,
  };
  return { controller: new VoiceController(deps), deps, recording };
}

let nextEventId = 0;
function event(controller: VoiceController, type: string, content = '', scope = target, id = String(++nextEventId)) {
  controller.event(scope, { id, type, data: { content } });
}

afterEach(() => vi.useRealTimers());

describe('push-to-talk voice controller', () => {
  it('matches supported alternative message fields before speaking', async () => {
    const { controller, deps } = setup();
    await controller.press(target.agentId);
    await controller.release();
    controller.event(target, { id: 'user', type: 'user.message', data: { prompt: 'Explain this change' } });
    controller.event(target, { id: 'reply', type: 'assistant.message', data: { text: 'Answer' } });
    event(controller, 'assistant.turn_end');
    expect(deps.speak).toHaveBeenCalledExactlyOnceWith('Answer', expect.any(Function), expect.any(Function));
    controller.cancel();
  });
  it('submits exactly once on release to the original office/agent/session', async () => {
    const { controller, deps, recording } = setup();
    await controller.press(target.agentId);
    expect(controller.state.phase).toBe('recording');
    await controller.press('second-agent');
    expect(deps.record).toHaveBeenCalledTimes(1);
    await controller.release();
    await controller.release();
    expect(recording.stop).toHaveBeenCalledTimes(1);
    expect(deps.submit).toHaveBeenCalledExactlyOnceWith(target, 'Explain this change');
    controller.cancel();
  });

  it('ignores a late permission grant after release, and releases its microphone', async () => {
    let grant!: (recording: { stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }) => void;
    const pending = new Promise<{ stop: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> }>((resolve) => { grant = resolve; });
    const { controller, recording, deps } = setup({ record: () => pending });
    const press = controller.press(target.agentId);
    await vi.waitFor(() => expect(controller.state.target).toEqual(target));
    await controller.release();
    grant(recording);
    await press;
    expect(recording.cancel).toHaveBeenCalledOnce();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('does not send when the session is replaced during transcription', async () => {
    let current = true;
    const { controller, deps } = setup({
      isCurrent: () => current,
      transcribe: async () => { current = false; return 'Wrong session'; },
    });
    await controller.press(target.agentId);
    await controller.release();
    expect(deps.submit).not.toHaveBeenCalled();
    expect(controller.state).toMatchObject({ phase: 'error', detail: expect.stringContaining('not sent') });
  });

  it('cancels capture without submitting on office switch or blur', async () => {
    const { controller, recording, deps } = setup();
    await controller.press(target.agentId);
    controller.cancel();
    await controller.release();
    expect(recording.cancel).toHaveBeenCalledOnce();
    expect(deps.submit).not.toHaveBeenCalled();
    expect(controller.state.phase).toBe('idle');
  });

  it('rejects silence before transcription and surfaces backend failures', async () => {
    const silent = setup({ record: async () => ({ cancel() {}, stop: async () => new Float32Array(1600) }) });
    await silent.controller.press(target.agentId);
    await silent.controller.release();
    expect(silent.deps.transcribe).not.toHaveBeenCalled();
    expect(silent.controller.state.detail).toContain('No speech');
    const unsupported = setup({ submit: async () => ({ success: false, error: 'node-pty does not support programmatic prompts' }) });
    await unsupported.controller.press(target.agentId);
    await unsupported.controller.release();
    expect(unsupported.controller.state.detail).toContain('node-pty');
  });

  it('speaks only the matching voice turn final response, not deltas or other offices', async () => {
    const { controller, deps } = setup();
    await controller.press(target.agentId);
    await controller.release();
    event(controller, 'assistant.message', 'Unrelated');
    event(controller, 'user.message', 'Explain this change', { ...target, officeId: 'other-office' });
    event(controller, 'assistant.turn_end');
    expect(deps.speak).not.toHaveBeenCalled();
    event(controller, 'user.message', 'Explain this change');
    event(controller, 'assistant.message_delta', 'Partial');
    event(controller, 'assistant.message', 'Final response');
    event(controller, 'assistant.turn_end');
    event(controller, 'session.idle');
    expect(deps.speak).toHaveBeenCalledExactlyOnceWith('Final response', expect.any(Function), expect.any(Function));
    controller.cancel();
  });

  it('does not read a new typed or Teams turn as a voice reply', async () => {
    const { controller, deps } = setup();
    await controller.press(target.agentId);
    await controller.release();
    event(controller, 'user.message', 'Something typed elsewhere');
    event(controller, 'assistant.message', 'Not a voice reply');
    event(controller, 'session.idle');
    expect(deps.speak).not.toHaveBeenCalled();
    expect(controller.state.phase).toBe('idle');
  });

  it('limits recording to thirty seconds and handles microphone/model errors', async () => {
    vi.useFakeTimers();
    const { controller, deps } = setup();
    await controller.press(target.agentId);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(deps.submit).toHaveBeenCalledOnce();
    controller.cancel();
    const denied = setup({ record: async () => { throw new Error('Permission denied'); } });
    await denied.controller.press(target.agentId);
    expect(denied.controller.state.detail).toBe('Permission denied');
    const failed = setup({ load: async () => { throw new Error('Model download failed'); } });
    await failed.controller.press(target.agentId);
    expect(failed.controller.state.detail).toBe('Model download failed');
  });
});
