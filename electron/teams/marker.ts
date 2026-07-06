// T006 — Self-loop marker.
//
// The app posts under the signed-in user's own identity, so sender identity cannot
// distinguish app posts from human replies. We embed a stable, low-visibility marker
// in EVERY app-posted message (intro, reply, check-in, offline/inactive notices). On
// receive, any message containing the marker is dropped before all other filtering,
// preventing the "notice-triggers-itself" loop (FR-007a).
//
// The marker is a zero-width-tagged HTML comment: invisible in the Teams UI, survives
// round-trip through the message body, and is easy to detect in received content.

/** Stable marker token embedded in every app post. */
export const TEAMS_MARKER = 'copilotoffice-agent-post-v1';

const MARKER_HTML = `<!--${TEAMS_MARKER}-->`;

/** Add the hidden self-loop marker to an outgoing HTML body (idempotent). */
export function embedMarker(html: string): string {
  if (hasMarker(html)) return html;
  return `${MARKER_HTML}${html ?? ''}`;
}

/** True when content contains the app self-post marker → drop before all processing. */
export function hasMarker(content: string): boolean {
  if (!content) return false;
  return content.includes(TEAMS_MARKER);
}
