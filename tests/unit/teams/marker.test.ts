import { describe, expect, it } from 'vitest';
import { embedMarker, hasMarker, TEAMS_MARKER } from '../../../electron/teams/marker';

const ZW = '\u200B\u200C\u200D\u200B\u200C\u200D';

describe('marker round-trip', () => {
  it('embeds a zero-width marker and detects it', () => {
    const html = '<p>hello</p>';
    const marked = embedMarker(html);
    expect(marked).not.toBe(html);
    expect(hasMarker(marked)).toBe(true);
    expect(marked).toContain(ZW);
  });

  it('does NOT use an HTML comment (Teams strips those)', () => {
    expect(embedMarker('<p>hi</p>')).not.toContain('<!--');
  });

  it('inserts the marker inside the first element so it is not leading-trimmed', () => {
    expect(embedMarker('<p>hi</p>')).toBe(`<p>${ZW}hi</p>`);
  });

  it('prepends when there is no leading tag', () => {
    expect(embedMarker('plain')).toBe(`${ZW}plain`);
  });

  it('is idempotent — does not double-embed', () => {
    const once = embedMarker('<p>x</p>');
    const twice = embedMarker(once);
    expect(twice).toBe(once);
  });

  it('does not flag ordinary human content', () => {
    expect(hasMarker('what is 2+2?')).toBe(false);
    expect(hasMarker('')).toBe(false);
  });

  it('still detects the legacy token marker for back-compat', () => {
    expect(hasMarker(`something ${TEAMS_MARKER} here`)).toBe(true);
  });

  it('detects the marker after the app self-post echoes back', () => {
    const appPost = embedMarker('<p>🔌 offline notice</p>');
    expect(hasMarker(appPost)).toBe(true);
  });
});
