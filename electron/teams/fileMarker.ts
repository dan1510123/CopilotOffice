// File-attachment sentinel recognition for Teams replies (mirrors imageMarker.ts).
//
// An agent can attach an arbitrary file to its Teams reply by emitting an
// HTML-comment sentinel anywhere in its assistant message text:
//
//     <!--office-file:.office-files/data-2026-07-13T21-40-01-123Z.csv-->
//
// CopilotOffice extracts these markers from the captured reply text BEFORE the
// text is converted to Teams HTML, reads the referenced file, and posts it as a
// raw Microsoft Graph reference attachment (see graphClient.ts) — NOT inline. The
// marker itself never reaches Teams — and even if extraction were skipped, the
// reply text is HTML-escaped, so a missed marker degrades to inert escaped text
// rather than an active HTML comment.
//
// Unlike office-image, there is no rendering / screenshot and no magic-byte
// validation: the bytes are attached as-is and arbitrary file types are allowed
// (content type is inferred from the extension for the upload only).
//
// SECURITY: the marker path is remote-triggerable (a Teams user drives the agent),
// so it is treated as UNTRUSTED. `loadAttachmentFiles` confines every path to the
// agent's workingDir sandbox via `resolveWithinBase` — rejecting absolute paths and
// `..` traversal that escape it — and caps per-file size, file count, and aggregate
// bytes. This prevents a remote user from exfiltrating arbitrary local files (e.g.
// secrets) as Teams attachments.

import * as fs from 'fs';
import * as path from 'path';
import { resolveWithinBase } from './imageMarker';

/** Regex source for `<!--office-file:PATH-->` (PATH captured; paths never contain `-->`). */
export const FILE_MARKER_SOURCE = '<!--office-file:(.*?)-->';

/**
 * Convenience global matcher for external detection. NOTE: this is stateful
 * (`lastIndex`); internal parsing always builds a fresh regex so extraction is
 * unaffected by any external mutation of this instance.
 */
export const FILE_MARKER_RE = new RegExp(FILE_MARKER_SOURCE, 'g');

/** A file ready to attach to a Graph message as a raw reference attachment. */
export interface AttachmentFile {
  /** Attachment display name — the file's basename. */
  name: string;
  /** MIME type inferred from the extension (e.g. `text/csv`). */
  contentType: string;
  /** Raw file bytes to upload. */
  bytes: Buffer;
}

export interface ExtractFileResult {
  /** Reply text with all file markers removed and surrounding whitespace tidied. */
  text: string;
  /** Ordered, de-duplicated list of referenced file paths (as written by the agent). */
  paths: string[];
}

/**
 * Extract file-sentinel paths from reply text and return the cleaned text.
 * Pure — no filesystem access. Order is preserved; duplicates are collapsed.
 */
export function extractFileMarkers(input: string): ExtractFileResult {
  const src = input ?? '';
  const paths: string[] = [];
  const seen = new Set<string>();

  // Fresh, non-shared regex instances so extraction is stateless regardless of
  // any external mutation of the exported FILE_MARKER_RE.lastIndex.
  const matcher = new RegExp(FILE_MARKER_SOURCE, 'g');
  for (const m of src.matchAll(matcher)) {
    const p = (m[1] ?? '').trim();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    paths.push(p);
  }

  // Remove every marker occurrence, then collapse the whitespace/newlines the
  // removal may have left behind so the remaining prose stays clean.
  const text = src
    .replace(new RegExp(FILE_MARKER_SOURCE, 'g'), '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return { text, paths };
}

/**
 * Infer a MIME type from a file extension for the raw upload. Defaults to
 * `application/octet-stream` for unknown extensions (arbitrary file types are
 * supported — the bytes are attached as-is regardless of the inferred type).
 */
export function contentTypeForFile(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.csv':
      return 'text/csv';
    case '.json':
      return 'application/json';
    case '.txt':
    case '.log':
      return 'text/plain';
    case '.md':
      return 'text/markdown';
    case '.html':
    case '.htm':
      return 'text/html';
    case '.xml':
      return 'application/xml';
    case '.pdf':
      return 'application/pdf';
    case '.zip':
      return 'application/zip';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    default:
      return 'application/octet-stream';
  }
}

export interface LoadAttachmentFilesOptions {
  /**
   * Sandbox root that every marker path is confined to (the agent's workingDir).
   * REQUIRED for any file to load — paths that escape it (absolute or `..`) are
   * rejected. When omitted, all paths are rejected.
   */
  baseDir?: string;
  /** Skip files larger than this many bytes. */
  maxBytes?: number;
  /** Maximum number of files attached to a single reply. */
  maxFiles?: number;
  /** Maximum aggregate raw file bytes across a single reply. */
  maxTotalBytes?: number;
  /** Injectable file reader (defaults to fs.promises.readFile) for testability. */
  readFile?: (absPath: string) => Promise<Buffer>;
  /** Injectable warn logger. */
  warn?: (msg: string) => void;
}

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_MAX_FILES = 8;
const DEFAULT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/**
 * Read the referenced files and build ordered {@link AttachmentFile} descriptors.
 * Every path is confined to `baseDir`; per-file size, file count, and aggregate
 * byte caps are enforced. Any rejected path is skipped with a warning so a single
 * bad marker never blocks the rest of the reply. Unlike office-image, there is NO
 * magic-byte validation — arbitrary file types are attached as-is.
 */
export async function loadAttachmentFiles(
  paths: string[],
  options: LoadAttachmentFilesOptions = {},
): Promise<AttachmentFile[]> {
  const baseDir = options.baseDir;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const readFile = options.readFile ?? ((p: string) => fs.promises.readFile(p));
  const warn = options.warn ?? (() => {});

  const files: AttachmentFile[] = [];
  let totalBytes = 0;
  for (const rawPath of paths) {
    if (files.length >= maxFiles) {
      warn(`office-file: file count cap (${maxFiles}) reached — ignoring "${rawPath}"`);
      continue;
    }
    const absPath = resolveWithinBase(rawPath, baseDir);
    if (!absPath) {
      warn(`office-file: rejected path outside agent sandbox: "${rawPath}"`);
      continue;
    }
    try {
      const buf = await readFile(absPath);
      if (buf.length === 0) {
        warn(`office-file: skipping empty file ${absPath}`);
        continue;
      }
      if (buf.length > maxBytes) {
        warn(`office-file: skipping ${absPath} — ${buf.length} bytes exceeds ${maxBytes} limit`);
        continue;
      }
      if (totalBytes + buf.length > maxTotalBytes) {
        warn(`office-file: aggregate byte cap (${maxTotalBytes}) reached — ignoring ${absPath}`);
        continue;
      }
      totalBytes += buf.length;
      files.push({
        name: path.basename(absPath),
        contentType: contentTypeForFile(absPath),
        bytes: buf,
      });
    } catch (e) {
      warn(`office-file: could not read ${absPath}: ${(e as Error).message}`);
    }
  }
  return files;
}
