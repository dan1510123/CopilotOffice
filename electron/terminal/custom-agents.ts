// Custom-agent discovery for SDK-backed sessions.
//
// The interactive Copilot TUI auto-discovers `*.agent.md` files from the Copilot
// home's `agents/` dir (`~/.copilot/agents`, or `$COPILOT_HOME/agents`) and
// `<gitRoot|cwd>/.github/agents`. SDK-created sessions do NOT: the runtime only exposes the agents an
// embedding app explicitly declares via `SessionConfigBase.customAgents`. Without
// this, "New Session" (which calls `createSession`) shows none of the user's
// custom agents, while resumed sessions — first born in the real TUI — keep them.
// See the SDK's `CustomAgentConfig` / `SessionConfig` in @github/copilot-sdk.
//
// This module reads those same on-disk locations and parses each file's YAML
// frontmatter into a `CustomAgentConfig`, so both create/resume paths can inject
// `customAgents` and reach parity with the standalone CLI.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CustomAgentConfig } from '@github/copilot-sdk';

/** Parsed frontmatter + prompt body of a single `.agent.md` file. */
export interface ParsedAgentFile {
  name?: string;
  displayName?: string;
  description?: string;
  tools?: string[];
  model?: string;
  infer?: boolean;
  skills?: string[];
  /** Markdown body after the frontmatter block — the agent's system prompt. */
  prompt: string;
}

/**
 * Minimal, dependency-free parser for the small YAML frontmatter subset used by
 * `.agent.md` files: scalar values, quoted scalars, folded (`>`) / literal (`|`)
 * block scalars, block sequences (`- item`) and inline flow sequences (`[a, b]`).
 *
 * We deliberately avoid a full YAML dependency: `yaml` is not a project-level
 * package (it only resolves transitively on some dev machines) and electron is
 * esbuild-bundled, so importing it would break clean checkouts / CI.
 */
export function parseAgentFrontmatter(content: string): ParsedAgentFile {
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n') && normalized !== '---') {
    return { prompt: content.trim() };
  }

  const end = normalized.indexOf('\n---', 3);
  if (end === -1) {
    return { prompt: content.trim() };
  }

  const fmBlock = normalized.slice(4, end);
  // Body begins after the closing `---` line.
  const afterFence = normalized.indexOf('\n', end + 1);
  const prompt = (afterFence === -1 ? '' : normalized.slice(afterFence + 1)).trim();

  const raw = parseFrontmatterBlock(fmBlock);

  const out: ParsedAgentFile = { prompt };
  if (typeof raw.name === 'string') out.name = raw.name;
  if (typeof raw.displayName === 'string') out.displayName = raw.displayName;
  if (typeof raw.description === 'string') out.description = raw.description;
  if (typeof raw.model === 'string') out.model = raw.model;
  if (typeof raw.infer === 'boolean') out.infer = raw.infer;
  if (Array.isArray(raw.tools)) out.tools = raw.tools.map(String);
  if (Array.isArray(raw.skills)) out.skills = raw.skills.map(String);
  return out;
}

type FMValue = string | boolean | string[];

/** Parse the inner text of a frontmatter block into a flat key → value map. */
function parseFrontmatterBlock(block: string): Record<string, FMValue> {
  const lines = block.split('\n');
  const result: Record<string, FMValue> = {};
  let i = 0;

  const keyLine = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/;

  while (i < lines.length) {
    const line = lines[i];
    // Skip blanks and comments at the top level.
    if (!line.trim() || /^\s*#/.test(line)) { i++; continue; }

    const m = keyLine.exec(line);
    if (!m || /^\s/.test(line)) { i++; continue; }

    const key = m[1];
    const rest = m[2].trim();

    // Block scalar: `key: >` (folded) or `key: |` (literal).
    if (rest === '>' || rest === '|' || rest === '>-' || rest === '|-') {
      const folded = rest[0] === '>';
      const collected: string[] = [];
      i++;
      while (i < lines.length && (lines[i].trim() === '' || /^\s/.test(lines[i]))) {
        collected.push(lines[i].replace(/^\s+/, ''));
        i++;
      }
      // Trim trailing blank lines.
      while (collected.length && collected[collected.length - 1] === '') collected.pop();
      result[key] = folded ? collected.join(' ').replace(/\s+/g, ' ').trim() : collected.join('\n');
      continue;
    }

    // Inline flow sequence: `key: [a, b, c]`.
    if (rest.startsWith('[') && rest.endsWith(']')) {
      result[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter((s) => s.length > 0);
      i++;
      continue;
    }

    // Block sequence: `key:` followed by `  - item` lines.
    if (rest === '') {
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && (lines[j].trim() === '' || /^\s/.test(lines[j]))) {
        const item = /^\s*-\s+(.*)$/.exec(lines[j]);
        if (item) items.push(unquote(item[1].trim()));
        else if (lines[j].trim() === '') { /* allow blank lines within block */ }
        else break;
        j++;
      }
      if (items.length > 0) {
        result[key] = items;
        i = j;
        continue;
      }
      // Empty value with no list — treat as empty string.
      result[key] = '';
      i++;
      continue;
    }

    // Plain scalar.
    result[key] = coerceScalar(unquote(rest));
    i++;
  }

  return result;
}

function unquote(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function coerceScalar(s: string): FMValue {
  if (s === 'true') return true;
  if (s === 'false') return false;
  return s;
}

/**
 * Convert a parsed `.agent.md` file into an SDK `CustomAgentConfig`, or `null`
 * when the file is unusable (no name, or empty prompt body). `tools: undefined`
 * intentionally maps to "all tools" per the SDK contract.
 *
 * `fallbackName` (typically the filename minus `.agent.md`) is used as the agent
 * name when the frontmatter omits an explicit `name:` — matching the CLI, which
 * derives an agent's name from its filename (e.g. `speckit.plan.agent.md` →
 * `speckit.plan`).
 */
export function toCustomAgentConfig(parsed: ParsedAgentFile, fallbackName?: string): CustomAgentConfig | null {
  const name = parsed.name || fallbackName;
  if (!name || !parsed.prompt) return null;
  const config: CustomAgentConfig = {
    name,
    prompt: parsed.prompt,
  };
  if (parsed.displayName) config.displayName = parsed.displayName;
  if (parsed.description) config.description = parsed.description;
  if (parsed.tools && parsed.tools.length > 0) config.tools = parsed.tools;
  if (parsed.model) config.model = parsed.model;
  if (typeof parsed.infer === 'boolean') config.infer = parsed.infer;
  if (parsed.skills && parsed.skills.length > 0) config.skills = parsed.skills;
  return config;
}

/**
 * Resolve the Copilot config home directory, mirroring the CLI's own
 * `resolveCopilotHome(configDir, COPILOT_HOME, homedir())` precedence:
 * an explicit `COPILOT_HOME` env override wins, otherwise `<homedir>/.copilot`.
 */
export function resolveCopilotHome(
  env: NodeJS.ProcessEnv = process.env,
  homeDir: string = os.homedir(),
): string {
  const override = env.COPILOT_HOME?.trim();
  if (override) return override;
  return path.join(homeDir, '.copilot');
}

/** Directories to scan, in precedence order (earlier wins on name collision). */
export function customAgentDirs(cwd: string, copilotHome: string = resolveCopilotHome()): string[] {
  const dirs = [path.join(copilotHome, 'agents')];
  if (cwd) {
    dirs.push(path.join(cwd, '.github', 'agents'));
  }
  return dirs;
}

/**
 * Load and parse all `*.agent.md` custom agents visible to a session with the
 * given working directory. Mirrors the TUI's discovery set (the Copilot home's
 * `agents/` dir — honoring `COPILOT_HOME` — plus the working directory's
 * `.github/agents`). Deduplicated by agent name (first directory wins). Never
 * throws — unreadable files/dirs are skipped.
 */
export function loadCustomAgents(cwd: string, copilotHome: string = resolveCopilotHome()): CustomAgentConfig[] {
  const byName = new Map<string, CustomAgentConfig>();

  for (const dir of customAgentDirs(cwd, copilotHome)) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.toLowerCase().endsWith('.agent.md')) continue;
      const full = path.join(dir, entry);
      let content: string;
      try {
        content = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      // Derive the fallback name from the filename (`<name>.agent.md`) for files
      // whose frontmatter omits `name:` — e.g. the speckit repo agents.
      const fallbackName = entry.slice(0, -'.agent.md'.length);
      const config = toCustomAgentConfig(parseAgentFrontmatter(content), fallbackName);
      if (config && !byName.has(config.name)) {
        byName.set(config.name, config);
      }
    }
  }

  return [...byName.values()];
}
