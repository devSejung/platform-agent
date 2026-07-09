import { requireAdminAccount, requireRequesterAccountId } from "../../accounts/permissions.js";
import { getCredentialMasterKeyStatus } from "../../credentials/encryption.js";
import { SQLiteCredentialService } from "../../credentials/index.js";
import type {
  CreateCredentialDefinitionInput,
  UpsertCredentialInput,
} from "../../credentials/types.js";
import { formatErrorMessage } from "../../infra/errors.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateCredentialDefinitionsListParams,
  validateCredentialDefinitionDeleteParams,
  validateCredentialDefinitionsUpsertParams,
  validateCredentialRevokeParams,
  validateCredentialsListParams,
  validateCredentialsStatusParams,
  validateCredentialUpsertParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

function createCredentialService() {
  return new SQLiteCredentialService();
}

export const credentialHandlers: GatewayRequestHandlers = {
  "credentials.status": async ({ params, respond, client }) => {
    if (!validateCredentialsStatusParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid credentials.status params: ${formatValidationErrors(
            validateCredentialsStatusParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      requireRequesterAccountId(client);
      const status = getCredentialMasterKeyStatus();
      respond(
        true,
        {
          encryptionReady: status.ready,
          keyName: status.keyName,
          message: status.message,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },

  "credentials.definitions.list": async ({ params, respond, client }) => {
    if (!validateCredentialDefinitionsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid credentials.definitions.list params: ${formatValidationErrors(
            validateCredentialDefinitionsListParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      requireRequesterAccountId(client);
      const entries = await createCredentialService().listDefinitions();
      respond(true, { entries }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },

  "credentials.definitions.upsert": async ({ params, respond, client }) => {
    if (!validateCredentialDefinitionsUpsertParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid credentials.definitions.upsert params: ${formatValidationErrors(
            validateCredentialDefinitionsUpsertParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      requireAdminAccount(client);
      const definition = await createCredentialService().createDefinition(
        params as CreateCredentialDefinitionInput,
      );
      respond(true, { ok: true, definition }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },

  "credentials.definitions.delete": async ({ params, respond, client }) => {
    if (!validateCredentialDefinitionDeleteParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid credentials.definitions.delete params: ${formatValidationErrors(
            validateCredentialDefinitionDeleteParams.errors,
          )}`,
        ),
      );
      return;
    }
    try {
      requireAdminAccount(client);
      const { key } = params as { key: string };
      await createCredentialService().archiveDefinition(key);
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },

  "credentials.list": async ({ params, respond, client }) => {
    if (!validateCredentialsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid credentials.list params: ${formatValidationErrors(validateCredentialsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = requireRequesterAccountId(client);
      const entries = await createCredentialService().listCredentials({
        ownerType: "account",
        ownerId: accountId,
      });
      respond(true, { entries }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },

  "credentials.upsert": async ({ params, respond, client }) => {
    if (!validateCredentialUpsertParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid credentials.upsert params: ${formatValidationErrors(validateCredentialUpsertParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = requireRequesterAccountId(client);
      const input = params as Omit<UpsertCredentialInput, "ownerType" | "ownerId">;
      const credential = await createCredentialService().upsertCredential({
        ...input,
        ownerType: "account",
        ownerId: accountId,
      });
      respond(true, { ok: true, credential }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },

  "credentials.revoke": async ({ params, respond, client }) => {
    if (!validateCredentialRevokeParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid credentials.revoke params: ${formatValidationErrors(validateCredentialRevokeParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const accountId = requireRequesterAccountId(client);
      const { definitionKey } = params as { definitionKey: string };
      await createCredentialService().revokeCredential({
        definitionKey,
        scope: { ownerType: "account", ownerId: accountId },
      });
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, formatErrorMessage(err)));
    }
  },
};
