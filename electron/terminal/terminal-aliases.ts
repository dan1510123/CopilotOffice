/** Owning office plus every transferred-office alias for one live terminal. */
export function terminalOffices(
  agentToTerminal: ReadonlyMap<string, string>,
  owningOfficeId: string,
  agentId: string,
  terminalKey: string,
): string[] {
  const offices = new Set([owningOfficeId]);
  for (const [aliasCk, key] of agentToTerminal) {
    if (key !== terminalKey || !aliasCk.endsWith(`:${agentId}`)) continue;
    offices.add(aliasCk.slice(0, aliasCk.length - agentId.length - 1));
  }
  return [...offices];
}
