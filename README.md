# opencode-host-notify-bridge

OpenCode plugin that forwards notification events from a devcontainer or remote session to a small host-side notifier process.

This solves the common case where `opencode` runs inside a container, but the sound and desktop notification need to happen on the macOS host.

## Quickstart

1. Install the plugin in OpenCode.
2. Create `~/.config/opencode/host-notify-bridge.json` from `examples/host-notify-bridge.json`.
3. Create `~/.config/opencode/host-notify-server.json` from `examples/host-notify-server.json`.
4. Start the host process:

```bash
opencode-host-notify-server
```

5. Run `opencode` inside your devcontainer.

## What it does

- listens for OpenCode events inside the plugin runtime
- forwards those events to a host HTTP endpoint
- keeps notifications focused on user-attention events
- ignores subagent and background-task sessions by default
- falls back to a terminal bell if the host endpoint is unreachable

Default events:

- `permission.asked`
- `question.asked`
- `session.idle`

## Package contents

- `index.js`: OpenCode plugin entrypoint
- `bin/opencode-host-notify-server.mjs`: host-side notifier process
- `examples/host-notify-bridge.json`: plugin config example
- `examples/host-notify-server.json`: host server config example

## Install

### 1. Install the plugin

After publishing to npm:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-host-notify-bridge"]
}
```

For local development:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///absolute/path/to/opencode-host-notify-bridge"]
}
```

### 2. Create plugin config

Create `~/.config/opencode/host-notify-bridge.json` from `examples/host-notify-bridge.json`.

Important fields:

- `endpoint` / `endpoints`: where the container should POST notifications
- `token`: shared secret between plugin and host process
- `events`: which OpenCode events trigger notifications
- `ignoreSubagents`: ignore notifications from task/subagent sessions; defaults to `true`
- `ignoreBackgroundTasks`: ignore notifications from background task sessions; defaults to `true`

### 3. Create host server config

Create `~/.config/opencode/host-notify-server.json` from `examples/host-notify-server.json`.

Important fields:

- `host`
- `port`
- `token`
- `sound`
- `notificationTarget`: `iterm`, `zed`, or custom fields; defaults to `iterm`
- `notificationSender`: macOS bundle identifier used by `terminal-notifier`
- `notificationFallback`: set to `true` to also use AppleScript notifications; defaults to enabled when omitted
- `speechEnabled`

### 4. Start the host server

```bash
opencode-host-notify-server
```

For a background launch on macOS:

```bash
nohup opencode-host-notify-server >/tmp/opencode-host-notify-server.log 2>&1 &
```

## How it works in devcontainers

```text
OpenCode in devcontainer
  -> plugin receives event
  -> POST to host.docker.internal:8765/notify
  -> host server triggers macOS notification and sound
```

If `host.docker.internal` is not available in your container runtime, use another reachable host address and set it in `host-notify-bridge.json`.

## Files

- `index.js`: plugin entrypoint loaded by OpenCode
- `bin/opencode-host-notify-server.mjs`: host-side HTTP listener
- `examples/host-notify-bridge.json`: container-side plugin config
- `examples/host-notify-server.json`: host-side notifier config

## Event model

Recommended event set:

- `permission.asked`
- `question.asked`
- `session.idle`

Avoid `message.updated` unless you explicitly want noisy per-message notifications.

## macOS behavior

The host process uses:

- `terminal-notifier` for Notification Center alerts attributed to the configured app sender
- optional `osascript` fallback when `notificationFallback` is not `false`
- `afplay` for system sounds
- `say` only when `speechEnabled` is `true`

Default notification targeting is iTerm:

```json
{
  "notificationTarget": "iterm",
  "notificationSender": "com.googlecode.iterm2",
  "notificationFallback": false
}
```

To target Zed instead:

```json
{
  "notificationTarget": "zed",
  "notificationSender": "dev.zed.Zed"
}
```

Install `terminal-notifier` on macOS if it is not already available:

```bash
brew install terminal-notifier
```

## Local development

For local plugin loading, point OpenCode at the repo path:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///Users/your-user/Documents/projects/personal/opencode-host-notify-bridge"]
}
```

For local host-server testing:

```bash
node bin/opencode-host-notify-server.mjs
```

Then post a test notification:

```bash
curl -X POST http://127.0.0.1:8765/notify \
  -H 'content-type: application/json' \
  -H 'x-opencode-token: replace-me' \
  --data '{"title":"OpenCode","body":"Test","eventType":"session.idle"}'
```

## Publish

1. Pick the final package name
2. `npm publish`
3. Add the repo to `awesome-opencode`
4. Optionally submit it to `opencode.im`
