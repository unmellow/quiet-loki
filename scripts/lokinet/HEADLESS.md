# Headless Quiet Loki (Day 2)

CLI that **forks `packages/backend-bundle/bundle.cjs`** (same entrypoint as desktop), then drives create / invite / join / `#general` over Socket.IO. No Electron UI.

Repo: `unmellow/quiet-loki` only.

## Prerequisites

```bash
systemctl is-active lokinet
host localhost.loki 127.3.2.1
export LOKINET_WS_PORT=8080   # same on every peer
./scripts/lokinet/day2-preflight.sh
```

You need a built backend bundle and built `@quiet/common`:

```bash
# from repo root (existing Quiet Loki build is fine)
ls packages/backend-bundle/bundle.cjs   # required (~20MB webpack output)
ls packages/common/lib/index.js         # required
```

If `bundle.cjs` is missing:

```bash
lerna run --scope @quiet/backend webpack:prod
# or your usual desktop/backend build that syncs into backend-bundle
```

## Install + build headless only

```bash
cd packages/headless
npm install
npm run build
```

`npm install` links `backend-bundle` and `@quiet/common` via `file:../…`.

## Run

```bash
export LOKINET_WS_PORT=8080
export QUIET_HEADLESS_DATA_DIR=$HOME/.config/QuietHeadless-A

cd packages/headless
node lib/cli.js create --name day2 --username alice
node lib/cli.js invite
# → quiet-loki://?…

export QUIET_HEADLESS_DATA_DIR=$HOME/.config/QuietHeadless-B
node lib/cli.js join --invite 'quiet-loki://?…' --username bob
node lib/cli.js send 'hello from B'
node lib/cli.js messages
```

Or pass `--data-dir` on each command.

### Commands

| Command | Purpose |
|---|---|
| `create -n <name> -u <user>` | Create community + `#general` |
| `invite` | Print `quiet-loki://` invite |
| `join -i <url> -u <user>` | Join via invite |
| `send <text>` | Send to `#general` |
| `messages [--ids …]` | List/fetch `#general` |
| `status` | Session + backend PID |
| `serve` | Keep backend-bundle alive |

## Architecture

1. CLI forks `backend-bundle` with `-p desktop -d <port> -a <dataDir> -r <resources>`
2. Sends socket secret over IPC (`readyForSecret` / `set-socket-secret`) — same as Electron main
3. Connects `socket.io-client` with `Authorization: Bearer <secret>` and emits `start`
4. Uses SocketActions create/join/channel/message

Loki-only: system lokinet, `LOKINET_WS_PORT`, no Tor wrap, no second lokinet, no `:1190`.

## Verified smoke (Arch)

On a machine with system lokinet + `packages/backend-bundle/bundle.cjs`:
`node lib/cli.js create …` returned `ok: true` with a `#general` channel id, and `invite` printed a `quiet-loki://?…` URL (psk + 52-char SNApp in `p=`).
