import {
  SSEClientTransport,
  type SSEClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { getUserMcpAdminPolicy } from "../accounts/user-mcp-store.js";
import { loadUndiciRuntimeDeps } from "../infra/net/undici-runtime.js";
import { logDebug } from "../logger.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { isMcpConfigRecord } from "./mcp-config-shared.js";
import { resolveMcpTransportConfig } from "./mcp-transport-config.js";
import { createUserMcpGuardedFetch } from "./user-mcp-fetch.js";

export type ResolvedMcpTransport = {
  transport: Transport;
  description: string;
  transportType: "stdio" | "sse" | "streamable-http";
  connectionTimeoutMs: number;
  detachStderr?: () => void;
  disposeTransportResources?: () => Promise<void>;
};

function resolveUserMcpFetch(rawServer: unknown, url: string) {
  if (!isMcpConfigRecord(rawServer) || !isMcpConfigRecord(rawServer.__platformclawUserMcp)) {
    return undefined;
  }
  const policy = getUserMcpAdminPolicy();
  return createUserMcpGuardedFetch(url, {
    dangerouslyAllowPrivateNetwork: policy.allowPrivateNetwork,
    allowedHostnames: policy.allowedHostnames,
  });
}

function attachStderrLogging(serverName: string, transport: StdioClientTransport) {
  const stderr = transport.stderr;
  if (!stderr || typeof stderr.on !== "function") {
    return undefined;
  }
  const onData = (chunk: Buffer | string) => {
    const message =
      normalizeOptionalString(typeof chunk === "string" ? chunk : String(chunk)) ?? "";
    if (!message) {
      return;
    }
    for (const line of message.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) {
        logDebug(`bundle-mcp:${serverName}: ${trimmed}`);
      }
    }
  };
  stderr.on("data", onData);
  return () => {
    if (typeof stderr.off === "function") {
      stderr.off("data", onData);
    } else if (typeof stderr.removeListener === "function") {
      stderr.removeListener("data", onData);
    }
  };
}

type SseEventSourceFetch = NonNullable<
  NonNullable<SSEClientTransportOptions["eventSourceInit"]>["fetch"]
>;

const fetchWithUndici: FetchLike = async (url, init) =>
  (await loadUndiciRuntimeDeps().fetch(
    url,
    init as Parameters<ReturnType<typeof loadUndiciRuntimeDeps>["fetch"]>[1],
  )) as unknown as Response;

function buildSseEventSourceFetch(
  headers: Record<string, string>,
  fetchImpl: FetchLike = fetchWithUndici,
): SseEventSourceFetch {
  return (url: string | URL, init?: RequestInit) => {
    const sdkHeaders: Record<string, string> = {};
    if (init?.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((value, key) => {
          sdkHeaders[key] = value;
        });
      } else {
        Object.assign(sdkHeaders, init.headers);
      }
    }
    return fetchImpl(url, {
      ...(init as RequestInit),
      headers: { ...sdkHeaders, ...headers },
    }) as ReturnType<SseEventSourceFetch>;
  };
}

export function resolveMcpTransport(
  serverName: string,
  rawServer: unknown,
): ResolvedMcpTransport | null {
  const resolved = resolveMcpTransportConfig(serverName, rawServer);
  if (!resolved) {
    return null;
  }
  if (resolved.kind === "stdio") {
    const transport = new StdioClientTransport({
      command: resolved.command,
      args: resolved.args,
      env: resolved.env,
      cwd: resolved.cwd,
      stderr: "pipe",
    });
    return {
      transport,
      description: resolved.description,
      transportType: "stdio",
      connectionTimeoutMs: resolved.connectionTimeoutMs,
      detachStderr: attachStderrLogging(serverName, transport),
    };
  }
  if (resolved.transportType === "streamable-http") {
    const guarded = resolveUserMcpFetch(rawServer, resolved.url);
    return {
      transport: new StreamableHTTPClientTransport(new URL(resolved.url), {
        requestInit: resolved.headers ? { headers: resolved.headers } : undefined,
        fetch: guarded?.fetch,
      }),
      description: resolved.description,
      transportType: "streamable-http",
      connectionTimeoutMs: resolved.connectionTimeoutMs,
      disposeTransportResources: guarded ? () => guarded.dispose() : undefined,
    };
  }
  const headers: Record<string, string> = {
    ...resolved.headers,
  };
  const hasHeaders = Object.keys(headers).length > 0;
  const guarded = resolveUserMcpFetch(rawServer, resolved.url);
  const guardedFetch = guarded?.fetch ?? fetchWithUndici;
  return {
    transport: new SSEClientTransport(new URL(resolved.url), {
      requestInit: hasHeaders ? { headers } : undefined,
      fetch: guardedFetch,
      eventSourceInit: {
        fetch: hasHeaders ? buildSseEventSourceFetch(headers, guardedFetch) : guardedFetch,
      },
    }),
    description: resolved.description,
    transportType: "sse",
    connectionTimeoutMs: resolved.connectionTimeoutMs,
    disposeTransportResources: guarded ? () => guarded.dispose() : undefined,
  };
}
