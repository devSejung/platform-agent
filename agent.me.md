# PlatformClaw Agent Instructions

This file provides persistent guidance for Codex agents working under:

`C:\platform-agent`

PlatformClaw is a customized OpenClaw-based internal runtime for multi-user employee workflows. Treat it as a company-facing product customization, not a single-user local experiment.

## Repo Map

- PlatformClaw working repo: `C:\platform-agent`
- Primary UI workspace: `C:\platform-agent\ui`
- Local mock and validation runs should use the English-path workspace under `C:\platform-agent`

If a child directory has its own `AGENTS.md`, follow it for local coding rules. This file defines PlatformClaw product-level direction for this workspace.

For PlatformClaw feature work, bug fixes, local runs, and company image-build preparation, use `C:\platform-agent`. Do not assume a sibling upstream clone is available unless the user explicitly points to one.

Keep `openclaw` for package names, CLI commands, config keys, environment variables, plugin IDs, and public SDK import paths such as `openclaw/plugin-sdk/*`. Do not mechanically rename those identifiers to `platformclaw`.

## Current Environment Assumptions

- This repo is used to package dependencies and build images for company deployment.
- Company runtime uses local vLLM.
- Company deployment runs inside Docker on Linux servers.
- Local UI verification should prefer the repo's `ui` directory directly instead of wrapper scripts from the repo root when Windows shell/path issues are likely.

## Always Preserve

- Employee/session/workspace separation.
- Existing chat session selection, auth, routing, and workspace boundaries unless the task explicitly changes them.
- Existing OpenClaw contracts unless explicitly changing PlatformClaw behavior.
- Backward compatibility for gateway/client protocols where practical.
- Maintainable, focused, reversible changes with nearby tests.

## Do Not

- Mix state between employees, sessions, or workspaces.
- Let clients choose absolute workspace paths.
- Bypass server-side workspace boundary validation.
- Make broad refactors for narrow bugs.
- Assume local success means company deployment success.
- Assume `src/` changes affect runtime when stale `dist` or container artifacts may still be active.
- Commit local-only test settings, temporary configs, or machine-specific tweaks.

## Work Style

Before editing:

1. Identify the touched subsystem.
2. Inspect existing code and nearby tests.
3. Read only the smallest relevant context.
4. Prefer small, additive, reversible patches.
5. Avoid unrelated cleanup.
6. Add or update focused tests when behavior changes.

When uncertain, check code and tests before guessing. Preserve current behavior unless the task explicitly asks to change it.

## UI Work Rules

- For Control UI changes, inspect current layout/render structure first.
- Reuse existing menu/data definitions instead of hardcoding duplicate navigation.
- Keep responsive behavior intact unless the task explicitly changes it.
- Prefer building from `C:\platform-agent\ui`.
- If wrapper scripts from repo root and direct `ui` builds disagree, trust direct `ui` verification first and report the mismatch.

## Testing

Use the narrowest meaningful tests first.

Common commands:

- `corepack pnpm test <path-or-filter>`
- `corepack pnpm build`
- `corepack pnpm --dir ui test <path-or-filter>`
- `corepack pnpm --dir ui build`
- `git diff --check`

If tests cannot be run, explain why and give the smallest useful verification result instead.

## Deployment Caveat

Company runtime may differ from local because of:

- stale `dist`
- stale container image
- mounted config/state/workspace
- wrong config path
- different deployed artifact

For company-only failures, check the active image, config, mounts, state directory, and runtime artifact before proposing logic fixes.

## Commit Rule

- Work on the current user-selected branch unless explicitly told otherwise.
- Follow the same branch/commit workflow already being used in this repo.
- Do not create a commit until the user explicitly approves it in chat.

## Final Response

Report concisely:

- What changed
- Files touched
- Tests/checks run
- Tests/checks not run
- Remaining risks or deployment caveats
