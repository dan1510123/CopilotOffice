import { programmaticInputUnsupportedError, type TerminalProcess } from './terminal-backend';

export class PreseededPromptQueue {
  private readonly prompts = new Map<string, string[]>();

  push(key: string, prompt: string | undefined): void {
    if (!prompt) return;
    const queued = this.prompts.get(key) ?? [];
    queued.push(prompt);
    this.prompts.set(key, queued);
  }

  take(key: string): string[] {
    const queued = this.prompts.get(key) ?? [];
    this.prompts.delete(key);
    return queued;
  }

  delete(key: string): void {
    this.prompts.delete(key);
  }

  clear(): void {
    this.prompts.clear();
  }
}

/**
 * Deliver a start-time prompt through the process's programmatic transport.
 *
 * SDK/native-bridge processes use session.send so warm/reused terminals receive
 * the prompt atomically and visibly in their own session. A process without a
 * programmatic submit (raw node-pty) rejects with an explicit error — the prompt
 * is never typed into the TUI as keystrokes.
 */
export async function deliverPreseededPrompt(
  process: Pick<TerminalProcess, 'submitPrompt'>,
  prompt: string | undefined,
): Promise<boolean> {
  if (!prompt) return false;
  if (typeof process.submitPrompt !== 'function') {
    throw new Error(programmaticInputUnsupportedError('prompt'));
  }
  await process.submitPrompt(prompt);
  return true;
}
