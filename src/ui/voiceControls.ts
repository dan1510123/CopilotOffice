import { VoiceController } from '../voice/VoiceController';

export function voiceControls(agentId: string, enabled: boolean, compact = false): string {
  const escaped = agentId.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const style = compact ? 'font-size: 10px; padding: 3px 4px;' : '';
  return `<span hidden style="display: none; ${compact ? 'flex-direction: column;' : ''} gap: 4px;">
    <button class="ui-btn ui-btn--primary" data-voice-agent="${escaped}"
    title="Hold to talk (English, on-device). Release to send." aria-label="Hold to talk"
    aria-pressed="false" style="touch-action: none; ${style}"${enabled ? '' : ' disabled'}>Hold to talk</button>
    <button class="ui-btn ui-btn--ghost" data-voice-stop style="${style}"
      title="Cancel recording or stop spoken reply">Stop voice</button></span>`;
}

/** Document-level release survives dashboard/card replacement during a recording. */
export function bindVoiceControls(controller: VoiceController): () => void {
  let pointer: number | null = null;
  let key: string | null = null;
  const button = (event: Event) => event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('[data-voice-agent], [data-voice-stop]') : null;
  const down = (event: PointerEvent) => {
    const target = button(event);
    if (!target || target.disabled || event.button !== 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target.hasAttribute('data-voice-stop')) { controller.cancel(); return; }
    if (pointer !== null || key !== null) return;
    pointer = event.pointerId;
    void controller.press(target.dataset.voiceAgent!);
  };
  const up = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    pointer = null;
    void controller.release();
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && controller.state.phase !== 'idle') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
      return;
    }
    const target = button(event);
    if (!target || target.disabled || ![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    if (target.hasAttribute('data-voice-stop')) { cancel(); return; }
    if (key !== null || pointer !== null) return;
    key = event.key;
    void controller.press(target.dataset.voiceAgent!);
  };
  const keyup = (event: KeyboardEvent) => {
    if (event.key !== key) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    key = null;
    void controller.release();
  };
  const cancel = () => { pointer = null; key = null; controller.cancel(); };
  const click = (event: Event) => {
    const target = button(event);
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (target.hasAttribute('data-voice-stop')) cancel();
  };
  const visibility = () => { if (document.hidden) cancel(); };
  document.addEventListener('pointerdown', down, true);
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', cancel, true);
  document.addEventListener('keydown', keydown, true);
  document.addEventListener('keyup', keyup, true);
  document.addEventListener('click', click, true);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    cancel();
    document.removeEventListener('pointerdown', down, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', cancel, true);
    document.removeEventListener('keydown', keydown, true);
    document.removeEventListener('keyup', keyup, true);
    document.removeEventListener('click', click, true);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', visibility);
  };
}
