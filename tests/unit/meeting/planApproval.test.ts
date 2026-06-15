import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanApprovalOverlay } from '../../../src/meeting/planApproval';
import type { MeetingPlan } from '../../../src/meeting/types';

function makePlan(): MeetingPlan {
  return {
    plan: 'Decompose and dispatch',
    tasks: [
      { agentId: 'generalist', title: 'Do X', description: 'desc-x', prompt: 'prompt-x' },
      { agentId: 'debugger', title: 'Fix Y', description: 'desc-y', prompt: 'prompt-y' },
    ],
  };
}

describe('meeting/planApproval.PlanApprovalOverlay', () => {
  let overlay: PlanApprovalOverlay;
  let rootChildrenBefore: number;

  beforeEach(() => {
    rootChildrenBefore = document.body.children.length;
    overlay = new PlanApprovalOverlay();
  });

  afterEach(() => {
    overlay.hide();
    // Clean up the overlay container appended to body so subsequent tests stay isolated.
    while (document.body.children.length > rootChildrenBefore) {
      document.body.removeChild(document.body.lastChild!);
    }
  });

  it('show() renders the plan summary and one task card per task', () => {
    overlay.show(makePlan(), { onApprove: vi.fn(), onRevise: vi.fn(), onCancel: vi.fn() });

    // The summary text and both task titles should be present in the DOM.
    expect(document.body.textContent).toContain('Decompose and dispatch');
    expect(document.body.textContent).toContain('Do X');
    expect(document.body.textContent).toContain('Fix Y');
    // Friendly display names from AGENT_DISPLAY.
    expect(document.body.textContent).toContain('Gene');
    expect(document.body.textContent).toContain('Dan');
  });

  it('clicking ✅ Approve invokes onApprove with the plan and hides the overlay', () => {
    const plan = makePlan();
    const onApprove = vi.fn();
    const onRevise = vi.fn();
    const onCancel = vi.fn();
    overlay.show(plan, { onApprove, onRevise, onCancel });

    const approveBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Approve')
    );
    expect(approveBtn).toBeDefined();
    approveBtn!.click();

    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith(plan);
    expect(onRevise).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('clicking ❌ Cancel invokes onCancel and hides the overlay', () => {
    const onApprove = vi.fn();
    const onCancel = vi.fn();
    overlay.show(makePlan(), { onApprove, onRevise: vi.fn(), onCancel });

    const cancelBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Cancel')
    );
    cancelBtn!.click();

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApprove).not.toHaveBeenCalled();
  });

  it('Revise → Send Feedback invokes onRevise with the typed text', () => {
    const onRevise = vi.fn();
    overlay.show(makePlan(), { onApprove: vi.fn(), onRevise, onCancel: vi.fn() });

    const reviseBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Revise')
    );
    reviseBtn!.click();

    const textarea = document.querySelector('textarea')! as HTMLTextAreaElement;
    textarea.value = 'please use generalist instead';

    const sendBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Send Feedback')
    );
    sendBtn!.click();

    expect(onRevise).toHaveBeenCalledTimes(1);
    expect(onRevise).toHaveBeenCalledWith('please use generalist instead');
  });

  it('Revise → empty feedback is ignored (does NOT invoke onRevise)', () => {
    const onRevise = vi.fn();
    overlay.show(makePlan(), { onApprove: vi.fn(), onRevise, onCancel: vi.fn() });

    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Revise'))!
      .click();

    // Leave textarea blank.
    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Send Feedback'))!
      .click();

    expect(onRevise).not.toHaveBeenCalled();
  });

  it('Revise → ← Back returns to the primary action row', () => {
    overlay.show(makePlan(), { onApprove: vi.fn(), onRevise: vi.fn(), onCancel: vi.fn() });

    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Revise'))!
      .click();

    expect(document.querySelector('textarea')).not.toBeNull();

    Array.from(document.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Back'))!
      .click();

    expect(document.querySelector('textarea')).toBeNull();
    expect(
      Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('Approve'))
    ).toBeDefined();
  });

  it('falls back to the raw agentId when an unknown agent appears in a task', () => {
    const plan: MeetingPlan = {
      plan: 'mixed',
      tasks: [{ agentId: 'mystery_agent', title: 'T', description: 'd', prompt: 'p' }],
    };
    overlay.show(plan, { onApprove: vi.fn(), onRevise: vi.fn(), onCancel: vi.fn() });
    expect(document.body.textContent).toContain('mystery_agent');
  });
});
