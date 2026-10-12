# @quiet/headless

Headless Quiet Loki client for Day 2. **Forks `backend-bundle/bundle.cjs`** the same way desktop Electron does — no Nest-in-process imports.

See `scripts/lokinet/HEADLESS.md`.

## `status`

`node lib/cli.js status` prints runtime and session info as JSON. Community secrets in the session (`psk`,
`inviteSeed`, `inviteSalt`) are masked as `"[redacted]"` by default so the output is safe to paste into logs or bug
reports. Pass `--show-secrets` to print them unmasked:

```sh
node lib/cli.js status                 # secrets masked
node lib/cli.js status --show-secrets  # psk / invite seed / salt shown
```

The JSON shape is unchanged; only those values are masked. `serve` prints the same (masked) status at start-up.
`invite` still prints the full invite link, since that is what you share.
