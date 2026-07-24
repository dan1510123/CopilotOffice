// Ack quips — the short phrases an agent uses when acknowledging a freshly
// received Teams message (before it starts working). Edit this list in code to
// change the personality of the "message received" acks. One quip per line.
//
// These are rendered after the bold agent-name prefix and the ⌛ glyph, e.g.
//   **Gene** ⌛ On it…
// Keep them short, plain text (HTML-escaped at post time), and no trailing punctuation-heavy noise.

export const ACK_QUIPS: string[] = [
  'Cracking my knuckles…',
  'Summoning the electrons…',
  'Bribing the compiler…',
  'Yelling at the terminal politely…',
  'Consulting the rubber duck…',
  'Putting down my coffee…',
  'Rolling a d20 for initiative…',
  'Waking up the hamsters…',
  "Pretending I wasn't slacking…",
  'Feeding the machine spirit…',
];

export const ORCHESTRATOR_ACK_QUIPS: string[] = [
  'Delegating recursively until the problem disappears…',
  'Converting ambiguity into parallel confusion…',
  'Moving the pawns; the strategy arrives later…',
  'Asking the hive mind to achieve consensus—adorable…',
  'Distributing context on a need-to-guess basis…',
  'Assigning agents according to the sacred spreadsheet…',
  'Turning one hard problem into six smaller arguments…',
  'Deploying minions with enterprise-grade confidence…',
  'Parallelizing the mistakes for faster delivery…',
  'Giving the worker bees a strongly worded roadmap…',
  'Optimizing the swarm for maximum plausible deniability…',
  'Scheduling the pawns for strategic advancement…',
  'Spending tokens to save thoughts…',
  'Informing the agents that failure is merely telemetry…',
  'Promoting the boldest guess to architecture…',
  'Letting the hive mind overthink this in parallel…',
  'Assigning ownership before anyone understands it…',
  'Scaling headcount instead of comprehension…',
  'Orchestrating chaos with deterministic identifiers…',
  'Dispatching agents—the org chart demands tribute…',
];

function pickQuip(quips: string[], fallback: string, rng: () => number): string {
  if (quips.length === 0) return fallback;
  return quips[Math.floor(rng() * quips.length)] ?? quips[0];
}

/** Pick a random ack quip. Falls back to a stable default if the list is empty. */
export function pickAckQuip(rng: () => number = Math.random): string {
  return pickQuip(ACK_QUIPS, 'Working on this…', rng);
}

/** Pick a random orchestrator ack quip from its dedicated personality pool. */
export function pickOrchestratorAckQuip(rng: () => number = Math.random): string {
  return pickQuip(ORCHESTRATOR_ACK_QUIPS, 'Coordinating the team…', rng);
}
