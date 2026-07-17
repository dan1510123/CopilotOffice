import { describe, expect, it } from 'vitest';
import { escapeHtml, linkifyHtml, stripHtml } from '../../../electron/teams/htmlText';

describe('linkifyHtml', () => {
  it('wraps a bare http(s) URL in a clickable anchor', () => {
    expect(linkifyHtml('see https://example.com now')).toBe(
      'see <a href="https://example.com">https://example.com</a> now',
    );
  });

  it('preserves &amp; in a query string inside the href (decodes to & in the attribute)', () => {
    const escaped = escapeHtml('https://teams.microsoft.com/l/message/19?groupId=abc&tenantId=xyz');
    const out = linkifyHtml(escaped);
    expect(out).toBe(
      '<a href="https://teams.microsoft.com/l/message/19?groupId=abc&amp;tenantId=xyz">' +
        'https://teams.microsoft.com/l/message/19?groupId=abc&amp;tenantId=xyz</a>',
    );
    // The href round-trips back to the original URL when the entity is decoded.
    expect(stripHtml(out)).toBe('https://teams.microsoft.com/l/message/19?groupId=abc&tenantId=xyz');
  });

  it('does not swallow a trailing <br> tag', () => {
    expect(linkifyHtml('https://example.com<br>next')).toBe(
      '<a href="https://example.com">https://example.com</a><br>next',
    );
  });

  it('linkifies multiple URLs independently', () => {
    expect(linkifyHtml('a http://a.com b https://b.com')).toBe(
      'a <a href="http://a.com">http://a.com</a> b <a href="https://b.com">https://b.com</a>',
    );
  });

  it('leaves text without URLs unchanged', () => {
    expect(linkifyHtml('no links here')).toBe('no links here');
    expect(linkifyHtml('')).toBe('');
  });
});
