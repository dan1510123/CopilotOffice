import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from '../../../src/ui/SettingsPanel';
import { NotificationService } from '../../../src/ui/NotificationService';
import { ToastNotificationManager } from '../../../src/ui/ToastNotification';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

function openPanel(
  setYolo: (enabled: boolean) => Promise<{ success: boolean; error?: string }>,
  ringleader = {
    orchestratorGetSettings: async () => ({ success: true, settings: { allowAllOperations: false } }),
    orchestratorSaveSettings: async (settings: { allowAllOperations: boolean }): Promise<{ success: boolean; settings?: { allowAllOperations: boolean }; error?: string }> =>
      ({ success: true, settings }),
  },
) {
  vi.stubGlobal('copilotBridge', { setYolo, ...ringleader });
  const service = new NotificationService(new ToastNotificationManager(document.body), () => undefined);
  const panel = new SettingsPanel(service, {
    onBgmVolumeChange: () => {},
    onBgmMuteChange: () => {},
    getBgmMuted: () => true,
    setBgmMuted: () => {},
  });
  panel.open();
  const checkbox = document.querySelector<HTMLInputElement>('#settings-yolo-mode')!;
  return { panel, checkbox };
}

describe('SettingsPanel Ringleader approval setting', () => {
  it('loads saved settings and saves changes without updating agent YOLO', async () => {
    const setYolo = vi.fn(async () => ({ success: true }));
    const save = vi.fn(async (settings: { allowAllOperations: boolean }) => ({ success: true, settings }));
    const { panel } = openPanel(setYolo, {
      orchestratorGetSettings: async () => ({ success: true, settings: { allowAllOperations: true } }),
      orchestratorSaveSettings: save,
    });
    const checkbox = document.querySelector<HTMLInputElement>('#settings-ringleader-allow-all')!;
    await vi.waitFor(() => expect(checkbox.disabled).toBe(false));
    expect(checkbox.checked).toBe(true);
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(checkbox.disabled).toBe(true);
    await vi.waitFor(() => expect(checkbox.disabled).toBe(false));
    expect(save).toHaveBeenCalledWith({ allowAllOperations: false });
    expect(setYolo).not.toHaveBeenCalled();
    panel.close();
  });

  it('restores the saved value and displays persistence errors', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { panel } = openPanel(async () => ({ success: true }), {
      orchestratorGetSettings: async () => ({ success: true, settings: { allowAllOperations: false } }),
      orchestratorSaveSettings: async () => ({ success: false, error: 'Disk full' }),
    });
    const checkbox = document.querySelector<HTMLInputElement>('#settings-ringleader-allow-all')!;
    await vi.waitFor(() => expect(checkbox.disabled).toBe(false));
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.querySelector('#settings-ringleader-error')?.textContent).toContain('Disk full'));
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(false);
    panel.close();
  });
});

describe('SettingsPanel live YOLO updates', () => {
  it('waits for the server to apply the setting', async () => {
    let finish!: (result: { success: boolean }) => void;
    const setYolo = vi.fn(() => new Promise<{ success: boolean }>((resolve) => { finish = resolve; }));
    const { checkbox, panel } = openPanel(setYolo);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(setYolo).toHaveBeenCalledWith(true);
    expect(checkbox.disabled).toBe(true);
    finish({ success: true });
    await vi.waitFor(() => expect(checkbox.disabled).toBe(false));
    expect(document.querySelector('#settings-yolo-error')?.textContent).toBe('');
    panel.close();
  });

  it('shows a runtime rejection instead of silently claiming all sessions were updated', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { checkbox, panel } = openPanel(async () => ({ success: false, error: 'Permission policy rejected allow-all' }));
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      expect(document.querySelector('#settings-yolo-error')?.textContent).toContain('Permission policy rejected allow-all');
    });
    expect(checkbox.disabled).toBe(false);
    panel.close();
  });
});
