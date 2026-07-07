// T006 — Self-loop marker.
//
// The app posts under the signed-in user's own identity, so sender identity cannot
// distinguish app posts from human replies. We embed a stable, low-visibility marker
// in EVERY app-posted message (intro, reply, check-in, offline/inactive notices). On
// receive, any message containing the marker is dropped before all other filtering,
// preventing the "notice-triggers-itself" loop (FR-007a).
//
// IMPORTANT: the marker must survive Teams' message sanitizer. HTML comments do NOT —
// Teams strips `<!-- ... -->` from channel message content, so a comment marker vanishes
// on the Trouter echo and the app's own posts get mis-dispatched (the intro-post bug).
// Instead we embed a distinctive ZERO-WIDTH character sequence into the visible body
// text: it renders invisibly in the Teams UI but is preserved as ordinary text content
// on round-trip. (Message-id tracking in the service is the deterministic primary guard;
// this marker is the content-based secondary guard, covering ids that don't round-trip.)

/** Legacy token (kept for detection of any old comment-marked posts). */
export const TEAMS_MARKER = 'copilotoffice-agent-post-v1';

// Zero-width sequence: ZWSP, ZWNJ, ZWJ repeated — six chars, vanishingly unlikely to
// occur naturally, invisible when rendered, preserved as text through Teams.
const ZW_MARKER = '\u200B\u200C\u200D\u200B\u200C\u200D';

/** Add the hidden self-loop marker to an outgoing HTML body (idempotent). */
export function embedMarker(html: string): string {
  if (hasMarker(html)) return html;
  // Insert the zero-width marker just inside the first element (when present) to avoid
  // any leading-whitespace trimming; otherwise prepend it.
  const body = html ?? '';
  const firstTag = body.match(/^\s*<[a-zA-Z][^>]*>/);
  if (firstTag) {
    const insertAt = firstTag.index! + firstTag[0].length;
    return body.slice(0, insertAt) + ZW_MARKER + body.slice(insertAt);
  }
  return ZW_MARKER + body;
}

/** True when content contains the app self-post marker → drop before all processing. */
export function hasMarker(content: string): boolean {
  if (!content) return false;
  return content.includes(ZW_MARKER) || content.includes(TEAMS_MARKER);
}
