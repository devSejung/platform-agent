import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";
import { connectOk, installGatewayTestHooks, rpcReq } from "./test-helpers.js";
import { withServer } from "./test-with-server.js";

installGatewayTestHooks({ scope: "suite" });

describe("gateway skills.status", () => {
  it("does not expose raw config values to operator.read clients", async () => {
    await withEnvAsync(
      { OPENCLAW_BUNDLED_SKILLS_DIR: path.join(process.cwd(), "skills") },
      async () => {
        const secret = "discord-token-secret-abc"; // pragma: allowlist secret
        const { writeConfigFile } = await import("../config/config.js");
        await writeConfigFile({
          session: { mainKey: "main-test" },
          channels: {
            discord: {
              token: secret,
            },
          },
        });

        await withServer(async (ws) => {
          await connectOk(ws, { token: "secret", scopes: ["operator.read"] });
          const res = await rpcReq<{
            skills?: Array<{
              name?: string;
              configChecks?: Array<
                { path?: string; satisfied?: boolean } & Record<string, unknown>
              >;
            }>;
          }>(ws, "skills.status", {});

          expect(res.ok).toBe(true);
          expect(JSON.stringify(res.payload)).not.toContain(secret);

          const discord = res.payload?.skills?.find((s) => s.name === "discord");
          expect(discord).toBeTruthy();
          const check = discord?.configChecks?.find((c) => c.path === "channels.discord.token");
          expect(check).toBeTruthy();
          expect(check?.satisfied).toBe(true);
          expect(check && "value" in check).toBe(false);
        });
      },
    );
  });

  it("supports fallback workspace resolution for unknown agent ids", async () => {
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-skills-status-"));
    const workspacesRoot = path.join(tmpRoot, "workspaces");
    const agentId = "knox_user";
    const skillDir = path.join(workspacesRoot, agentId, "skills", "demo-skill");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      [
        "---",
        "name: Demo Skill",
        "description: Demo fallback workspace skill",
        "---",
        "",
        "# Demo Skill",
        "",
        "Used for fallback workspace tests.",
      ].join("\n"),
      "utf8",
    );

    await withEnvAsync({}, async () => {
      const { writeConfigFile } = await import("../config/config.js");
      await writeConfigFile({
        agents: {
          defaults: {
            workspace: workspacesRoot,
          },
        },
      });

      await withServer(async (ws) => {
        await connectOk(ws, { token: "secret", scopes: ["operator.read"] });
        const res = await rpcReq<{
          workspaceDir?: string;
          skills?: Array<{
            name?: string;
            description?: string;
            source?: string;
          }>;
        }>(ws, "skills.status", { agentId });

        expect(res.ok).toBe(true);
        expect(res.payload?.workspaceDir).toBe(path.join(workspacesRoot, agentId));
        expect(res.payload?.skills?.some((skill) => skill.name === "Demo Skill")).toBe(true);
      });
    });
  });
});
