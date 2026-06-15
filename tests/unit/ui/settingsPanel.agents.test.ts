import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsPanel } from '../../../src/ui/SettingsPanel';
import {
  STORAGE_KEY as AUTO_START_STORAGE_KEY,
} from '../../../src/config/agentAutoStart';

function makeService() {
  return {
    getSettings: vi.fn(() => ({
      dedupeWindowMs: 2000,
      events: {
        turnEnd: { enabled: true, toast: true, osNotification: false, message: '' },
        askUser: { enabled: true, toast: true, osNotification: false, message: '' },
        turnStart: { enabled: false, toast: false, osNotification: false, message: '' },
        toolStart: { enabled: false, toast: false, osNotification: false, message: '' },
        toolComplete: { enabled: false, toast: false, osNotification: false, message: '' },
        sessionReady: { enabled: true, toast: true, osNotification: false, message: '' },
        sessionError: { enabled: true, toast: true, osNotification: true, message: '' },
      },
    })),
    updateSettings: vi.fn(),
    notify: vi.fn(),
  };
}

function makePanel() {
  const service = makeService();
  const callbacks = {
    onBgmVolumeChange: vi.fn(),
    onBgmMuteChange: vi.fn(),
    getBgmMuted: vi.fn(() => false),
    setBgmMuted: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
  };
  return { panel: new SettingsPanel(service as any, callbacks), callbacks, service };
}

beforeEach(() => {
  try {
    localStorage.clear();
  } catch { /* ignore */ }
  // Strip any lingering overlay from a prior test.
  document.querySelectorAll('#settings-overlay').forEach((el) => el.remove());
});

describe('ui/SettingsPanel — Agents section (spec 009 T601)', () => {
  it('renders an Agents section with the auto-start checkbox above Notifications', () => {
    const { panel } = makePanel();
    panel.open();
    const overlay = document.querySelector('#settings-overlay');
    expect(overlay).toBeTruthy();
    const html = overlay!.innerHTML;
    const agentsIdx = html.indexOf('Agents');
    const notifIdx = html.indexOf('Notifications');
    expect(agentsIdx).toBeGreaterThanOrEqual(0);
    expect(notifIdx).toBeGreaterThan(agentsIdx);
    const cb = document.querySelector('#settings-agent-auto-start') as HTMLInputElement;
    expect(cb).toBeTruthy();
    // Label is present
    expect(html).toContain('Auto-start known agents');
    panel.close();
  });

  it('defaults to checked when localStorage is empty', () => {
    const { panel } = makePanel();
    panel.open();
    const cb = document.querySelector('#settings-agent-auto-start') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    panel.close();
  });

  it('toggling the checkbox persists to localStorage immediately', () => {
    const { panel } = makePanel();
    panel.open();
    const cb = document.querySelector('#settings-agent-auto-start') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    const raw = localStorage.getItem(AUTO_START_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ autoStartKnownAgents: false });
    panel.close();
  });

  it('re-opening the panel reflects the persisted value', () => {
    localStorage.setItem(
      AUTO_START_STORAGE_KEY,
      JSON.stringify({ autoStartKnownAgents: false }),
    );
    const { panel } = makePanel();
    panel.open();
    const cb = document.querySelector('#settings-agent-auto-start') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    panel.close();
  });
});
