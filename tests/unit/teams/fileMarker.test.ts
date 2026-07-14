import { describe, it, expect } from 'vitest';
import {
  extractFileMarkers,
  loadAttachmentFiles,
  contentTypeForFile,
  FILE_MARKER_RE,
} from '../../../electron/teams/fileMarker';

describe('extractFileMarkers', () => {
  it('returns text unchanged and no paths when there are no markers', () => {
    const r = extractFileMarkers('just some **markdown** text');
    expect(r.paths).toEqual([]);
    expect(r.text).toBe('just some **markdown** text');
  });

  it('extracts a single marker and removes it from the text', () => {
    const r = extractFileMarkers(
      'Here is the export:\n<!--office-file:.office-files/data-2026-07-13T21-40-01-123Z.csv-->',
    );
    expect(r.paths).toEqual(['.office-files/data-2026-07-13T21-40-01-123Z.csv']);
    expect(r.text).toBe('Here is the export:');
  });

  it('extracts multiple markers in order', () => {
    const r = extractFileMarkers('a <!--office-file:/one.csv--> b <!--office-file:/two.json--> c');
    expect(r.paths).toEqual(['/one.csv', '/two.json']);
    expect(r.text).toBe('a  b  c');
  });

  it('de-duplicates repeated paths, preserving first-seen order', () => {
    const r = extractFileMarkers(
      '<!--office-file:/x.csv--><!--office-file:/y.csv--><!--office-file:/x.csv-->',
    );
    expect(r.paths).toEqual(['/x.csv', '/y.csv']);
  });

  it('trims whitespace inside the marker and ignores empty markers', () => {
    const r = extractFileMarkers('<!--office-file:  /padded.csv  --><!--office-file:-->');
    expect(r.paths).toEqual(['/padded.csv']);
  });

  it('collapses excess blank lines left by removal', () => {
    const r = extractFileMarkers('line1\n<!--office-file:/a.csv-->\n\n\nline2');
    expect(r.text).toBe('line1\n\nline2');
  });

  it('is resettable across calls (no lastIndex leakage from the global regex)', () => {
    const a = extractFileMarkers('<!--office-file:/a.csv-->');
    const b = extractFileMarkers('<!--office-file:/b.csv-->');
    expect(a.paths).toEqual(['/a.csv']);
    expect(b.paths).toEqual(['/b.csv']);
    FILE_MARKER_RE.lastIndex = 5;
    const c = extractFileMarkers('<!--office-file:/c.csv-->');
    expect(c.paths).toEqual(['/c.csv']);
  });
});

describe('contentTypeForFile', () => {
  it('maps known extensions', () => {
    expect(contentTypeForFile('data.csv')).toBe('text/csv');
    expect(contentTypeForFile('a.CSV')).toBe('text/csv');
    expect(contentTypeForFile('a.json')).toBe('application/json');
    expect(contentTypeForFile('a.txt')).toBe('text/plain');
    expect(contentTypeForFile('a.pdf')).toBe('application/pdf');
  });
  it('defaults to octet-stream for unknown/no extensions', () => {
    expect(contentTypeForFile('a.unknown')).toBe('application/octet-stream');
    expect(contentTypeForFile('noext')).toBe('application/octet-stream');
  });
});

const CSV = Buffer.from('id,name\n1,alice\n2,bob\n');
const BIN = Buffer.from([0x00, 0x01, 0x02, 0x03]);

describe('loadAttachmentFiles (sandbox + caps, arbitrary types)', () => {
  it('reads sandboxed files, using basename as name and inferring content type', async () => {
    const files = await loadAttachmentFiles(['one.csv', 'sub/data.json'], {
      baseDir: '/work',
      readFile: async (p) => {
        const key = p.replace(/\\/g, '/');
        if (key.endsWith('/work/one.csv')) return CSV;
        if (key.endsWith('/work/sub/data.json')) return BIN;
        throw new Error(`unexpected ${p}`);
      },
    });
    expect(files).toEqual([
      { name: 'one.csv', contentType: 'text/csv', bytes: CSV },
      { name: 'data.json', contentType: 'application/json', bytes: BIN },
    ]);
  });

  it('attaches arbitrary (non-image) bytes as-is — no magic-byte validation', async () => {
    const files = await loadAttachmentFiles(['blob.bin'], {
      baseDir: '/work',
      readFile: async () => BIN,
    });
    expect(files).toEqual([
      { name: 'blob.bin', contentType: 'application/octet-stream', bytes: BIN },
    ]);
  });

  it('rejects absolute paths (sandbox escape)', async () => {
    const warnings: string[] = [];
    const files = await loadAttachmentFiles(['/etc/passwd', 'C:\\secrets.txt'], {
      baseDir: '/work',
      warn: (m) => warnings.push(m),
      readFile: async () => CSV,
    });
    expect(files).toEqual([]);
    expect(warnings.filter((w) => w.includes('outside agent sandbox')).length).toBe(2);
  });

  it('rejects ".." traversal that escapes the sandbox', async () => {
    const warnings: string[] = [];
    const files = await loadAttachmentFiles(['../../etc/passwd', 'sub/../../out.csv'], {
      baseDir: '/work',
      warn: (m) => warnings.push(m),
      readFile: async () => CSV,
    });
    expect(files).toEqual([]);
    expect(warnings.every((w) => w.includes('outside agent sandbox'))).toBe(true);
  });

  it('rejects every path when no baseDir sandbox is configured', async () => {
    const files = await loadAttachmentFiles(['a.csv'], { readFile: async () => CSV });
    expect(files).toEqual([]);
  });

  it('skips unreadable files and keeps the rest', async () => {
    const warnings: string[] = [];
    const files = await loadAttachmentFiles(['ok.csv', 'missing.csv', 'ok2.csv'], {
      baseDir: '/work',
      warn: (m) => warnings.push(m),
      readFile: async (p) => {
        if (p.replace(/\\/g, '/').endsWith('missing.csv')) throw new Error('ENOENT');
        return CSV;
      },
    });
    expect(files.map((f) => f.name)).toEqual(['ok.csv', 'ok2.csv']);
    expect(warnings.some((w) => w.includes('missing.csv'))).toBe(true);
  });

  it('skips empty and oversized files', async () => {
    const warnings: string[] = [];
    const files = await loadAttachmentFiles(['empty.csv', 'big.csv', 'good.csv'], {
      baseDir: '/work',
      maxBytes: 10,
      warn: (m) => warnings.push(m),
      readFile: async (p) => {
        const k = p.replace(/\\/g, '/');
        if (k.endsWith('empty.csv')) return Buffer.alloc(0);
        if (k.endsWith('big.csv')) return Buffer.alloc(50);
        return Buffer.from('short');
      },
    });
    expect(files.map((f) => f.name)).toEqual(['good.csv']);
    expect(warnings.some((w) => w.includes('empty.csv'))).toBe(true);
    expect(warnings.some((w) => w.includes('big.csv'))).toBe(true);
  });

  it('enforces the maximum file count', async () => {
    const warnings: string[] = [];
    const files = await loadAttachmentFiles(['a.csv', 'b.csv', 'c.csv'], {
      baseDir: '/work',
      maxFiles: 2,
      warn: (m) => warnings.push(m),
      readFile: async () => CSV,
    });
    expect(files.map((f) => f.name)).toEqual(['a.csv', 'b.csv']);
    expect(warnings.some((w) => w.includes('file count cap'))).toBe(true);
  });

  it('enforces the aggregate byte cap', async () => {
    const warnings: string[] = [];
    const big = Buffer.alloc(50);
    const files = await loadAttachmentFiles(['a.csv', 'b.csv', 'c.csv'], {
      baseDir: '/work',
      maxTotalBytes: 120,
      warn: (m) => warnings.push(m),
      readFile: async () => big,
    });
    expect(files.map((f) => f.name)).toEqual(['a.csv', 'b.csv']);
    expect(warnings.some((w) => w.includes('aggregate byte cap'))).toBe(true);
  });
});
