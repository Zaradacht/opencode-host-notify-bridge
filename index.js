import fs from "node:fs/promises";
import path from "node:path";

export const id = "opencode-host-notify-bridge";

const DEFAULT_EVENTS = new Set([
  "permission.asked",
  "question.asked",
  "session.idle",
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

const DEFAULT_COOLDOWN_MS = 1500;
const DEFAULT_TIMEOUT_MS = 1200;
const DEFAULT_ENDPOINTS = [
  "http://host.docker.internal:8765/notify",
  "http://gateway.docker.internal:8765/notify",
];

function bell() {
  process.stdout.write("\x07");
}

function isProbablyContainer() {
  return Boolean(
    process.env.container ||
    process.env.REMOTE_CONTAINERS ||
    process.env.DEVCONTAINER ||
    process.env.CODESPACES
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

function normalizeNumber(value, fallback) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return value;
}

function eventMessage(event) {
  switch (event?.type) {
    case "permission.asked":
      return "OpenCode needs permission";
    case "question.asked":
      return "OpenCode needs your input";
    case "session.idle":
      return "OpenCode is waiting for you";
    default:
      return "OpenCode needs attention";
  }
}

function configPath() {
  const explicit = process.env.OPENCODE_HOST_NOTIFY_BRIDGE_CONFIG;
  if (explicit) {
    return explicit;
  }

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

export async function server(_input, options = {}) {
  const config = await readBridgeConfig();
  const enabled = typeof options.enabled === "boolean"
    ? options.enabled
    : typeof config.enabled === "boolean"
      ? config.enabled
      : isProbablyContainer();
  const events = normalizeEvents(options.events ?? config.events);
  const blockedEvents = normalizeBlockedEvents(options.blockedEvents ?? config.blockedEvents);
  const cooldownMs = normalizeNumber(options.cooldownMs ?? config.cooldownMs, DEFAULT_COOLDOWN_MS);
  const timeoutMs = normalizeNumber(options.timeoutMs ?? config.timeoutMs, DEFAULT_TIMEOUT_MS);
  const endpoints = normalizeEndpoints(config, options);
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
  let lastBellAt = 0;

  return {
    event: async ({ event, sessionID }) => {
      if (!enabled || !event || !events.has(event.type) || eventBlocked(event.type, blockedEvents)) {
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

      const payload = {
        eventType: event.type,
        title,
        body: eventMessage(event),
        sessionID: typeof sessionID === "string" ? sessionID : null,
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
