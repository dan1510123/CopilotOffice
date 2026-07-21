/**
 * Shared Microsoft Teams glyph for every "Teams remote" surface (spec 011/016).
 *
 * A single inline SVG so the terminal overlay, serious dashboard, default
 * dashboard, orchestrator panel, and settings all render the same recognizable
 * Teams-purple badge instead of a generic 💬 speech balloon. The glyph colors
 * are fixed (on-brand purple) and independent of the host button's text color,
 * so button state is still conveyed by the surrounding label/color.
 *
 * Because the icon is markup, host buttons that previously used `textContent`
 * must switch to `innerHTML` and use {@link teamsLabel}.
 */
export const TEAMS_ICON_SVG =
  '<svg viewBox="0 0 32 32" width="1em" height="1em" ' +
  'style="vertical-align:-0.15em;display:inline-block;margin-right:0.4em" ' +
  'aria-hidden="true" focusable="false">' +
  '<circle cx="23.5" cy="8.5" r="5" fill="#7b83eb"/>' +
  '<rect x="3" y="8" width="19" height="19" rx="3.5" fill="#5b5fc7"/>' +
  '<path d="M7.5 12.4h10v2.7h-3.7V23h-2.6v-7.9H7.5z" fill="#fff"/>' +
  '</svg>';

/**
 * Build an HTML label string: the Teams glyph followed by `text`.
 * Callers assign the result to `element.innerHTML`. `text` must be trusted
 * static UI copy (never user input) since it is not escaped.
 */
export function teamsLabel(text: string): string {
  return `${TEAMS_ICON_SVG}${text}`;
}
