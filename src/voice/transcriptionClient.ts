import type { TranscriptionRequest, TranscriptionResponse } from './types';

export class TranscriptionClient {
  private worker?: Worker;
  private nextId = 0;
  private pending = new Map<number, {
    resolve: (text: string) => void;
    reject: (error: Error) => void;
    progress: (detail: string) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  load(progress: (detail: string) => void): Promise<string> {
    return this.request({ id: ++this.nextId, type: 'load' }, progress);
  }

  transcribe(audio: Float32Array): Promise<string> {
    return this.request({ id: ++this.nextId, type: 'transcribe', audio }, () => {});
  }

  destroy(): void {
    this.failAll(new Error('Voice transcription cancelled.'));
  }

  private failAll(error: Error): void {
    this.worker?.terminate();
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private request(message: TranscriptionRequest, progress: (detail: string) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this.worker = new Worker(new URL('../dist/voice/transcription.worker.js', document.baseURI), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent<TranscriptionResponse>) => {
          const response = event.data;
          const pending = this.pending.get(response.id);
          if (!pending) return;
          if (response.type === 'progress') {
            pending.progress(response.detail);
            return;
          }
          clearTimeout(pending.timer);
          this.pending.delete(response.id);
          if (response.type === 'error') pending.reject(new Error(response.error));
          else pending.resolve(response.type === 'text' ? response.text : '');
        };
        this.worker.onerror = (event) => this.failAll(new Error(`Voice worker failed: ${event.message}`));
      }
      const timer = setTimeout(() => this.failAll(new Error('Voice model timed out. Please retry.')), 300_000);
      this.pending.set(message.id, { resolve, reject, progress, timer });
      this.worker.postMessage(message);
    });
  }
}
