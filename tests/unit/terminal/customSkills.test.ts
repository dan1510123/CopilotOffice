import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { skillDirs, resolveSkillDirectories } from '../../../electron/terminal/custom-skills';

describe('skillDirs', () => {
  it('lists the cwd .github/skills dir before the copilot home skills dir', () => {
    const dirs = skillDirs('/repo', '/home/user/.copilot');
    expect(dirs).toEqual([
      path.join('/repo', '.github', 'skills'),
      path.join('/home/user/.copilot', 'skills'),
    ]);
  });

  it('omits the cwd dir when cwd is empty', () => {
    const dirs = skillDirs('', '/home/user/.copilot');
    expect(dirs).toEqual([path.join('/home/user/.copilot', 'skills')]);
  });
});

describe('resolveSkillDirectories', () => {
  let tmpHome: string;
  let tmpCwd: string;
  let copilotHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-home-'));
    tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-cwd-'));
    copilotHome = path.join(tmpHome, '.copilot');
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('returns only existing directories, cwd before home', () => {
    fs.mkdirSync(path.join(tmpCwd, '.github', 'skills'), { recursive: true });
    fs.mkdirSync(path.join(copilotHome, 'skills'), { recursive: true });

    expect(resolveSkillDirectories(tmpCwd, copilotHome)).toEqual([
      path.join(tmpCwd, '.github', 'skills'),
      path.join(copilotHome, 'skills'),
    ]);
  });

  it('skips a missing skills directory', () => {
    fs.mkdirSync(path.join(copilotHome, 'skills'), { recursive: true });

    expect(resolveSkillDirectories(tmpCwd, copilotHome)).toEqual([
      path.join(copilotHome, 'skills'),
    ]);
  });

  it('returns an empty list when no skill dirs exist', () => {
    expect(resolveSkillDirectories(tmpCwd, copilotHome)).toEqual([]);
  });

  it('ignores a file named like a skills dir', () => {
    fs.mkdirSync(path.join(tmpCwd, '.github'), { recursive: true });
    fs.writeFileSync(path.join(tmpCwd, '.github', 'skills'), 'not a dir');

    expect(resolveSkillDirectories(tmpCwd, copilotHome)).toEqual([]);
  });

  it('never throws when directories are missing', () => {
    expect(() => resolveSkillDirectories('/nonexistent/repo', '/nonexistent/home')).not.toThrow();
  });
});
