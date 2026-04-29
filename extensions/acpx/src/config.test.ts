import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAcpxPluginConfig, resolveAcpxPluginRoot } from "./config.js";

afterEach(() => {
  delete process.env.OPENCLAW_ACPX_CODEX_COMMAND;
  delete process.env.OPENCLAW_ACPX_CLAUDE_COMMAND;
  vi.restoreAllMocks();
});

describe("embedded acpx plugin config", () => {
  it("resolves workspace stateDir and cwd by default", () => {
    const workspaceDir = "/tmp/openclaw-acpx";
    const resolved = resolveAcpxPluginConfig({
      rawConfig: undefined,
      workspaceDir,
    });

    expect(resolved.cwd).toBe(workspaceDir);
    expect(resolved.stateDir).toBe(path.join(workspaceDir, "state"));
    expect(resolved.permissionMode).toBe("approve-reads");
    expect(resolved.nonInteractivePermissions).toBe("fail");
    expect(resolved.agents).toEqual({});
  });

  it("accepts agent command overrides", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: {
        agents: {
          claude: { command: "claude --acp" },
          codex: { command: "codex custom-acp" },
        },
      },
      workspaceDir: "/tmp/openclaw-acpx",
    });

    expect(resolved.agents).toEqual({
      claude: "claude --acp",
      codex: "codex custom-acp",
    });
  });

  it("auto-detects bundled agent binaries on PATH", () => {
    vi.spyOn(fs, "existsSync").mockImplementation((target) => {
      const candidate = String(target);
      return candidate.endsWith(`${path.sep}codex-acp`) || candidate.endsWith(`${path.sep}claude-agent-acp`);
    });
    const originalPath = process.env.PATH;
    process.env.PATH = ["/opt/openclaw-acp/bin", "/usr/local/bin"].join(path.delimiter);

    const resolved = resolveAcpxPluginConfig({
      rawConfig: undefined,
      workspaceDir: "/tmp/openclaw-acpx",
    });

    expect(resolved.agents).toEqual({
      claude: path.join("/opt/openclaw-acp/bin", "claude-agent-acp"),
      codex: path.join("/opt/openclaw-acp/bin", "codex-acp"),
    });

    process.env.PATH = originalPath;
  });

  it("prefers explicit env overrides over PATH detection", () => {
    process.env.OPENCLAW_ACPX_CODEX_COMMAND = "/custom/codex-acp";
    vi.spyOn(fs, "existsSync").mockImplementation((target) => {
      const candidate = String(target);
      return candidate.endsWith(`${path.sep}codex-acp`);
    });
    const originalPath = process.env.PATH;
    process.env.PATH = ["/usr/local/bin"].join(path.delimiter);

    const resolved = resolveAcpxPluginConfig({
      rawConfig: undefined,
      workspaceDir: "/tmp/openclaw-acpx",
    });

    expect(resolved.agents.codex).toBe("/custom/codex-acp");

    process.env.PATH = originalPath;
  });

  it("injects the built-in plugin-tools MCP server only when explicitly enabled", () => {
    const resolved = resolveAcpxPluginConfig({
      rawConfig: {
        pluginToolsMcpBridge: true,
      },
      workspaceDir: "/tmp/openclaw-acpx",
    });

    const server = resolved.mcpServers["openclaw-plugin-tools"];
    expect(server).toBeDefined();
    expect(server.command).toBe(process.execPath);
    expect(Array.isArray(server.args)).toBe(true);
    expect(server.args?.length).toBeGreaterThan(0);
  });

  it("keeps the runtime json schema in sync with the manifest config schema", () => {
    const pluginRoot = resolveAcpxPluginRoot();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(pluginRoot, "openclaw.plugin.json"), "utf8"),
    ) as { configSchema?: unknown };

    expect(manifest.configSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: expect.objectContaining({
        cwd: expect.any(Object),
        stateDir: expect.any(Object),
        agents: expect.any(Object),
        mcpServers: expect.any(Object),
      }),
    });
  });
});
