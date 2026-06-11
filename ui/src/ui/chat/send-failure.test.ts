import { describe, expect, it } from "vitest";
import { describeChatFailure } from "./send-failure.ts";

describe("describeChatFailure", () => {
  it("uses the structured server code when available", () => {
    expect(describeChatFailure("overloaded", "opaque provider error", true)).toMatchObject({
      code: "overloaded",
      retryable: true,
      title: expect.stringContaining("사용량"),
    });
  });

  it("infers common timeout messages without exposing provider details", () => {
    const result = describeChatFailure(undefined, "ETIMEDOUT calling internal-provider-17");
    expect(result).toMatchObject({
      code: "timeout",
      retryable: true,
    });
    expect(result.title).not.toContain("internal-provider-17");
    expect(result.detail).not.toContain("internal-provider-17");
  });

  it("does not recommend retrying configuration failures", () => {
    expect(describeChatFailure("model_not_found")).toMatchObject({
      code: "model_not_found",
      retryable: false,
    });
  });
});
