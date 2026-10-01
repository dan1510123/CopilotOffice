import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

export const NATIVE_BRIDGE_EXTENSION_ID = 'copilot-office-bridge';
export const NATIVE_BRIDGE_EXTENSION_SOURCE = String.raw`import { joinSession } from "@github/copilot-sdk/extension";
import * as net from "node:net";

const MAX_MESSAGE_BYTES = 256 * 1024;
const INITIAL_RECONNECT_DELAY_MS = 100;
const MAX_RECONNECT_DELAY_MS = 5000;

const endpoint = requireEnv("COPILOT_OFFICE_BRIDGE_ENDPOINT");
const terminalKey = requireEnv("COPILOT_OFFICE_BRIDGE_TERMINAL_KEY");
const token = requireEnv("COPILOT_OFFICE_BRIDGE_NONCE");

let socket;
let registered = false;
let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
let reconnectTimer;
let terminated = false;
let unsubscribeEvents;
let pendingUserInput;
let pendingPlanDecision;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error("Missing required environment variable: " + name);
  return value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sendFrame(value, target = socket) {
  if (!target || target.destroyed) return false;
  const line = JSON.stringify(value) + "\n";
  if (Buffer.byteLength(line) > MAX_MESSAGE_BYTES) {
    throw new Error("Bridge message exceeds maximum size");
  }
  target.write(line);
  return true;
}

function scheduleReconnect() {
  if (terminated || reconnectTimer) return;
  const delay = reconnectDelayMs;
  reconnectDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, reconnectDelayMs * 2);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    connect();
  }, delay);
  reconnectTimer.unref?.();
}

function connect() {
  if (terminated) return;
  const candidate = net.createConnection(endpoint);
  socket = candidate;
  registered = false;
  let buffer = Buffer.alloc(0);

  candidate.setNoDelay(true);
  candidate.on("connect", () => {
    sendFrame({
      type: "register",
      terminalKey,
      token,
      sessionId: session.sessionId,
    }, candidate);
  });
  candidate.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const newlineIndex = buffer.indexOf(0x0a);
      if (newlineIndex === -1) break;
      if (newlineIndex > MAX_MESSAGE_BYTES) {
        candidate.destroy(new Error("Bridge message exceeds maximum size"));
        return;
      }
      const line = buffer.subarray(0, newlineIndex);
      buffer = buffer.subarray(newlineIndex + 1);
      if (line.length === 0) continue;
      let message;
      try {
        message = JSON.parse(line.toString("utf8"));
      } catch {
        candidate.destroy(new Error("Invalid bridge JSON"));
        return;
      }
      void handleBrokerMessage(candidate, message);
    }
    if (buffer.length > MAX_MESSAGE_BYTES) {
      candidate.destroy(new Error("Bridge message exceeds maximum size"));
    }
  });
  candidate.on("error", () => {});
  candidate.on("close", () => {
    if (socket === candidate) {
      socket = undefined;
      registered = false;
    }
    scheduleReconnect();
  });
}

async function handleBrokerMessage(candidate, message) {
  if (!message || typeof message !== "object") {
    candidate.destroy(new Error("Invalid bridge message"));
    return;
  }
  if (message.type === "registered") {
    if (candidate !== socket) {
      candidate.destroy();
      return;
    }
    registered = true;
    reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    return;
  }
  if (message.type === "registration-error") {
    candidate.destroy();
    return;
  }
  if (message.type !== "request" || typeof message.id !== "string") {
    candidate.destroy(new Error("Unexpected bridge message"));
    return;
  }

  try {
    const result = await executeCommand(message.command, message.params);
    sendFrame({ type: "response", id: message.id, ok: true, result }, candidate);
  } catch (error) {
    sendFrame({
      type: "response",
      id: message.id,
      ok: false,
      error: errorMessage(error),
    }, candidate);
  }
}

async function executeCommand(command, params) {
  switch (command) {
    case "send": {
      const prompt = params?.prompt;
      if (typeof prompt !== "string" || prompt.length === 0) {
        throw new Error("send requires a non-empty prompt");
      }
      return session.send({ prompt, mode: "enqueue" });
    }
    case "run-control":
      return runControl(params);
    case "submit-answer": {
      if (!pendingUserInput) throw new Error("No pending user-input request");
      const answer = params?.answer;
      if (typeof answer !== "string") throw new Error("submit-answer requires an answer");
      const pending = pendingUserInput;
      pendingUserInput = undefined;
      pending.resolve({ answer, wasFreeform: params?.wasFreeform === true });
      return { resolved: true };
    }
    case "submit-plan-decision": {
      if (!pendingPlanDecision) throw new Error("No pending plan decision");
      if (typeof params?.approved !== "boolean") {
        throw new Error("submit-plan-decision requires approved");
      }
      const pending = pendingPlanDecision;
      pendingPlanDecision = undefined;
      pending.resolve({
        approved: params.approved,
        ...(typeof params.selectedAction === "string"
          ? { selectedAction: params.selectedAction }
          : {}),
        ...(typeof params.feedback === "string" ? { feedback: params.feedback } : {}),
      });
      return { resolved: true };
    }
    default:
      throw new Error("Unsupported bridge command: " + String(command));
  }
}

async function runControl(params) {
  switch (params?.command) {
    case "compact": {
      if (!session.rpc?.history?.compact) {
        throw new Error("compaction is not supported by this session");
      }
      const result = await session.rpc.history.compact(
        typeof params.arg === "string" && params.arg.length > 0
          ? { instructions: params.arg }
          : undefined,
      );
      return {
        kind: "compact",
        success: Boolean(result?.success),
        tokensRemoved: result?.tokensRemoved ?? 0,
        messagesRemoved: result?.messagesRemoved ?? 0,
        ...(typeof result?.summaryContent === "string"
          ? { summary: result.summaryContent }
          : {}),
      };
    }
    case "usage": {
      if (!session.rpc?.usage?.getMetrics) {
        throw new Error("usage metrics are not supported by this session");
      }
      const metrics = await session.rpc.usage.getMetrics();
      let contextInfo;
      try {
        contextInfo = (
          await session.rpc?.metadata?.contextInfo?.({
            promptTokenLimit: 0,
            outputTokenLimit: 0,
          })
        )?.contextInfo;
      } catch {
        contextInfo = undefined;
      }
      return {
        kind: "usage",
        premiumRequestCost: metrics?.totalPremiumRequestCost,
        userRequests: metrics?.totalUserRequests,
        apiDurationMs: metrics?.totalApiDurationMs,
        totalTokens: contextInfo?.totalTokens,
        promptTokenLimit: contextInfo?.promptTokenLimit,
        compactionThreshold: contextInfo?.compactionThreshold,
      };
    }
    case "model": {
      if (!session.rpc?.model?.getCurrent) {
        throw new Error("model control is not supported by this session");
      }
      let switchedTo;
      if (typeof params.arg === "string" && params.arg.length > 0) {
        if (!session.rpc.model.switchTo) {
          throw new Error("model switching is not supported by this session");
        }
        const switched = await session.rpc.model.switchTo({ modelId: params.arg });
        switchedTo = switched?.modelId ?? params.arg;
      }
      const current = await session.rpc.model.getCurrent();
      return {
        kind: "model",
        current: current?.modelId,
        reasoningEffort: current?.reasoningEffort,
        ...(switchedTo ? { switchedTo } : {}),
      };
    }
    default:
      throw new Error("Unsupported control command: " + String(params?.command));
  }
}

const session = await joinSession({
  onUserInputRequest(request) {
    if (pendingUserInput) {
      throw new Error("A user-input request is already pending");
    }
    return new Promise((resolve) => {
      pendingUserInput = { request, resolve };
    });
  },
  onExitPlanModeRequest(request) {
    if (pendingPlanDecision) {
      throw new Error("A plan decision is already pending");
    }
    return new Promise((resolve) => {
      pendingPlanDecision = { request, resolve };
    });
  },
});

unsubscribeEvents = session.on((event) => {
  if (!registered) return;
  try {
    sendFrame({ type: "event", event });
  } catch {
    socket?.destroy();
  }
});

async function shutdown() {
  if (terminated) return;
  terminated = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  unsubscribeEvents?.();
  unsubscribeEvents = undefined;
  if (pendingUserInput) {
    pendingUserInput.resolve({ answer: "", wasFreeform: true });
    pendingUserInput = undefined;
  }
  if (pendingPlanDecision) {
    pendingPlanDecision.resolve({ approved: false, feedback: "Bridge terminated" });
    pendingPlanDecision = undefined;
  }
  const activeSocket = socket;
  socket = undefined;
  registered = false;
  activeSocket?.end();
  activeSocket?.destroy();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
connect();
`;

export interface MaterializeNativeBridgeExtensionOptions {
  homeDir?: string;
  source?: string;
}

export interface MaterializedNativeBridgeExtension {
  changed: boolean;
  extensionPath: string;
}

export function getNativeBridgeExtensionPath(homeDir = os.homedir()): string {
  return path.join(
    homeDir,
    '.copilot',
    'extensions',
    NATIVE_BRIDGE_EXTENSION_ID,
    'extension.mjs',
  );
}

export async function materializeNativeBridgeExtension(
  options: MaterializeNativeBridgeExtensionOptions = {},
): Promise<MaterializedNativeBridgeExtension> {
  const extensionPath = getNativeBridgeExtensionPath(options.homeDir);
  const source = options.source ?? NATIVE_BRIDGE_EXTENSION_SOURCE;
  let current: string | undefined;
  try {
    current = await fs.readFile(extensionPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (current === source) {
    return { changed: false, extensionPath };
  }

  const directory = path.dirname(extensionPath);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = path.join(
    directory,
    `.extension.mjs.${process.pid}.${randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, source, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(temporaryPath, extensionPath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  return { changed: true, extensionPath };
}
