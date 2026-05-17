---
title: "TOOLS.md Template"
summary: "Workspace template for TOOLS.md"
read_when:
  - Bootstrapping a workspace manually
---

# TOOLS.md - PlatformClaw Local Notes

This file is for company-specific operating notes that are safe and useful for this agent.
Skills define how tools work. `TOOLS.md` records which internal tools, projects, aliases, and conventions matter in this workspace.

## What Goes Here

Use this file for practical details such as:

- Skill locations and which skills to prefer for Jira, Confluence, Gerrit, builds, or release work
- Internal service aliases, non-secret URLs, and dashboard names
- Repository locations, Gerrit remotes, branch naming conventions, and review flow notes
- Common commands for this workspace, including safe build/test commands
- Project-specific terminology, owners, and escalation notes
- Known limitations of the company model/API, network, certificate, proxy, or Docker environment

Do not store secrets, tokens, passwords, private keys, or credentials here.

## Recommended Sections

```markdown
### Skills

- Bundled skills: built into PlatformClaw/OpenClaw. Use them when they best match the task.
- Global skills: shared company-wide skills for common internal systems.
- Location: `~/.openclaw/skills`
- Workspace skills: project/team-specific skills stored in this workspace.
- Jira: use the global Jira skill before shell fallbacks.
- Confluence: use the global Confluence skill before shell fallbacks.
- Gerrit: use the most specific visible Gerrit skill or workspace note before inventing commands.
- For git/review tasks, check whether this repository uses Gerrit before assuming GitHub.

### Repositories

- Add frequently used repositories here.
- Example: `<repo-name> -> ~/work/<repo-name>`

### Common Commands

- Unit tests: pnpm test <path>
- Type check: pnpm tsgo --noEmit --pretty false
- Build image: ./build-openclaw-images-v2.sh
```

## PlatformClaw Notes

- Knox and PlatformClaw Web are the primary user surfaces in this deployment.
- Cron, reminders, and scheduled work should preserve the originating agent/session.
- Bundled, Global, and workspace skills are all valid. Choose the most specific visible skill for the task.
- Global skills are shared company-wide skills loaded from configured global skill directories. The default company/global skill location is `~/.openclaw/skills`.
- Workspace skills are agent/workspace-specific skills stored in this workspace. Use them for project-specific workflows or team-local conventions.
- Jira and Confluence commands should use Global skills when available.
- If both Global and workspace skills apply, prefer the most specific skill for the task.
- If a required internal tool is missing, explain the exact missing command or skill instead of guessing.

Keep this file concise. It should help the agent act correctly without bloating every prompt.
