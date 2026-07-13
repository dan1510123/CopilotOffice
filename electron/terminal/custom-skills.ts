// Custom-skill discovery for SDK-backed sessions.
//
// Like custom agents (see ./custom-agents), the interactive Copilot TUI
// auto-discovers skills from the Copilot home's `skills/` dir
// (`~/.copilot/skills`, or `$COPILOT_HOME/skills`) and `<cwd>/.github/skills`.
// SDK-created sessions do NOT: with `enableConfigDiscovery` defaulting to false
// the runtime never scans those dirs, so `createSession` / `resumeSession`
// sessions load none of the user's skills — even though the hosted TUI's `/`
// menu still lists them from its own on-disk scan.
//
// This module computes those same on-disk skill-root directories so the backend
// can pass them as `SessionConfigBase.skillDirectories` (with `enableSkills:
// true`), reaching parity with the standalone CLI. We pass explicit directories
// rather than flipping `enableConfigDiscovery` so we don't also pull in
// unrelated MCP-server auto-discovery.

import * as fs from 'fs';
import * as path from 'path';
import { resolveCopilotHome } from './custom-agents';

/**
 * Candidate skill-root directories, in precedence order (project/cwd before
 * personal/home — matching the SDK's project-over-home precedence). Each entry
 * is a directory that CONTAINS skill folders (e.g. `<cwd>/.github/skills` holds
 * `<cwd>/.github/skills/<skill-name>/SKILL.md`).
 */
export function skillDirs(cwd: string, copilotHome: string = resolveCopilotHome()): string[] {
  const dirs: string[] = [];
  if (cwd) {
    dirs.push(path.join(cwd, '.github', 'skills'));
  }
  dirs.push(path.join(copilotHome, 'skills'));
  return dirs;
}

/**
 * Resolve the set of existing skill-root directories to hand the SDK as
 * `skillDirectories`. Only directories that exist on disk are returned so the
 * config stays clean and deterministic. Never throws — unreadable/missing
 * entries are skipped.
 */
export function resolveSkillDirectories(cwd: string, copilotHome: string = resolveCopilotHome()): string[] {
  const out: string[] = [];
  for (const dir of skillDirs(cwd, copilotHome)) {
    try {
      if (fs.statSync(dir).isDirectory()) {
        out.push(dir);
      }
    } catch {
      // Missing or unreadable — skip.
    }
  }
  return out;
}
