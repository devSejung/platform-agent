# PlatformClaw Working Context

This file is for follow-up agents working in `/home/eon/work/open_claw`.

It is not a replacement for `openclaw/AGENTS.md`.
That file describes upstream repo rules and coding boundaries.
This file describes the current PlatformClaw customization context and project-specific decisions.

## What This Project Is

- PlatformClaw is a custom OpenClaw-based runtime.
- Primary surface is Knox and employee web.
- This repo is being customized for multi-user internal use, not single-user local-only use.
- Current focus is "platform development team agent" style operation for multiple employees sharing the same product surface with per-user routing, workspace, and session separation.

## Repos

- Main repo: `/home/eon/work/open_claw/openclaw`
- Related repo: `/home/eon/work/open_claw/knox-adapter`
- Related repo: `/home/eon/work/open_claw/knox-proxy-mock`
- Local test config: `/home/eon/work/open_claw/exam_emp_openclaw.json`

## Current Product Direction

- OpenClaw core is the base runtime.
- Knox is the primary messaging surface.
- Employee web is also important and shares the same user/agent model.
- `sessionKey` is treated as the routing boundary.
- cron must preserve source agent/session/channel context.
- Knox cron results must return to the originating DM or room.
- Delivery should normally preserve runtime context instead of forcing `sessions_send`.

## Multi-User Assumptions

- Different employees should not accidentally share agent/session state.
- Employee identity drives agent and workspace behavior.
- The system is being customized for internal company use, especially Platform/team workflows.
- Keep thinking in terms of user separation, origin restoration, and operational safety for multiple users.

## Account And Groups System

- PlatformClaw now has an internal account/group layer on top of employee auth.
- Current v1 account identity is effectively `employeeId`.
- SQLite DB path:
  - `~/.openclaw/platformclaw.sqlite`
- Local test admin seeds:
  - `test_admin`
  - `eon`
- Initial admin list can be overridden with:
  - `OPENCLAW_INITIAL_ADMIN_EMPLOYEE_IDS`

### Roles

- Global roles:
  - `member`
  - `admin`
- `leader` is **not** a global role.
- `leader` is scoped inside Group / Part membership.

### Group Model

- Hierarchy is exactly 2 levels:
  - `Group`
  - `Part`
- A `Part` belongs to one parent `Group`.
- Membership model is:
  - `scope_type = group | part`
  - `scope_id`
  - `group_role = member | leader`
- Group leader permissions cover child Parts by permission calculation.
- Group leader does **not** imply duplicated membership rows for every child Part.
- Group / Part deletion policy is archive-only for v1.

### Current UI / UX Intent

- `Groups` tab is a product-facing surface, not a debug/admin-only page.
- Left side should behave like a compact Group selection list.
- Right side should show one selected `Group` with:
  - Group header
  - Group members
  - Nested Parts inside that Group
- Parts should visually read as belonging to the selected Group, not as flat sibling cards.
- `Admin` tab is admin-only and is an in-app management surface.
- Skill Hub, Groups, and Admin should keep the same visual language:
  - compact controls
  - card hierarchy
  - strong selection state
  - minimal raw browser-default form styling

### Current Permission Expectations

- Admin can:
  - create Group / Part
  - change global role
  - assign/remove memberships
  - promote/demote scoped leader
  - transfer Skill Hub ownership
- Leader can:
  - add/remove members within managed scope
  - manage child Parts if leader of parent Group
- Leader cannot:
  - promote someone else to leader
  - remove self from managed scope
- Owner self-transfer of Skill Hub ownership is allowed.
- Admin transfer requires reason.

## Employee Web Files Tab

- Employee web now has a product-level `Files` tab directly below `Chat`.
- This is the employee-facing workspace browser for the currently logged-in user.
- Scope is strictly:
  - current employee session
  - current session `agentId`
  - that agent's workspace root only

### Files Tab Behavior

- Users can:
  - browse folders inside their own workspace
  - move into child folders
  - move one level up
  - upload files into the currently open folder
  - download files
  - create folders
  - rename files/folders
  - delete files/folders
- Hidden files/directories are not shown.
- Default sort is:
  - directories first
  - then name ascending
- Multiple selection is supported.
- Multiple download is currently individual file download, not zip bundling.
- Folder delete is recursive with confirmation.

### File Preview

- Readable files should open in an inline preview view inside the `Files` tab.
- Current preview targets include:
  - markdown files
  - text files
  - common script/code files such as `py`, `sh`, `js`, `ts`, `json`, `yaml`, `xml`, `sql`
  - supported archives such as `zip`, `tar`, `tgz`, `tar.gz`
- Markdown preview uses the existing sanitized UI markdown renderer.
- Code/script preview uses syntax-highlighted preformatted rendering when language inference is available.
- Plain text preview uses the same inline file preview surface without markdown formatting.
- Archive preview shows a bounded entry listing rather than extracting file contents inline.
- Preview view has:
  - back-to-files action
  - top-right download button
- Files that are not readable / previewable should still fall back to download.
- Large previews are intentionally bounded server-side and may return truncated text or archive summaries instead of full content.

### Upload UX

- Upload transport is HTTP multipart, not websocket/base64.
- Upload progress is shown only while files are actively uploading.
- Successful uploads should not linger in the progress list after completion.
- Success messages are short-lived callout feedback, then auto-clear.
- Failed uploads may remain visible for troubleshooting.

### Security Model

- Client never chooses the absolute workspace path.
- Server resolves workspace from:
  - employee session cookie
  - session `agentId`
  - `resolveAgentWorkspaceDir(...)`
- Every file operation re-validates the requested relative path against the resolved workspace root.
- Blocked path forms include:
  - absolute paths
  - `..`
  - hidden path segments
  - reserved OS names
  - symlink/boundary escape attempts
- User-facing forbidden message should remain generic:
  - `접근할 수 없는 경로`

### Important Files

- Backend contract:
  - `openclaw/src/gateway/employee-workspace-files-contract.ts`
- Backend routes and boundary logic:
  - `openclaw/src/gateway/employee-workspace-files.ts`
- Employee session lookup:
  - `openclaw/src/gateway/employee-web-auth.ts`
- Agent workspace resolution:
  - `openclaw/src/agents/agent-scope.ts`
- Frontend controller:
  - `openclaw/ui/src/ui/controllers/workspace-files.ts`
- Frontend view:
  - `openclaw/ui/src/ui/views/workspace-files.ts`

### Agent Awareness Decision

- It is good for the runtime agent to know the current user’s own Group / Part memberships.
- It is **not** necessary to inject the full org tree into prompt context.
- Preferred prompt context is lightweight:
  - current global role
  - top-level groups
  - current Group / Part memberships
- Treat LDAP `department` as external profile metadata.
- Treat internal `Group / Part` as PlatformClaw product metadata.
- Do not assume `department` and `Group` are the same thing.

## Skill Hub Slash Commands From Knox

- Knox room messages may include wrapper text before the actual command.
- Current decision is intentionally simple:
  - Knox adapter inspects the **last non-empty line**
  - if that line strictly matches:
    - `/skillhub install <slug>`
    - `/skillhub update <slug>`
    - `/skillhub delete <slug>`
  - it sends that exact line as `commandBody`
- PlatformClaw `/skillhub` handling now trusts:
  - `BodyForCommands`
  - `CommandBody`
  only
- It no longer falls back to raw wrapped body text for `/skillhub` interception.
- For strict Skill Hub slash commands:
  - adapter forces websocket `chat.send`
  - adapter does **not** use `/v1/responses`
  - this avoids the command being treated as a normal LLM input
- Relevant files:
  - `openclaw/src/auto-reply/dispatch.ts`
  - `openclaw/src/gateway/protocol/schema/logs-chat.ts`
  - `openclaw/src/gateway/server-methods/chat.ts`
  - `knox-adapter/src/platformclaw-gateway.ts`

## Shared Operator Scope Relaxation

- There is now an explicit gateway auth flag:
  - `gateway.auth.allowSharedOperatorScopesWithoutDeviceIdentity`
- Purpose:
  - allow shared `token` / `password` operator clients to keep requested operator scopes
  - even when they connect without device identity / pairing
- This is a **policy relaxation** and should be enabled only intentionally.
- Default intent:
  - keep it off unless a deployment explicitly wants shared-auth operator clients to act with requested scopes
- Local test config currently enables it in:
  - `/home/eon/work/open_claw/exam_emp_openclaw.json`
- This relaxation was added mainly to support Knox adapter slash-command writes without forcing device pairing in that environment.
- Relevant files:
  - `openclaw/src/config/types.gateway.ts`
  - `openclaw/src/config/zod-schema.ts`
  - `openclaw/src/gateway/auth.ts`
  - `openclaw/src/gateway/server/ws-connection/connect-policy.ts`
  - `openclaw/src/gateway/server/ws-connection/message-handler.ts`
  - `openclaw/src/gateway/server-methods.ts`

### Operational Note

- If a company deployment keeps strict shared-auth policy, websocket operator writes may still require:
  - device identity
  - pairing / approval
- If a company deployment enables the relaxation flag, slash-command writes from Knox adapter can work with shared password auth alone.
- For this project, the local validated path is:
  - shared password auth
  - requested `operator.admin`
  - no device identity required
  - Knox room wrapper + strict last-line `/skillhub install ...`
  - outbound result: `Skill installed: ...`

## Knox File Sharing Decision

Current product decision:

- Knox does not use native file upload yet.
- Knox file sharing is implemented as link-only delivery.
- Outbound Knox messages remain `msgType: "text"`.
- Final Knox text format starts with `[KNOX_FILE_LINKS]`.
- The human-readable message body is produced in OpenClaw before it reaches adapter/proxy.
- Proxy changes are intentionally minimized.

Example format:

```text
[KNOX_FILE_LINKS]
파일 3개를 준비했습니다.
링크 만료: 2026-05-25 14:00 KST

1. report.pdf
- 2.1 MB
- application/pdf
- 링크: https://...
```

## Knox File Sharing Policy

These are current agreed policies unless the user changes them later.

- Link TTL: 7 days
- Delete grace after expiry: 3 days
- Access: no auth requirement; anyone with the link may access
- Max file size: 256 MB
- Max files per message: 10
- Multiple files are bundled into one message
- If some files fail, allowed files are sent and blocked/failed files are listed separately
- If all files fail, send `첨부 가능한 파일이 없습니다.`
- Long intro text should be truncated
- Official message format is fixed
- PDF and image downloads should allow inline browser preview when possible

Current blocked extensions are intentionally "very sensitive only", not broad blocking.

## Knox File Sharing Implementation

Important files:

- Knox outbound conversion:
  - `openclaw/extensions/knox/src/channel.ts`
- Knox file link generation and download route:
  - `openclaw/extensions/knox/src/file-links.ts`
- Generic attached-results sendPayload fix:
  - `openclaw/src/plugin-sdk/core.ts`
- Outbound delivery hook point:
  - `openclaw/src/infra/outbound/deliver.ts`
- Gateway HTTP route registration:
  - `openclaw/src/gateway/server-http.ts`

Behavior:

- If Knox outbound payload contains `mediaUrl/mediaUrls`, OpenClaw converts that payload into Knox link text.
- Download route is served by OpenClaw, not by the proxy.
- Current route prefix:
  - `/api/v1/knox/file-links/:artifactId`

## Important Runtime Caveat

OpenClaw runtime uses built output under `dist/`, not `src/` directly.

That means:

- Code changes in `src/` do not matter unless the build output used by runtime/container is updated.
- If `doctor` or runtime behavior does not reflect recent source changes, always suspect stale `dist` or stale deployed container first.

This mattered for Knox file-link work:

- `channels.knox.fileLinksBaseUrl` support exists in updated code and updated `dist`
- If runtime says `channels.knox: invalid config: must NOT have additional properties`, it usually means the running artifact is older than the current source tree

## Important Deployment Caveat

Company deployment may use imported Docker images, and behavior may still differ from local runs because of mounted config/state/workspace.

Be careful about:

- mounted `openclaw.json`
- mounted state dir
- mounted workspace dir
- whether runtime is using `exam_emp_openclaw.json` or some other config
- whether company runtime is actually using the newest image

Do not assume local runtime behavior matches company runtime behavior.

## Known Local/Test Setup

Local test script:

- `/home/eon/work/open_claw/start_local.sh`

Key local assumptions used during Knox testing:

- `OPENCLAW_CONFIG_PATH=/home/eon/work/open_claw/exam_emp_openclaw.json`
- `OPENCLAW_STATE_DIR=/home/eon/work/open_claw/.openclaw-local-test`
- `OPENCLAW_KNOX_FILE_LINKS_BASE_URL=http://127.0.0.1:19001`

Mock testing:

- Knox proxy mock:
  - `/home/eon/work/open_claw/knox-proxy-mock`
- Useful endpoint:
  - `http://127.0.0.1:3020/api/v1/platformclaw/knox/outbound/messages`

## Known Company/Deployment Concern

Local success does not guarantee company success.

Common reasons:

- stale container/image
- stale mounted config
- mounted workspace/state mismatch
- runtime not using expected config path
- doctor being run against a different runtime than the deployed container

Do not jump to speculative fixes for company runtime without first checking what config, image, and mounted state are actually active.

## Guidance For Future Agents

- Treat this as a multi-user product customization effort, not a generic OpenClaw hobby setup.
- Preserve Knox origin routing assumptions.
- Preserve employee separation assumptions.
- Minimize proxy and adapter churn unless clearly necessary.
- Prefer fixing PlatformClaw/OpenClaw-side shaping over pushing complexity into Knox proxy mock or adapter.
- When something "works at home but not at company", check runtime artifact, config path, mounted state, and actual deployed image before proposing logic changes.
