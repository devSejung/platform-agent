import type { Command } from "commander";
import type { CronJob } from "../../cron/types.js";
import { resolveAgentIdFromSessionKey, sanitizeAgentId } from "../../routing/session-key.js";
import { defaultRuntime } from "../../runtime.js";
import {
  normalizeLowercaseStringOrEmpty,
  normalizeOptionalString,
} from "../../shared/string-coerce.js";
import { INTERNAL_MESSAGE_CHANNEL, normalizeMessageChannel } from "../../utils/message-channel.js";
import type { GatewayRpcOpts } from "../gateway-rpc.js";
import { addGatewayClientOptions } from "../gateway-rpc.js";
import { parsePositiveIntOrUndefined } from "../program/helpers.js";
import { resolveCronCreateSchedule } from "./schedule-options.js";
import {
  getCronChannelOptions,
  callCronGatewayFromCli,
  handleCronCliError,
  printCronJson,
  printCronList,
  warnIfCronSchedulerDisabled,
} from "./shared.js";

function readEnvOptionalString(...keys: string[]) {
  for (const key of keys) {
    const value = normalizeOptionalString(process.env[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function resolveEnvDeliverySnapshot() {
  const channel = normalizeMessageChannel(
    readEnvOptionalString("OPENCLAW_AGENT_CHANNEL", "OPENCLAW_CHANNEL"),
  );
  const to = readEnvOptionalString("OPENCLAW_AGENT_TO", "OPENCLAW_CURRENT_CHANNEL_ID");
  if (!channel || !to || channel === INTERNAL_MESSAGE_CHANNEL || channel === "last") {
    return null;
  }
  return {
    mode: "announce" as const,
    channel,
    to,
    threadId: readEnvOptionalString("OPENCLAW_AGENT_THREAD_ID", "OPENCLAW_CURRENT_THREAD_TS"),
    accountId: readEnvOptionalString("OPENCLAW_AGENT_ACCOUNT_ID"),
  };
}

export function registerCronStatusCommand(cron: Command) {
  addGatewayClientOptions(
    cron
      .command("status")
      .description("Show cron scheduler status")
      .option("--json", "Output JSON", false)
      .action(async (opts) => {
        try {
          const res = await callCronGatewayFromCli("cron.status", opts, {});
          printCronJson(res);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );
}

export function registerCronListCommand(cron: Command) {
  addGatewayClientOptions(
    cron
      .command("list")
      .description("List cron jobs")
      .option("--all", "Include disabled jobs", false)
      .option("--json", "Output JSON", false)
      .action(async (opts) => {
        try {
          const res = await callCronGatewayFromCli("cron.list", opts, {
            includeDisabled: Boolean(opts.all),
          });
          if (opts.json) {
            printCronJson(res);
            return;
          }
          const jobs = (res as { jobs?: CronJob[] } | null)?.jobs ?? [];
          printCronList(jobs, defaultRuntime);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );
}

export function registerCronAddCommand(cron: Command) {
  addGatewayClientOptions(
    cron
      .command("add")
      .alias("create")
      .description("Add a cron job")
      .requiredOption("--name <name>", "Job name")
      .option("--description <text>", "Optional description")
      .option("--disabled", "Create job disabled", false)
      .option("--delete-after-run", "Delete one-shot job after it succeeds", false)
      .option("--keep-after-run", "Keep one-shot job after it succeeds", false)
      .option(
        "--global",
        "Create an ownerless global cron job. Agent sessions should not use this.",
        false,
      )
      .option("--agent <id>", "Agent id for this job")
      .option("--session <target>", "Session target (main|isolated|current|session:<id>)")
      .option(
        "--session-key <key>",
        "Origin session key for job ownership/routing. Agent exec sessions usually set this automatically.",
      )
      .option("--wake <mode>", "Wake mode (now|next-heartbeat)", "now")
      .option(
        "--at <when>",
        "Run once at time (ISO with offset, or +duration). Use --tz for offset-less datetimes",
      )
      .option("--every <duration>", "Run every duration (e.g. 10m, 1h)")
      .option("--cron <expr>", "Cron expression (5-field or 6-field with seconds)")
      .option("--tz <iana>", "Timezone for cron expressions (IANA)", "")
      .option("--stagger <duration>", "Cron stagger window (e.g. 30s, 5m)")
      .option("--exact", "Disable cron staggering (set stagger to 0)", false)
      .option("--system-event <text>", "System event payload (main session)")
      .option("--message <text>", "Agent message payload")
      .option(
        "--thinking <level>",
        "Thinking level for agent jobs (off|minimal|low|medium|high|xhigh)",
      )
      .option("--model <model>", "Model override for agent jobs (provider/model or alias)")
      .option("--timeout-seconds <n>", "Timeout seconds for agent jobs")
      .option("--light-context", "Use lightweight bootstrap context for agent jobs", false)
      .option("--tools <csv>", "Comma-separated tool allow-list (e.g. exec,read,write)")
      .option(
        "--announce",
        "Send final result to an external configured chat channel. Not needed for web/session-owned jobs.",
        false,
      )
      .option("--deliver", "Deprecated alias for --announce.")
      .option(
        "--no-deliver",
        "Do not send to an external channel. Session-owned jobs remain attached to their origin session.",
      )
      .option("--channel <channel>", `Delivery channel (${getCronChannelOptions()})`, "last")
      .option(
        "--to <dest>",
        "Delivery destination (E.164, Telegram chatId, or Discord channel/user)",
      )
      .option("--account <id>", "Channel account id for delivery (multi-account setups)")
      .option("--best-effort-deliver", "Do not fail the job if delivery fails", false)
      .option("--json", "Output JSON", false)
      .addHelpText(
        "after",
        `
Ownership:
  Normal cron jobs must be owned by an agent/session. When run from an agent tool
  session, OPENCLAW_AGENT_SESSION_KEY / OPENCLAW_SESSION_KEY is used automatically.
  Use --agent or --session-key for manual CLI creation. Use --global only for an
  intentional ownerless admin job.

Delivery:
  Session-owned isolated agent jobs default to --no-deliver behavior, so results
  stay attached to the origin session. Use --announce with --channel/--to only
  when you explicitly want external channel delivery.
`,
      )
      .action(async (opts: GatewayRpcOpts & Record<string, unknown>, cmd?: Command) => {
        try {
          const schedule = resolveCronCreateSchedule({
            at: opts.at,
            cron: opts.cron,
            every: opts.every,
            exact: opts.exact,
            stagger: opts.stagger,
            tz: opts.tz,
          });

          const wakeMode = normalizeOptionalString(opts.wake) ?? "now";
          if (wakeMode !== "now" && wakeMode !== "next-heartbeat") {
            throw new Error("--wake must be now or next-heartbeat");
          }

          const envSessionKey =
            normalizeOptionalString(process.env.OPENCLAW_AGENT_SESSION_KEY) ??
            normalizeOptionalString(process.env.OPENCLAW_SESSION_KEY);
          const cliAgentId =
            typeof opts.agent === "string" && opts.agent.trim()
              ? sanitizeAgentId(opts.agent.trim())
              : undefined;
          const agentId =
            cliAgentId ??
            (envSessionKey
              ? sanitizeAgentId(resolveAgentIdFromSessionKey(envSessionKey))
              : normalizeOptionalString(process.env.OPENCLAW_AGENT_ID)
                ? sanitizeAgentId(String(process.env.OPENCLAW_AGENT_ID))
                : undefined);

          const hasAnnounce = Boolean(opts.announce) || opts.deliver === true;
          const hasNoDeliver = opts.deliver === false;
          const deliveryFlagCount = [hasAnnounce, hasNoDeliver].filter(Boolean).length;
          if (deliveryFlagCount > 1) {
            throw new Error("Choose at most one of --announce or --no-deliver");
          }

          const payload = (() => {
            const systemEvent = normalizeOptionalString(opts.systemEvent) ?? "";
            const message = normalizeOptionalString(opts.message) ?? "";
            const chosen = [Boolean(systemEvent), Boolean(message)].filter(Boolean).length;
            if (chosen !== 1) {
              throw new Error("Choose exactly one payload: --system-event or --message");
            }
            if (systemEvent) {
              return { kind: "systemEvent" as const, text: systemEvent };
            }
            const timeoutSeconds = parsePositiveIntOrUndefined(opts.timeoutSeconds);
            return {
              kind: "agentTurn" as const,
              message,
              model: normalizeOptionalString(opts.model),
              thinking: normalizeOptionalString(opts.thinking),
              timeoutSeconds:
                timeoutSeconds && Number.isFinite(timeoutSeconds) ? timeoutSeconds : undefined,
              lightContext: opts.lightContext === true ? true : undefined,
              toolsAllow:
                typeof opts.tools === "string" && opts.tools.trim()
                  ? opts.tools
                      .split(",")
                      .map((t: string) => normalizeOptionalString(t))
                      .filter((t): t is string => Boolean(t))
                  : undefined,
            };
          })();

          const optionSource =
            typeof cmd?.getOptionValueSource === "function"
              ? (name: string) => cmd.getOptionValueSource(name)
              : () => undefined;
          const sessionSource = optionSource("session");
          const sessionTargetRaw = normalizeOptionalString(opts.session) ?? "";
          const inferredSessionTarget = payload.kind === "agentTurn" ? "isolated" : "main";
          const sessionTarget =
            sessionSource === "cli" ? sessionTargetRaw || "" : inferredSessionTarget;
          const isCustomSessionTarget =
            normalizeLowercaseStringOrEmpty(sessionTarget).startsWith("session:") &&
            Boolean(normalizeOptionalString(sessionTarget.slice(8)));
          const isIsolatedLikeSessionTarget =
            sessionTarget === "isolated" || sessionTarget === "current" || isCustomSessionTarget;
          if (sessionTarget !== "main" && !isIsolatedLikeSessionTarget) {
            throw new Error("--session must be main, isolated, current, or session:<id>");
          }

          if (opts.deleteAfterRun && opts.keepAfterRun) {
            throw new Error("Choose --delete-after-run or --keep-after-run, not both");
          }

          if (sessionTarget === "main" && payload.kind !== "systemEvent") {
            throw new Error("Main jobs require --system-event (systemEvent).");
          }
          if (isIsolatedLikeSessionTarget && payload.kind !== "agentTurn") {
            throw new Error("Isolated/current/custom-session jobs require --message (agentTurn).");
          }
          if (
            (opts.announce || typeof opts.deliver === "boolean") &&
            (!isIsolatedLikeSessionTarget || payload.kind !== "agentTurn")
          ) {
            throw new Error("--announce/--no-deliver require a non-main agentTurn session target.");
          }

          const accountId = normalizeOptionalString(opts.account);

          if (accountId && (!isIsolatedLikeSessionTarget || payload.kind !== "agentTurn")) {
            throw new Error("--account requires a non-main agentTurn job with delivery.");
          }

          const sessionKey =
            typeof opts.sessionKey === "string" && opts.sessionKey.trim()
              ? opts.sessionKey.trim()
              : envSessionKey;

          const deliveryMode =
            isIsolatedLikeSessionTarget && payload.kind === "agentTurn"
              ? hasAnnounce
                ? "announce"
                : hasNoDeliver
                  ? "none"
                  : sessionKey
                    ? "origin"
                    : "announce"
              : undefined;
          const envDeliverySnapshot =
            !hasAnnounce &&
            !hasNoDeliver &&
            isIsolatedLikeSessionTarget &&
            payload.kind === "agentTurn"
              ? resolveEnvDeliverySnapshot()
              : null;

          const name = normalizeOptionalString(opts.name) ?? "";
          if (!name) {
            throw new Error("--name is required");
          }

          const description = normalizeOptionalString(opts.description);

          if (!agentId && !sessionKey && opts.global !== true) {
            throw new Error(
              "cron add requires an owner. Pass --agent/--session-key, run from an agent session, or use --global for an explicit ownerless job.",
            );
          }

          const params = {
            name,
            description,
            enabled: !opts.disabled,
            deleteAfterRun: opts.deleteAfterRun ? true : opts.keepAfterRun ? false : undefined,
            agentId,
            sessionKey,
            global: opts.global === true ? true : undefined,
            schedule,
            sessionTarget,
            wakeMode,
            payload,
            delivery: envDeliverySnapshot
              ? envDeliverySnapshot
              : deliveryMode
                ? deliveryMode === "none"
                  ? { mode: deliveryMode }
                  : deliveryMode === "origin"
                    ? { mode: deliveryMode }
                    : {
                        mode: deliveryMode,
                        channel:
                          typeof opts.channel === "string" && opts.channel.trim()
                            ? opts.channel.trim()
                            : undefined,
                        to: normalizeOptionalString(opts.to),
                        accountId,
                        bestEffort: opts.bestEffortDeliver ? true : undefined,
                      }
                : undefined,
          };

          const res = await callCronGatewayFromCli("cron.add", opts, params);
          printCronJson(res);
          await warnIfCronSchedulerDisabled(opts);
        } catch (err) {
          handleCronCliError(err);
        }
      }),
  );
}
