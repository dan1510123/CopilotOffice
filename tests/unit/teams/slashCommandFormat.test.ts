import { describe, expect, it } from 'vitest';
import {
  formatCompact,
  formatUsage,
  formatModel,
  formatControlData,
  formatHelp,
} from '../../../electron/teams/slashCommandFormat';

describe('slashCommandFormat', () => {
  describe('formatCompact', () => {
    it('reports freed tokens/messages and the escaped summary', () => {
      const html = formatCompact({ kind: 'compact', success: true, tokensRemoved: 12000, messagesRemoved: 8, summary: 'Did <stuff> & things' });
      expect(html).toContain('12,000');
      expect(html).toContain('8');
      expect(html).toContain('Did &lt;stuff&gt; &amp; things');
      expect(html).not.toContain('<stuff>');
    });

    it('handles a missing summary', () => {
      const html = formatCompact({ kind: 'compact', success: true, tokensRemoved: 0, messagesRemoved: 0 });
      expect(html).toContain('Context compacted');
      expect(html).not.toContain('Summary');
    });

    it('reports a no-op when compaction did not run', () => {
      const html = formatCompact({ kind: 'compact', success: false, tokensRemoved: 0, messagesRemoved: 0 });
      expect(html).toContain('did not run');
    });
  });

  describe('formatUsage', () => {
    it('renders cost and context breakdown, tolerating missing fields', () => {
      const html = formatUsage({ kind: 'usage', premiumRequestCost: 3.5, userRequests: 42, apiDurationMs: 6224, totalTokens: 6224, promptTokenLimit: 128000, compactionThreshold: 115000 });
      expect(html).toContain('3.5');
      expect(html).toContain('42');
      expect(html).toContain('6,224');
      expect(html).toContain('128,000');
      expect(html).toContain('115,000');
    });

    it('degrades gracefully when only cost is present', () => {
      const html = formatUsage({ kind: 'usage', premiumRequestCost: 0, userRequests: 0 });
      expect(html).toContain('Session usage');
      expect(html).toContain('Premium request cost');
    });
  });

  describe('formatModel', () => {
    it('shows the current model when no switch happened', () => {
      const html = formatModel({ kind: 'model', current: 'claude-opus-4.8', reasoningEffort: 'high' });
      expect(html).toContain('Current model');
      expect(html).toContain('claude-opus-4.8');
      expect(html).toContain('reasoning: high');
    });

    it('confirms a switch', () => {
      const html = formatModel({ kind: 'model', current: 'gpt-5.6-sol', switchedTo: 'gpt-5.6-sol' });
      expect(html).toContain('Switched model');
      expect(html).toContain('gpt-5.6-sol');
    });
  });

  it('formatControlData dispatches on kind', () => {
    expect(formatControlData({ kind: 'compact', success: true, tokensRemoved: 1, messagesRemoved: 1 })).toContain('compacted');
    expect(formatControlData({ kind: 'usage', premiumRequestCost: 0, userRequests: 0 })).toContain('usage');
    expect(formatControlData({ kind: 'model', current: 'x' })).toContain('model');
  });

  it('formatHelp lists the supported commands', () => {
    const html = formatHelp();
    for (const cmd of ['/compact', '/usage', '/model', '/new', '/clear', '/stop', '/help']) {
      expect(html).toContain(cmd);
    }
  });
});
