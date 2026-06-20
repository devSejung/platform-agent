import type { IncomingMessage } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeMockHttpResponse } from "./test-http-response.js";

const mocks = vi.hoisted(() => ({
  readEmployeeSession: vi.fn(),
  readSkillHubIconAsset: vi.fn(),
}));

vi.mock("./employee-web-auth.js", () => ({
  readEmployeeSession: mocks.readEmployeeSession,
}));
vi.mock("../agents/skill-hub-icon-assets.js", () => ({
  readSkillHubIconAsset: mocks.readSkillHubIconAsset,
}));

import { handleSkillHubIconHttpRequest } from "./skill-hub-icons-http.js";

const assetId = "a".repeat(64);

function request(url: string, headers: IncomingMessage["headers"] = {}): IncomingMessage {
  return { url, method: "GET", headers } as IncomingMessage;
}

describe("Skill Hub icon HTTP endpoint", () => {
  beforeEach(() => {
    mocks.readEmployeeSession.mockReset();
    mocks.readSkillHubIconAsset.mockReset();
  });

  it("requires an employee session and rejects malformed asset paths", async () => {
    let response = makeMockHttpResponse();
    expect(
      await handleSkillHubIconHttpRequest(
        request(`/api/v1/platformclaw/skillhub/icons/${assetId}.png`),
        response.res,
      ),
    ).toBe(true);
    expect(response.res.statusCode).toBe(401);
    expect(mocks.readSkillHubIconAsset).not.toHaveBeenCalled();

    mocks.readEmployeeSession.mockReturnValue({ employeeId: "eon" });
    response = makeMockHttpResponse();
    await handleSkillHubIconHttpRequest(
      request("/api/v1/platformclaw/skillhub/icons/..%2Fsecret.png"),
      response.res,
    );
    expect(response.res.statusCode).toBe(400);
    expect(mocks.readSkillHubIconAsset).not.toHaveBeenCalled();
  });

  it("serves authenticated PNG assets with immutable headers and ETag", async () => {
    mocks.readEmployeeSession.mockReturnValue({ employeeId: "eon" });
    mocks.readSkillHubIconAsset.mockResolvedValue(Buffer.from("png"));
    const response = makeMockHttpResponse();
    await handleSkillHubIconHttpRequest(
      request(`/api/v1/platformclaw/skillhub/icons/${assetId}.png`),
      response.res,
    );

    expect(response.res.statusCode).toBe(200);
    expect(response.setHeader).toHaveBeenCalledWith("Content-Type", "image/png");
    expect(response.setHeader).toHaveBeenCalledWith("X-Content-Type-Options", "nosniff");
    expect(response.setHeader).toHaveBeenCalledWith("ETag", `"${assetId}"`);
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      "private, max-age=31536000, immutable",
    );
    expect(response.end).toHaveBeenCalledWith(Buffer.from("png"));
  });

  it("returns 304 for a matching ETag and 404 for missing assets", async () => {
    mocks.readEmployeeSession.mockReturnValue({ employeeId: "eon" });
    mocks.readSkillHubIconAsset.mockResolvedValue(Buffer.from("png"));
    let response = makeMockHttpResponse();
    await handleSkillHubIconHttpRequest(
      request(`/api/v1/platformclaw/skillhub/icons/${assetId}.png`, {
        "if-none-match": `"${assetId}"`,
      }),
      response.res,
    );
    expect(response.res.statusCode).toBe(304);
    expect(mocks.readSkillHubIconAsset).toHaveBeenCalledOnce();

    mocks.readSkillHubIconAsset.mockResolvedValue(null);
    response = makeMockHttpResponse();
    await handleSkillHubIconHttpRequest(
      request(`/api/v1/platformclaw/skillhub/icons/${assetId}.png`),
      response.res,
    );
    expect(response.res.statusCode).toBe(404);
  });
});
