import { describe, expect, it } from 'vitest';
import { embedMarker, hasMarker, TEAMS_MARKER } from '../../../electron/teams/marker';

describe('marker round-trip', () => {
  it('embeds and detects the marker', () => {
    const html = '<p>hello</p>';
    const marked = embedMarker(html);
    expect(marked).not.toBe(html);
    expect(hasMarker(marked)).toBe(true);
    expect(marked).toContain(TEAMS_MARKER);
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

  it('detects the marker even after HTML round-trips through content', () => {
    // Simulates the app self-post echoing back over Trouter/chatsvc.
    const appPost = embedMarker('<p>🔌 offline notice</p>');
    expect(hasMarker(appPost)).toBe(true);
  });
});
