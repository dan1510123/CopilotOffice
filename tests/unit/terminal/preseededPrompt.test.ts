import { describe, expect, it, vi } from 'vitest';
import { deliverPreseededPrompt } from '../../../electron/terminal/preseeded-prompt';

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
