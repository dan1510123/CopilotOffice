import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TrouterClient } from '../../../electron/teams/trouterClient';

const { sockets } = vi.hoisted(() => ({ sockets: [] as EventEmitter[] }));

vi.mock('ws', () => ({
  default: class extends EventEmitter {
    static OPEN = 1;
    readyState = 1;

    constructor() {
      super();
      sockets.push(this);
    }

    send(): void {}

    close(): void {
      this.readyState = 3;
      this.emit('close');
    }
  },
}));

let listener: TrouterClient | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  sockets.length = 0;
});

afterEach(async () => {
  await listener?.stop();
  listener = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function connectSocket(socket: EventEmitter): Promise<void> {
  socket.emit('message', '5:::{"name":"trouter.connected","args":[{}]}');
  await vi.advanceTimersByTimeAsync(0);
}

function pushReply(socket: EventEmitter, id: string): void {
  socket.emit('message', `3:::${JSON.stringify({
    body: {
      type: 'EventMessage',
      resourceType: 'NewMessage',
      resource: {
        id,
        conversationLink: '19:fixture@thread.tacv2;messageid=root',
        content: 'Fixture reply',
      },
    },
  })}`);
}

it('keeps receiving Teams thread replies after the receive token rotates', async () => {
  let validToken = 'fixture-original';
  let registered = false;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    registered = new Headers(init.headers).get('authorization')?.endsWith(` ${validToken}`) ?? false;
    return new Response(null, { status: registered ? 202 : 401 });
  });

  listener = new TrouterClient({ getToken: async () => validToken });
  const receive = vi.fn();
  await listener.start(receive);
  const [socket] = sockets;
  await connectSocket(socket);
  if (registered) pushReply(socket, 'before');
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ messageId: 'before' }));

  validToken = 'fixture-renewed';
  await vi.advanceTimersByTimeAsync(45 * 60 * 1000);
  if (registered) pushReply(socket, 'after');
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ messageId: 'after', threadRootId: 'root' }));
});

it('receives Teams thread replies again after a dropped socket and a transient credential failure', async () => {
  vi.stubGlobal('fetch', async () => new Response(null, { status: 202 }));
  let credentialsAvailable = true;
  listener = new TrouterClient({
    getToken: async () => {
      if (!credentialsAvailable) throw new Error('Temporary credential failure');
      return 'fixture-token';
    },
  });
  const receive = vi.fn();
  await listener.start(receive);
  const [original] = sockets;
  await connectSocket(original);

  credentialsAvailable = false;
  original.emit('close');
  await vi.advanceTimersByTimeAsync(5000);
  credentialsAvailable = true;
  await vi.advanceTimersByTimeAsync(5000);

  const replacement = sockets.at(-1);
  if (replacement && replacement !== original) {
    await connectSocket(replacement);
    pushReply(replacement, 'recovered');
  }
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'recovered' }));
});

it('reconnects if Teams rejects renewal instead of continuing to report connected', async () => {
  let acceptsRegistration = true;
  vi.stubGlobal('fetch', async () => new Response(null, { status: acceptsRegistration ? 202 : 401 }));
  listener = new TrouterClient({ getToken: async () => 'fixture-token' });
  const receive = vi.fn();
  await listener.start(receive);
  const [original] = sockets;
  await connectSocket(original);
  expect(listener.health).toBe('connected');

  acceptsRegistration = false;
  await vi.advanceTimersByTimeAsync(45 * 60 * 1000);
  expect(listener.health).not.toBe('connected');

  acceptsRegistration = true;
  await vi.advanceTimersByTimeAsync(5000);
  const replacement = sockets.at(-1);
  if (replacement && replacement !== original) {
    await connectSocket(replacement);
    pushReply(replacement, 'recovered');
  }
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'recovered' }));
});
