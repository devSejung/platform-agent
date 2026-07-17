import type { IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import type { GatewayClientInfo } from "./protocol/client-info.js";
import { resolveTrustedHttpSenderId, resolveTrustedWsSenderId } from "./sender-override.js";

function makeBackendClient(id: GatewayClientInfo["id"]): GatewayClientInfo {
  return {
    id,
    version: "1.0.0",
    platform: "test",
    mode: "backend",
  };
}

describe("sender override trust gates", () => {
  const previousTrustedClients = process.env.OPENCLAW_TRUSTED_SENDER_CLIENT_IDS;
  const previousTrustedHeader = process.env.OPENCLAW_TRUST_HTTP_SENDER_HEADER;

  afterEach(() => {
    if (previousTrustedClients === undefined) {
      delete process.env.OPENCLAW_TRUSTED_SENDER_CLIENT_IDS;
    } else {
      process.env.OPENCLAW_TRUSTED_SENDER_CLIENT_IDS = previousTrustedClients;
    }
    if (previousTrustedHeader === undefined) {
      delete process.env.OPENCLAW_TRUST_HTTP_SENDER_HEADER;
    } else {
      process.env.OPENCLAW_TRUST_HTTP_SENDER_HEADER = previousTrustedHeader;
    }
  });

  it("accepts senderId overrides only from allowlisted backend websocket clients", () => {
    process.env.OPENCLAW_TRUSTED_SENDER_CLIENT_IDS = "gateway-client, knox-adapter";
    expect(
      resolveTrustedWsSenderId({
        clientInfo: makeBackendClient("gateway-client"),
        senderId: "hyeonho.jung",
      }),
    ).toEqual({
      senderId: "hyeonho.jung",
      trusted: true,
      present: true,
      invalid: false,
    });
    expect(
      resolveTrustedWsSenderId({
        clientInfo: makeBackendClient("gateway-client"),
        senderId: "x".repeat(257),
      }),
    ).toEqual({
      senderId: undefined,
      trusted: true,
      present: true,
      invalid: true,
    });
  });

  it("ignores senderId overrides from non-allowlisted or non-backend websocket clients", () => {
    process.env.OPENCLAW_TRUSTED_SENDER_CLIENT_IDS = "knox-adapter";
    expect(
      resolveTrustedWsSenderId({
        clientInfo: makeBackendClient("gateway-client"),
        senderId: "hyeonho.jung",
      }),
    ).toEqual({
      senderId: undefined,
      trusted: false,
      present: true,
      invalid: false,
    });
    expect(
      resolveTrustedWsSenderId({
        clientInfo: {
          ...makeBackendClient("gateway-client"),
          mode: "ui",
        },
        senderId: "hyeonho.jung",
      }),
    ).toEqual({
      senderId: undefined,
      trusted: false,
      present: true,
      invalid: false,
    });
  });

  it("trusts HTTP sender headers only when explicitly enabled", () => {
    const req = {
      headers: {
        "x-openclaw-sender-id": "hyeonho.jung",
      },
    } as unknown as IncomingMessage;
    delete process.env.OPENCLAW_TRUST_HTTP_SENDER_HEADER;
    expect(resolveTrustedHttpSenderId(req)).toEqual({
      senderId: undefined,
      trusted: false,
      present: true,
      invalid: false,
    });
    process.env.OPENCLAW_TRUST_HTTP_SENDER_HEADER = "true";
    expect(resolveTrustedHttpSenderId(req)).toEqual({
      senderId: "hyeonho.jung",
      trusted: true,
      present: true,
      invalid: false,
    });
  });

  it("treats falsy HTTP trust env values as disabled and truthy values as enabled", () => {
    const req = {
      headers: {
        "x-openclaw-sender-id": "hyeonho.jung",
      },
    } as unknown as IncomingMessage;

    for (const value of [undefined, "", "false", "0", "off"] as const) {
      if (value === undefined) {
        delete process.env.OPENCLAW_TRUST_HTTP_SENDER_HEADER;
      } else {
        process.env.OPENCLAW_TRUST_HTTP_SENDER_HEADER = value;
      }
      expect(resolveTrustedHttpSenderId(req)).toEqual({
        senderId: undefined,
        trusted: false,
        present: true,
        invalid: false,
      });
    }

    for (const value of ["true", "1", "on", "yes"] as const) {
      process.env.OPENCLAW_TRUST_HTTP_SENDER_HEADER = value;
      expect(resolveTrustedHttpSenderId(req)).toEqual({
        senderId: "hyeonho.jung",
        trusted: true,
        present: true,
        invalid: false,
      });
    }
  });

  it("flags invalid trusted HTTP sender headers", () => {
    process.env.OPENCLAW_TRUST_HTTP_SENDER_HEADER = "1";
    const req = {
      headers: {
        "x-openclaw-sender-id": "x".repeat(257),
      },
    } as unknown as IncomingMessage;
    expect(resolveTrustedHttpSenderId(req)).toEqual({
      senderId: undefined,
      trusted: true,
      present: true,
      invalid: true,
    });
  });
});
