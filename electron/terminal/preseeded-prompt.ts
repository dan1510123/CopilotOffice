import type { TerminalProcess } from './terminal-backend';

/**
 * Deliver a start-time prompt through the strongest transport the process owns.
 *
 * SDK/native-bridge processes use session.send so warm/reused terminals receive
 * the prompt atomically and visibly in their own session. Only the explicit raw
 * node-pty fallback types the line into the TUI.
 */
export async function deliverPreseededPrompt(
  process: Pick<TerminalProcess, 'submitPrompt' | 'write'>,
  prompt: string | undefined,
): Promise<boolean> {
  if (!prompt) return false;
  if (typeof process.submitPrompt === 'function') {
    await process.submitPrompt(prompt);
  } else {
    process.write(`${prompt}\r`);
  }
  return true;
}
