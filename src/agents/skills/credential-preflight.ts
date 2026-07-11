import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import {
  buildExecCredentialRuntimeContext,
  SQLiteCredentialService,
} from "../../credentials/index.js";
import type { CredentialService } from "../../credentials/types.js";
import { isPathInside } from "../../infra/path-guards.js";
import { resolveUserPath } from "../../utils.js";
import { splitShellArgs } from "../../utils/shell-argv.js";
import { loadWorkspaceSkillEntries } from "./workspace.js";

export type SkillCredentialPreflightResult =
  | { ok: true }
  | {
      ok: false;
      skillName: string;
      missingCredentials: string[];
      message: string;
    };

export type SkillCredentialPreflightInput = {
  command: string;
  workdir: string;
  workspaceDir: string;
  config?: OpenClawConfig;
  managedSkillsDir?: string;
  bundledSkillsDir?: string;
  agentId?: string;
  accountId?: string | null;
  sessionKey?: string | null;
  messageProvider?: string | null;
  currentChannelId?: string | null;
  service?: Pick<CredentialService, "listCredentials">;
};

function normalizeRequiredCredentialKeys(input: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const key of input ?? []) {
    const trimmed = key.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function tokenToCandidatePath(token: string, workdir: string): string | null {
  const trimmed = token.trim();
  if (!trimmed || /[|&;<>(){}$`*?\[\]]/u.test(trimmed)) {
    return null;
  }
  if (trimmed.startsWith("~")) {
    return path.resolve(resolveUserPath(trimmed));
  }
  if (path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }
  if (
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed === "." ||
    trimmed === ".." ||
    trimmed.includes("/")
  ) {
    return path.resolve(workdir, trimmed);
  }
  return null;
}

function commandReferencesSkill(params: {
  command: string;
  workdir: string;
  skillBaseDir: string;
}): boolean {
  const baseDir = path.resolve(params.skillBaseDir);
  const workdir = path.resolve(params.workdir);
  if (workdir === baseDir || isPathInside(baseDir, workdir)) {
    return true;
  }
  const tokens = splitShellArgs(params.command) ?? [];
  for (const token of tokens) {
    const candidate = tokenToCandidatePath(token, workdir);
    if (!candidate) {
      continue;
    }
    if (candidate === baseDir || isPathInside(baseDir, candidate)) {
      return true;
    }
  }
  return false;
}

function missingCredentialMessage(params: {
  skillName: string;
  missingCredentials: string[];
  reason?: string;
}): string {
  const joined = params.missingCredentials.join(", ");
  const reason = params.reason ? `${params.reason}\n\n` : "";
  return [
    reason,
    `Credential required before running skill "${params.skillName}".`,
    `Register ${joined} in the Credentials tab, then run the skill again.`,
  ].join("");
}

export async function preflightSkillCredentials(
  input: SkillCredentialPreflightInput,
): Promise<SkillCredentialPreflightResult> {
  const entries = loadWorkspaceSkillEntries(input.workspaceDir, {
    config: input.config,
    managedSkillsDir: input.managedSkillsDir,
    bundledSkillsDir: input.bundledSkillsDir,
    agentId: input.agentId,
  });
  const matched = entries.find((entry) => {
    const requiredCredentials = normalizeRequiredCredentialKeys(
      entry.metadata?.requires?.credentials,
    );
    return (
      requiredCredentials.length > 0 &&
      commandReferencesSkill({
        command: input.command,
        workdir: input.workdir,
        skillBaseDir: entry.skill.baseDir,
      })
    );
  });
  if (!matched) {
    return { ok: true };
  }

  const requiredCredentials = normalizeRequiredCredentialKeys(
    matched.metadata?.requires?.credentials,
  );
  const runtimeContext = buildExecCredentialRuntimeContext({
    runId: "preflight",
    agentId: input.agentId,
    sessionKey: input.sessionKey,
    messageProvider: input.messageProvider,
    currentChannelId: input.currentChannelId,
    accountId: input.accountId,
  });
  if (!runtimeContext) {
    return {
      ok: false,
      skillName: matched.skill.name,
      missingCredentials: requiredCredentials,
      message: missingCredentialMessage({
        skillName: matched.skill.name,
        missingCredentials: requiredCredentials,
        reason: "Credential lookup is not available for this run context.",
      }),
    };
  }

  const service = input.service ?? new SQLiteCredentialService();
  const existing = await service.listCredentials({
    ownerType: runtimeContext.effectiveOwnerType,
    ownerId: runtimeContext.effectiveOwnerId,
  });
  const existingKeys = new Set(existing.map((credential) => credential.definitionKey));
  const missingCredentials = requiredCredentials.filter((key) => !existingKeys.has(key));
  if (missingCredentials.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    skillName: matched.skill.name,
    missingCredentials,
    message: missingCredentialMessage({
      skillName: matched.skill.name,
      missingCredentials,
    }),
  };
}
