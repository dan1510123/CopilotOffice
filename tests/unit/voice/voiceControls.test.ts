import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindVoiceControls, voiceControls } from '../../../src/ui/voiceControls';
import { VoiceController } from '../../../src/voice/VoiceController';
import { LocalSpeech, spokenText } from '../../../src/voice/speech';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('voice card controls', () => {
  it.each([false, true])('hides voice buttons on regular and compact surfaces (compact=%s)', (compact) => {
    document.body.innerHTML = voiceControls('custom-agent', true, compact);
    const host = document.querySelector<HTMLElement>('span')!;
    expect(host.hidden).toBe(true);
    expect(getComputedStyle(host).display).toBe('none');
    expect(host.querySelectorAll('button')).toHaveLength(2);
  });

  it('isolates keyboard PTT and stop from the underlying card click', () => {
    document.body.innerHTML = `<div class="agent-card">${voiceControls('custom-agent', true)}</div>`;
    const controller = new VoiceController({
      resolveTarget: vi.fn(), isCurrent: () => true, load: vi.fn(), record: vi.fn(),
      transcribe: vi.fn(), submit: vi.fn(), speak: vi.fn(), stopSpeaking: vi.fn(), changed: vi.fn(),
    });
    const press = vi.spyOn(controller, 'press').mockResolvedValue();
    const release = vi.spyOn(controller, 'release').mockResolvedValue();
    const cancel = vi.spyOn(controller, 'cancel').mockImplementation(() => {});
    const cardClick = vi.fn();
    document.querySelector('.agent-card')!.addEventListener('click', cardClick);
    const unbind = bindVoiceControls(controller);
    const button = document.querySelector<HTMLButtonElement>('[data-voice-agent]')!;
    button.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
    // Live card refresh removes the button before keyup.
    document.querySelector('.agent-card')!.innerHTML = voiceControls('custom-agent', true);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    document.querySelector<HTMLButtonElement>('[data-voice-agent]')!.click();
    document.querySelector<HTMLButtonElement>('[data-voice-stop]')!.click();
    expect(press).toHaveBeenCalledExactlyOnceWith('custom-agent');
    expect(release).toHaveBeenCalledOnce();
    expect(cardClick).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    unbind();
  });

  it('renders disabled for inactive sessions and escapes dynamic agent identifiers', () => {
    document.body.innerHTML = voiceControls('a" onclick="bad', false);
    const button = document.querySelector<HTMLButtonElement>('[data-voice-agent]')!;
    expect(button.disabled).toBe(true);
    expect(button.dataset.voiceAgent).toBe('a" onclick="bad');
    expect(button.hasAttribute('onclick')).toBe(false);
  });

  it('removes code and markdown from spoken replies', () => {
    expect(spokenText('## Done\n[Read more](https://example.com)\n```ts\nsecretCode()\n```'))
      .toBe('Done Read more Code shown in terminal.');
  });

  it('does not use a cloud voice when no local English voice exists', async () => {
    const synthesis = {
      cancel: vi.fn(),
      getVoices: () => [{ localService: false, lang: 'en-US' }, { localService: true, lang: 'fr-FR' }],
      speak: vi.fn(),
    };
    vi.stubGlobal('speechSynthesis', synthesis);
    await expect(new LocalSpeech().speak('Reply', vi.fn(), vi.fn())).rejects.toThrow('No local English voice');
    expect(synthesis.speak).not.toHaveBeenCalled();
  });

  it('waits through empty voice updates before selecting a local English voice', async () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    const voice = { localService: true, lang: 'en-US', name: 'David' };
    let voices: typeof voice[] = [];
    const synthesis = {
      cancel: vi.fn(), speak: vi.fn(), getVoices: () => voices,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: vi.fn(events.removeEventListener.bind(events)),
    };
    vi.stubGlobal('speechSynthesis', synthesis);
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      constructor(public text: string) {}
    });
    const pending = new LocalSpeech().speak('Reply', vi.fn(), vi.fn());
    events.dispatchEvent(new Event('voiceschanged'));
    await vi.advanceTimersByTimeAsync(100);
    expect(synthesis.speak).not.toHaveBeenCalled();
    expect(synthesis.removeEventListener).not.toHaveBeenCalled();
    voices = [voice];
    events.dispatchEvent(new Event('voiceschanged'));
    await pending;
    expect(synthesis.speak).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ voice, text: 'Reply' }));
    expect(synthesis.removeEventListener).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out and removes its listener if voice updates stay empty', async () => {
    vi.useFakeTimers();
    const events = new EventTarget();
    const synthesis = {
      cancel: vi.fn(), speak: vi.fn(), getVoices: () => [],
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: vi.fn(events.removeEventListener.bind(events)),
    };
    vi.stubGlobal('speechSynthesis', synthesis);
    const pending = new LocalSpeech().speak('Reply', vi.fn(), vi.fn());
    const assertion = expect(pending).rejects.toThrow('No local English voice');
    events.dispatchEvent(new Event('voiceschanged'));
    await vi.advanceTimersByTimeAsync(1500);
    await assertion;
    expect(synthesis.removeEventListener).toHaveBeenCalledOnce();
    expect(synthesis.speak).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
