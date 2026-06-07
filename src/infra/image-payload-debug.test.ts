import { describe, expect, it } from "vitest";
import { summarizeImagePayload } from "./image-payload-debug.js";

describe("summarizeImagePayload", () => {
  it("classifies raw base64 payloads", () => {
    expect(summarizeImagePayload("QUJDRA==")).toMatchObject({
      kind: "base64",
      length: 8,
    });
  });

  it("classifies blob URLs", () => {
    expect(summarizeImagePayload("blob:https://example.test/123")).toMatchObject({
      kind: "blob-url",
    });
  });

  it("classifies data URLs separately from raw base64", () => {
    expect(summarizeImagePayload("data:image/png;base64,QUJDRA==")).toMatchObject({
      kind: "data-url-base64",
      mimeType: "image/png",
    });
  });

  it("flags invalid base64-like strings", () => {
    expect(summarizeImagePayload("not_base64!!!")).toMatchObject({
      kind: "base64-invalid",
    });
  });
});
