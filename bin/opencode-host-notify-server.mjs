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
    child.unref();
  } catch {
    // Host notifications should never crash the bridge server.
  }
}

function shellQuote(value) {
  return String(value).replace(/"/g, "\\\"");
}

function notifyMac(title, body, sound) {
  const script = `display notification "${shellQuote(body)}" with title "${shellQuote(title)}" sound name "${shellQuote(sound)}"`;
  runDetached("osascript", ["-e", script]);
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

    const title = typeof payload.title === "string" && payload.title.length > 0
      ? payload.title
      : "OpenCode";
    const body = typeof payload.body === "string" && payload.body.length > 0
      ? payload.body
      : "Needs attention";
    const sound = typeof payload.sound === "string" && payload.sound.length > 0
      ? payload.sound
      : config.sound;

    notifyMac(title, body, sound);
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
