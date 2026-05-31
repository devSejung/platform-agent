import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  appendSessionRecord,
  type AccountRecord,
  buildAccountSummary,
  upsertAccount,
  upsertWorkspaceBinding,
} from "./account-store.js";

export type ProvisionedAccount = {
  account: AccountRecord;
  workspaceId: string;
};

export function provisionEmployeeAccount(params: {
  config: OpenClawConfig;
  employeeId: string;
  email?: string | null;
  name?: string | null;
  department?: string | null;
  agentId: string;
  sessionId?: string;
  sessionExpiresAt?: string | null;
  recordSession?: boolean;
  env?: NodeJS.ProcessEnv;
}): ProvisionedAccount {
  const env = params.env ?? process.env;
  const account = upsertAccount({
    employeeId: params.employeeId,
    email: params.email,
    displayName: params.name,
    department: params.department,
    externalProvider: "ldap",
    externalSubject: params.employeeId,
    env,
  });
  const workspacePath = resolveAgentWorkspaceDir(params.config, params.agentId);
  const workspaceId = upsertWorkspaceBinding({
    accountId: account.id,
    agentId: params.agentId,
    workspacePath,
    env,
  });
  if (params.recordSession !== false) {
    appendSessionRecord({
      sessionId: params.sessionId,
      accountId: account.id,
      agentId: params.agentId,
      workspaceId,
      expiresAt: params.sessionExpiresAt ?? null,
      env,
    });
  }
  return { account, workspaceId };
}

export function resolveEmployeeAccountSummary(params: {
  employeeId: string;
  env?: NodeJS.ProcessEnv;
}) {
  return buildAccountSummary(params.employeeId, params.env ?? process.env);
}
