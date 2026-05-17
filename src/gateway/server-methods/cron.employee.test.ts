import { describe, expect, it, vi } from "vitest";
import { cronHandlers } from "./cron.js";

describe("employee cron handlers", () => {
  it("assigns employee agentId when an employee creates a cron job without explicit ownership", async () => {
    const add = vi.fn(async (job: unknown) => job);
    const respond = vi.fn();

    await cronHandlers["cron.add"]({
      params: {
        name: "employee job",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "hello" },
      },
      respond,
      context: {
        cron: { add },
        logGateway: { info: vi.fn() },
      },
      client: {
        connect: { role: "employee" },
        internal: { employee: { agentId: "eon" } },
      },
    } as never);

    expect(add).toHaveBeenCalledWith(expect.objectContaining({ agentId: "eon" }));
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ agentId: "eon" }),
      undefined,
    );
  });

  it("converts employee main systemEvent cron to isolated origin job for dynamic agents", async () => {
    const add = vi.fn(async (job: unknown) => job);
    const respond = vi.fn();

    await cronHandlers["cron.add"]({
      params: {
        name: "employee reminder",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        sessionKey: "agent:eon:main",
        payload: { kind: "systemEvent", text: "tell me the time" },
      },
      respond,
      context: {
        cron: { add },
        logGateway: { info: vi.fn() },
      },
      client: {
        connect: { role: "employee" },
        internal: { employee: { agentId: "eon" } },
      },
    } as never);

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "eon",
        sessionTarget: "isolated",
        payload: { kind: "agentTurn", message: "tell me the time" },
        delivery: { mode: "origin" },
      }),
    );
  });

  it("coerces manual sessions_send cron delivery workarounds to origin delivery", async () => {
    const add = vi.fn(async (job: unknown) => job);
    const respond = vi.fn();

    await cronHandlers["cron.add"]({
      params: {
        name: "bad reminder",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "isolated",
        wakeMode: "now",
        agentId: "eon",
        sessionKey: "agent:eon:main",
        payload: {
          kind: "agentTurn",
          message:
            "Use sessions_send to send exactly this text to sessionKey agent:eon:main: 1분 지났어. No extra text.",
        },
        delivery: { mode: "none" },
      },
      respond,
      context: {
        cron: { add },
        logGateway: { info: vi.fn() },
      },
      client: {
        connect: { role: "admin" },
      },
    } as never);

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "eon",
        sessionKey: "agent:eon:main",
        payload: { kind: "agentTurn", message: "1분 지났어." },
        delivery: { mode: "origin" },
      }),
    );
  });

  it("rejects employee cron creation for another agent after normalization", async () => {
    const add = vi.fn();
    const respond = vi.fn();

    await cronHandlers["cron.add"]({
      params: {
        job: {
          name: "other employee job",
          enabled: true,
          schedule: { kind: "every", everyMs: 60_000 },
          sessionTarget: "main",
          wakeMode: "next-heartbeat",
          agentId: "minji",
          payload: { kind: "systemEvent", text: "hello" },
        },
      },
      respond,
      context: {
        cron: { add },
        logGateway: { info: vi.fn() },
      },
      client: {
        connect: { role: "employee" },
        internal: { employee: { agentId: "eon" } },
      },
    } as never);

    expect(add).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: "employee access denied for cron create" }),
    );
  });

  it("rejects cron creation when agentId and sessionKey point to different agents", async () => {
    const add = vi.fn();
    const respond = vi.fn();

    await cronHandlers["cron.add"]({
      params: {
        name: "mismatched job",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "isolated",
        wakeMode: "next-heartbeat",
        agentId: "eon",
        sessionKey: "agent:minji:main",
        payload: { kind: "systemEvent", text: "hello" },
      },
      respond,
      context: {
        cron: { add },
        logGateway: { info: vi.fn() },
      },
      client: {
        connect: { role: "admin" },
      },
    } as never);

    expect(add).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "invalid cron.add params: agentId must match sessionKey agent",
      }),
    );
  });

  it("rejects backend cron creation without agentId or sessionKey", async () => {
    const add = vi.fn();
    const respond = vi.fn();

    await cronHandlers["cron.add"]({
      params: {
        name: "ownerless backend job",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "hello" },
      },
      respond,
      context: {
        cron: { add },
        logGateway: { info: vi.fn() },
      },
      client: {
        connect: {
          client: {
            id: "gateway-client",
            version: "test",
            platform: "test",
            mode: "backend",
          },
        },
      },
    } as never);

    expect(add).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message:
          "invalid cron.add params: agentId or sessionKey is required for non-global cron creation",
      }),
    );
  });

  it("rejects cli cron creation without agentId/sessionKey unless explicitly global", async () => {
    const add = vi.fn();
    const respond = vi.fn();

    await cronHandlers["cron.add"]({
      params: {
        name: "ownerless cli job",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "hello" },
      },
      respond,
      context: {
        cron: { add },
        logGateway: { info: vi.fn() },
      },
      client: {
        connect: {
          client: {
            id: "cli",
            version: "test",
            platform: "test",
            mode: "cli",
          },
        },
      },
    } as never);

    expect(add).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message:
          "invalid cron.add params: agentId or sessionKey is required for non-global cron creation",
      }),
    );
  });

  it("allows explicitly global cli cron creation", async () => {
    const add = vi.fn(async (job: unknown) => job);
    const respond = vi.fn();

    await cronHandlers["cron.add"]({
      params: {
        name: "explicit global cli job",
        global: true,
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "systemEvent", text: "hello" },
      },
      respond,
      context: {
        cron: { add },
        logGateway: { info: vi.fn() },
      },
      client: {
        connect: {
          client: {
            id: "cli",
            version: "test",
            platform: "test",
            mode: "cli",
          },
        },
      },
    } as never);

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "explicit global cli job",
        global: true,
      }),
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ name: "explicit global cli job" }),
      undefined,
    );
  });

  it("rejects origin delivery without sessionKey", async () => {
    const add = vi.fn();
    const respond = vi.fn();

    await cronHandlers["cron.add"]({
      params: {
        name: "broken origin job",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "isolated",
        wakeMode: "now",
        agentId: "eon",
        payload: { kind: "agentTurn", message: "hello" },
        delivery: { mode: "origin" },
      },
      respond,
      context: {
        cron: { add },
        logGateway: { info: vi.fn() },
      },
      client: {
        connect: { role: "admin" },
      },
    } as never);

    expect(add).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "invalid cron.add params: sessionKey is required for origin cron delivery",
      }),
    );
  });

  it("rejects last-channel announce delivery without sessionKey", async () => {
    const add = vi.fn();
    const respond = vi.fn();

    await cronHandlers["cron.add"]({
      params: {
        name: "broken last-channel job",
        enabled: true,
        schedule: { kind: "every", everyMs: 60_000 },
        sessionTarget: "isolated",
        wakeMode: "now",
        agentId: "eon",
        payload: { kind: "agentTurn", message: "hello" },
        delivery: { mode: "announce", channel: "last" },
      },
      respond,
      context: {
        cron: { add },
        logGateway: { info: vi.fn() },
      },
      client: {
        connect: { role: "admin" },
      },
    } as never);

    expect(add).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        message: "invalid cron.add params: sessionKey is required for delivery.channel=last",
      }),
    );
  });
});
