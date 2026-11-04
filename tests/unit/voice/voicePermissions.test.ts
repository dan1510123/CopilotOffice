import { describe, expect, it } from 'vitest';
import { isAppMicrophoneRequest } from '../../../electron/voicePermissions';

describe('voice media permission boundary', () => {
  const app = 'file:///app/index.html';
  it('permits only audio from the exact app document', () => {
    expect(isAppMicrophoneRequest(app, app, ['audio'])).toBe(true);
    expect(isAppMicrophoneRequest(app, app, ['audio', 'video'])).toBe(false);
    expect(isAppMicrophoneRequest(app, app, ['video'])).toBe(false);
    expect(isAppMicrophoneRequest(app, app, [])).toBe(false);
    expect(isAppMicrophoneRequest(app, 'https://example.com', ['audio'])).toBe(false);
    expect(isAppMicrophoneRequest(app, 'file:///another/index.html', ['audio'])).toBe(false);
  });
});
