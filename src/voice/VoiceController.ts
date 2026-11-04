import { hasSpeechAudio, type VoiceRecording } from './microphone';
import type { VoiceState, VoiceTarget } from './types';

function eventText(data: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

export interface VoiceDependencies {
  resolveTarget(agentId: string): Promise<VoiceTarget>;
  isCurrent(target: VoiceTarget): boolean;
  load(progress: (detail: string) => void): Promise<unknown>;
  record(): Promise<VoiceRecording>;
  transcribe(audio: Float32Array): Promise<string>;
  submit(target: VoiceTarget, text: string): Promise<{ success: boolean; error?: string }>;
  speak(text: string, done: () => void, failed: (error: Error) => void): Promise<void>;
  stopSpeaking(): void;
  changed(state: VoiceState): void;
}

export class VoiceController {
  state: VoiceState = { phase: 'idle', target: null, detail: '' };
  private generation = 0;
  private held = false;
  private recording?: VoiceRecording;
  private limitTimer?: ReturnType<typeof setTimeout>;
  private replyTimer?: ReturnType<typeof setTimeout>;
  private reply?: { prompt: string; matched: boolean; text: string; seen: Set<string> };

  constructor(private readonly deps: VoiceDependencies) {}

  async press(agentId: string): Promise<void> {
    if (['loading', 'recording', 'transcribing'].includes(this.state.phase)) return;
    this.cancel();
    this.held = true;
    const token = this.generation;
    this.set('loading', null, 'Preparing local voice...');
    try {
      const target = await this.deps.resolveTarget(agentId);
      if (token !== this.generation || !this.held) return;
      this.set('loading', target, 'Loading voice model (first use downloads model files)...');
      await this.deps.load((detail) => {
        if (token === this.generation) this.set('loading', target, detail);
      });
      if (token !== this.generation || !this.held) return;
      if (!this.deps.isCurrent(target)) throw new Error('Agent session changed. Hold to talk again.');
      const recording = await this.deps.record();
      if (token !== this.generation || !this.held) { recording.cancel(); return; }
      this.recording = recording;
      this.set('recording', target, 'Listening... release to send (30 seconds maximum).');
      this.limitTimer = setTimeout(() => { void this.release(); }, 30_000);
    } catch (error) {
      if (token === this.generation) this.fail(error);
    }
  }

  async release(): Promise<void> {
    if (!this.held) return;
    this.held = false;
    clearTimeout(this.limitTimer);
    if (this.state.phase !== 'recording' || !this.recording || !this.state.target) {
      this.cancel();
      return;
    }
    const token = this.generation;
    const target = this.state.target;
    const recording = this.recording;
    this.recording = undefined;
    this.set('transcribing', target, 'Transcribing on this device...');
    try {
      const audio = await recording.stop();
      if (token !== this.generation) return;
      if (!hasSpeechAudio(audio)) throw new Error('No speech detected. Hold to talk and try again.');
      const text = (await this.deps.transcribe(audio)).trim();
      if (token !== this.generation) return;
      if (!text) throw new Error('No speech recognized. Please try again.');
      if (!this.deps.isCurrent(target)) throw new Error('Agent session changed; recording was not sent.');
      this.reply = { prompt: text, matched: false, text: '', seen: new Set() };
      this.set('waiting', target, `Sent: ${text}`);
      this.replyTimer = setTimeout(() => this.fail(new Error('Voice reply timed out. Check the terminal.')), 600_000);
      const result = await this.deps.submit(target, text);
      if (token === this.generation && !result.success) {
        throw new Error(result.error || 'The agent could not accept the voice prompt.');
      }
    } catch (error) {
      if (token === this.generation) this.fail(error);
    }
  }

  event(target: VoiceTarget, event: { id: string; type: string; data: Record<string, unknown> }): void {
    const active = this.state.target;
    if (!active || !this.reply || active.officeId !== target.officeId ||
        active.agentId !== target.agentId || active.sessionId !== target.sessionId) return;
    if (!this.deps.isCurrent(active)) { this.cancel(); return; }
    const reply = this.reply;
    if (reply.seen.has(event.id)) return;
    reply.seen.add(event.id);
    if (event.type === 'user.message') {
      if (eventText(event.data, ['content', 'message', 'text', 'input', 'prompt', 'body']) === reply.prompt) reply.matched = true;
      else this.cancel();
    } else if (reply.matched && event.type === 'assistant.message') {
      reply.text = eventText(event.data, ['content', 'message', 'text']);
    } else if (reply.matched && (event.type === 'session.idle' || event.type === 'assistant.turn_end') && reply.text) {
      const text = reply.text;
      this.reply = undefined;
      clearTimeout(this.replyTimer);
      this.set('speaking', active, 'Speaking reply. Press Stop voice to silence.');
      const token = this.generation;
      void this.deps.speak(
        text,
        () => { if (token === this.generation) this.set('idle', null, ''); },
        (error) => { if (token === this.generation) this.fail(error); },
      ).catch((error: unknown) => { if (token === this.generation) this.fail(error); });
    } else if (event.type === 'session.error') {
      this.fail(new Error('The agent encountered an error. Check its terminal.'));
    }
  }

  cancel(): void {
    this.generation++;
    this.held = false;
    this.recording?.cancel();
    this.recording = undefined;
    this.reply = undefined;
    clearTimeout(this.limitTimer);
    clearTimeout(this.replyTimer);
    this.deps.stopSpeaking();
    this.set('idle', null, '');
  }

  private fail(error: unknown): void {
    const target = this.state.target;
    this.cancel();
    const message = error instanceof Error ? error.message : String(error);
    console.error('[voice]', message);
    this.set('error', target, message);
  }

  private set(phase: VoiceState['phase'], target: VoiceTarget | null, detail: string): void {
    this.state = { phase, target, detail };
    this.deps.changed(this.state);
  }
}
