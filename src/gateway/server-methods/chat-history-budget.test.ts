import { describe, expect, it } from "vitest";
import { enforceChatHistoryFinalBudget } from "./chat.js";

type DisplayMessage = {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
};

function firstText(messages: unknown[]): string {
  const msg = messages[0] as DisplayMessage | undefined;
  return msg?.content?.[0]?.text ?? "";
}

describe("enforceChatHistoryFinalBudget", () => {
  it("passes through history that already fits the budget", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "hello" }] },
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
    ];
    const result = enforceChatHistoryFinalBudget({ messages, maxBytes: 1_000_000 });
    expect(result.messages).toEqual(messages);
    expect(result.placeholderCount).toBe(0);
  });

  it("returns the empty array unchanged for empty input", () => {
    const result = enforceChatHistoryFinalBudget({ messages: [], maxBytes: 10 });
    expect(result.messages).toEqual([]);
    expect(result.placeholderCount).toBe(0);
  });

  it("keeps just the last message when full history is over budget but the last fits", () => {
    const big = { role: "user", content: [{ type: "text", text: "x".repeat(4000) }] };
    const last = { role: "assistant", content: [{ type: "text", text: "ok" }] };
    const result = enforceChatHistoryFinalBudget({ messages: [big, last], maxBytes: 2_000 });
    expect(result.messages).toEqual([last]);
    expect(result.placeholderCount).toBe(0);
  });

  it("falls back to an oversized placeholder when even the last message is too large", () => {
    const last = {
      role: "assistant",
      timestamp: 1,
      content: [{ type: "text", text: "y".repeat(4000) }],
      __openclaw: { id: "abc", seq: 7 },
    };
    const result = enforceChatHistoryFinalBudget({ messages: [last], maxBytes: 2_000 });
    expect(result.messages).toHaveLength(1);
    expect(firstText(result.messages)).toContain("chat.history omitted: message too large");
    expect(result.placeholderCount).toBe(1);
  });

  it("returns a metadata-free sentinel instead of an empty transcript when the placeholder exceeds budget", () => {
    const message = {
      role: "user",
      timestamp: 1,
      content: [{ type: "text", text: "hi" }],
      __openclaw: { id: "z".repeat(4000), seq: 1 },
    };
    const result = enforceChatHistoryFinalBudget({ messages: [message], maxBytes: 10 });

    expect(result.messages).toHaveLength(1);
    expect(firstText(result.messages)).toContain("chat.history unavailable");
    expect((result.messages[0] as Record<string, unknown>)["__openclaw"]).toBeUndefined();
    expect(result.placeholderCount).toBe(1);
  });
});
