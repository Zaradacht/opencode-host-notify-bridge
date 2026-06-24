import fs from "node:fs/promises";
import path from "node:path";

export const id = "opencode-host-notify-bridge";

const DEFAULT_EVENTS = new Set([
  "permission.asked",
  "question.asked",
  "session.idle",
  "session.error",
  "session.failed",
]);

const DEFAULT_BLOCKED_EVENTS = new Set([
  "task.finished",
  "task.completed",
  "task.done",
  "agent.finished",
  "agent.completed",
  "subagent.finished",
  "subagent.completed",
  "message.updated",
]);

const DEFAULT_CLEAR_EVENTS = {
  "permission.replied": "permission.asked",
  "question.replied": "question.asked",
  "session.idle": "session.error",
  "session.deleted": "session.error",
};

const DEFAULT_COOLDOWN_MS = 1500;
const DEFAULT_TIMEOUT_MS = 1200;
const DEFAULT_ZED_BELL = true;
const DEFAULT_ENDPOINTS = [
  "http://127.0.0.1:8765/notify",
  "http://localhost:8765/notify",
  "http://host.docker.internal:8765/notify",
  "http://gateway.docker.internal:8765/notify",
];

const DEFAULT_EVENT_CONFIG = {
  "session.idle": {
    body: "OpenCode is waiting for you",
    sound: "Glass",
    terminalTitle: false,
    label: "Done",
    zedBell: true,
  },
  "permission.asked": {
    body: "OpenCode needs permission",
    sound: "Submarine",
    marker: "🔴",
    label: "Permission",
    zedBell: true,
  },
  "question.asked": {
    body: "OpenCode needs your input",
    sound: "Ping",
    marker: "🟡",
    label: "Input",
    zedBell: true,
  },
  "session.error": {
    body: "OpenCode hit an error",
    sound: "Basso",
    marker: "⚠️",
    label: "Error",
    zedBell: true,
  },
  "session.failed": {
    body: "OpenCode hit an error",
    sound: "Basso",
    marker: "⚠️",
    label: "Error",
    zedBell: true,
  },
};

function bell() {
  process.stdout.write("\x07");
}

function setTerminalTitle(title) {
  process.stdout.write(`\x1b]0;${title.replace(/[\x00-\x1f\x7f]/g, "")}\x07`);
}

function pushTerminalTitle() {
  process.stdout.write("\x1b[22;0t");
}

function popTerminalTitle() {
  process.stdout.write("\x1b[23;0t");
}

function isProbablyContainer() {
  return Boolean(
    process.env.container ||
    process.env.REMOTE_CONTAINERS ||
    process.env.DEVCONTAINER ||
    process.env.CODESPACES,
  );
}

function normalizeEvents(events) {
  if (!Array.isArray(events)) {
    return DEFAULT_EVENTS;
  }

  const normalized = events
    .filter((event) => typeof event === "string")
    .map((event) => event.trim())
    .filter((event) => event.length > 0);

  return normalized.length > 0 ? new Set(normalized) : DEFAULT_EVENTS;
}

function normalizeBlockedEvents(blockedEvents) {
  if (!Array.isArray(blockedEvents)) {
    return DEFAULT_BLOCKED_EVENTS;
  }

  const normalized = blockedEvents
    .filter((event) => typeof event === "string")
    .map((event) => event.trim())
    .filter((event) => event.length > 0);

  return new Set([...DEFAULT_BLOCKED_EVENTS, ...normalized]);
}

function eventBlocked(eventType, blockedEvents) {
  if (blockedEvents.has(eventType)) {
    return true;
  }

  for (const event of blockedEvents) {
    if (event.endsWith("*") && eventType.startsWith(event.slice(0, -1))) {
      return true;
    }
  }

  return false;
}

function normalizeClearEvents(clearEvents) {
  if (!clearEvents || typeof clearEvents !== "object" || Array.isArray(clearEvents)) {
    return DEFAULT_CLEAR_EVENTS;
  }

  return { ...DEFAULT_CLEAR_EVENTS, ...clearEvents };
}

function normalizeNumber(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return value;
}

function mergeEventConfig(config, options) {
  const configured = config.eventConfig && typeof config.eventConfig === "object" ? config.eventConfig : {};
  const optionConfig = options.eventConfig && typeof options.eventConfig === "object" ? options.eventConfig : {};
  return { ...DEFAULT_EVENT_CONFIG, ...configured, ...optionConfig };
}

function detailsForEvent(event, eventConfig) {
  const details = eventConfig[event?.type] ?? {};
  return {
    body: typeof details.body === "string" && details.body.length > 0 ? details.body : "OpenCode needs attention",
    sound: typeof details.sound === "string" && details.sound.length > 0 ? details.sound : undefined,
    marker: typeof details.marker === "string" && details.marker.length > 0 ? details.marker : "🔵",
    label: typeof details.label === "string" && details.label.length > 0 ? details.label : "Attention",
    terminalTitle: details.terminalTitle !== false,
    zedBell: details.zedBell !== false,
    autoRestoreMs: typeof details.autoRestoreMs === "number" && Number.isFinite(details.autoRestoreMs) && details.autoRestoreMs > 0
      ? details.autoRestoreMs
      : 0,
  };
}

function isAbortError(error) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = typeof error.name === "string" ? error.name : "";
  const message = typeof error.message === "string" ? error.message : "";
  return name === "MessageAbortedError"
    || name === "AbortError"
    || /\b(aborted|cancelled|canceled|interrupted|esc pressed)\b/i.test(message);
}

function configPath() {
  const home = process.env.HOME;
  if (!home) {
    return null;
  }

  return path.join(home, ".config", "opencode", "host-notify-bridge.json");
}

async function readBridgeConfig() {
  const filePath = configPath();

  if (!filePath) {
    return {};
  }

  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeEndpoints(config, options) {
  if (Array.isArray(options.endpoints)) {
    const values = options.endpoints.filter((value) => typeof value === "string" && value.trim().length > 0);
    if (values.length > 0) {
      return values;
    }
  }

  if (typeof options.endpoint === "string" && options.endpoint.trim().length > 0) {
    return [options.endpoint.trim()];
  }

  if (Array.isArray(config.endpoints)) {
    const values = config.endpoints.filter((value) => typeof value === "string" && value.trim().length > 0);
    if (values.length > 0) {
      return values;
    }
  }

  if (typeof config.endpoint === "string" && config.endpoint.trim().length > 0) {
    return [config.endpoint.trim()];
  }

  return DEFAULT_ENDPOINTS;
}

async function postNotification(url, token, payload, timeoutMs) {
  const headers = {
    "content-type": "application/json",
  };

  if (typeof token === "string" && token.length > 0) {
    headers["x-opencode-token"] = token;
  }

  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    throw new Error(`notify bridge returned ${response.status}`);
  }
}

function eventSessionID(event, fallback) {
  if (typeof event?.properties?.sessionID === "string" && event.properties.sessionID.length > 0) {
    return event.properties.sessionID;
  }

  if (typeof fallback === "string" && fallback.length > 0) {
    return fallback;
  }

  return null;
}

function metadataSessionID(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  if (typeof metadata.sessionId === "string" && metadata.sessionId.length > 0) {
    return metadata.sessionId;
  }

  if (typeof metadata.sessionID === "string" && metadata.sessionID.length > 0) {
    return metadata.sessionID;
  }

  return null;
}

export async function server(_input, options = {}) {
  const config = await readBridgeConfig();
  const enabled = typeof options.enabled === "boolean"
    ? options.enabled
    : typeof config.enabled === "boolean"
      ? config.enabled
      : isProbablyContainer();
  const events = normalizeEvents(options.events ?? config.events);
  const blockedEvents = normalizeBlockedEvents(options.blockedEvents ?? config.blockedEvents);
  const clearEvents = normalizeClearEvents(options.clearEvents ?? config.clearEvents);
  const cooldownMs = normalizeNumber(options.cooldownMs ?? config.cooldownMs, DEFAULT_COOLDOWN_MS);
  const timeoutMs = normalizeNumber(options.timeoutMs ?? config.timeoutMs, DEFAULT_TIMEOUT_MS);
  const endpoints = normalizeEndpoints(config, options);
  const eventConfig = mergeEventConfig(config, options);
  const token = typeof options.token === "string"
    ? options.token
    : typeof config.token === "string"
      ? config.token
      : "";
  const title = typeof options.title === "string"
    ? options.title
    : typeof config.title === "string"
      ? config.title
      : "OpenCode";
  const bellOnFailure = options.bellOnFailure !== false && config.bellOnFailure !== false;
  const bellOnEveryEvent = options.bellOnEveryEvent === true || config.bellOnEveryEvent === true;
  const zedBell = typeof options.zedBell === "boolean"
    ? options.zedBell
    : typeof config.zedBell === "boolean"
      ? config.zedBell
      : DEFAULT_ZED_BELL;
  const terminalTitleEnabled = options.terminalTitle !== false && config.terminalTitle !== false;
  const restoreTitle = options.restoreTitle !== false && config.restoreTitle !== false;
  const ignoreSubagents = options.ignoreSubagents !== false && config.ignoreSubagents !== false;
  const ignoreBackgroundTasks = options.ignoreBackgroundTasks !== false && config.ignoreBackgroundTasks !== false;
  let lastBellAt = 0;
  const activeAttention = new Map();
  const attentionTimers = new Map();
  const ignoredSubagentSessions = new Set();
  const ignoredBackgroundSessions = new Set();
  let titlePushed = false;

  function attentionKey(eventType, sessionID) {
    const session = typeof sessionID === "string" && sessionID.length > 0 ? sessionID : "global";
    return `${session}:${eventType}`;
  }

  function activeAttentionCount() {
    let total = 0;
    for (const count of activeAttention.values()) {
      total += count;
    }
    return total;
  }

  function restoreTitleIfClear() {
    if (terminalTitleEnabled && restoreTitle && titlePushed && activeAttentionCount() === 0) {
      popTerminalTitle();
      titlePushed = false;
    }
  }

  function markAttention(eventType, sessionID, details) {
    if (!details.terminalTitle) {
      return;
    }

    const key = attentionKey(eventType, sessionID);
    activeAttention.set(key, (activeAttention.get(key) ?? 0) + 1);
    if (details.terminalTitle && terminalTitleEnabled && restoreTitle && !titlePushed) {
      pushTerminalTitle();
      titlePushed = true;
    }

    const existingTimer = attentionTimers.get(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      attentionTimers.delete(key);
    }

    if (details.autoRestoreMs > 0) {
      const timer = setTimeout(() => {
        activeAttention.delete(key);
        attentionTimers.delete(key);
        restoreTitleIfClear();
      }, details.autoRestoreMs);
      timer.unref?.();
      attentionTimers.set(key, timer);
    }
  }

  function clearAttention(clearEventType, sessionID) {
    const targetEventType = clearEvents[clearEventType];
    if (!targetEventType) {
      return;
    }

    const exactKey = attentionKey(targetEventType, sessionID);
    const keysToClear = new Set();

    if (activeAttention.has(exactKey) || attentionTimers.has(exactKey)) {
      keysToClear.add(exactKey);
    }

    // OpenCode's replied events can arrive without the same sessionID shape as
    // asked events, and asked events may be duplicated in the bus. A reply means
    // the prompt was handled, so clear every outstanding attention marker for
    // that prompt type instead of decrementing a fragile counter.
    for (const key of activeAttention.keys()) {
      if (key.endsWith(`:${targetEventType}`)) {
        keysToClear.add(key);
      }
    }
    for (const key of attentionTimers.keys()) {
      if (key.endsWith(`:${targetEventType}`)) {
        keysToClear.add(key);
      }
    }

    for (const key of keysToClear) {
      const existingTimer = attentionTimers.get(key);
      if (existingTimer) {
        clearTimeout(existingTimer);
        attentionTimers.delete(key);
      }
      activeAttention.delete(key);
    }

    restoreTitleIfClear();
  }

  function clearAllAttention() {
    for (const timer of attentionTimers.values()) {
      clearTimeout(timer);
    }
    activeAttention.clear();
    attentionTimers.clear();
    restoreTitleIfClear();
  }

  function shouldIgnoreSession(sessionID) {
    if (typeof sessionID !== "string" || sessionID.length === 0) {
      return false;
    }

    return (ignoreSubagents && ignoredSubagentSessions.has(sessionID))
      || (ignoreBackgroundTasks && ignoredBackgroundSessions.has(sessionID));
  }

  function rememberTaskSession(input, output) {
    if (input?.tool !== "task") {
      return;
    }

    const sessionID = metadataSessionID(output?.metadata);
    if (!sessionID) {
      return;
    }

    if (ignoreSubagents) {
      ignoredSubagentSessions.add(sessionID);
    }

    if (ignoreBackgroundTasks && output.metadata?.background === true) {
      ignoredBackgroundSessions.add(sessionID);
    }
  }

  return {
    "tool.execute.after": async (input, output) => {
      rememberTaskSession(input, output);
    },
    event: async ({ event, sessionID }) => {
      if (!enabled || !event) {
        return;
      }

      const targetSessionID = eventSessionID(event, sessionID);

      if (event.type === "session.error" && isAbortError(event.properties?.error ?? event.error)) {
        clearAllAttention();
        return;
      }

      clearAttention(event.type, targetSessionID);

      if (shouldIgnoreSession(targetSessionID)) {
        return;
      }

      if (!events.has(event.type) || eventBlocked(event.type, blockedEvents)) {
        return;
      }

      const now = Date.now();
      if (now - lastBellAt < cooldownMs) {
        return;
      }

      lastBellAt = now;

      if (bellOnEveryEvent) {
        bell();
      }

      const details = detailsForEvent(event, eventConfig);

      if (!bellOnEveryEvent && zedBell && details.zedBell) {
        bell();
      }

      markAttention(event.type, targetSessionID, details);

      if (details.terminalTitle && terminalTitleEnabled) {
        setTerminalTitle(`${details.marker} OpenCode: ${details.label}`);
      }

      const payload = {
        eventType: event.type,
        title,
        body: details.body,
        sound: details.sound,
        marker: details.marker,
        label: details.label,
        sessionID: targetSessionID,
        timestamp: new Date(now).toISOString(),
      };

      for (const endpoint of endpoints) {
        try {
          await postNotification(endpoint, token, payload, timeoutMs);
          return;
        } catch {
          // Try the next endpoint.
        }
      }

      if (bellOnFailure && !bellOnEveryEvent) {
        bell();
      }
    },
  };
}

export default {
  id,
  server,
};
