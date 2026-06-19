import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { resolvePreferredOpenClawTmpDir } from "../../infra/tmp-openclaw-dir.js";
import { detectMime } from "../../media/mime.js";
import { resolveConfigDir } from "../../utils.js";
import { readStringParam, ToolInputError, type AnyAgentTool } from "./common.js";

const GLOBAL_DOCS_DIRNAME = "global_docs";

const AttachArtifactToolSchema = Type.Object({
  path: Type.String({
    description:
      "Local or workspace file path to attach/deliver to the user. The file is copied into the workspace artifact store before display.",
  }),
  caption: Type.Optional(
    Type.String({
      description: "Optional assistant-facing caption shown with the delivered artifact.",
    }),
  ),
  kind: Type.Optional(
    Type.String({
      description: 'Optional hint: "image" or "file". MIME detection remains authoritative.',
    }),
  ),
});

function resolveArtifactSourcePath(rawPath: string, workspaceDir: string): string {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    throw new ToolInputError("path required");
  }
  if (/^https?:\/\//i.test(trimmed) || /^data:/i.test(trimmed)) {
    throw new ToolInputError("path must be a local or workspace file path");
  }
  return path.isAbsolute(trimmed) ? path.resolve(trimmed) : path.resolve(workspaceDir, trimmed);
}

function isPathInside(rootDir: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isManagedGlobalMediaPath(candidate: string): boolean {
  const globalMediaRoot = path.join(resolveConfigDir(), "media");
  const relative = path.relative(path.resolve(globalMediaRoot), path.resolve(candidate));
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  const firstSegment = relative.split(path.sep)[0] ?? "";
  return firstSegment === "outbound" || firstSegment.startsWith("tool-");
}

function isGlobalDocsPath(candidate: string): boolean {
  return isPathInside(path.join(resolveConfigDir(), GLOBAL_DOCS_DIRNAME), candidate);
}

function assertAllowedArtifactSource(params: { workspaceDir: string; sourcePath: string }) {
  if (
    isPathInside(params.workspaceDir, params.sourcePath) ||
    isManagedGlobalMediaPath(params.sourcePath) ||
    isGlobalDocsPath(params.sourcePath) ||
    isPathInside(resolvePreferredOpenClawTmpDir(), params.sourcePath)
  ) {
    return;
  }
  throw new ToolInputError("artifact path must be inside the workspace or managed media roots");
}

export function createAssistantArtifactTool(options: { workspaceDir: string }): AnyAgentTool {
  return {
    label: "Attach artifact",
    name: "attach_artifact",
    displaySummary: "Attach a generated file to the assistant response.",
    description:
      "Deliver a generated local/workspace file to the user as an assistant artifact. Use this after creating an image, HTML page, report, CSV, log, archive, or other file that should be visible in the assistant message, not hidden inside tool output. PlatformClaw Web UI previews image artifacts inline and renders HTML artifacts in an inline sandboxed preview with a download link; other files appear as downloadable cards.",
    parameters: AttachArtifactToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const sourcePath = resolveArtifactSourcePath(
        readStringParam(params, "path", { required: true }),
        options.workspaceDir,
      );
      assertAllowedArtifactSource({ workspaceDir: options.workspaceDir, sourcePath });
      const caption = readStringParam(params, "caption");
      const kind = readStringParam(params, "kind");
      if (kind && kind !== "image" && kind !== "file") {
        throw new ToolInputError('kind must be "image" or "file"');
      }

      const stat = await fs.stat(sourcePath).catch(() => null);
      if (!stat?.isFile()) {
        throw new ToolInputError(`artifact file not found: ${sourcePath}`);
      }
      const mimeType = (await detectMime({ filePath: sourcePath }).catch(() => undefined)) ?? "";
      return {
        content: [
          {
            type: "text",
            text: caption
              ? `Attached artifact: ${path.basename(sourcePath)}\n${caption}`
              : `Attached artifact: ${path.basename(sourcePath)}`,
          },
        ],
        details: {
          status: "ok",
          artifactDelivery: true,
          path: sourcePath,
          fileName: path.basename(sourcePath),
          mimeType,
          sizeBytes: stat.size,
          ...(caption ? { caption } : {}),
          ...(kind ? { kind } : {}),
          media: {
            mediaUrl: sourcePath,
          },
        },
      };
    },
  };
}
