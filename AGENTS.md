# AGENTS

## Purpose

This repository contains two cooperating pieces:

- an OpenCode plugin that runs inside the OpenCode runtime
- a host-side notifier process that runs on the machine that should produce the alert

The main use case is `opencode` inside a devcontainer where desktop notifications and audio need to happen on the host, not inside the container.

## Key files

- `index.js`: plugin entrypoint
- `bin/opencode-host-notify-server.mjs`: host-side notification server
- `examples/host-notify-bridge.json`: plugin config template
- `examples/host-notify-server.json`: host server config template
- `package.json`: npm metadata and OpenCode plugin metadata

## Runtime model

1. OpenCode emits an event inside the plugin runtime.
2. `index.js` filters the event list.
3. The plugin POSTs JSON to the configured host endpoint.
4. `opencode-host-notify-server.mjs` receives the payload.
5. The host process triggers notification and sound locally.

## Current event policy

Keep the default event set narrowly focused on user-attention events:

- `permission.asked`
- `question.asked`
- `session.idle`

Do not reintroduce `message.updated` as a default. It is too noisy for normal use.

## Config contract

Plugin config:

- default path: `~/.config/opencode/host-notify-bridge.json`
- env override: `OPENCODE_HOST_NOTIFY_BRIDGE_CONFIG`

Host server config:

- default path: `~/.config/opencode/host-notify-server.json`
- env override: `OPENCODE_HOST_NOTIFY_SERVER_CONFIG`

Both configs are plain JSON, not JSONC.

## Compatibility rules

- Keep the package installable as a normal npm package.
- Preserve the `oc-plugin` metadata in `package.json`.
- Preserve `export const id` and the default export object for the plugin entrypoint.
- Keep the plugin dependency-free unless a real need appears.

## Platform assumptions

- The host notifier is currently macOS-first.
- `osascript` is used for desktop notifications.
- `afplay` is used for system sounds.
- `say` is optional and controlled by `speechEnabled`.

If another platform is added, do it as a clear branch in the host notifier logic instead of weakening the macOS path.

## Testing

Minimum checks after edits:

1. Import test:
   `node -e "import('./index.js').then(m => console.log(m.id))"`
2. Host server boot:
   `node bin/opencode-host-notify-server.mjs`
3. HTTP test:
   POST a sample payload to `/notify`
4. OpenCode load test:
   point OpenCode at the repo with a `file://` plugin path and run `opencode debug config`

## Editing guidance

- Keep the plugin small and event-driven.
- Do not move user-specific example values into the code defaults unless they are safe defaults.
- Avoid embedding secrets in repo files. Example tokens should stay as `replace-me`.
- If adding new events, update both:
  - `DEFAULT_EVENTS`
  - `eventMessage()`
- If changing docs, keep `README.md` human-facing and `AGENTS.md` implementation-facing.

## Release guidance

Before publishing:

1. confirm package name
2. confirm `oc-plugin` metadata still matches OpenCode expectations
3. update version in `package.json`
4. verify `files` in `package.json` include everything needed
5. test npm install from a clean OpenCode config
