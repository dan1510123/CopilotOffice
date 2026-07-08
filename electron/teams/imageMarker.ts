// Image sentinel recognition for Teams replies.
//
// An agent can attach an image to its Teams reply by emitting an HTML-comment
// sentinel anywhere in its assistant message text:
//
//     <!--office-image:reply.png-->
//
// CopilotOffice extracts these markers from the captured reply text BEFORE the
// text is converted to Teams HTML, reads the referenced file, and posts it as an
// inline Microsoft Graph `hostedContents` image (see graphClient.ts). The marker
// itself never reaches Teams — and even if extraction were skipped, the reply
// text is HTML-escaped, so a missed marker degrades to inert escaped text rather
// than an active HTML comment.
//
// HTML-comment form is chosen to match the codebase's existing control-marker
// style (electron/teams/marker.ts) and because it is inert if it ever leaks.
//
// SECURITY: the marker path is remote-triggerable (a Teams user drives the agent),
// so it is treated as UNTRUSTED. `loadHostedImages` (1) confines every path to the
// agent's workingDir sandbox — rejecting absolute paths and `..` traversal that
// escape it, (2) validates real image magic bytes rather than trusting the file
// extension, and (3) caps per-file size, image count, and aggregate bytes. This
// prevents a remote user from exfiltrating arbitrary local files (e.g. secrets)
// as Teams "images".

import * as fs from 'fs';
import * as path from 'path';

/** Regex source for `<!--office-image:PATH-->` (PATH captured; paths never contain `-->`). */
export const IMAGE_MARKER_SOURCE = '<!--office-image:(.*?)-->';

/**
 * Convenience global matcher for external detection. NOTE: this is stateful
 * (`lastIndex`); internal parsing always builds a fresh regex so extraction is
 * unaffected by any external mutation of this instance.
 */
export const IMAGE_MARKER_RE = new RegExp(IMAGE_MARKER_SOURCE, 'g');

/** An image ready to attach to a Graph message as inline hosted content. */
export interface HostedImage {
  /** Per-message temporary id (`1`..`n`), referenced by `<img src="../hostedContents/{id}/$value">`. */
  id: string;
  /** MIME type, e.g. `image/png`. */
  contentType: string;
  /** Base64-encoded file bytes. */
  contentBytesBase64: string;
}

export interface ExtractResult {
  /** Reply text with all image markers removed and surrounding whitespace tidied. */
  text: string;
  /** Ordered, de-duplicated list of referenced image paths (as written by the agent). */
  paths: string[];
}

/**
 * Extract image-sentinel paths from reply text and return the cleaned text.
 * Pure — no filesystem access. Order is preserved; duplicates are collapsed.
 */
export function extractImageMarkers(input: string): ExtractResult {
  const src = input ?? '';
  const paths: string[] = [];
  const seen = new Set<string>();

  // Fresh, non-shared regex instances so extraction is stateless regardless of
  // any external mutation of the exported IMAGE_MARKER_RE.lastIndex.
  const matcher = new RegExp(IMAGE_MARKER_SOURCE, 'g');
  for (const m of src.matchAll(matcher)) {
    const p = (m[1] ?? '').trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    paths.push(p);
  }

  // Remove every marker occurrence, then collapse the whitespace/newlines the
  // removal may have left behind so the remaining prose stays clean.
  const text = src
    .replace(new RegExp(IMAGE_MARKER_SOURCE, 'g'), '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, paths };
}

/** Infer a Graph-friendly image MIME type from a file extension. Defaults to image/png. */
export function contentTypeForPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.bmp':
      return 'image/bmp';
    case '.png':
    default:
      return 'image/png';
  }
}

/**
 * Detect an image MIME type from the buffer's magic bytes. Returns null when the
 * content is not a recognized image — callers MUST reject in that case rather than
 * trusting the file extension (an attacker controls the marker path/extension).
 */
export function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 8 &&
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return 'image/png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buf.length >= 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 &&
      buf[3] === 0x38 && (buf[4] === 0x37 || buf[4] === 0x39) && buf[5] === 0x61) {
    return 'image/gif';
  }
  if (buf.length >= 12 &&
      buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4d) {
    return 'image/bmp';
  }
  return null;
}

/**
 * Resolve an untrusted marker path against the sandbox root and return the
 * absolute path only if it stays inside the root. Returns null for absolute
 * paths, `..` traversal, or when no root is configured. Blocks arbitrary local
 * file reads driven by a remote Teams user.
 */
export function resolveWithinBase(rawPath: string, baseDir?: string): string | null {
  if (!baseDir) return null; // no sandbox → cannot safely contain; reject
  if (path.isAbsolute(rawPath)) return null; // absolute/UNC paths escape the sandbox
  const root = path.resolve(baseDir);
  const resolved = path.resolve(root, rawPath);
  const rel = path.relative(root, resolved);
  // Inside the root iff the relative path doesn't climb out and isn't absolute.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

export interface LoadHostedImagesOptions {
  /**
   * Sandbox root that every marker path is confined to (the agent's workingDir).
   * REQUIRED for any image to load — paths that escape it (absolute or `..`) are
   * rejected. When omitted, all paths are rejected.
   */
  baseDir?: string;
  /** Skip files larger than this many bytes (Graph hosted content limit is ~4 MB). */
  maxBytes?: number;
  /** Maximum number of images attached to a single reply. */
  maxImages?: number;
  /** Maximum aggregate raw image bytes across a single reply. */
  maxTotalBytes?: number;
  /** Injectable file reader (defaults to fs.promises.readFile) for testability. */
  readFile?: (absPath: string) => Promise<Buffer>;
  /** Injectable warn logger. */
  warn?: (msg: string) => void;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_IMAGES = 8;
const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/**
 * Read the referenced image files and build ordered {@link HostedImage} descriptors
 * with per-message ids `1`..`n`. Every path is confined to `baseDir` and validated
 * as a real image by magic bytes; per-file size, image count, and aggregate byte
 * caps are enforced. Any rejected path is skipped with a warning so a single bad
 * marker never blocks the rest of the reply.
 */
export async function loadHostedImages(
  paths: string[],
  options: LoadHostedImagesOptions = {},
): Promise<HostedImage[]> {
  const baseDir = options.baseDir;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxImages = options.maxImages ?? DEFAULT_MAX_IMAGES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const readFile = options.readFile ?? ((p: string) => fs.promises.readFile(p));
  const warn = options.warn ?? (() => {});

  const images: HostedImage[] = [];
  let totalBytes = 0;
  for (const rawPath of paths) {
    if (images.length >= maxImages) {
      warn(`office-image: image count cap (${maxImages}) reached — ignoring "${rawPath}"`);
      continue;
    }
    const absPath = resolveWithinBase(rawPath, baseDir);
    if (!absPath) {
      warn(`office-image: rejected path outside agent sandbox: "${rawPath}"`);
      continue;
    }
    try {
      const buf = await readFile(absPath);
      if (buf.length === 0) {
        warn(`office-image: skipping empty file ${absPath}`);
        continue;
      }
      if (buf.length > maxBytes) {
        warn(`office-image: skipping ${absPath} — ${buf.length} bytes exceeds ${maxBytes} limit`);
        continue;
      }
      const sniffed = sniffImageType(buf);
      if (!sniffed) {
        warn(`office-image: skipping ${absPath} — not a recognized image (magic-byte check failed)`);
        continue;
      }
      if (totalBytes + buf.length > maxTotalBytes) {
        warn(`office-image: aggregate byte cap (${maxTotalBytes}) reached — ignoring ${absPath}`);
        continue;
      }
      totalBytes += buf.length;
      images.push({
        id: String(images.length + 1),
        contentType: sniffed,
        contentBytesBase64: buf.toString('base64'),
      });
    } catch (e) {
      warn(`office-image: could not read ${absPath}: ${(e as Error).message}`);
    }
  }
  return images;
}

/** Build the inline `<img>` HTML that references the given hosted images by id. */
export function hostedImagesHtml(images: HostedImage[]): string {
  return images
    .map((img) => `<img src="../hostedContents/${img.id}/$value" alt="attachment" style="max-width:100%">`)
    .join('<br>');
}
