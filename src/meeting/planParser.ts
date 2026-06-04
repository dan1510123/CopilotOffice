import { MeetingPlan, TaskAssignment } from './types';
import { DEFAULT_PLAN_AGENT_IDS } from '../config/agents';

const DEFAULT_VALID_AGENT_IDS = DEFAULT_PLAN_AGENT_IDS;

/** Remove ANSI escape codes from terminal output. */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
    .replace(/\x1B\].*?\x07/g, '');
}

/** Extract content from fenced JSON code blocks. */
export function extractJsonBlocks(text: string): string[] {
  const blocks: string[] = [];
  const pattern = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const content = match[1].trim();
    if (content.startsWith('{') || content.startsWith('[')) {
      blocks.push(content);
    }
  }
  return blocks;
}

/** Validate a parsed JSON object matches the MeetingPlan interface. */
export function validateMeetingPlan(
  obj: unknown,
  validAgentIds: string[],
): MeetingPlan | null {
  if (obj === null || typeof obj !== 'object') return null;

  const record = obj as Record<string, unknown>;
  if (typeof record.plan !== 'string' || record.plan.trim() === '') return null;
  if (!Array.isArray(record.tasks) || record.tasks.length === 0) return null;

  const validTasks: TaskAssignment[] = [];
  for (const task of record.tasks) {
    if (task === null || typeof task !== 'object') continue;
    const t = task as Record<string, unknown>;

    if (
      typeof t.agentId !== 'string' ||
      typeof t.title !== 'string' ||
      typeof t.description !== 'string' ||
      typeof t.prompt !== 'string'
    ) {
      continue;
    }

    if (!validAgentIds.includes(t.agentId)) {
      console.warn(`[planParser] Skipping task with invalid agentId: "${t.agentId}"`);
      continue;
    }

    validTasks.push({
      agentId: t.agentId,
      title: t.title,
      description: t.description,
      prompt: t.prompt,
    });
  }

  if (validTasks.length === 0) return null;

  return { plan: record.plan as string, tasks: validTasks };
}

/** Parse a MeetingPlan from raw terminal output. */
export function parsePlanFromOutput(
  terminalOutput: string,
  validAgentIds: string[] = DEFAULT_VALID_AGENT_IDS,
): MeetingPlan | null {
  const clean = stripAnsi(terminalOutput);
  const blocks = extractJsonBlocks(clean);

  for (const block of blocks) {
    try {
      const parsed: unknown = JSON.parse(block);
      const plan = validateMeetingPlan(parsed, validAgentIds);
      if (plan) return plan;
    } catch {
      console.warn('[planParser] Failed to parse JSON block');
    }
  }

  return null;
}
