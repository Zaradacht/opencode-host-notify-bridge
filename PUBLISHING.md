# Publishing

## Status

Current repository:

- GitHub: `https://github.com/Zaradacht/opencode-host-notify-bridge`

Current blocker:

- npm publish is not possible until this machine is authenticated with npm.

## 1. Authenticate with npm

```bash
npm adduser
```

Verify:

```bash
npm whoami
```

## 2. Final package review

Run:

```bash
npm pack --dry-run
```

Check:

- package name is correct
- version is correct
- tarball contents include:
  - `index.js`
  - `bin/opencode-host-notify-server.mjs`
  - `examples/*`
  - `README.md`
  - `LICENSE`

## 3. Publish

```bash
npm publish
```

If the package name is already taken, rename it in `package.json` first.

Recommended alternatives if the current name is unavailable:

- `@zaradacht/opencode-host-notify-bridge`
- `opencode-devcontainer-notify-bridge`
- `opencode-host-notify`

## 4. Install test after publish

In a clean OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-host-notify-bridge"]
}
```

Then run:

```bash
opencode debug config
```

## 5. Submit to awesome-opencode

Repository:

- `https://github.com/awesome-opencode/awesome-opencode`

Add a short entry under plugins with:

- plugin name
- one-line description
- GitHub repo link
- npm package name if published

Suggested description:

`OpenCode plugin and host bridge that forwards permission, question, and idle notifications from devcontainers to the host machine.`

## 6. Submit to opencode.im

Site:

- `https://www.opencode.im/`

Prepare:

- plugin name
- GitHub repo URL
- short description
- installation instructions
- screenshots or demo if useful

## 7. Suggested first release tag

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 8. After first release

Update `README.md` with:

- npm install path confirmed to work
- exact package name
- release badge if you want one
