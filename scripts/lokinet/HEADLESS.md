# Headless Quiet Loki (Day 2)

AI-agent / no-GUI client for create → invite → join → `#general` over **system Lokinet**.

Repo: `unmellow/quiet-loki` only (never TryQuiet/quiet).

## Prerequisites

Same as `DAY2-TWO-NODE.md`:

```bash
systemctl is-active lokinet
host localhost.loki 127.3.2.1
export LOKINET_WS_PORT=8080   # unprivileged; same on every peer
./scripts/lokinet/day2-preflight.sh
```

Build the monorepo once (`npm run bootstrap` / your usual Quiet Loki build) so `@quiet/backend` and friends resolve.

## Run

From the repo root after packages are built:

```bash
export LOKINET_WS_PORT=8080
export QUIET_HEADLESS=1
export QUIET_HEADLESS_DATA_DIR=$HOME/.config/QuietHeadless-A

cd packages/headless
npm run build
node lib/cli.js create --name day2 --username alice
node lib/cli.js invite
# → quiet-loki://join#p=…

# peer B
export QUIET_HEADLESS_DATA_DIR=$HOME/.config/QuietHeadless-B
node lib/cli.js join --invite 'quiet-loki://join#…' --username bob
node lib/cli.js send 'hello from B'
node lib/cli.js messages
```

### Commands

| Command | Purpose |
|---|---|
| `create -n <name> -u <user>` | Create Loki-only community + `#general` |
| `invite` | Print `quiet-loki://` invite |
| `join -i <url> -u <user>` | Join via invite |
| `send <text>` | Send to `#general` |
| `messages [--ids id1,id2]` | List/fetch `#general` messages |
| `status` | Session + env |
| `serve` | Keep backend alive |

Uses Nest backend with `QUIET_HEADLESS=1` (no Electron, no Tor wrap, no second lokinet, no `:1190`).

## Verification

quiet loki can start Day 2 verification from this entrypoint once both peers pass preflight and share an invite from `invite`.
