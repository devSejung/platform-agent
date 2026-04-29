import { describe, expect, it } from "vitest";
import type { SkillStatusEntry } from "../types.ts";
import { groupSkills } from "./skills-grouping.ts";

function makeSkill(
  name: string,
  source: string,
  overrides: Partial<SkillStatusEntry> = {},
): SkillStatusEntry {
  return {
    name,
    description: `${name} description`,
    source,
    bundled: source === "openclaw-bundled",
    filePath: `/tmp/${name}/SKILL.md`,
    baseDir: `/tmp/${name}`,
    skillKey: name,
    always: false,
    disabled: false,
    blockedByAllowlist: false,
    eligible: true,
    requirements: { bins: [], env: [], config: [], os: [] },
    missing: { bins: [], env: [], config: [], os: [] },
    configChecks: [],
    install: [],
    ...overrides,
  };
}

describe("groupSkills", () => {
  it("places global skills below workspace and above built-in", () => {
    const groups = groupSkills([
      makeSkill("workspace-skill", "openclaw-workspace"),
      makeSkill("global-skill", "agents-skills-personal"),
      makeSkill("managed-skill", "openclaw-managed"),
      makeSkill("builtin-skill", "openclaw-bundled"),
    ]);

    expect(groups.map((group) => group.id)).toEqual(["workspace", "global", "built-in"]);
    expect(groups[1]?.label).toBe("Global Skills");
    expect(groups[1]?.skills.map((skill) => skill.name)).toEqual([
      "global-skill",
      "managed-skill",
    ]);
  });
});
