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
const MAX_UNREGISTERED_CONNECT_ATTEMPTS = 8;
const MAX_EVENT_BACKLOG = 32;

const enabled = process.env.COPILOT_OFFICE_BRIDGE_ENABLED === "1";
const sessionId = process.env.SESSION_ID;
let endpoint;
let terminalKey;
let token;

// This user-level extension loads in every experimental Copilot session. Only
// TUIs launched by Copilot Office carry the non-secret enable marker; anywhere
// else, exit before joining so unrelated sessions are left untouched.
if (!enabled || !sessionId) {
  process.exit(0);
}
delete process.env.COPILOT_OFFICE_BRIDGE_ENABLED;

let socket;
let registered = false;
let everRegistered = false;
let failedConnectAttempts = 0;
let reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
let reconnectTimer;
let terminated = false;
let unsubscribeEvents;
let sessionPromise;
let joinedSession;
let pendingUserInput;
let pendingPlanDecision;
let pendingElicitation;
let eventBacklog = [];

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
  if (!everRegistered && ++failedConnectAttempts >= MAX_UNREGISTERED_CONNECT_ATTEMPTS) {
    // The broker that minted these credentials is gone (e.g. stale inherited
    // environment); never join a session we cannot be driven from.
    void shutdown(0);
    return;
  }
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
      sessionId,
      parentPid: process.ppid,
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
    everRegistered = true;
    failedConnectAttempts = 0;
    reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
    void sessionPromise.then((session) => {
      announceReady(session, candidate);
      flushEventBacklog();
    });
    return;
  }
  if (message.type === "registration-error" || message.type === "replaced") {
    // Not this TUI's credentials, or a newer extension instance owns the
    // bridge: stand down for good instead of reconnecting.
    void shutdown(0);
    return;
  }
  if (message.type === "ready-ack") {
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
  const session = await requireSession();
  switch (command) {
    case "send": {
      const prompt = params?.prompt;
      if (typeof prompt !== "string" || prompt.length === 0) {
        throw new Error("send requires a non-empty prompt");
      }
      return session.send({ prompt, mode: "enqueue" });
    }
    case "run-control":
      return runControl(session, params);
    case "submit-answer": {
      if (!pendingUserInput) throw new Error("No pending user-input request");
      const answer = params?.answer;
      if (typeof answer !== "string") throw new Error("submit-answer requires an answer");
      if (
        typeof params?.requestId === "string"
        && params.requestId.length > 0
        && pendingUserInput.requestId !== params.requestId
      ) {
        throw new Error(
          "Pending user-input request does not match " + params.requestId,
        );
      }
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
      if (
        typeof params?.requestId === "string"
        && params.requestId.length > 0
        && pendingPlanDecision.requestId !== params.requestId
      ) {
        throw new Error(
          "Pending plan decision does not match " + params.requestId,
        );
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
    case "submit-elicitation": {
      if (!pendingElicitation) throw new Error("No pending elicitation request");
      const action = params?.action;
      if (action !== "accept" && action !== "decline" && action !== "cancel") {
        throw new Error("submit-elicitation requires action accept|decline|cancel");
      }
      if (
        typeof params?.requestId === "string"
        && params.requestId.length > 0
        && pendingElicitation.requestId !== params.requestId
      ) {
        throw new Error(
          "Pending elicitation request does not match " + params.requestId,
        );
      }
      const pending = pendingElicitation;
      pendingElicitation = undefined;
      pending.resolve({
        action,
        ...(action === "accept" && params?.content && typeof params.content === "object"
          ? { content: params.content }
          : {}),
      });
      return { resolved: true };
    }
    default:
      throw new Error("Unsupported bridge command: " + String(command));
  }
}

async function runControl(session, params) {
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

function requireSession() {
  if (!sessionPromise) throw new Error("Bridge session is not joined");
  return sessionPromise;
}

async function joinBridgeSession() {
  const session = await joinSession({
    requestedEnvironmentVariables: [
      "COPILOT_OFFICE_BRIDGE_ENDPOINT",
      "COPILOT_OFFICE_BRIDGE_TERMINAL_KEY",
      "COPILOT_OFFICE_BRIDGE_NONCE",
    ],
    onUserInputRequest(request) {
      if (pendingUserInput) {
        // A local TUI answer can settle the runtime before this extension sees
        // the matching completed event. A new request proves the old slot is
        // stale, so retire it instead of blocking every future ask_user call.
        pendingUserInput.resolve({ answer: "", wasFreeform: true });
      }
      return new Promise((resolve) => {
        pendingUserInput = {
          request,
          requestId:
            typeof request?.requestId === "string"
              ? request.requestId
              : undefined,
          resolve,
        };
      });
    },
    onExitPlanModeRequest(request) {
      if (pendingPlanDecision) {
        pendingPlanDecision.resolve({
          approved: false,
          feedback: "Superseded by a newer plan decision",
        });
      }
      return new Promise((resolve) => {
        pendingPlanDecision = {
          request,
          requestId:
            typeof request?.requestId === "string"
              ? request.requestId
              : undefined,
          resolve,
        };
      });
    },
    onElicitationRequest(context) {
      // The structured, multi-field ask_user form (or an MCP server's elicitation). Mirrors
      // onUserInputRequest: a local TUI answer can settle the runtime before this extension
      // sees the matching completed event, so a new request proves the old slot is stale —
      // cancel it rather than blocking every future elicitation. The ElicitationContext
      // carries no requestId; it is correlated from the elicitation.requested event by message.
      if (pendingElicitation) {
        pendingElicitation.resolve({ action: "cancel" });
      }
      return new Promise((resolve) => {
        pendingElicitation = {
          context,
          requestId: undefined,
          resolve,
        };
      });
    },
  });
  if (terminated) return session;
  endpoint = process.env.COPILOT_OFFICE_BRIDGE_ENDPOINT;
  terminalKey = process.env.COPILOT_OFFICE_BRIDGE_TERMINAL_KEY;
  token = process.env.COPILOT_OFFICE_BRIDGE_NONCE;
  for (const name of Object.keys(process.env)) {
    if (name.toUpperCase().startsWith("COPILOT_OFFICE_BRIDGE_")) delete process.env[name];
  }
  if (!endpoint || !terminalKey || !token) {
    throw new Error("Copilot Office bridge credentials were not granted to the extension");
  }
  joinedSession = session;
  unsubscribeEvents = session.on((event) => {
    const requestId =
      typeof event?.data?.requestId === "string"
        ? event.data.requestId
        : undefined;
    if (event?.type === "user_input.requested") {
      const pendingQuestion = pendingUserInput?.request?.question;
      const eventQuestion = event?.data?.question;
      if (
        pendingUserInput
        && !pendingUserInput.requestId
        && (
          typeof pendingQuestion !== "string"
          || (
            typeof eventQuestion === "string"
            && pendingQuestion === eventQuestion
          )
        )
      ) {
        pendingUserInput.requestId = requestId;
      }
    } else if (event?.type === "user_input.completed") {
      if (pendingUserInput?.requestId && pendingUserInput.requestId === requestId) {
        pendingUserInput = undefined;
      }
    } else if (event?.type === "exit_plan_mode.requested") {
      const pendingSummary = pendingPlanDecision?.request?.summary;
      const eventSummary = event?.data?.summary;
      if (
        pendingPlanDecision
        && !pendingPlanDecision.requestId
        && (
          typeof pendingSummary !== "string"
          || (
            typeof eventSummary === "string"
            && pendingSummary === eventSummary
          )
        )
      ) {
        pendingPlanDecision.requestId = requestId;
      }
    } else if (event?.type === "exit_plan_mode.completed") {
      if (pendingPlanDecision?.requestId && pendingPlanDecision.requestId === requestId) {
        pendingPlanDecision = undefined;
      }
    } else if (event?.type === "elicitation.requested") {
      const pendingMessage = pendingElicitation?.context?.message;
      const eventMessage = event?.data?.message;
      if (
        pendingElicitation
        && !pendingElicitation.requestId
        && (
          typeof pendingMessage !== "string"
          || (
            typeof eventMessage === "string"
            && pendingMessage === eventMessage
          )
        )
      ) {
        pendingElicitation.requestId = requestId;
      }
    } else if (event?.type === "elicitation.completed") {
      if (pendingElicitation?.requestId && pendingElicitation.requestId === requestId) {
        pendingElicitation = undefined;
      }
    }
    const bridgeEvent = prepareEventForBridge(event);
    if (!registered) {
      eventBacklog.push(bridgeEvent);
      if (eventBacklog.length > MAX_EVENT_BACKLOG) eventBacklog.shift();
      return;
    }
    sendEventFrame(bridgeEvent);
  });
  announceReady(session, socket);
  return session;
}

function announceReady(session, target) {
  if (
    terminated
    || !registered
    || !target
    || target !== socket
    || target.destroyed
  ) {
    return;
  }
  sendFrame({ type: "ready", sessionId: session.sessionId }, target);
}

function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(String(value));
  if (bytes.length <= maxBytes) return String(value);
  return bytes.subarray(0, maxBytes).toString("utf8") + "\n[bridge content truncated]";
}

function compactEvent(event) {
  const data = event?.data && typeof event.data === "object" && !Array.isArray(event.data)
    ? event.data
    : {};
  const compactData = { bridgeTruncated: true };
  const identityKeys = [
    "requestId",
    "toolCallId",
    "toolName",
    "messageId",
    "success",
    "approved",
    "selectedAction",
    "feedback",
  ];
  for (const key of identityKeys) {
    const value = data[key];
    if (
      typeof value === "string"
      || typeof value === "number"
      || typeof value === "boolean"
      || value === null
    ) {
      compactData[key] = value;
    }
  }
  for (const key of ["content", "text", "message", "partialOutput", "detailedContent"]) {
    if (typeof data[key] === "string") {
      compactData[key] = truncateUtf8(data[key], 192 * 1024);
      break;
    }
    if (event?.type === "user_input.requested") {
      compactData.question = truncateUtf8(data.question ?? "", 64 * 1024);
      compactData.allowFreeform = data.allowFreeform === true;
      compactData.choices = compactStringArray(data.choices, 32, 4096);
    } else if (event?.type === "exit_plan_mode.requested") {
      compactData.summary = truncateUtf8(data.summary ?? "", 32 * 1024);
      compactData.planContent = truncateUtf8(data.planContent ?? "", 128 * 1024);
      compactData.actions = compactStringArray(data.actions, 32, 2048);
      compactData.recommendedAction = truncateUtf8(data.recommendedAction ?? "", 4096);
    }
  }

  function compactStringArray(value, maxItems, maxItemBytes) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, maxItems).map((item) => {
      if (typeof item === "string") return truncateUtf8(item, maxItemBytes);
      if (item && typeof item === "object") {
        const text = item.text ?? item.label ?? item.value ?? "";
        return { text: truncateUtf8(text, maxItemBytes) };
      }
      return truncateUtf8(item ?? "", maxItemBytes);
    });
  }
  return {
    type: event?.type ?? "unknown",
    ...(typeof event?.id === "string" ? { id: event.id } : {}),
    ...(typeof event?.timestamp === "string" ? { timestamp: event.timestamp } : {}),
    ...(
      typeof event?.parentId === "string" || event?.parentId === null
        ? { parentId: event.parentId }
        : {}
    ),
    data: compactData,
  };
}

function prepareEventForBridge(event) {
  try {
    const line = JSON.stringify({ type: "event", event }) + "\n";
    if (Buffer.byteLength(line) <= MAX_MESSAGE_BYTES) return event;
  } catch (error) {
    return {
      type: event?.type ?? "unknown",
      data: { bridgeTruncated: true, content: "[unserializable event omitted]" },
    };
  }
  const compacted = compactEvent(event);
  const compactedLine = JSON.stringify({ type: "event", event: compacted }) + "\n";
  if (Buffer.byteLength(compactedLine) <= MAX_MESSAGE_BYTES) return compacted;
  return {
    type: event?.type ?? "unknown",
    data: { bridgeTruncated: true, content: "[oversized event omitted]" },
  };
}

function sendEventFrame(event) {
  try {
    sendFrame({ type: "event", event });
  } catch {
    // Event delivery is best-effort; never tear down the command channel.
  }
}

function flushEventBacklog() {
  if (!registered || eventBacklog.length === 0) return;
  const backlog = eventBacklog;
  eventBacklog = [];
  for (const event of backlog) sendEventFrame(event);
}

async function shutdown(exitCode = 0) {
  if (terminated) return;
  terminated = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
  unsubscribeEvents?.();
  unsubscribeEvents = undefined;
  joinedSession = undefined;
  eventBacklog = [];
  if (pendingUserInput) {
    pendingUserInput.resolve({ answer: "", wasFreeform: true });
    pendingUserInput = undefined;
  }
  if (pendingPlanDecision) {
    pendingPlanDecision.resolve({ approved: false, feedback: "Bridge terminated" });
    pendingPlanDecision = undefined;
  }
  if (pendingElicitation) {
    pendingElicitation.resolve({ action: "cancel" });
    pendingElicitation = undefined;
  }
  const activeSocket = socket;
  socket = undefined;
  registered = false;
  activeSocket?.end();
  activeSocket?.destroy();
  process.exit(exitCode);
}

process.once("SIGTERM", () => void shutdown(0));
process.once("SIGINT", () => void shutdown(0));
sessionPromise = joinBridgeSession();
sessionPromise.then(() => connect()).catch(() => void shutdown(1));
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
