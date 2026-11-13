import { afterEach, describe, expect, it, vi } from 'vitest';
import { OfficeShortcutActions, OfficeShortcutListener } from '../../../src/input/OfficeShortcutListener';

describe('office keyboard shortcuts', () => {
  let listener: OfficeShortcutListener | undefined;
  afterEach(() => {
    listener?.destroy();
    document.body.innerHTML = '';
  });

  function setup(overrides: Partial<OfficeShortcutActions> = {}) {
    const actions: OfficeShortcutActions = {
      getFocus: () => 'game',
      getAgentIds: () => ['second', 'first'],
      selectAgent: vi.fn(),
      canSelectAgent: () => true,
      openTerminal: vi.fn(),
      hasPcTerminal: () => true,
      ...overrides,
    };
    listener = new OfficeShortcutListener(actions);
    return actions;
  }

  function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document) {
    const event = new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  }

  it('selects by current dashboard order without opening from the overview', () => {
    let order = ['second', 'first'];
    const actions = setup({ getAgentIds: () => order });
    expect(press('1').defaultPrevented).toBe(true);
    expect(actions.selectAgent).toHaveBeenLastCalledWith('second');
    order = ['first', 'second'];
    press('1');
    expect(actions.selectAgent).toHaveBeenLastCalledWith('first');
    expect(actions.openTerminal).not.toHaveBeenCalled();
  });

  it('switches terminals and consumes the shortcut before xterm sees it', () => {
    const actions = setup({ getFocus: () => 'terminal' });
    const xtermHandler = vi.fn();
    document.addEventListener('keydown', xtermHandler);
    press('2');
    document.removeEventListener('keydown', xtermHandler);
    expect(actions.selectAgent).toHaveBeenCalledWith('first');
    expect(actions.openTerminal).toHaveBeenCalledWith('first');
    expect(xtermHandler).not.toHaveBeenCalled();
  });

  it.each(['game', 'terminal'] as const)('opens PC terminal in %s focus', focus => {
    const actions = setup({ getFocus: () => focus });
    press('`', { code: 'Backquote' });
    expect(actions.openTerminal).toHaveBeenCalledWith('pc-terminal');
    expect(actions.selectAgent).not.toHaveBeenCalled();
  });

  it('ignores missing agents, unsupported PC terminals, and held-key repeats', () => {
    const actions = setup({ hasPcTerminal: () => false });
    press('9');
    press('`');
    press('1', { repeat: true });
    expect(actions.selectAgent).not.toHaveBeenCalled();
    expect(actions.openTerminal).not.toHaveBeenCalled();
  });

  it('preserves restricted-layout indices without selecting read-only agents', () => {
    const actions = setup({
      getFocus: () => 'terminal',
      getAgentIds: () => ['read-only', 'architect'],
      canSelectAgent: id => id === 'architect',
    });
    press('1');
    expect(actions.selectAgent).not.toHaveBeenCalled();
    expect(actions.openTerminal).not.toHaveBeenCalled();
    press('2');
    expect(actions.openTerminal).toHaveBeenCalledWith('architect');
  });

  it('does not interfere with other keys, modifiers, or suspended input', () => {
    let focus: 'game' | null = null;
    const actions = setup({ getFocus: () => focus });
    expect(press('1').defaultPrevented).toBe(false);
    focus = 'game';
    for (const [key, init] of [
      ['0', {}], ['a', {}], ['1', { ctrlKey: false }],
      ['1', { shiftKey: true }], ['1', { altKey: true }],
      ['1', { metaKey: true }], ['1', { isComposing: true }],
    ] as [string, KeyboardEventInit][]) {
      expect(press(key, init).defaultPrevented).toBe(false);
    }
    expect(actions.selectAgent).not.toHaveBeenCalled();
  });

  it.each(['xterm', 'copilot-conversation'])('preserves form input but handles %s textarea shortcuts', className => {
    const actions = setup({ getFocus: () => 'terminal' });
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    expect(press('1', {}, textarea).defaultPrevented).toBe(false);
    const xterm = document.createElement('div');
    xterm.className = className;
    document.body.appendChild(xterm);
    xterm.appendChild(textarea);
    expect(press('1', {}, textarea).defaultPrevented).toBe(true);
    expect(actions.openTerminal).toHaveBeenCalledWith('second');
  });

  it('removes its handler on destroy', () => {
    const actions = setup();
    listener?.destroy();
    expect(press('1').defaultPrevented).toBe(false);
    expect(actions.selectAgent).not.toHaveBeenCalled();
  });
});
