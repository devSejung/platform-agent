import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "../agents/agent-scope.js";
import {
  deleteSkillFromWorkspace,
  type SkillHubCategoryFilter,
  formatSkillHubDeleteMessage,
  formatSkillHubError,
  listSkillHubEntries,
  formatSkillHubInstallMessage,
  formatSkillHubUpdateMessage,
  installSkillFromHub,
  resolveSkillHubActor,
  updateSkillFromHub,
} from "../agents/skill-hub.js";
import type { OpenClawConfig } from "../config/config.js";
import type { DispatchFromConfigResult } from "./reply/dispatch-from-config.js";
import { dispatchReplyFromConfig } from "./reply/dispatch-from-config.js";
import { finalizeInboundContext } from "./reply/inbound-context.js";
import {
  createReplyDispatcher,
  createReplyDispatcherWithTyping,
  type ReplyDispatcher,
  type ReplyDispatcherOptions,
  type ReplyDispatcherWithTypingOptions,
} from "./reply/reply-dispatcher.js";
import type { FinalizedMsgContext, MsgContext } from "./templating.js";
import type { GetReplyOptions } from "./types.js";

export type DispatchInboundResult = DispatchFromConfigResult;

type ParsedSkillHubCommand =
  | { action: "help"; locale: "en" | "ko" }
  | { action: "list"; category: SkillHubCategoryFilter }
  | { action: "installed" }
  | { action: "install" | "update" | "delete"; slug: string };

const SKILL_HUB_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,80}$/;
const SKILL_HUB_CATEGORY_SET = new Set<SkillHubCategoryFilter>([
  "all",
  "knowledge",
  "automation",
  "utility",
  "other",
]);

function parseSkillHubCommand(commandText: string): ParsedSkillHubCommand | null {
  const trimmed = commandText.trim();
  if (!trimmed.startsWith("/skillhub")) {
    return null;
  }
  const parts = trimmed.split(/\s+/);
  if (parts[0]?.toLowerCase() !== "/skillhub") {
    return null;
  }
  const action = parts[1]?.toLowerCase();
  if (!action) {
    return null;
  }
  if (action === "help" && (parts.length === 2 || parts.length === 3)) {
    const locale = parts[2]?.toLowerCase();
    if (!locale) {
      return { action: "help", locale: "en" };
    }
    if (locale === "ko" || locale === "en") {
      return { action: "help", locale };
    }
    return null;
  }
  if (action === "list" && (parts.length === 2 || parts.length === 3)) {
    const category = (parts[2]?.toLowerCase() ?? "all") as SkillHubCategoryFilter;
    return SKILL_HUB_CATEGORY_SET.has(category) ? { action: "list", category } : null;
  }
  if (action === "installed" && parts.length === 2) {
    return { action: "installed" };
  }
  if (
    (action === "install" || action === "update" || action === "delete") &&
    parts.length === 3 &&
    SKILL_HUB_SLUG_RE.test(parts[2] ?? "")
  ) {
    return { action, slug: parts[2]!.toLowerCase() };
  }
  return null;
}

function formatSkillHubCommandHelp(locale: "en" | "ko"): string {
  if (locale === "ko") {
    return [
      "# Skill Hub 명령어",
      "",
      "| 명령어 | 설명 |",
      "| --- | --- |",
      "| `/skillhub help` | 기본 도움말을 영어로 보여줍니다. |",
      "| `/skillhub help ko` | 도움말을 한국어로 보여줍니다. |",
      "| `/skillhub list` | 공유 스킬을 카테고리별로 보여줍니다. |",
      "| `/skillhub list <category>` | 특정 카테고리 스킬만 보여줍니다. |",
      "| `/skillhub installed` | 현재 workspace에 설치된 Skill Hub 스킬을 보여줍니다. |",
      "| `/skillhub install <slug>` | 현재 workspace에 스킬을 설치합니다. |",
      "| `/skillhub update <slug>` | 현재 workspace의 설치 스킬을 업데이트합니다. |",
      "| `/skillhub delete <slug>` | 현재 workspace에서 Skill Hub 스킬을 제거합니다. |",
      "",
      "## Categories",
      "",
      "- `knowledge`",
      "- `automation`",
      "- `utility`",
      "- `other`",
      "",
      "## 예시",
      "",
      "- `/skillhub help ko`",
      "- `/skillhub list`",
      "- `/skillhub list knowledge`",
      "- `/skillhub installed`",
      "- `/skillhub install jedec-lpddr-dram-reference`",
    ].join("\n");
  }
  return [
    "# Skill Hub Commands",
    "",
    "| Command | Description |",
    "| --- | --- |",
    "| `/skillhub help` | Show available Skill Hub commands. |",
    "| `/skillhub help ko` | Show this help in Korean. |",
    "| `/skillhub list` | Show shared skills grouped by category. |",
    "| `/skillhub list <category>` | Show shared skills in one category only. |",
    "| `/skillhub installed` | Show Skill Hub skills installed in the current workspace. |",
    "| `/skillhub install <slug>` | Install a shared skill into the current workspace. |",
    "| `/skillhub update <slug>` | Update an installed shared skill in the current workspace. |",
    "| `/skillhub delete <slug>` | Remove a Skill Hub-installed skill from the current workspace. |",
    "",
    "## Categories",
    "",
    "- `knowledge`",
    "- `automation`",
    "- `utility`",
    "- `other`",
    "",
    "## Examples",
    "",
    "- `/skillhub help ko`",
    "- `/skillhub list`",
    "- `/skillhub list knowledge`",
    "- `/skillhub installed`",
    "- `/skillhub install jedec-lpddr-dram-reference`",
  ].join("\n");
}

function formatSkillHubCategoryLabel(category: Exclude<SkillHubCategoryFilter, "all">): string {
  switch (category) {
    case "knowledge":
      return "Knowledge";
    case "automation":
      return "Automation";
    case "utility":
      return "Utility";
    case "other":
    default:
      return "Other";
  }
}

function truncateForTable(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function formatSkillHubListSection(params: {
  title: string;
  entries: Array<{
    presentation: { displayName: string; displayDescription: string };
    slug: string;
  }>;
}): string {
  if (params.entries.length === 0) {
    return [`## ${params.title}`, "", "_No skills found._"].join("\n");
  }
  const visibleEntries = params.entries.slice(0, 20);
  const lines = [
    `## ${params.title}`,
    "",
    "| Name | Slug | Description |",
    "| --- | --- | --- |",
    ...visibleEntries.map((entry) => {
      const name = escapeMarkdownTableCell(truncateForTable(entry.presentation.displayName, 36));
      const slug = `\`${entry.slug}\``;
      const description = escapeMarkdownTableCell(
        truncateForTable(entry.presentation.displayDescription, 88),
      );
      return `| ${name} | ${slug} | ${description || "-"} |`;
    }),
  ];
  if (params.entries.length > visibleEntries.length) {
    lines.push(
      "",
      `_Showing ${visibleEntries.length} of ${params.entries.length} skills in ${params.title}. Use the web Skill Hub UI for the full list._`,
    );
  }
  return lines.join("\n");
}

function formatSkillHubListMarkdown(params: {
  title?: string;
  category: SkillHubCategoryFilter;
  entries: Array<{
    presentation: {
      category: Exclude<SkillHubCategoryFilter, "all">;
      displayName: string;
      displayDescription: string;
    };
    slug: string;
  }>;
}): string {
  if (params.category !== "all") {
    return [
      `# ${params.title ?? `Skill Hub List: ${formatSkillHubCategoryLabel(params.category)}`}`,
      "",
      formatSkillHubListSection({
        title: formatSkillHubCategoryLabel(params.category),
        entries: params.entries,
      }),
    ].join("\n");
  }
  const sections = (["knowledge", "automation", "utility", "other"] as const).map((category) =>
    formatSkillHubListSection({
      title: formatSkillHubCategoryLabel(category),
      entries: params.entries.filter((entry) => entry.presentation.category === category),
    }),
  );
  return [
    `# ${params.title ?? "Skill Hub List"}`,
    "",
    "_Each category shows up to 20 skills. Use `/skillhub list <category>` for a focused view._",
    "",
    ...sections,
  ].join("\n");
}

function parseFirstSkillHubCommand(
  values: Array<string | null | undefined>,
): ParsedSkillHubCommand | null {
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    const parsed = parseSkillHubCommand(value);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

async function tryHandleSkillHubCommand(params: {
  ctx: FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: ReplyDispatcher;
}): Promise<DispatchInboundResult | null> {
  const command = parseFirstSkillHubCommand([params.ctx.BodyForCommands, params.ctx.CommandBody]);
  if (!command) {
    return null;
  }
  const sessionKey = typeof params.ctx.SessionKey === "string" ? params.ctx.SessionKey.trim() : "";
  if (!sessionKey) {
    params.dispatcher.sendFinalReply({
      text: "skillhub command requires a session context",
    });
    return {
      queuedFinal: true,
      counts: params.dispatcher.getQueuedCounts(),
    };
  }
  const agentId = resolveSessionAgentId({ sessionKey, config: params.cfg });
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
  const actor = resolveSkillHubActor({
    employee: {
      employeeId: params.ctx.SenderId ?? agentId,
      name: params.ctx.SenderName ?? undefined,
    },
    fallbackAgentId: agentId,
  });
  try {
    let text = "";
    if (command.action === "help") {
      text = formatSkillHubCommandHelp(command.locale);
    } else if (command.action === "list") {
      const entries = await listSkillHubEntries({
        workspaceDir,
        actor,
        scope: "discover",
        sort: "az",
        category: command.category,
      });
      text = formatSkillHubListMarkdown({
        category: command.category,
        entries,
      });
    } else if (command.action === "installed") {
      const entries = await listSkillHubEntries({
        workspaceDir,
        actor,
        scope: "installed",
        sort: "az",
        category: "all",
      });
      text = formatSkillHubListMarkdown({
        title: "Installed Skill Hub Skills",
        category: "all",
        entries,
      });
    } else if (command.action === "install") {
      await installSkillFromHub({
        workspaceDir,
        actor,
        slug: command.slug,
      });
      text = formatSkillHubInstallMessage(command.slug);
    } else if (command.action === "update") {
      const result = await updateSkillFromHub({
        workspaceDir,
        actor,
        slug: command.slug,
      });
      text = formatSkillHubUpdateMessage(command.slug, result.version);
    } else {
      await deleteSkillFromWorkspace({
        workspaceDir,
        skillKey: command.slug,
        slug: command.slug,
        config: params.cfg,
      });
      text = formatSkillHubDeleteMessage(command.slug);
    }
    params.dispatcher.sendFinalReply({ text });
  } catch (err) {
    params.dispatcher.sendFinalReply({ text: formatSkillHubError(err) });
  }
  return {
    queuedFinal: true,
    counts: params.dispatcher.getQueuedCounts(),
  };
}

export async function withReplyDispatcher<T>(params: {
  dispatcher: ReplyDispatcher;
  run: () => Promise<T>;
  onSettled?: () => void | Promise<void>;
}): Promise<T> {
  try {
    return await params.run();
  } finally {
    // Ensure dispatcher reservations are always released on every exit path.
    params.dispatcher.markComplete();
    try {
      await params.dispatcher.waitForIdle();
    } finally {
      await params.onSettled?.();
    }
  }
}

export async function dispatchInboundMessage(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
  configOverride?: OpenClawConfig;
}): Promise<DispatchInboundResult> {
  const finalized = finalizeInboundContext(params.ctx);
  const skillHubHandled = await tryHandleSkillHubCommand({
    ctx: finalized,
    cfg: params.cfg,
    dispatcher: params.dispatcher,
  });
  if (skillHubHandled) {
    return await withReplyDispatcher({
      dispatcher: params.dispatcher,
      run: async () => skillHubHandled,
    });
  }
  return await withReplyDispatcher({
    dispatcher: params.dispatcher,
    run: () =>
      dispatchReplyFromConfig({
        ctx: finalized,
        cfg: params.cfg,
        dispatcher: params.dispatcher,
        replyOptions: params.replyOptions,
        replyResolver: params.replyResolver,
        configOverride: params.configOverride,
      }),
  });
}

export async function dispatchInboundMessageWithBufferedDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
  configOverride?: OpenClawConfig;
}): Promise<DispatchInboundResult> {
  const { dispatcher, replyOptions, markDispatchIdle, markRunComplete } =
    createReplyDispatcherWithTyping(params.dispatcherOptions);
  try {
    return await dispatchInboundMessage({
      ctx: params.ctx,
      cfg: params.cfg,
      dispatcher,
      replyResolver: params.replyResolver,
      configOverride: params.configOverride,
      replyOptions: {
        ...params.replyOptions,
        ...replyOptions,
      },
    });
  } finally {
    markRunComplete();
    markDispatchIdle();
  }
}

export async function dispatchInboundMessageWithDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
  configOverride?: OpenClawConfig;
}): Promise<DispatchInboundResult> {
  const dispatcher = createReplyDispatcher(params.dispatcherOptions);
  return await dispatchInboundMessage({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcher,
    replyResolver: params.replyResolver,
    configOverride: params.configOverride,
    replyOptions: params.replyOptions,
  });
}
