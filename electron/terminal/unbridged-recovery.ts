/**
 * Removes one reused terminal from the live maps after its native bridge has
 * failed to connect. The caller owns all side effects beyond those maps
 * (watchers, readiness state, and PID-registry cleanup).
 */
export function evictUnbridgedReusedTerminal<T>(
  processes: Map<string, T>,
  agentToTerminal: Map<string, string>,
  terminalKey: string,
  expected: T,
  kill: (entry: T) => boolean,
): boolean {
  if (processes.get(terminalKey) !== expected || !kill(expected)) {
    return false;
  }

  processes.delete(terminalKey);
  for (const [agentKey, assignedTerminalKey] of agentToTerminal) {
    if (assignedTerminalKey === terminalKey) {
      agentToTerminal.delete(agentKey);
    }
  }
  return true;
}
