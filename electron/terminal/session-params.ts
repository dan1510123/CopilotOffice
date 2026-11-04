import type { SessionConfig } from '@github/copilot-sdk';

type SessionOverrides = Pick<SessionConfig, 'agent' | 'model' | 'reasoningEffort'>;

/** Split direct process arguments, preserving quoted values and Windows path separators. */
export function parseAdditionalParams(text: string): string[] {
  const args: string[] = [];
  let value = '';
  let quote: '"' | "'" | undefined;
  let started = false;
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = undefined;
      else value += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) args.push(value);
      value = '';
      started = false;
    } else {
      value += char;
      started = true;
    }
  }
  if (quote) throw new Error('Unclosed quote in Additional Parameters');
  if (started) args.push(value);
  return args;
}

/** CLI flags without a session equivalent remain host arguments, never guessed SDK fields. */
export function sessionConfigFromArgs(args: readonly string[]): {
  config: SessionOverrides;
  unmappedFlags: string[];
} {
  const config: SessionOverrides = {};
  const unmappedFlags: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') break;
    const separator = arg.indexOf('=');
    const flag = separator < 0 ? arg : arg.slice(0, separator);
    if (flag !== '--agent' && flag !== '--model' && flag !== '--reasoning-effort') {
      if (flag.startsWith('-')) unmappedFlags.push(flag);
      continue;
    }
    const value = separator < 0 ? args[++i] : arg.slice(separator + 1);
    if (!value || value.startsWith('-')) throw new Error(`${flag} requires a value`);
    if (flag === '--agent') config.agent = value;
    else if (flag === '--model') config.model = value;
    else {
      switch (value) {
        case 'low': case 'medium': case 'high': case 'xhigh': case 'max':
          config.reasoningEffort = value;
          break;
        default:
          throw new Error(`Unsupported SDK --reasoning-effort value: ${value}. Expected low, medium, high, xhigh, or max`);
      }
    }
  }
  return { config, unmappedFlags: [...new Set(unmappedFlags)] };
}
