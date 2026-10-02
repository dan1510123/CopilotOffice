import { describe, expect, it, vi } from 'vitest';
import {
  deliverPreseededPrompt,
  PreseededPromptQueue,
} from '../../../electron/terminal/preseeded-prompt';

describe('deliverPreseededPrompt', () => {
  it('uses the atomic programmatic transport when available', async () => {
    const process = {
      submitPrompt: vi.fn(async () => {}),
      write: vi.fn(),
    };

    await expect(deliverPreseededPrompt(process, 'fleet task')).resolves.toBe(true);
    expect(process.submitPrompt).toHaveBeenCalledWith('fleet task');
    expect(process.write).not.toHaveBeenCalled();
  });

  describe('PreseededPromptQueue', () => {
    it('preserves every coalesced start prompt in caller order and drains once', () => {
      const queue = new PreseededPromptQueue();
      queue.push('office:agent', 'first');
      queue.push('office:agent', 'second');
      queue.push('office:agent', undefined);

      expect(queue.take('office:agent')).toEqual(['first', 'second']);
      expect(queue.take('office:agent')).toEqual([]);
    });

    it('drops stale prompts on session teardown', () => {
      const queue = new PreseededPromptQueue();
      queue.push('office:a', 'old-a');
      queue.push('office:b', 'old-b');
      queue.delete('office:a');

      expect(queue.take('office:a')).toEqual([]);
      expect(queue.take('office:b')).toEqual(['old-b']);

      queue.push('office:c', 'old-c');
      queue.clear();
      expect(queue.take('office:c')).toEqual([]);
    });
  });

  it('falls back to raw input only for processes without a programmatic transport', async () => {
    const process = { write: vi.fn() };

    await expect(deliverPreseededPrompt(process, 'legacy task')).resolves.toBe(true);
    expect(process.write).toHaveBeenCalledWith('legacy task\r');
  });

  it('does nothing when no prompt was supplied', async () => {
    const process = { submitPrompt: vi.fn(), write: vi.fn() };

    await expect(deliverPreseededPrompt(process, undefined)).resolves.toBe(false);
    expect(process.submitPrompt).not.toHaveBeenCalled();
    expect(process.write).not.toHaveBeenCalled();
  });
});
