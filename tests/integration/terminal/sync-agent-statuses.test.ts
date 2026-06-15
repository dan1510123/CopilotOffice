import { describe, expect, it } from 'vitest';
import { decideStartupTimeoutTransition } from '../../../src/util/startupTimeoutGuard';

/**
 * Feature 002 (US2, T014–T015) — startup-timeout recovery guard.
 *
 * These cover V4: when an agent has been `starting` past the 60s timeout the
 * renderer must consult the PTY's `alive` flag before flipping the badge to
 * `error: 'Startup timed out'`. Live PTY → recover to ready; dead PTY → keep
 * the original error path.
 */

const TIMEOUT_MS = 60_000;
const T0 = 1_000_000;
const PAST_TIMEOUT = T0 + TIMEOUT_MS + 1;
const WITHIN_TIMEOUT = T0 + TIMEOUT_MS - 1;

describe('US2 V4: startup timeout decision', () => {
  it('US2 V4: starting + past timeout + alive recovers to ready', () => {
    const decision = decideStartupTimeoutTransition({
      subState: 'starting',
      activityStartTime: T0,
      now: PAST_TIMEOUT,
      timeoutMs: TIMEOUT_MS,
      serverAlive: true,
    });
    expect(decision).toEqual({ kind: 'recover-to-ready' });
  });

  it('US2 V4: starting + past timeout + NOT alive transitions to Startup timed out error', () => {
    const decision = decideStartupTimeoutTransition({
      subState: 'starting',
      activityStartTime: T0,
      now: PAST_TIMEOUT,
      timeoutMs: TIMEOUT_MS,
      serverAlive: false,
    });
    expect(decision).toEqual({ kind: 'transition-to-error', reason: 'Startup timed out' });
  });

  it('US2 V4: starting + past timeout + serverAlive undefined still transitions to error', () => {
    const decision = decideStartupTimeoutTransition({
      subState: 'starting',
      activityStartTime: T0,
      now: PAST_TIMEOUT,
      timeoutMs: TIMEOUT_MS,
      serverAlive: undefined,
    });
    expect(decision).toEqual({ kind: 'transition-to-error', reason: 'Startup timed out' });
  });

  it('US2 V4: starting BUT not past timeout is untouched regardless of alive=true', () => {
    const decision = decideStartupTimeoutTransition({
      subState: 'starting',
      activityStartTime: T0,
      now: WITHIN_TIMEOUT,
      timeoutMs: TIMEOUT_MS,
      serverAlive: true,
    });
    expect(decision).toEqual({ kind: 'no-transition' });
  });

  it('US2 V4: starting BUT not past timeout is untouched regardless of alive=false', () => {
    const decision = decideStartupTimeoutTransition({
      subState: 'starting',
      activityStartTime: T0,
      now: WITHIN_TIMEOUT,
      timeoutMs: TIMEOUT_MS,
      serverAlive: false,
    });
    expect(decision).toEqual({ kind: 'no-transition' });
  });

  it('US2 V4: non-starting subState is untouched even past timeout', () => {
    const decision = decideStartupTimeoutTransition({
      subState: 'thinking',
      activityStartTime: T0,
      now: PAST_TIMEOUT,
      timeoutMs: TIMEOUT_MS,
      serverAlive: false,
    });
    expect(decision).toEqual({ kind: 'no-transition' });
  });

  it('US2 V4: starting without activityStartTime is untouched', () => {
    const decision = decideStartupTimeoutTransition({
      subState: 'starting',
      activityStartTime: null,
      now: PAST_TIMEOUT,
      timeoutMs: TIMEOUT_MS,
      serverAlive: false,
    });
    expect(decision).toEqual({ kind: 'no-transition' });
  });
});
