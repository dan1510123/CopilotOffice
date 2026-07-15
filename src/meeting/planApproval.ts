import type { MeetingPlan } from './types';
import { injectUiKit, uiButtonClass, type UiButtonVariant } from '../ui/uiKit';

export interface PlanApprovalCallbacks {
  onApprove: (plan: MeetingPlan) => void;
  onRevise: (feedback: string) => void;
  onCancel: () => void;
}

const AGENT_DISPLAY: Record<string, { name: string; color: string }> = {
  generalist: { name: 'Gene', color: '#4488cc' },
  debugger: { name: 'Dan', color: '#22cc44' },
  admin: { name: 'Alice', color: '#ff69b4' },
};

export class PlanApprovalOverlay {
  private container: HTMLDivElement;
  private currentPlan: MeetingPlan | null = null;
  private currentCallbacks: PlanApprovalCallbacks | null = null;

  constructor() {
    this.container = document.createElement('div');
    Object.assign(this.container.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      background: 'rgba(0,0,0,0.7)',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '10002',
      fontFamily: 'monospace',
    });
    document.body.appendChild(this.container);
  }

  show(plan: MeetingPlan, callbacks: PlanApprovalCallbacks): void {
    injectUiKit();
    this.currentPlan = plan;
    this.currentCallbacks = callbacks;
    this.container.innerHTML = '';

    const content = document.createElement('div');
    Object.assign(content.style, {
      maxWidth: '600px',
      width: '90%',
      background: '#1e1e2e',
      borderRadius: '12px',
      padding: '24px',
      maxHeight: '80vh',
      overflowY: 'auto',
      color: '#ccc',
      fontFamily: 'monospace',
    });

    // Header
    const header = document.createElement('h2');
    header.textContent = '📋 Meeting Plan';
    Object.assign(header.style, { color: '#fff', margin: '0 0 16px 0', fontSize: '18px' });
    content.appendChild(header);

    // Plan summary
    const summary = document.createElement('p');
    summary.textContent = plan.plan;
    Object.assign(summary.style, {
      color: '#aaa',
      fontStyle: 'italic',
      margin: '0 0 20px 0',
      lineHeight: '1.5',
    });
    content.appendChild(summary);

    // Task list
    const taskList = document.createElement('div');
    for (const task of plan.tasks) {
      const agent = AGENT_DISPLAY[task.agentId] ?? { name: task.agentId, color: '#888' };

      const card = document.createElement('div');
      Object.assign(card.style, {
        background: '#2a2a3e',
        margin: '8px 0',
        padding: '12px',
        borderRadius: '8px',
        borderLeft: `3px solid ${agent.color}`,
      });

      const taskHeader = document.createElement('div');
      Object.assign(taskHeader.style, { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' });

      const badge = document.createElement('span');
      badge.textContent = agent.name;
      Object.assign(badge.style, { color: agent.color, fontWeight: 'bold', fontSize: '13px' });

      const title = document.createElement('span');
      title.textContent = task.title;
      Object.assign(title.style, { color: '#fff', fontSize: '13px' });

      taskHeader.appendChild(badge);
      taskHeader.appendChild(title);
      card.appendChild(taskHeader);

      const desc = document.createElement('p');
      desc.textContent = task.description;
      Object.assign(desc.style, { color: '#999', margin: '0', fontSize: '12px', lineHeight: '1.4' });
      card.appendChild(desc);

      taskList.appendChild(card);
    }
    content.appendChild(taskList);

    // Actions area
    const actionsContainer = document.createElement('div');
    actionsContainer.style.marginTop = '20px';
    content.appendChild(actionsContainer);

    this.renderButtons(actionsContainer);

    this.container.appendChild(content);
    this.container.style.display = 'flex';
  }

  hide(): void {
    this.container.style.display = 'none';
    this.container.innerHTML = '';
    this.currentPlan = null;
    this.currentCallbacks = null;
  }

  private renderButtons(container: HTMLElement): void {
    container.innerHTML = '';
    const wrapper = document.createElement('div');
    Object.assign(wrapper.style, { display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' });

    const btnApprove = this.createButton('✅ Approve & Execute', 'success');
    btnApprove.addEventListener('click', () => {
      if (this.currentPlan && this.currentCallbacks) {
        const plan = this.currentPlan;
        const cb = this.currentCallbacks;
        this.hide();
        cb.onApprove(plan);
      }
    });

    const btnRevise = this.createButton('✏️ Revise', 'amber');
    btnRevise.addEventListener('click', () => {
      this.renderReviseForm(container);
    });

    const btnCancel = this.createButton('❌ Cancel', 'default');
    btnCancel.addEventListener('click', () => {
      const cb = this.currentCallbacks;
      this.hide();
      cb?.onCancel();
    });

    wrapper.appendChild(btnApprove);
    wrapper.appendChild(btnRevise);
    wrapper.appendChild(btnCancel);
    container.appendChild(wrapper);
  }

  private renderReviseForm(container: HTMLElement): void {
    container.innerHTML = '';

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Tell Arthur what to change...';
    Object.assign(textarea.style, {
      width: '100%',
      minHeight: '80px',
      background: '#2a2a3e',
      color: '#ccc',
      border: '1px solid #555',
      borderRadius: '6px',
      padding: '10px',
      fontFamily: 'monospace',
      fontSize: '13px',
      resize: 'vertical',
      boxSizing: 'border-box',
    });
    container.appendChild(textarea);

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, { display: 'flex', justifyContent: 'center', gap: '8px', marginTop: '12px' });

    const btnSend = this.createButton('📤 Send Feedback', 'amber');
    btnSend.addEventListener('click', () => {
      const feedback = textarea.value.trim();
      if (feedback && this.currentCallbacks) {
        const cb = this.currentCallbacks;
        this.hide();
        cb.onRevise(feedback);
      }
    });

    const btnBack = this.createButton('← Back', 'default');
    btnBack.addEventListener('click', () => {
      this.renderButtons(container);
    });

    btnRow.appendChild(btnSend);
    btnRow.appendChild(btnBack);
    container.appendChild(btnRow);

    textarea.focus();
  }

  private createButton(text: string, variant: UiButtonVariant = 'default'): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.className = uiButtonClass(variant);
    btn.style.padding = '10px 20px';
    btn.style.margin = '0 8px';
    btn.style.fontSize = '13px';
    return btn;
  }
}
