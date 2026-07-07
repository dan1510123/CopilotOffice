import { describe, it, expect } from 'vitest';
import {
  extractImageMarkers,
  loadHostedImages,
  contentTypeForPath,
  hostedImagesHtml,
  sniffImageType,
  resolveWithinBase,
  IMAGE_MARKER_RE,
} from '../../../electron/teams/imageMarker';

describe('extractImageMarkers', () => {
  it('returns text unchanged and no paths when there are no markers', () => {
    const r = extractImageMarkers('just some **markdown** text');
    expect(r.paths).toEqual([]);
    expect(r.text).toBe('just some **markdown** text');
  });

  it('extracts a single marker and removes it from the text', () => {
    const r = extractImageMarkers('Here is the result:\n<!--office-image:C:\\tmp\\a.png-->');
    expect(r.paths).toEqual(['C:\\tmp\\a.png']);
    expect(r.text).toBe('Here is the result:');
  });

  it('extracts multiple markers in order', () => {
    const r = extractImageMarkers(
      'a <!--office-image:/one.png--> b <!--office-image:/two.jpg--> c',
    );
    expect(r.paths).toEqual(['/one.png', '/two.jpg']);
    expect(r.text).toBe('a  b  c');
  });

  it('de-duplicates repeated paths, preserving first-seen order', () => {
    const r = extractImageMarkers(
      '<!--office-image:/x.png--><!--office-image:/y.png--><!--office-image:/x.png-->',
    );
    expect(r.paths).toEqual(['/x.png', '/y.png']);
  });

  it('trims whitespace inside the marker and ignores empty markers', () => {
    const r = extractImageMarkers('<!--office-image:  /padded.png  --><!--office-image:-->');
    expect(r.paths).toEqual(['/padded.png']);
  });

  it('collapses excess blank lines left by removal', () => {
    const r = extractImageMarkers('line1\n<!--office-image:/a.png-->\n\n\nline2');
    expect(r.text).toBe('line1\n\nline2');
  });

  it('is resettable across calls (no lastIndex leakage from the global regex)', () => {
    const a = extractImageMarkers('<!--office-image:/a.png-->');
    const b = extractImageMarkers('<!--office-image:/b.png-->');
    expect(a.paths).toEqual(['/a.png']);
    expect(b.paths).toEqual(['/b.png']);
    // Guard against a stateful global regex being shared incorrectly.
    IMAGE_MARKER_RE.lastIndex = 5;
    const c = extractImageMarkers('<!--office-image:/c.png-->');
    expect(c.paths).toEqual(['/c.png']);
  });
});

describe('contentTypeForPath', () => {
  it('maps known extensions', () => {
    expect(contentTypeForPath('a.png')).toBe('image/png');
    expect(contentTypeForPath('a.JPG')).toBe('image/jpeg');
    expect(contentTypeForPath('a.jpeg')).toBe('image/jpeg');
    expect(contentTypeForPath('a.gif')).toBe('image/gif');
    expect(contentTypeForPath('a.webp')).toBe('image/webp');
  });
  it('defaults to png for unknown extensions', () => {
    expect(contentTypeForPath('a.unknown')).toBe('image/png');
    expect(contentTypeForPath('noext')).toBe('image/png');
  });
});

// Minimal valid image byte buffers (magic-byte prefixes are what sniffing checks).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const NOT_IMAGE = Buffer.from('#!/bin/sh\nsecret=hunter2\n');

describe('loadHostedImages (sandbox + validation)', () => {
  it('reads sandboxed image files with sniffed content types and sequential ids', async () => {
    const files: Record<string, Buffer> = {};
    const images = await loadHostedImages(['one.png', 'sub/two.jpg'], {
      baseDir: '/work',
      readFile: async (p) => {
        const key = p.replace(/\\/g, '/');
        if (key.endsWith('/work/one.png')) return PNG;
        if (key.endsWith('/work/sub/two.jpg')) return JPG;
        throw new Error(`unexpected ${p}`);
      },
    });
    expect(images).toEqual([
      { id: '1', contentType: 'image/png', contentBytesBase64: PNG.toString('base64') },
      { id: '2', contentType: 'image/jpeg', contentBytesBase64: JPG.toString('base64') },
    ]);
  });

  it('rejects absolute paths (sandbox escape)', async () => {
    const warnings: string[] = [];
    const images = await loadHostedImages(['/etc/passwd', 'C:\\secrets.txt'], {
      baseDir: '/work',
      warn: (m) => warnings.push(m),
      readFile: async () => PNG,
    });
    expect(images).toEqual([]);
    expect(warnings.filter((w) => w.includes('outside agent sandbox')).length).toBe(2);
  });

  it('rejects ".." traversal that escapes the sandbox', async () => {
    const warnings: string[] = [];
    const images = await loadHostedImages(['../../etc/passwd', 'sub/../../out.png'], {
      baseDir: '/work',
      warn: (m) => warnings.push(m),
      readFile: async () => PNG,
    });
    expect(images).toEqual([]);
    expect(warnings.every((w) => w.includes('outside agent sandbox'))).toBe(true);
  });

  it('rejects every path when no baseDir sandbox is configured', async () => {
    const images = await loadHostedImages(['a.png'], { readFile: async () => PNG });
    expect(images).toEqual([]);
  });

  it('rejects files that are not real images (magic-byte check), ignoring extension', async () => {
    const warnings: string[] = [];
    const images = await loadHostedImages(['evil.png'], {
      baseDir: '/work',
      warn: (m) => warnings.push(m),
      readFile: async () => NOT_IMAGE,
    });
    expect(images).toEqual([]);
    expect(warnings.some((w) => w.includes('magic-byte'))).toBe(true);
  });

  it('skips unreadable files and keeps ids contiguous', async () => {
    const warnings: string[] = [];
    const images = await loadHostedImages(['ok.png', 'missing.png', 'ok2.png'], {
      baseDir: '/work',
      warn: (m) => warnings.push(m),
      readFile: async (p) => {
        if (p.replace(/\\/g, '/').endsWith('missing.png')) throw new Error('ENOENT');
        return PNG;
      },
    });
    expect(images.map((i) => i.id)).toEqual(['1', '2']);
    expect(warnings.some((w) => w.includes('missing.png'))).toBe(true);
  });

  it('skips empty and oversized files', async () => {
    const warnings: string[] = [];
    const images = await loadHostedImages(['empty.png', 'big.png', 'good.png'], {
      baseDir: '/work',
      maxBytes: 10,
      warn: (m) => warnings.push(m),
      readFile: async (p) => {
        const k = p.replace(/\\/g, '/');
        if (k.endsWith('empty.png')) return Buffer.alloc(0);
        if (k.endsWith('big.png')) return Buffer.concat([PNG, Buffer.alloc(50)]);
        return PNG;
      },
    });
    expect(images.map((i) => i.id)).toEqual(['1']);
    expect(warnings.some((w) => w.includes('empty.png'))).toBe(true);
    expect(warnings.some((w) => w.includes('big.png'))).toBe(true);
  });

  it('enforces the maximum image count', async () => {
    const warnings: string[] = [];
    const images = await loadHostedImages(['a.png', 'b.png', 'c.png'], {
      baseDir: '/work',
      maxImages: 2,
      warn: (m) => warnings.push(m),
      readFile: async () => PNG,
    });
    expect(images.map((i) => i.id)).toEqual(['1', '2']);
    expect(warnings.some((w) => w.includes('image count cap'))).toBe(true);
  });

  it('enforces the aggregate byte cap', async () => {
    const warnings: string[] = [];
    const big = Buffer.concat([PNG, Buffer.alloc(40)]); // 50 bytes each
    const images = await loadHostedImages(['a.png', 'b.png', 'c.png'], {
      baseDir: '/work',
      maxTotalBytes: 120,
      warn: (m) => warnings.push(m),
      readFile: async () => big,
    });
    expect(images.map((i) => i.id)).toEqual(['1', '2']);
    expect(warnings.some((w) => w.includes('aggregate byte cap'))).toBe(true);
  });
});

describe('sniffImageType', () => {
  it('recognizes real image signatures', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPG)).toBe('image/jpeg');
    expect(sniffImageType(Buffer.from('GIF89a....'))).toBe('image/gif');
    expect(sniffImageType(Buffer.from([0x42, 0x4d, 0, 0]))).toBe('image/bmp');
  });
  it('returns null for non-images', () => {
    expect(sniffImageType(NOT_IMAGE)).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('resolveWithinBase', () => {
  it('resolves a relative path inside the sandbox', () => {
    const r = resolveWithinBase('sub/a.png', '/work');
    expect(r?.replace(/\\/g, '/')).toContain('/work/sub/a.png');
  });
  it('returns null for absolute paths, traversal, and missing base', () => {
    expect(resolveWithinBase('/etc/passwd', '/work')).toBeNull();
    expect(resolveWithinBase('../out.png', '/work')).toBeNull();
    expect(resolveWithinBase('a.png', undefined)).toBeNull();
  });
});

describe('hostedImagesHtml', () => {
  it('builds img tags referencing hosted content ids', () => {
    const html = hostedImagesHtml([
      { id: '1', contentType: 'image/png', contentBytesBase64: 'x' },
      { id: '2', contentType: 'image/png', contentBytesBase64: 'y' },
    ]);
    expect(html).toContain('../hostedContents/1/$value');
    expect(html).toContain('../hostedContents/2/$value');
  });
});
