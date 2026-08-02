import { describe, expect, it } from "vitest";
import { createUserMcpGuardedFetch } from "./user-mcp-fetch.js";

describe("user MCP guarded fetch", () => {
  it("rejects private destinations before opening a connection", async () => {
    const guarded = createUserMcpGuardedFetch("http://127.0.0.1/mcp", {});
    await expect(guarded.fetch("http://127.0.0.1/mcp")).rejects.toThrow(/private|internal/i);
    await guarded.dispose();
  });

  it("rejects cross-origin endpoints and redirects", async () => {
    const guarded = createUserMcpGuardedFetch("https://example.com/mcp", {});
    await expect(guarded.fetch("https://other.example/mcp")).rejects.toThrow("cross-origin");
    await guarded.dispose();
  });
});
