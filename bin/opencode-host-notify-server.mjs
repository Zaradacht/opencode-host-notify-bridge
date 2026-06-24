#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_CONFIG = {
  host: "0.0.0.0",
  port: 8765,
  token: "",
  sound: "Glass",
  sounds: {},
  notificationEnabled: true,
  notificationTarget: "iterm",
  notificationApp: "iTerm",
  notificationBundleId: "com.googlecode.iterm2",
  notificationSender: "com.googlecode.iterm2",
  allowedEvents: [
    "permission.asked",
    "question.asked",
    "session.idle",
    "session.error",
    "session.failed",
  ],
  blockedEvents: [
    "task.finished",
    "task.completed",
    "task.done",
    "agent.finished",
    "agent.completed",
    "subagent.finished",
    "subagent.completed",
    "message.updated",
  ],
  speechEnabled: false,
  voice: "Samantha",
  rate: 200,
};

function configPath() {
  return process.env.OPENCODE_HOST_NOTIFY_SERVER_CONFIG
    || path.join(os.homedir(), ".config", "opencode", "host-notify-server.json");
}

async function readConfig() {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? { ...DEFAULT_CONFIG, ...parsed }
      : DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

function runDetached(command, args) {
  try {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => {});
    child.unref();
  } catch {
    // Host notifications should never crash the bridge server.
  }
}

function shellQuote(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\r?\n/g, " ");
}

function notifyMac(title, body, sound, config) {
  if (config.notificationEnabled === false) {
    return;
  }

  const target = notificationTarget(config);
  runDetached("terminal-notifier", [
    "-title",
    title,
    "-message",
    body,
    "-sound",
    sound,
    "-sender",
    target.sender,
    "-activate",
    target.sender,
  ]);

  const script = [
    `display notification "${shellQuote(body)}" with title "${shellQuote(title)}" sound name "${shellQuote(sound)}"`,
    `tell application "${shellQuote(target.app)}" to activate`,
  ].join("\n");
  if (config.notificationFallback !== false) {
    runDetached("osascript", ["-e", script]);
  }
}

function notificationTarget(config) {
  if (config.notificationTarget === "zed") {
    return { app: "Zed", sender: "dev.zed.Zed" };
  }

  if (config.notificationTarget === "iterm") {
    return { app: "iTerm", sender: "com.googlecode.iterm2" };
  }

  return {
    app: typeof config.notificationApp === "string" && config.notificationApp.length > 0
      ? config.notificationApp
      : "iTerm",
    sender: typeof config.notificationSender === "string" && config.notificationSender.length > 0
      ? config.notificationSender
      : typeof config.notificationBundleId === "string" && config.notificationBundleId.length > 0
        ? config.notificationBundleId
        : "com.googlecode.iterm2",
  };
}

function playSound(sound) {
  runDetached("afplay", [`/System/Library/Sounds/${sound}.aiff`]);
}

function speak(body, voice, rate) {
  const args = [];

  if (typeof voice === "string" && voice.length > 0) {
    args.push("-v", voice);
  }

  if (typeof rate === "number" && Number.isFinite(rate)) {
    args.push("-r", String(rate));
  }

  args.push(body);
  runDetached("say", args);
}

function normalizeStringList(value, fallback = []) {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value.filter((item) => typeof item === "string" && item.trim().length > 0);
}

function eventAllowed(eventType, config) {
  if (typeof eventType !== "string" || eventType.trim().length === 0) {
    return false;
  }

  const blocked = normalizeStringList(config.blockedEvents, DEFAULT_CONFIG.blockedEvents);
  if (blocked.includes(eventType) || blocked.some((event) => event.endsWith("*") && eventType.startsWith(event.slice(0, -1)))) {
    return false;
  }

  const allowed = normalizeStringList(config.allowedEvents, DEFAULT_CONFIG.allowedEvents);
  return allowed.length === 0 || allowed.includes(eventType);
}

function soundForEvent(eventType, config) {
  const sounds = config.sounds && typeof config.sounds === "object" && !Array.isArray(config.sounds)
    ? config.sounds
    : {};
  const sound = sounds[eventType];
  return typeof sound === "string" && sound.length > 0 ? sound : config.sound;
}

function json(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function start() {
  const config = await readConfig();

  const server = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/notify") {
      json(response, 404, { ok: false });
      return;
    }

    if (config.token) {
      const header = request.headers["x-opencode-token"];
      if (header !== config.token) {
        json(response, 403, { ok: false, error: "invalid token" });
        return;
      }
    }

    const chunks = [];
    for await (const chunk of request) {
      chunks.push(chunk);
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      json(response, 400, { ok: false, error: "invalid json" });
      return;
    }

    const eventType = typeof payload.eventType === "string" ? payload.eventType : "";
    if (!eventAllowed(eventType, config)) {
      json(response, 200, { ok: true, skipped: true, eventType });
      return;
    }

    const title = typeof payload.title === "string" && payload.title.length > 0
      ? payload.title
      : "OpenCode";
    const body = typeof payload.body === "string" && payload.body.length > 0
      ? payload.body
      : "Needs attention";
    const sound = typeof payload.sound === "string" && payload.sound.length > 0
      ? payload.sound
      : soundForEvent(eventType, config);

    notifyMac(title, body, sound, config);
    playSound(sound);

    if (config.speechEnabled) {
      speak(body, config.voice, config.rate);
    }

    json(response, 200, { ok: true });
  });

  server.listen(config.port, config.host, () => {
    process.stdout.write(`OpenCode host notify bridge listening on ${config.host}:${config.port}\n`);
  });
}

start().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
