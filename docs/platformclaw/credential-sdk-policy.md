# PlatformClaw Credential SDK Policy

Date: 2026-07-10
Status: Phase 0-2 implemented, Phase 3 foundation implemented

## Goal

PlatformClaw must let trusted Skill code retrieve runtime credentials without
storing plaintext secrets in Skill source, workspace files, chat history, tool
arguments, or SQLite.

The first product direction is a Python SDK bundled in the Skill Docker base
image:

```python
from platformclaw import credentials

token = credentials.get("jira.default")
```

The SDK calls PlatformClaw Runtime. Runtime decides the credential scope from
the current run context and returns only credentials allowed for that scope.

## Security Model

This is not a zero-secret Skill model.

Trusted Skill code can read the credential value returned by
`credentials.get(...)`. The security guarantee is:

- A Skill can only retrieve credentials for the current Runtime-selected scope.
- A Skill cannot choose another user, room, or system owner.
- LLM/tool arguments cannot choose the credential owner.
- Plaintext credentials are never stored in SQLite, workspace files, Skill
  source, argv, chat history, or artifacts by PlatformClaw itself.
- Runtime output paths must redact credential values after lookup.

If a future feature requires Skill code to never see a secret value, that
feature must use a Runtime connector such as `jira.create_issue` or `mail.send`
instead of `credentials.get(...)`.

## Credential Scope

Credential ownership is a Runtime decision.

```ts
type CredentialOwnerType = "account" | "room" | "system";

type CredentialScope =
  | { ownerType: "account"; ownerId: string }
  | { ownerType: "room"; ownerId: string }
  | { ownerType: "system"; ownerId: string };
```

Runtime must not reuse generic channel routing `accountId` as the credential
owner unless that field is explicitly proven to be a human account id for the
current run. Routing account ids, room ids, and external channel account ids are
not credential owners by default.

## Channel Policy

Web and authenticated DM runs:

- Use `ownerType = "account"`.
- Use the authenticated requester account id as `ownerId`.

Group room runs:

- Do not use personal credentials.
- Do not infer a user credential owner from `group-{chatroomId}`.
- Jira may use a room or system shared credential.
- Mail credentials are denied by default.

Cron and automation runs:

- Use the automation owner account id when available.
- Ownerless legacy automation must not receive personal credentials.
- Shared/system credentials may be added later by explicit policy.

API runs:

- Use account credentials only when the API identity maps to an account id.
- Otherwise deny credential retrieval.

## SDK Contract

The initial Python SDK surface is intentionally small:

```python
credentials.get(name: str) -> str
```

The SDK must not expose owner selection:

```python
# Forbidden API shape
credentials.get("jira.default", owner_id="user-b")
```

Runtime supplies the SDK with internal run context, for example:

```text
PLATFORMCLAW_RUN_ID
PLATFORMCLAW_SKILL_ID
PLATFORMCLAW_RUNTIME_ENDPOINT
PLATFORMCLAW_RUNTIME_TOKEN
```

These values are not the secret. They only let the SDK authenticate to the
Runtime credential endpoint for the current run.

Phase 3 foundation currently provides the internal Runtime resolver boundary:

```ts
resolveRuntimeCredential(
  { definitionKey: "jira.default" },
  {
    runId,
    skillId,
    effectiveOwnerType,
    effectiveOwnerId,
  },
);
```

The resolver derives SQLite lookup scope only from Runtime context and registers
the decrypted value with the runtime redaction registry before returning it to
in-process Runtime/SDK code. Browser and Control UI Gateway methods remain
metadata-only and must not expose plaintext credentials.

The Python SDK transport must be wired only after the Runtime can provide a
trusted per-run context/token. It must not call `credentials.*` Control UI
methods, and SDK requests must not include `ownerId`, `accountId`, `roomId`, or
`systemId` as credential owner input.

## Docker Policy

The PlatformClaw Skill Docker base image must include the official Python SDK
so Skill code can import it naturally:

```python
from platformclaw import credentials
```

The SDK may be included by installing a local package into the image or by
setting `PYTHONPATH` inside the base image. Skill authors should not need to
vendor the SDK into each Skill.

## Credential Definitions

Admin UI manages credential types, not user secret values.

Examples:

- `jira.default`
- `mail.default`
- `github.default`
- `internal.api`

User or room credential records store the actual encrypted values for those
definitions.

The first SQLite model should use two tables:

- `credential_definitions`
- `credentials`

`credential_definitions` stores admin-managed metadata such as key, label, type,
localized descriptions, usage hint, owner policy, and rotation days.

`credentials` stores encrypted credential values for an owner scope.

Current SQLite shape:

```text
credential_definitions
  id
  credential_key
  label
  type
  description
  description_en
  usage_hint
  owner_policy
  rotation_days
  required
  created_at
  updated_at
  archived_at

credentials
  id
  definition_id
  owner_type
  owner_id
  encrypted_value
  encryption_version
  created_at
  updated_at
  last_used_at
  expires_at
  revoked_at
```

`credential_definitions` answers "what kinds of token can be configured?"
`credentials` answers "what encrypted value exists for this owner scope?"

## Encryption Policy

SQLite must never store plaintext credential values.

Required baseline:

- Use authenticated encryption, preferably AES-256-GCM.
- Store only `encrypted_value`.
- Keep the master key outside SQLite.
- Support `encryption_version`.

Allowed master key sources for the first implementation:

- `PLATFORMCLAW_MASTER_KEY`
- A server-owned file such as `/etc/platformclaw/master.key`

For the current SQLite implementation, `PLATFORMCLAW_MASTER_KEY` is the
backend/gateway process environment variable used to encrypt and decrypt
credential values. It is acceptable to provide it when the Docker container
starts, but the value must be stable across restarts. If the key changes,
existing encrypted credentials cannot be decrypted until they are migrated or
re-encrypted with the new key.

In local development it can be exported in the shell before starting the
backend. In service or container deployments, configure it in the service
environment, Docker Compose environment, Kubernetes Secret, or the gateway host
env file that the service already loads. Do not store this key in SQLite, Skill
code, workspace files, or Skill manifests.

Example key generation:

```bash
openssl rand -base64 32
```

Then set:

```bash
PLATFORMCLAW_MASTER_KEY=base64:<generated-value>
```

Docker Compose example:

```yaml
services:
  platformclaw:
    environment:
      PLATFORMCLAW_MASTER_KEY: "base64:<generated-value>"
```

Vault or KMS can replace the encryption backend later through
`CredentialService`.

## Runtime Lookup Rules

When SDK calls `credentials.get("jira.default")`, Runtime must:

1. Verify the runtime token and run id.
2. Resolve the current credential scope internally.
3. Verify the Skill is allowed to use credential SDK access.
4. Resolve the credential definition by name.
5. Enforce channel policy and owner policy.
6. Load the matching credential row by definition and scope.
7. Reject missing, revoked, expired, or policy-denied credentials.
8. Decrypt the value.
9. Register the plaintext value with run-scoped redaction.
10. Return the value to the SDK.

The SDK request cannot include owner id, account id, room id, or system id.

## Redaction Policy

After Runtime decrypts a credential value, the value must be registered for
run-scoped redaction before returning it to the SDK.

At minimum, redaction must cover:

- stdout and stderr from Skill execution
- tool result payloads
- tool lifecycle events
- server chat broadcasts
- transcript and history persistence
- error messages and stack traces
- artifact metadata and generated text where PlatformClaw controls the path

Redaction is a defense layer. It does not make untrusted Skill code safe to read
credentials.

## Explicit Non Goals For Phase 0

Phase 0 does not implement:

- SQLite migrations
- UI screens
- Python SDK code
- Runtime credential endpoint
- Credential grants
- Audit logs
- Jira or Mail connectors

Those belong to later implementation phases.

## Phase 1 Storage API

The first backend service boundary is:

```ts
interface CredentialService {
  createDefinition(input): Promise<CredentialDefinition>;
  listDefinitions(): Promise<CredentialDefinition[]>;
  upsertCredential(input): Promise<CredentialMetadata>;
  listCredentials(scope): Promise<CredentialMetadata[]>;
  getCredential(input): Promise<ResolvedCredential>;
  revokeCredential(input): Promise<void>;
}
```

The SQLite implementation is `SQLiteCredentialService`. It encrypts values
before writing them and never returns plaintext from list or mutation metadata
methods. Plaintext is only returned by `getCredential(...)`, which is reserved
for later Runtime/SDK use.

## Phase 2 Gateway API

The first Control UI-facing gateway methods are:

```text
credentials.definitions.list
credentials.status
credentials.definitions.upsert
credentials.definitions.delete
credentials.list
credentials.upsert
credentials.revoke
```

Policy:

- `credentials.status` is available to authenticated employee clients and
  reports whether the server-side encryption master key is configured. It does
  not return the key value.
- `credentials.definitions.upsert` requires admin account access.
- `credentials.definitions.delete` requires admin account access. The SQLite
  implementation archives the definition with `archived_at` instead of hard
  deleting it, preserving referential integrity and future audit/debug context.
- `credentials.definitions.list` is available to authenticated employee clients
  so the user credential tab can show required token types.
- `credentials.list`, `credentials.upsert`, and `credentials.revoke` operate
  only on the authenticated requester's account scope.
- These methods do not accept `owner_id`, `account_id`, `room_id`, or
  `system_id`.
- These methods never return plaintext credential values.

Room/system shared credential management is intentionally not part of the first
user credential API. It should be added later as an explicit admin-only surface.

The first UI layer is split into a controller wrapper and an isolated tab view:

```text
ui/src/ui/controllers/credentials.ts
ui/src/ui/views/credentials.ts
```

The tab shows metadata and empty secret inputs only. Stored credential values are
never rendered back into the UI. Admin users can define credential types through
the `+` card modal, including the primary description, English description, and
`usage_hint` metadata. `usage_hint` is display-only copy such as "사용 스킬";
it is not a permission or grant. Deleting a credential type archives it through
the card `...` menu. The visible description follows the current UI locale:
Korean uses `description`, English uses `description_en`, with fallback to the
other field when missing.

If `credentials.status` reports that `PLATFORMCLAW_MASTER_KEY` is not ready, the
tab shows an admin-facing warning and disables credential value saves. This
keeps the "SQLite stores no plaintext" policy intact even during incomplete
server setup.

## Phase 3 Runtime SDK Plan

Phase 3 must not change the Phase 0-2 security decisions. It adds runtime access
for trusted Skill code only after the execution context and redaction boundary
are explicit.

Implemented foundation:

1. Add an internal Runtime resolver that accepts credential key plus Runtime
   context, not owner input from Skill/LLM arguments.
2. Resolve SQLite scope from `effectiveOwnerType + effectiveOwnerId`.
3. Deny resolver use when `runId`, `skillId`, or `effectiveOwnerId` is missing.
4. Register decrypted values with runtime redaction before returning them to
   in-process Runtime/SDK code.
5. Apply the runtime redaction registry to generic logging redaction and
   node-host `system.run` stdout/stderr/event output.

Remaining implementation order:

1. Add a Runtime credential endpoint that is not exposed to browser clients.
2. Pass only Runtime-owned context to the endpoint: run id, skill id, runtime
   token, and internally resolved credential scope.
3. Deny SDK requests that include owner id, account id, room id, or system id.
4. Resolve scope from the run context:
   - Web and DM: current authenticated account.
   - Group room: deny personal credentials by default.
   - Cron: automation owner account only when the owner is known.
5. Register decrypted values with run-scoped redaction before returning them to
   the SDK.
6. Add the Docker-bundled Python SDK import surface:

   ```python
   from platformclaw import credentials
   token = credentials.get("jira.default")
   ```

Phase 3 must not use env injection as the primary path and must not let Skill or
LLM input choose credential owner.

## Phase 0 Decisions

- Use a Docker-bundled Python SDK as the primary Skill authoring surface.
- Use `credentials.get(name)` for trusted Skill credential reads.
- Do not use env injection as the primary design.
- Do not make Skill authors call a CLI through `subprocess`.
- Do not let Skill or LLM choose credential owner.
- Use `owner_type + owner_id` internally for credential scope.
- Use admin-managed credential definitions for token types.
- Start with `credential_definitions` and `credentials` tables.
- Encrypt stored values from the first DB implementation.
- Keep connector-style tools as the future option when Skill code must not see
  secret values.
