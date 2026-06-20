import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { canExecRequestNode } from "../../agents/exec-defaults.js";
import {
  auditSkillHubIconAssets,
  garbageCollectSkillHubIconAssets,
} from "../../agents/skill-hub-icon-maintenance.js";
import {
  listReferencedSkillHubIconAssetIds,
  deleteSkillFromHub,
  deleteSkillFromWorkspace,
  formatHubPublishMessage,
  formatSkillHubDeleteMessage,
  formatSkillHubError,
  formatSkillHubInstallMessage,
  formatSkillHubUpdateMessage,
  getSkillHubDetail,
  getSkillHubOverview,
  installSkillFromHub,
  listSkillHubEntries,
  listWorkspacePublishEntries,
  publishWorkspaceSkillToHub,
  resolveSkillHubActor,
  toggleSkillHubLike,
  transferSkillHubOwnership,
  updateSkillFromHub,
  updateSkillHubExamplePrompts,
  updateSkillHubMetadata,
  updateSkillHubPresentation,
  uploadSkillPackageToHub,
} from "../../agents/skill-hub.js";
import {
  installSkillFromClawHub,
  searchSkillsFromClawHub,
  updateSkillsFromClawHub,
} from "../../agents/skills-clawhub.js";
import { installSkill } from "../../agents/skills-install.js";
import { buildWorkspaceSkillStatus } from "../../agents/skills-status.js";
import { loadWorkspaceSkillEntries, type SkillEntry } from "../../agents/skills.js";
import { listAgentWorkspaceDirs } from "../../agents/workspace-dirs.js";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig, writeConfigFile } from "../../config/config.js";
import { fetchClawHubSkillDetail } from "../../infra/clawhub.js";
import { formatErrorMessage } from "../../infra/errors.js";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { normalizeSecretInput } from "../../utils/normalize-secret-input.js";
import { enforceEmployeeAgent, getEmployeeAgentId } from "../employee-access.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateSkillsBinsParams,
  validateSkillsDetailParams,
  validateSkillHubDeleteParams,
  validateSkillHubDetailParams,
  validateSkillHubExamplePromptsUpdateParams,
  validateSkillHubHideParams,
  validateSkillHubIconAuditParams,
  validateSkillHubIconGcParams,
  validateSkillHubInstallParams,
  validateSkillHubLikeParams,
  validateSkillHubListParams,
  validateSkillHubMetadataUpdateParams,
  validateSkillHubPresentationUpdateParams,
  validateSkillHubPublishParams,
  validateSkillHubTransferOwnershipParams,
  validateSkillHubUploadParams,
  validateSkillHubWorkspacePublishListParams,
  validateSkillsDeleteParams,
  validateSkillsInstallParams,
  validateSkillsSearchParams,
  validateSkillsStatusParams,
  validateSkillsUpdateParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, GatewayClient } from "./types.js";

function resolveSkillsWorkspace(params: {
  cfg: OpenClawConfig;
  client?: GatewayClient | null;
  agentIdRaw?: string;
}) {
  const employeeAgentId = getEmployeeAgentId(params.client);
  const agentId = employeeAgentId
    ? employeeAgentId
    : params.agentIdRaw?.trim()
      ? normalizeAgentId(params.agentIdRaw)
      : resolveDefaultAgentId(params.cfg);
  return {
    agentId,
    workspaceDir: resolveAgentWorkspaceDir(params.cfg, agentId),
    actor: resolveSkillHubActor({
      employee: params.client?.internal?.employee,
      fallbackAgentId: agentId,
    }),
  };
}

function collectSkillBins(entries: SkillEntry[]): string[] {
  const bins = new Set<string>();
  for (const entry of entries) {
    const required = entry.metadata?.requires?.bins ?? [];
    const anyBins = entry.metadata?.requires?.anyBins ?? [];
    const install = entry.metadata?.install ?? [];
    for (const bin of required) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const bin of anyBins) {
      const trimmed = bin.trim();
      if (trimmed) {
        bins.add(trimmed);
      }
    }
    for (const spec of install) {
      const specBins = spec?.bins ?? [];
      for (const bin of specBins) {
        const trimmed = String(bin).trim();
        if (trimmed) {
          bins.add(trimmed);
        }
      }
    }
  }
  return [...bins].toSorted();
}

export const skillsHandlers: GatewayRequestHandlers = {
  "skills.status": ({ params, respond, client }) => {
    if (!validateSkillsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.status params: ${formatValidationErrors(validateSkillsStatusParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const agentIdRaw = typeof params?.agentId === "string" ? params.agentId.trim() : "";
    const employeeAgentId = getEmployeeAgentId(client);
    if (employeeAgentId && agentIdRaw) {
      const requestedAgentId = normalizeAgentId(agentIdRaw);
      if (!enforceEmployeeAgent(client, requestedAgentId, respond, "skills status")) {
        return;
      }
    }
    const agentId = employeeAgentId
      ? employeeAgentId
      : agentIdRaw
        ? normalizeAgentId(agentIdRaw)
        : resolveDefaultAgentId(cfg);
    const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
    const report = buildWorkspaceSkillStatus(workspaceDir, {
      config: cfg,
      eligibility: {
        remote: getRemoteSkillEligibility({
          advertiseExecNode: canExecRequestNode({
            cfg,
            agentId,
          }),
        }),
      },
    });
    respond(true, report, undefined);
  },
  "skills.bins": ({ params, respond }) => {
    if (!validateSkillsBinsParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.bins params: ${formatValidationErrors(validateSkillsBinsParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const workspaceDirs = listAgentWorkspaceDirs(cfg);
    const bins = new Set<string>();
    for (const workspaceDir of workspaceDirs) {
      const entries = loadWorkspaceSkillEntries(workspaceDir, { config: cfg });
      for (const bin of collectSkillBins(entries)) {
        bins.add(bin);
      }
    }
    respond(true, { bins: [...bins].toSorted() }, undefined);
  },
  "skills.search": async ({ params, respond }) => {
    if (!validateSkillsSearchParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.search params: ${formatValidationErrors(validateSkillsSearchParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const results = await searchSkillsFromClawHub({
        query: (params as { query?: string }).query,
        limit: (params as { limit?: number }).limit,
      });
      respond(true, { results }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "skills.detail": async ({ params, respond }) => {
    if (!validateSkillsDetailParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.detail params: ${formatValidationErrors(validateSkillsDetailParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const detail = await fetchClawHubSkillDetail({
        slug: (params as { slug: string }).slug,
      });
      respond(true, detail, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
  "skills.install": async ({ params, respond }) => {
    if (!validateSkillsInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.install params: ${formatValidationErrors(validateSkillsInstallParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { workspaceDir: workspaceDirRaw } = resolveSkillsWorkspace({ cfg });
    if (params && typeof params === "object" && "source" in params && params.source === "clawhub") {
      const p = params as {
        source: "clawhub";
        slug: string;
        version?: string;
        force?: boolean;
      };
      const result = await installSkillFromClawHub({
        workspaceDir: workspaceDirRaw,
        slug: p.slug,
        version: p.version,
        force: Boolean(p.force),
      });
      respond(
        result.ok,
        result.ok
          ? {
              ok: true,
              message: `Installed ${result.slug}@${result.version}`,
              stdout: "",
              stderr: "",
              code: 0,
              slug: result.slug,
              version: result.version,
              targetDir: result.targetDir,
            }
          : result,
        result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.error),
      );
      return;
    }
    const p = params as {
      name: string;
      installId: string;
      dangerouslyForceUnsafeInstall?: boolean;
      timeoutMs?: number;
    };
    const result = await installSkill({
      workspaceDir: workspaceDirRaw,
      skillName: p.name,
      installId: p.installId,
      dangerouslyForceUnsafeInstall: p.dangerouslyForceUnsafeInstall,
      timeoutMs: p.timeoutMs,
      config: cfg,
    });
    respond(
      result.ok,
      result,
      result.ok ? undefined : errorShape(ErrorCodes.UNAVAILABLE, result.message),
    );
  },
  "skills.update": async ({ params, respond }) => {
    if (!validateSkillsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.update params: ${formatValidationErrors(validateSkillsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    if (params && typeof params === "object" && "source" in params && params.source === "clawhub") {
      const p = params as {
        source: "clawhub";
        slug?: string;
        all?: boolean;
      };
      if (!p.slug && !p.all) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, 'clawhub skills.update requires "slug" or "all"'),
        );
        return;
      }
      if (p.slug && p.all) {
        respond(
          false,
          undefined,
          errorShape(
            ErrorCodes.INVALID_REQUEST,
            'clawhub skills.update accepts either "slug" or "all", not both',
          ),
        );
        return;
      }
      const cfg = loadConfig();
      const { workspaceDir } = resolveSkillsWorkspace({ cfg });
      const results = await updateSkillsFromClawHub({
        workspaceDir,
        slug: p.slug,
      });
      const errors = results.filter((result) => !result.ok);
      respond(
        errors.length === 0,
        {
          ok: errors.length === 0,
          skillKey: p.slug ?? "*",
          config: {
            source: "clawhub",
            results,
          },
        },
        errors.length === 0
          ? undefined
          : errorShape(ErrorCodes.UNAVAILABLE, errors.map((result) => result.error).join("; ")),
      );
      return;
    }
    const p = params as {
      skillKey: string;
      enabled?: boolean;
      apiKey?: string;
      env?: Record<string, string>;
    };
    const cfg = loadConfig();
    const skills = cfg.skills ? { ...cfg.skills } : {};
    const entries = skills.entries ? { ...skills.entries } : {};
    const current = entries[p.skillKey] ? { ...entries[p.skillKey] } : {};
    if (typeof p.enabled === "boolean") {
      current.enabled = p.enabled;
    }
    if (typeof p.apiKey === "string") {
      const trimmed = normalizeSecretInput(p.apiKey);
      if (trimmed) {
        current.apiKey = trimmed;
      } else {
        delete current.apiKey;
      }
    }
    if (p.env && typeof p.env === "object") {
      const nextEnv = current.env ? { ...current.env } : {};
      for (const [key, value] of Object.entries(p.env)) {
        const trimmedKey = key.trim();
        if (!trimmedKey) {
          continue;
        }
        const trimmedVal = value.trim();
        if (!trimmedVal) {
          delete nextEnv[trimmedKey];
        } else {
          nextEnv[trimmedKey] = trimmedVal;
        }
      }
      current.env = nextEnv;
    }
    entries[p.skillKey] = current;
    skills.entries = entries;
    const nextConfig: OpenClawConfig = {
      ...cfg,
      skills,
    };
    await writeConfigFile(nextConfig);
    respond(true, { ok: true, skillKey: p.skillKey, config: current }, undefined);
  },
  "skills.delete": async ({ params, respond, client }) => {
    if (!validateSkillsDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skills.delete params: ${formatValidationErrors(validateSkillsDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { workspaceDir } = resolveSkillsWorkspace({ cfg, client });
    try {
      const result = await deleteSkillFromWorkspace({
        workspaceDir,
        skillKey: (params as { skillKey: string }).skillKey,
        slug:
          typeof (params as { slug?: string }).slug === "string"
            ? (params as { slug?: string }).slug
            : undefined,
        config: cfg,
      });
      respond(
        true,
        {
          ok: true,
          kind: result.kind,
          ...(result.kind === "hub"
            ? { slug: result.slug, message: formatSkillHubDeleteMessage(result.slug) }
            : {
                skillKey: result.skillKey,
                message: "이 스킬을 workspace에서 완전히 삭제했습니다.",
              }),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.list": async ({ params, respond, client }) => {
    if (!validateSkillHubListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.list params: ${formatValidationErrors(validateSkillHubListParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { workspaceDir, actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const entries = await listSkillHubEntries({
        workspaceDir,
        actor,
        query:
          typeof (params as { query?: string }).query === "string"
            ? (params as { query?: string }).query
            : undefined,
        scope:
          typeof (params as { scope?: string }).scope === "string"
            ? ((params as { scope?: "discover" | "installed" | "uploads" | "updates" }).scope ??
              "discover")
            : "discover",
        sort:
          typeof (params as { sort?: string }).sort === "string"
            ? ((params as { sort?: "recent" | "installs" | "likes" | "az" }).sort ?? "recent")
            : "recent",
        category:
          typeof (params as { category?: string }).category === "string"
            ? ((
                params as {
                  category?: "all" | "knowledge" | "automation" | "utility" | "other";
                }
              ).category ?? "all")
            : "all",
      });
      respond(true, { entries }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.workspacePublish.list": async ({ params, respond, client }) => {
    if (!validateSkillHubWorkspacePublishListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.workspacePublish.list params: ${formatValidationErrors(validateSkillHubWorkspacePublishListParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { workspaceDir, actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const [entries, overview] = await Promise.all([
        listWorkspacePublishEntries({
          workspaceDir,
          actor,
          config: cfg,
        }),
        getSkillHubOverview({
          workspaceDir,
          actor,
          config: cfg,
        }),
      ]);
      respond(true, { entries, overview }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.detail": async ({ params, respond, client }) => {
    if (!validateSkillHubDetailParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.detail params: ${formatValidationErrors(validateSkillHubDetailParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { workspaceDir, actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const detail = await getSkillHubDetail({
        workspaceDir,
        actor,
        slug: (params as { slug: string }).slug,
      });
      respond(true, { detail }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.publish": async ({ params, respond, client }) => {
    if (!validateSkillHubPublishParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.publish params: ${formatValidationErrors(validateSkillHubPublishParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { workspaceDir, actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const result = await publishWorkspaceSkillToHub({
        workspaceDir,
        config: cfg,
        actor,
        skillName: (params as { skillName: string }).skillName,
        intent: (params as { intent: "create" | "update" }).intent,
        expectedSlug: (params as { expectedSlug?: string }).expectedSlug,
        expectedLocalChecksum: (params as { expectedLocalChecksum: string }).expectedLocalChecksum,
        expectedHubChecksum: (params as { expectedHubChecksum?: string | null })
          .expectedHubChecksum,
        examplePrompts: Array.isArray((params as { examplePrompts?: string[] }).examplePrompts)
          ? (params as { examplePrompts?: string[] }).examplePrompts
          : undefined,
        presentation: (
          params as {
            presentation?: Parameters<typeof publishWorkspaceSkillToHub>[0]["presentation"];
          }
        ).presentation,
      });
      respond(
        true,
        {
          ok: true,
          slug: result.slug,
          version: result.version,
          message: formatHubPublishMessage(result),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.upload": async ({ params, respond, client }) => {
    if (!validateSkillHubUploadParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.upload params: ${formatValidationErrors(validateSkillHubUploadParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const result = await uploadSkillPackageToHub({
        actor,
        filename: (params as { filename: string }).filename,
        contentBase64: (params as { contentBase64: string }).contentBase64,
        expectedHubChecksum: (params as { expectedHubChecksum?: string | null })
          .expectedHubChecksum,
        examplePrompts: Array.isArray((params as { examplePrompts?: string[] }).examplePrompts)
          ? (params as { examplePrompts?: string[] }).examplePrompts
          : undefined,
        presentation: (
          params as { presentation?: Parameters<typeof uploadSkillPackageToHub>[0]["presentation"] }
        ).presentation,
      });
      respond(
        true,
        {
          ok: true,
          slug: result.slug,
          version: result.version,
          message: formatHubPublishMessage(result),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.icons.audit": async ({ params, respond, client }) => {
    if (!validateSkillHubIconAuditParams(params)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid icon audit params"),
      );
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    if (actor.globalRole !== "admin") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "admin access required"));
      return;
    }
    try {
      const referencedAssetIds = await listReferencedSkillHubIconAssetIds();
      respond(true, await auditSkillHubIconAssets({ referencedAssetIds }), undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.icons.gc": async ({ params, respond, client }) => {
    if (!validateSkillHubIconGcParams(params)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid icon GC params"));
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    if (actor.globalRole !== "admin") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "admin access required"));
      return;
    }
    try {
      const referencedAssetIds = await listReferencedSkillHubIconAssetIds();
      const input = params as { dryRun?: boolean; graceDays?: number };
      respond(
        true,
        await garbageCollectSkillHubIconAssets({
          referencedAssetIds,
          dryRun: input.dryRun ?? true,
          graceDays: input.graceDays ?? 14,
        }),
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.install": async ({ params, respond, client }) => {
    if (!validateSkillHubInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.install params: ${formatValidationErrors(validateSkillHubInstallParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { workspaceDir, actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const result = await installSkillFromHub({
        workspaceDir,
        actor,
        slug: (params as { slug: string }).slug,
      });
      respond(
        true,
        {
          ok: true,
          slug: result.slug,
          version: result.version,
          message: formatSkillHubInstallMessage(result.slug),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.update": async ({ params, respond, client }) => {
    if (!validateSkillHubInstallParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.update params: ${formatValidationErrors(validateSkillHubInstallParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { workspaceDir, actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const result = await updateSkillFromHub({
        workspaceDir,
        actor,
        slug: (params as { slug: string }).slug,
      });
      respond(
        true,
        {
          ok: true,
          slug: result.slug,
          version: result.version,
          message: formatSkillHubUpdateMessage(result.slug, result.version),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.hide": async ({ params, respond, client }) => {
    if (!validateSkillHubHideParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.hide params: ${formatValidationErrors(validateSkillHubHideParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      await deleteSkillFromHub({
        slug: (params as { slug: string }).slug,
        actor,
      });
      respond(
        true,
        {
          ok: true,
          slug: (params as { slug: string }).slug,
          message: `Deleted from Skill Hub: ${(params as { slug: string }).slug}`,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.hardDelete": async ({ params, respond, client }) => {
    if (!validateSkillHubHideParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.hardDelete params: ${formatValidationErrors(validateSkillHubHideParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const slug = (params as { slug: string }).slug;
      await deleteSkillFromHub({ slug, actor });
      respond(
        true,
        {
          ok: true,
          slug,
          message: `Deleted from Skill Hub: ${slug}`,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.visibility.update": async ({ params, respond, client }) => {
    if (!validateSkillHubHideParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.visibility.update params: ${formatValidationErrors(validateSkillHubHideParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const { slug } = params as { slug: string; hidden?: boolean };
      await deleteSkillFromHub({ slug, actor });
      respond(
        true,
        {
          ok: true,
          slug,
          message: `Deleted from Skill Hub: ${slug}`,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.like": async ({ params, respond, client }) => {
    if (!validateSkillHubLikeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.like params: ${formatValidationErrors(validateSkillHubLikeParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const result = await toggleSkillHubLike({
        slug: (params as { slug: string }).slug,
        actor,
      });
      respond(
        true,
        {
          ok: true,
          slug: result.slug,
          liked: result.liked,
          likeCount: result.likeCount,
          message: result.liked ? `Liked ${result.slug}` : `Unliked ${result.slug}`,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.examplePrompts.update": async ({ params, respond, client }) => {
    if (!validateSkillHubExamplePromptsUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.examplePrompts.update params: ${formatValidationErrors(validateSkillHubExamplePromptsUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const result = await updateSkillHubExamplePrompts({
        slug: (params as { slug: string }).slug,
        actor,
        examplePrompts: (params as { examplePrompts: string[] }).examplePrompts,
      });
      respond(
        true,
        {
          ok: true,
          slug: result.slug,
          examplePrompts: result.examplePrompts,
          message: "Example prompts updated.",
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.metadata.update": async ({ params, respond, client }) => {
    if (!validateSkillHubMetadataUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.metadata.update params: ${formatValidationErrors(validateSkillHubMetadataUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const result = await updateSkillHubMetadata({
        slug: (params as { slug: string }).slug,
        actor,
        summary: (params as { summary: string }).summary,
        examplePrompts: (params as { examplePrompts: string[] }).examplePrompts,
      });
      respond(
        true,
        {
          ok: true,
          slug: result.slug,
          examplePrompts: result.examplePrompts,
          message: "Skill metadata updated.",
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.presentation.update": async ({ params, respond, client }) => {
    if (!validateSkillHubPresentationUpdateParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.presentation.update params: ${formatValidationErrors(validateSkillHubPresentationUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    const input = params as {
      slug: string;
      expectedRevision: number;
      displayName: string | null;
      displayDescription: string | null;
      category: "knowledge" | "automation" | "utility" | "other" | null;
      examplePrompts: string[];
      iconChange?:
        | { action: "upload"; mimeType: "image/png"; dataBase64: string }
        | { action: "reset" };
    };
    try {
      const result = await updateSkillHubPresentation({
        slug: input.slug,
        actor,
        expectedRevision: input.expectedRevision,
        displayName: input.displayName,
        displayDescription: input.displayDescription,
        category: input.category,
        examplePrompts: input.examplePrompts,
        ...(input.iconChange ? { iconChange: input.iconChange } : {}),
      });
      respond(
        true,
        {
          ok: true,
          slug: result.slug,
          revision: result.revision,
          message: result.noOp
            ? "Skill presentation is already up to date."
            : "Skill presentation updated.",
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.transferOwnership": async ({ params, respond, client }) => {
    if (!validateSkillHubTransferOwnershipParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.transferOwnership params: ${formatValidationErrors(
            validateSkillHubTransferOwnershipParams.errors,
          )}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { actor } = resolveSkillsWorkspace({ cfg, client });
    try {
      const result = await transferSkillHubOwnership({
        slug: (params as { slug: string }).slug,
        actor,
        targetAccountId: (params as { targetAccountId: string }).targetAccountId,
        reason:
          typeof (params as { reason?: string }).reason === "string"
            ? (params as { reason?: string }).reason
            : undefined,
      });
      respond(
        true,
        {
          ok: true,
          slug: result.slug,
          message: `Ownership transferred to ${result.ownerName}`,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
  "skillhub.delete": async ({ params, respond, client }) => {
    if (!validateSkillHubDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid skillhub.delete params: ${formatValidationErrors(validateSkillHubDeleteParams.errors)}`,
        ),
      );
      return;
    }
    const cfg = loadConfig();
    const { workspaceDir } = resolveSkillsWorkspace({ cfg, client });
    try {
      const slug = (params as { slug: string }).slug;
      await deleteSkillFromWorkspace({
        workspaceDir,
        skillKey: slug,
        slug,
        config: cfg,
      });
      respond(
        true,
        {
          ok: true,
          slug,
          message: formatSkillHubDeleteMessage(slug),
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatSkillHubError(err)));
    }
  },
};
