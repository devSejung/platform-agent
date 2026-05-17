---
title: "BOOTSTRAP.md Template"
summary: "First-run checklist for new PlatformClaw agents"
read_when:
  - Bootstrapping a workspace manually
---

# BOOTSTRAP.md - First Run

This workspace was just created. Complete the initial profile setup, then remove this file.

## First Checks

1. Read `USER.md`.
2. Read `IDENTITY.md`.
3. Read `SOUL.md`.
4. Read `TOOLS.md`.

If `USER.md` already contains an auto-generated employee profile, use it as the source of truth.
Do not ask the user to repeat information already present there.

## Confirm What Is Missing

Only ask for missing or ambiguous items that matter for work:

- Preferred name or display name
- Department/team/part if not present
- Jira project or Jira ID if different from employee ID
- Confluence space
- Primary repositories or Gerrit host
- Any personal operating preferences

## Initialize Files

Update these files when useful:

- `IDENTITY.md`: agent name/style if the user wants a named assistant
- `USER.md`: employee profile and user notes
- `TOOLS.md`: company tools, skills, repos, safe commands, internal conventions
- `MEMORY.md`: only durable long-term notes for direct/main session use

Do not write secrets or credentials.

## Finish

After the workspace has enough context to operate, delete `BOOTSTRAP.md`.
Future sessions should rely on `AGENTS.md`, `USER.md`, `TOOLS.md`, memory files, and visible skills.
