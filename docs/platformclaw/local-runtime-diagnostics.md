# PlatformClaw Local Runtime Diagnostics

Use this note when a local PlatformClaw gateway accepts the web UI but CLI commands fail with config schema errors, protocol mismatch, or cron authorization symptoms.

## Common Cause

The `openclaw` command on `PATH` may point to a globally installed upstream build, while the local gateway was started from the PlatformClaw branch.

That mismatch can show up as:

- `Invalid config ... gateway.auth: Invalid input`
- `gateway closed (1002): protocol mismatch`
- cron commands appearing to ignore PlatformClaw shared-auth or employee scope fixes

This does not prove the cron backend patch regressed. First verify that the CLI and gateway are from the same PlatformClaw checkout.

## Checks

Run from the PlatformClaw repo:

```bash
which openclaw
openclaw --version
node openclaw.mjs --version
ss -ltnp | rg ':19001|:18789'
```

Expected local command shape:

```bash
OPENCLAW_CONFIG_PATH=/path/to/platformclaw-config.json \
OPENCLAW_STATE_DIR=/path/to/platformclaw-state \
node openclaw.mjs cron status --json
```

For an explicit wrapper that never uses the global install:

```bash
OPENCLAW_CONFIG_PATH=/path/to/platformclaw-config.json \
OPENCLAW_STATE_DIR=/path/to/platformclaw-state \
scripts/platformclaw-local-cli.sh cron status --json
```

## Cron Smoke

Use a disabled isolated job and remove it immediately:

```bash
OPENCLAW_CONFIG_PATH=/path/to/platformclaw-config.json \
OPENCLAW_STATE_DIR=/path/to/platformclaw-state \
scripts/platformclaw-local-cli.sh cron add \
  --name local-cron-smoke \
  --disabled \
  --agent <agent-id> \
  --every 1h \
  --message "debug smoke only" \
  --session isolated \
  --no-deliver \
  --json

OPENCLAW_CONFIG_PATH=/path/to/platformclaw-config.json \
OPENCLAW_STATE_DIR=/path/to/platformclaw-state \
scripts/platformclaw-local-cli.sh cron remove <job-id> --json
```

Notes:

- `--session current` needs an explicit origin `sessionKey` for PlatformClaw delivery routing.
- `--no-deliver` is the safest smoke path because it avoids Knox/channel delivery side effects.
- `cron.status`, `cron.list`, `cron.add`, `cron.update`, `cron.remove`, `cron.run`, and `cron.runs` must continue to use local backend shared auth.

## Diagnosis

If `node openclaw.mjs ...` works but `openclaw ...` fails, the problem is a runtime mismatch. Restart the local gateway with the intended branch and run local CLI commands through `node openclaw.mjs` or `scripts/platformclaw-local-cli.sh`.

If both fail, inspect the gateway log and cron server-method validation next. Do not bypass employee/session/workspace/agent scope checks to make a local smoke pass.
