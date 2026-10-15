import { describe, expect, it } from 'vitest';
import { createOnPermissionRequest, toPermissionResult } from '../../../electron/terminal/sdk-permissions';

describe('toPermissionResult', () => {
  it('yolo approves once by default and for session on request', () => {
    expect(toPermissionResult({ yolo: true })).toEqual({ kind: 'approve-once' });
    expect(toPermissionResult({ yolo: true, approveForSession: true })).toEqual({ kind: 'approve-for-session' });
  });

  it('non-yolo with no decision is user-not-available', () => {
    expect(toPermissionResult({ yolo: false })).toEqual({ kind: 'user-not-available' });
  });

  it('translates legacy approved and booleans', () => {
    expect(toPermissionResult({ yolo: false }, { kind: 'approved' })).toEqual({ kind: 'approve-once' });
    expect(toPermissionResult({ yolo: false }, true)).toEqual({ kind: 'approve-once' });
    expect(toPermissionResult({ yolo: false }, false)).toEqual({ kind: 'reject' });
    expect(toPermissionResult({ yolo: false }, { kind: 'denied-by-rules' })).toEqual({ kind: 'reject' });
    expect(toPermissionResult({ yolo: false }, { kind: 'no-result' })).toEqual({ kind: 'user-not-available' });
  });

  it('passes accepted kinds through', () => {
    expect(toPermissionResult({ yolo: false }, { kind: 'reject' })).toEqual({ kind: 'reject' });
  });
});

describe('createOnPermissionRequest', () => {
  it('yolo never consults decide and never returns approved', async () => {
    const handler = createOnPermissionRequest({ yolo: true, decide: () => { throw new Error('no'); } });
    expect(await handler({})).toEqual({ kind: 'approve-once' });
  });

  it('non-yolo defers to decide, falling back to user-not-available', async () => {
    expect(await createOnPermissionRequest({ yolo: false })({})).toEqual({ kind: 'user-not-available' });
    expect(await createOnPermissionRequest({ yolo: false, decide: async () => true })({})).toEqual({ kind: 'approve-once' });
    expect(await createOnPermissionRequest({ yolo: false, decide: () => { throw new Error('x'); } })({})).toEqual({ kind: 'user-not-available' });
  });
});
