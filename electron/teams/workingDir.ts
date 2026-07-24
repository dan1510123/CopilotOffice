// Working-directory normalization for the Teams subsystem.
//
// A working dir originates from the office path field in the renderer. Windows
// Explorer's "Copy as path" wraps the value in literal double quotes
// (e.g. `"C:\\path\\to\\dir"`), which survive `String.trim()` and can be
// persisted into an office config and, in turn, into an online-agent binding.
// Handed to `path.resolve`, a quoted string is treated as a relative segment →
// an invalid path with embedded quotes (ENOENT on mkdir). Normalize at every
// boundary where a working dir enters or is loaded so quotes never reach a
// consumer — mirrors `normalizeWorkingDir` in `src/office/officePersistence.ts`.

export function normalizeWorkingDir(p: string): string {
  let s = (p ?? '').trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      s = s.slice(1, -1).trim();
    }
  }
  return s;
}
