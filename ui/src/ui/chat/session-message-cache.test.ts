import { describe, expect, it } from "vitest";
import {
  appendChatMessageToCache,
  cacheChatMessages,
  readChatMessagesFromCache,
  type ChatMessageCache,
} from "./session-message-cache.ts";

describe("session message cache", () => {
  it("keeps session caches isolated by session key", () => {
    const cache: ChatMessageCache = new Map();
    cacheChatMessages(cache, "agent:ops:main", ["ops"]);
    cacheChatMessages(cache, "agent:sales:main", ["sales"]);

    expect(readChatMessagesFromCache(cache, "agent:ops:main")).toEqual(["ops"]);
    expect(readChatMessagesFromCache(cache, "agent:sales:main")).toEqual(["sales"]);
  });

  it("bounds cached sessions and messages", () => {
    const cache: ChatMessageCache = new Map();
    for (let index = 0; index < 20; index += 1) {
      cacheChatMessages(cache, `session-${index}`, [index]);
    }

    readChatMessagesFromCache(cache, "session-0");
    cacheChatMessages(cache, "session-20", [20]);
    cacheChatMessages(
      cache,
      "large",
      Array.from({ length: 101 }, (_, index) => index),
    );

    expect(cache.size).toBe(20);
    expect(cache.has("session-0")).toBe(true);
    expect(cache.has("session-1")).toBe(false);
    expect(readChatMessagesFromCache(cache, "large")).toHaveLength(100);
    expect(readChatMessagesFromCache(cache, "large")[0]).toBe(1);
  });

  it("appends messages without mutating returned cached arrays", () => {
    const cache: ChatMessageCache = new Map();
    cacheChatMessages(cache, "main", ["first"]);
    const read = readChatMessagesFromCache(cache, "main");
    read.push("local mutation");

    appendChatMessageToCache(cache, "main", "second");

    expect(readChatMessagesFromCache(cache, "main")).toEqual(["first", "second"]);
  });
});
