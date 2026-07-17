// Small HTML→text helper shared by the receive transports. Teams channel message content
// is HTML; the agent prompt needs plain text.

export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<!--[\s\S]*?-->/g, '') // drop HTML comments (incl. our marker)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Escape plain text for safe inclusion in an HTML message body. */
export function escapeHtml(text: string): string {
  return (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Wrap bare http(s) URLs in already-escaped HTML with clickable anchors so Teams
 * renders them as links (channel messages posted via Graph do not reliably
 * auto-linkify plain URLs). MUST run on escaped text: a URL run stops at the
 * first `<`, so inserted `<br>` tags are never swallowed, and any `&amp;` in the
 * query string decodes correctly inside the double-quoted href attribute.
 */
export function linkifyHtml(escaped: string): string {
  return (escaped ?? '').replace(
    /https?:\/\/[^\s<]+/g,
    (url) => `<a href="${url}">${url}</a>`,
  );
}
