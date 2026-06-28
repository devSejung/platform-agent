import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { createReplyMediaPathNormalizer } from "../../auto-reply/reply/reply-media-paths.runtime.js";
import type { ReplyPayload } from "../../auto-reply/types.js";
import type { OpenClawConfig } from "../../config/config.js";
import { isAudioFileName } from "../../media/mime.js";
import { resolveSendableOutboundReplyParts } from "../../plugin-sdk/reply-payload.js";

type WebchatReplyPayload = ReplyPayload & {
  sensitiveMedia?: boolean;
  trustedLocalMedia?: boolean;
};

function isDataUrlMedia(mediaUrl: string): boolean {
  return mediaUrl.trim().toLowerCase().startsWith("data:");
}

function shouldPreserveDisplayMediaUrl(mediaUrl: string): boolean {
  return isDataUrlMedia(mediaUrl) || isAudioFileName(mediaUrl);
}

export async function normalizeWebchatReplyMediaPathsForDisplay(params: {
  cfg: OpenClawConfig;
  sessionKey: string;
  agentId: string;
  workspaceDir?: string;
  payloads: ReplyPayload[];
}): Promise<ReplyPayload[]> {
  if (params.payloads.length === 0) {
    return params.payloads;
  }
  const workspaceDir = params.workspaceDir ?? resolveAgentWorkspaceDir(params.cfg, params.agentId);
  if (!workspaceDir) {
    return params.payloads;
  }
  const normalizeMediaPaths = createReplyMediaPathNormalizer({
    cfg: params.cfg,
    sessionKey: params.sessionKey,
    workspaceDir,
  });
  const normalized: ReplyPayload[] = [];
  for (const payload of params.payloads as WebchatReplyPayload[]) {
    if (payload.sensitiveMedia === true) {
      normalized.push(payload);
      continue;
    }
    const mediaUrls = resolveSendableOutboundReplyParts(payload).mediaUrls;
    if (!mediaUrls.some(shouldPreserveDisplayMediaUrl)) {
      normalized.push(await normalizeMediaPaths(payload));
      continue;
    }
    if (!mediaUrls.some((mediaUrl) => !shouldPreserveDisplayMediaUrl(mediaUrl))) {
      normalized.push(payload);
      continue;
    }
    const mergedMediaUrls: string[] = [];
    for (const mediaUrl of mediaUrls) {
      if (shouldPreserveDisplayMediaUrl(mediaUrl)) {
        mergedMediaUrls.push(mediaUrl);
        continue;
      }
      const normalizedPayload = await normalizeMediaPaths({
        ...payload,
        mediaUrl,
        mediaUrls: [mediaUrl],
      });
      const normalizedMediaUrls = resolveSendableOutboundReplyParts(normalizedPayload).mediaUrls;
      mergedMediaUrls.push(...normalizedMediaUrls);
    }
    normalized.push({
      ...payload,
      mediaUrl: mergedMediaUrls[0],
      mediaUrls: mergedMediaUrls.length > 0 ? mergedMediaUrls : undefined,
    });
  }
  return normalized;
}
