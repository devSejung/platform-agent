---
summary: "Timezone handling for agents, envelopes, and prompts"
read_when:
  - You need to understand how timestamps are normalized for the model
  - Configuring the user timezone for system prompts
title: "Timezones"
---

# Timezones

OpenClaw standardizes timestamps so the model sees a **single reference time**.

## Message envelopes (local by default)

Inbound messages are wrapped in an envelope like:

```
[Provider ... 2026-01-05 16:26 PST] message text
```

The timestamp in the envelope is **host-local by default**, with minutes precision.

You can override this with:

```json5
{
  agents: {
    defaults: {
      envelopeTimezone: "local", // "utc" | "local" | "user" | IANA timezone
      envelopeTimestamp: "on", // "on" | "off"
      envelopeElapsed: "on", // "on" | "off"
    },
  },
}
```

- `envelopeTimezone: "utc"` uses UTC.
- `envelopeTimezone: "user"` uses `agents.defaults.userTimezone` (falls back to the PlatformClaw default timezone).
- Use an explicit IANA timezone (e.g., `"Europe/Vienna"`) for a fixed offset.
- `envelopeTimestamp: "off"` removes absolute timestamps from envelope headers.
- `envelopeElapsed: "off"` removes elapsed time suffixes (the `+2m` style).

### Examples

**Local (default):**

```
[Signal Alice +1555 2026-01-18 00:19 PST] hello
```

**Fixed timezone:**

```
[Signal Alice +1555 2026-01-18 06:19 GMT+1] hello
```

**Elapsed time:**

```
[Signal Alice +1555 +2m 2026-01-18T05:19Z] follow-up
```

## Tool payloads (raw provider data + normalized fields)

Tool calls (`channels.discord.readMessages`, `channels.slack.readMessages`, etc.) return **raw provider timestamps**.
We also attach normalized fields for consistency:

- `timestampMs` (UTC epoch milliseconds)
- `timestampUtc` (ISO 8601 UTC string)

Raw provider fields are preserved.

## User timezone for prompts and HTTP gateway turns

Set `agents.defaults.userTimezone` to tell the model the user's local time zone. If it is
unset or invalid, PlatformClaw builds use the configured default timezone
(`Asia/Seoul`).

```json5
{
  agents: { defaults: { userTimezone: "America/Chicago" } },
}
```

The system prompt includes:

- `Current Date & Time` section with the timezone only

The dynamic current clock value is not placed in the system prompt, so prompt
caches stay stable across turns. Gateway-originated agent turns use a compact
message prefix instead, such as:

```
[Fri 2026-06-26 02:15 GMT+9] message text
```

The same timestamp prefix path is used for websocket `chat.send`, `/v1/responses`,
and `/v1/chat/completions`. `USER.md` is not parsed for timezone configuration.

See [Date & Time](/date-time) for the full behavior and examples.

## Related

- [Heartbeat](/gateway/heartbeat) — active hours use timezone for scheduling
- [Cron Jobs](/automation/cron-jobs) — cron expressions use timezone for scheduling
- [Date & Time](/date-time) — full date/time behavior and examples
