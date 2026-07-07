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

/** Pick a random ack quip. Falls back to a stable default if the list is empty. */
export function pickAckQuip(rng: () => number = Math.random): string {
  if (ACK_QUIPS.length === 0) return 'Working on this…';
  return ACK_QUIPS[Math.floor(rng() * ACK_QUIPS.length)] ?? ACK_QUIPS[0];
}
