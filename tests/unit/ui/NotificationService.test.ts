import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultSettings } from '../../../src/config/notifications';
import { NotificationService } from '../../../src/ui/NotificationService';

describe('ui/NotificationService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function createService() {
    const toastManager = { show: vi.fn() };
    const resolveAgent = (agentId: string) =>
      agentId === 'generalist' ? { name: 'Gene', color: 0x4488cc } : undefined;
    const onClickAgent = vi.fn();
    const service = new NotificationService(toastManager as any, resolveAgent, onClickAgent);
    const settings = getDefaultSettings();
    settings.events.turnStart.enabled = true;
    settings.events.turnStart.toast = true;
    service.updateSettings(settings);
    return { service, toastManager, onClickAgent };
  }

  it('skips notifications for selected agent', () => {
    const { service, toastManager } = createService();
    service.notify('generalist', 'turnEnd', undefined, 'generalist');
    expect(toastManager.show).not.toHaveBeenCalled();
  });

  it('dedupes same event type but not different event types', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const { service, toastManager } = createService();
    service.notify('generalist', 'turnEnd');
    service.notify('generalist', 'turnEnd');
    service.notify('generalist', 'turnStart');

    expect(toastManager.show).toHaveBeenCalledTimes(2);
  });

  it('formats tool placeholders and dispatches native notifications', async () => {
    const { service, toastManager } = createService();
    const settings = service.getSettings();
    settings.events.toolStart.enabled = true;
    settings.events.toolStart.toast = true;
    settings.events.toolStart.osNotification = true;
    service.updateSettings(settings);

    service.notify('generalist', 'toolStart', { toolName: 'edit' });

    expect(toastManager.show).toHaveBeenCalled();
    const toastPayload = (toastManager.show as any).mock.calls[0][0];
    expect(toastPayload.message).toContain('edit');
    expect(window.copilotBridge.showNativeNotification).toHaveBeenCalled();
    await Promise.resolve();
  });

  it('ignores unknown agents', () => {
    const { service, toastManager } = createService();
    service.notify('unknown', 'turnEnd');
    expect(toastManager.show).not.toHaveBeenCalled();
  });
});

