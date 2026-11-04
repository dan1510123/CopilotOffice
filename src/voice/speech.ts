export function spokenText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' Code shown in terminal. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`#*_>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export class LocalSpeech {
  private generation = 0;

  stop(): void {
    this.generation++;
    window.speechSynthesis?.cancel();
  }

  async speak(text: string, onEnd: () => void, onError: (error: Error) => void): Promise<void> {
    this.stop();
    const generation = this.generation;
    const synthesis = window.speechSynthesis;
    if (!synthesis) throw new Error('Speech playback is unavailable on this device.');
    if (!synthesis.getVoices().length) {
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          synthesis.removeEventListener('voiceschanged', onVoicesChanged);
          resolve();
        };
        const onVoicesChanged = () => {
          if (synthesis.getVoices().length) done();
        };
        const timer = setTimeout(done, 1500);
        synthesis.addEventListener('voiceschanged', onVoicesChanged);
      });
    }
    if (generation !== this.generation) return;
    const voice = synthesis.getVoices().find((candidate) => candidate.localService && /^en\b/i.test(candidate.lang));
    if (!voice) throw new Error('No local English voice is installed. Install a system voice to hear replies.');
    const chunks = spokenText(text).match(/.{1,180}(?:\s|$)|\S{1,180}/g) ?? [];
    const next = () => {
      if (generation !== this.generation) return;
      const chunk = chunks.shift();
      if (!chunk) { onEnd(); return; }
      const utterance = new SpeechSynthesisUtterance(chunk);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.onend = next;
      utterance.onerror = (event) => {
        if (generation === this.generation) onError(new Error(`Speech playback failed: ${event.error}`));
      };
      synthesis.speak(utterance);
    };
    next();
  }
}
