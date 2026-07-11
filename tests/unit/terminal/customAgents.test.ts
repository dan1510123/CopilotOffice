import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseAgentFrontmatter,
  toCustomAgentConfig,
  loadCustomAgents,
  customAgentDirs,
  resolveCopilotHome,
} from '../../../electron/terminal/custom-agents';

describe('parseAgentFrontmatter', () => {
  it('parses a plain scalar name + description and body prompt', () => {
    const parsed = parseAgentFrontmatter(
      ['---', 'name: anvil', 'description: Evidence-first coding agent.', '---', '', '# Anvil', 'Body text.'].join('\n'),
    );
    expect(parsed.name).toBe('anvil');
    expect(parsed.description).toBe('Evidence-first coding agent.');
    expect(parsed.prompt).toBe('# Anvil\nBody text.');
    expect(parsed.tools).toBeUndefined();
  });

  it('folds a `>` block scalar description into a single line', () => {
    const parsed = parseAgentFrontmatter(
      [
        '---',
        'name: ado-speckit',
        'description: >',
        '  Turns an Azure DevOps work item',
        '  into a spec-driven artifact.',
        'tools:',
        '  - execute',
        '  - read',
        '---',
        'prompt body',
      ].join('\n'),
    );
    expect(parsed.description).toBe('Turns an Azure DevOps work item into a spec-driven artifact.');
    expect(parsed.tools).toEqual(['execute', 'read']);
    expect(parsed.prompt).toBe('prompt body');
  });

  it('parses inline flow sequences and quoted scalars', () => {
    const parsed = parseAgentFrontmatter(
      ['---', 'name: "my-agent"', 'tools: [execute, "read", edit]', '---', 'body'].join('\n'),
    );
    expect(parsed.name).toBe('my-agent');
    expect(parsed.tools).toEqual(['execute', 'read', 'edit']);
  });

  it('coerces boolean infer and captures model', () => {
    const parsed = parseAgentFrontmatter(
      ['---', 'name: a', 'infer: false', 'model: claude-haiku-4.5', '---', 'body'].join('\n'),
    );
    expect(parsed.infer).toBe(false);
    expect(parsed.model).toBe('claude-haiku-4.5');
  });

  it('handles CRLF line endings', () => {
    const parsed = parseAgentFrontmatter(
      ['---', 'name: crlf', 'description: ok', '---', 'body'].join('\r\n'),
    );
    expect(parsed.name).toBe('crlf');
    expect(parsed.prompt).toBe('body');
  });

  it('treats a file with no frontmatter as prompt-only', () => {
    const parsed = parseAgentFrontmatter('just a body, no fence');
    expect(parsed.name).toBeUndefined();
    expect(parsed.prompt).toBe('just a body, no fence');
  });
});

describe('toCustomAgentConfig', () => {
  it('returns null when name is missing', () => {
    expect(toCustomAgentConfig({ prompt: 'body' })).toBeNull();
  });

  it('returns null when the prompt body is empty', () => {
    expect(toCustomAgentConfig({ name: 'x', prompt: '' })).toBeNull();
  });

  it('omits empty tool lists so the SDK grants all tools', () => {
    const cfg = toCustomAgentConfig({ name: 'x', prompt: 'p', tools: [] });
    expect(cfg).not.toBeNull();
    expect(cfg!.tools).toBeUndefined();
  });

  it('maps all supported fields', () => {
    const cfg = toCustomAgentConfig({
      name: 'x',
      displayName: 'X',
      description: 'd',
      prompt: 'p',
      tools: ['read'],
      model: 'm',
      infer: true,
      skills: ['s'],
    });
    expect(cfg).toEqual({
      name: 'x',
      displayName: 'X',
      description: 'd',
      prompt: 'p',
      tools: ['read'],
      model: 'm',
      infer: true,
      skills: ['s'],
    });
  });
});

describe('resolveCopilotHome', () => {
  it('defaults to <homedir>/.copilot', () => {
    expect(resolveCopilotHome({}, '/home/user')).toBe(path.join('/home/user', '.copilot'));
  });

  it('honors a COPILOT_HOME override', () => {
    expect(resolveCopilotHome({ COPILOT_HOME: '/custom/copilot' }, '/home/user')).toBe('/custom/copilot');
  });

  it('ignores a blank COPILOT_HOME', () => {
    expect(resolveCopilotHome({ COPILOT_HOME: '   ' }, '/home/user')).toBe(path.join('/home/user', '.copilot'));
  });
});

describe('customAgentDirs', () => {
  it('includes the copilot home agents dir and the cwd .github/agents dir', () => {
    const dirs = customAgentDirs('/repo', '/home/user/.copilot');
    expect(dirs).toEqual([
      path.join('/home/user/.copilot', 'agents'),
      path.join('/repo', '.github', 'agents'),
    ]);
  });
});

describe('loadCustomAgents', () => {
  let tmpHome: string;
  let tmpCwd: string;
  let copilotHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-home-'));
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-cwd-'));
    copilotHome = path.join(tmpHome, '.copilot');
    fs.mkdirSync(path.join(copilotHome, 'agents'), { recursive: true });
    fs.mkdirSync(path.join(tmpCwd, '.github', 'agents'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  const write = (dir: string, file: string, body: string) =>
    fs.writeFileSync(path.join(dir, file), body);

  it('loads agents from both home and repo dirs, skipping non-.agent.md files', () => {
    write(path.join(copilotHome, 'agents'), 'home.agent.md', '---\nname: home\n---\nbody');
    write(path.join(copilotHome, 'agents'), 'notes.md', '---\nname: nope\n---\nbody');
    write(path.join(tmpCwd, '.github', 'agents'), 'repo.agent.md', '---\nname: repo\n---\nbody');

    const agents = loadCustomAgents(tmpCwd, copilotHome);
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(['home', 'repo']);
  });

  it('dedupes by name with home taking precedence', () => {
    write(path.join(copilotHome, 'agents'), 'dup.agent.md', '---\nname: dup\ndescription: from-home\n---\nbody');
    write(path.join(tmpCwd, '.github', 'agents'), 'dup.agent.md', '---\nname: dup\ndescription: from-repo\n---\nbody');

    const agents = loadCustomAgents(tmpCwd, copilotHome);
    expect(agents).toHaveLength(1);
    expect(agents[0].description).toBe('from-home');
  });

  it('never throws when directories are missing', () => {
    fs.rmSync(path.join(tmpCwd, '.github', 'agents'), { recursive: true, force: true });
    expect(() => loadCustomAgents(tmpCwd, copilotHome)).not.toThrow();
  });
});
