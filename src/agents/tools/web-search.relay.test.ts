import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FetchMock, withFetchPreconnect } from "../../test-utils/fetch-mock.js";

const {
  resolveManifestContractOwnerPluginIdMock,
  resolveWebSearchDefinitionMock,
  runWebSearchMock,
} = vi.hoisted(() => ({
  resolveManifestContractOwnerPluginIdMock: vi.fn(() => null),
  resolveWebSearchDefinitionMock: vi.fn(),
  runWebSearchMock: vi.fn(),
}));

vi.mock("../../plugins/manifest-registry.js", () => ({
  resolveManifestContractOwnerPluginId: resolveManifestContractOwnerPluginIdMock,
}));

vi.mock("../../web-search/runtime.js", () => ({
  resolveWebSearchDefinition: resolveWebSearchDefinitionMock,
  resolveWebSearchProviderId: vi.fn(() => "mock"),
  runWebSearch: runWebSearchMock,
}));

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    headers: {
      get: (key: string) => (key.toLowerCase() === "content-type" ? "application/json" : null),
    },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function setMockFetch(
  impl: FetchMock = async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse({}),
) {
  const fetchSpy = vi.fn(impl);
  global.fetch = withFetchPreconnect(fetchSpy);
  return fetchSpy;
}

async function createTool() {
  const { createWebSearchTool } = await import("./web-search.js");
  return createWebSearchTool({
    config: {
      tools: {
        web: {
          search: {
            cacheTtlMinutes: 0,
          },
        },
      },
    },
  });
}

describe("web_search relay", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    resolveWebSearchDefinitionMock.mockReset();
    runWebSearchMock.mockReset();
    resolveWebSearchDefinitionMock.mockReturnValue({
      provider: { id: "mock" },
      definition: {
        description: "mock search",
        parameters: {},
      },
    });
  });

  afterEach(() => {
    global.fetch = priorFetch;
    vi.unstubAllEnvs();
  });

  it("uses the relay when WEB_SEARCH_RELAY_URL is set even without a configured provider", async () => {
    resolveWebSearchDefinitionMock.mockReturnValue(null);
    const fetchSpy = setMockFetch().mockResolvedValue(
      jsonResponse({
        provider: "searxng",
        query: "openclaw",
        results: [
          {
            title: "OpenClaw",
            url: "https://openclaw.ai",
            description: "docs",
          },
        ],
      }),
    );
    vi.stubEnv("WEB_SEARCH_RELAY_URL", "http://127.0.0.1:8765/search");
    vi.stubEnv("WEB_SEARCH_RELAY_TOKEN", "relay-secret");

    const tool = await createTool();
    const result = await tool?.execute?.("call", { query: "openclaw", count: 5 });

    expect(tool).not.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [input, init] = fetchSpy.mock.calls[0] ?? [];
    expect(String(input)).toBe("http://127.0.0.1:8765/search");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-token": "relay-secret",
      },
      body: JSON.stringify({ query: "openclaw", count: 5 }),
    });
    expect(runWebSearchMock).not.toHaveBeenCalled();
    expect(result?.details).toMatchObject({
      provider: "searxng",
      query: "openclaw",
      results: [{ title: "OpenClaw", url: "https://openclaw.ai", description: "docs" }],
    });
  });

  it("keeps the default runtime path when the relay env var is unset", async () => {
    runWebSearchMock.mockResolvedValue({
      provider: "mock",
      result: {
        query: "default-path",
        results: [],
      },
    });

    const tool = await createTool();
    const result = await tool?.execute?.("call", { query: "default-path" });

    expect(runWebSearchMock).toHaveBeenCalledTimes(1);
    expect(result?.details).toMatchObject({
      provider: "mock",
      query: "default-path",
      results: [],
    });
  });
});
