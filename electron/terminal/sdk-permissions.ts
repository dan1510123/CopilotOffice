/**
 * Permission results for SDK sessions hosted by CLI >= 1.0.98. The CLI rejects
 * the legacy `{ kind: 'approved' }` ("unexpected user permission response"),
 * so only the kinds below may ever be returned.
 */
export type SdkPermissionKind = 'approve-once' | 'approve-for-session' | 'reject' | 'user-not-available';

export interface SdkPermissionResult {
  kind: SdkPermissionKind;
  feedback?: string;
}

export interface PermissionPolicyOptions {
  /** YOLO on: approve every request. */
  yolo: boolean;
  /** YOLO on: remember approval for the session instead of per request. */
  approveForSession?: boolean;
  /** YOLO off: optional human decider; when absent nobody is available to answer. */
  decide?: (request: unknown) => Promise<SdkPermissionResult | boolean | undefined> | SdkPermissionResult | boolean | undefined;
}

const ACCEPTED_KINDS: ReadonlySet<string> = new Set<SdkPermissionKind>([
  'approve-once',
  'approve-for-session',
  'reject',
  'user-not-available',
]);

/** Maps any decision (legacy or current) to a result the 1.0.98 CLI accepts. */
export function toPermissionResult(
  opts: { yolo: boolean; approveForSession?: boolean },
  decision?: SdkPermissionResult | { kind?: string } | boolean | null,
): SdkPermissionResult {
  if (typeof decision === 'boolean') {
    return { kind: decision ? (opts.approveForSession ? 'approve-for-session' : 'approve-once') : 'reject' };
  }
  if (decision && typeof decision === 'object' && typeof decision.kind === 'string') {
    if (ACCEPTED_KINDS.has(decision.kind)) {
      const feedback = (decision as SdkPermissionResult).feedback;
      return feedback ? { kind: decision.kind as SdkPermissionKind, feedback } : { kind: decision.kind as SdkPermissionKind };
    }
    if (decision.kind === 'approved') {
      return { kind: opts.approveForSession ? 'approve-for-session' : 'approve-once' };
    }
    if (decision.kind === 'denied-interactively-by-user' || decision.kind.startsWith('denied')) {
      return { kind: 'reject' };
    }
    return { kind: 'user-not-available' };
  }
  if (opts.yolo) return { kind: opts.approveForSession ? 'approve-for-session' : 'approve-once' };
  return { kind: 'user-not-available' };
}

/** Ready-made `onPermissionRequest` for `createSession` / `resumeSession`. */
export function createOnPermissionRequest(
  opts: PermissionPolicyOptions,
): (request: unknown, invocation?: unknown) => Promise<SdkPermissionResult> {
  return async (request: unknown): Promise<SdkPermissionResult> => {
    if (opts.yolo) return toPermissionResult(opts);
    if (!opts.decide) return { kind: 'user-not-available' };
    try {
      const decision = await opts.decide(request);
      return decision === undefined ? { kind: 'user-not-available' } : toPermissionResult(opts, decision);
    } catch {
      return { kind: 'user-not-available' };
    }
  };
}
