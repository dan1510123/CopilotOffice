import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EventsWatcher,
  type CopilotEvent,
} from '../../../electron/terminal/events-watcher';

const scratchDirectories: string[] = [];
const activeWatchers: EventsWatcher[] = [];

function serializeEvent(index: number, content = `event-${index}`): string {
  return JSON.stringify({
    type: 'assistant.message',
    data: { content },
    id: `event-${index}`,
    timestamp: new Date(1_700_000_000_000 + index).toISOString(),
    parentId: null,
  } satisfies CopilotEvent);
}

async function createEventsFile(lines: string[]): Promise<string> {
  const root = path.join(process.cwd(), 'tests', `.scratch-events-watcher-${randomUUID()}`);
  scratchDirectories.push(root);
  await fs.mkdir(root, { recursive: true });
  const filePath = path.join(root, 'events.jsonl');
  await fs.writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
}

afterEach(async () => {
  for (const watcher of activeWatchers.splice(0)) watcher.stop();
  await Promise.all(scratchDirectories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true }),
  ));
});

describe('EventsWatcher', () => {
  it('replays large history in bounded chunks instead of blocking on the full file', async () => {
    const totalEvents = 500;
    const filePath = await createEventsFile(
      Array.from({ length: totalEvents }, (_, index) =>
        serializeEvent(index, `${index}-${'x'.repeat(80)}`)),
    );
    let releaseFirstYield!: () => void;
    const firstYield = new Promise<void>((resolve) => {
      releaseFirstYield = resolve;
    });
    let yieldCount = 0;
    const yieldToEventLoop = vi.fn(async () => {
      yieldCount++;
      if (yieldCount === 1) await firstYield;
    });
    const received: Array<{ event: CopilotEvent; historical: boolean }> = [];
    const watcher = new EventsWatcher('large-history', {
      filePath,
      maxReadChunkBytes: 1024,
      yieldToEventLoop,
    });
    activeWatchers.push(watcher);

    watcher.start((event, historical) => received.push({ event, historical }));

    await vi.waitFor(() => expect(yieldToEventLoop).toHaveBeenCalled(), { timeout: 5_000 });
    expect(received.length).toBeGreaterThan(0);
    expect(received.length).toBeLessThan(totalEvents);

    releaseFirstYield();
    await vi.waitFor(() => expect(received).toHaveLength(totalEvents), { timeout: 5_000 });
    expect(received.every(({ historical }) => historical)).toBe(true);
    expect(yieldCount).toBeGreaterThan(1);
  });

  it('preserves UTF-8 split across chunks and marks appended events as live', async () => {
    const filePath = await createEventsFile([serializeEvent(1, 'historical 😀')]);
    const received: Array<{ event: CopilotEvent; historical: boolean }> = [];
    const watcher = new EventsWatcher('utf8-history', {
      filePath,
      maxReadChunkBytes: 7,
    });
    activeWatchers.push(watcher);
    watcher.start((event, historical) => received.push({ event, historical }));

    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 5_000 });
    await fs.appendFile(filePath, `${serializeEvent(2, 'live café 🚀')}\n`, 'utf8');
    watcher.readNewLines();

    await vi.waitFor(() => expect(received).toHaveLength(2), { timeout: 5_000 });
    expect(received.map(({ event, historical }) => ({
      content: event.data.content,
      historical,
    }))).toEqual([
      { content: 'historical 😀', historical: true },
      { content: 'live café 🚀', historical: false },
    ]);
  });

  it('coalesces repeated triggers without duplicating events', async () => {
    const filePath = await createEventsFile([serializeEvent(1)]);
    const received: string[] = [];
    const watcher = new EventsWatcher('coalesced-reads', {
      filePath,
      maxReadChunkBytes: 16,
    });
    activeWatchers.push(watcher);
    watcher.start((event) => received.push(event.id));

    await vi.waitFor(() => expect(received).toEqual(['event-1']), { timeout: 5_000 });
    await fs.appendFile(filePath, `${serializeEvent(2)}\n`, 'utf8');
    watcher.readNewLines();
    watcher.readNewLines();
    watcher.readNewLines();

    await vi.waitFor(() => expect(received).toEqual(['event-1', 'event-2']), { timeout: 5_000 });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(received).toEqual(['event-1', 'event-2']);
  });
});
