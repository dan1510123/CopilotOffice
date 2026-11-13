export interface OfficeShortcutActions {
  getFocus: () => 'game' | 'terminal' | null;
  getAgentIds: () => string[];
  selectAgent: (agentId: string) => void;
  canSelectAgent: (agentId: string) => boolean;
  openTerminal: (agentId: string) => void;
  hasPcTerminal: () => boolean;
}

/** App-lifetime shortcuts shared by the game and serious-mode terminal. */
export class OfficeShortcutListener {
  constructor(private readonly actions: OfficeShortcutActions) {
    window.addEventListener('keydown', this.onKeydown, true);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeydown, true);
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey || event.isComposing) return;
    const isPc = event.code === 'Backquote' || event.key === '`';
    if (!isPc && !/^[1-9]$/.test(event.key)) return;

    const target = event.target;
    if (target instanceof HTMLElement && !target.closest('.xterm, .copilot-conversation') &&
        (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'))) return;
    const focus = this.actions.getFocus();
    if (!focus) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;

    if (isPc) {
      if (this.actions.hasPcTerminal()) this.actions.openTerminal('pc-terminal');
      return;
    }

    const agentId = this.actions.getAgentIds()[Number(event.key) - 1];
    if (!agentId || !this.actions.canSelectAgent(agentId)) return;
    this.actions.selectAgent(agentId);
    if (focus === 'terminal') this.actions.openTerminal(agentId);
  };
}
