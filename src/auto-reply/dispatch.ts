import { resolveAgentWorkspaceDir, resolveSessionAgentId } from "../agents/agent-scope.js";
import {
  deleteSkillFromWorkspace,
  formatSkillHubDeleteMessage,
  formatSkillHubError,
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

const SKILL_HUB_COMMAND_RE = /^\s*\/skillhub\s+(install|update|delete)\s+([a-z0-9][a-z0-9-]{1,80})\s*$/i;

function firstNonEmptyText(values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return "";
}

async function tryHandleSkillHubCommand(params: {
  ctx: FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: ReplyDispatcher;
}): Promise<DispatchInboundResult | null> {
  const commandText = firstNonEmptyText([
    params.ctx.BodyForCommands,
    params.ctx.CommandBody,
    params.ctx.RawBody,
    params.ctx.Body,
  ]);
  const match = commandText.match(SKILL_HUB_COMMAND_RE);
  if (!match) {
    return null;
  }
  const action = match[1]!.toLowerCase();
  const slug = match[2]!.toLowerCase();
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
    if (action === "install") {
      await installSkillFromHub({
        workspaceDir,
        actor,
        slug,
      });
      text = formatSkillHubInstallMessage(slug);
    } else if (action === "update") {
      const result = await updateSkillFromHub({
        workspaceDir,
        actor,
        slug,
      });
      text = formatSkillHubUpdateMessage(slug, result.version);
    } else {
      await deleteSkillFromWorkspace({
        workspaceDir,
        skillKey: slug,
        slug,
        config: params.cfg,
      });
      text = formatSkillHubDeleteMessage(slug);
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
      }),
  });
}

export async function dispatchInboundMessageWithBufferedDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const { dispatcher, replyOptions, markDispatchIdle, markRunComplete } =
    createReplyDispatcherWithTyping(params.dispatcherOptions);
  try {
    return await dispatchInboundMessage({
      ctx: params.ctx,
      cfg: params.cfg,
      dispatcher,
      replyResolver: params.replyResolver,
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
}): Promise<DispatchInboundResult> {
  const dispatcher = createReplyDispatcher(params.dispatcherOptions);
  return await dispatchInboundMessage({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcher,
    replyResolver: params.replyResolver,
    replyOptions: params.replyOptions,
  });
}
