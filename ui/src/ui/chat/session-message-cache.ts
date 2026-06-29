import { getSessionCacheValue, setSessionCacheValue } from "./session-cache.ts";

const MAX_CACHED_CHAT_MESSAGES = 100;

export type ChatMessageCache = Map<string, unknown[]>;

function normalizeCacheSessionKey(sessionKey: string): string {
  return sessionKey.trim() || "main";
}

export function cacheChatMessages(
  cache: ChatMessageCache,
  sessionKey: string,
  messages: unknown[],
): void {
  const cacheKey = normalizeCacheSessionKey(sessionKey);
  if (messages.length === 0) {
    cache.delete(cacheKey);
    return;
  }
  setSessionCacheValue(cache, cacheKey, messages.slice(-MAX_CACHED_CHAT_MESSAGES));
}

export function appendChatMessageToCache(
  cache: ChatMessageCache,
  sessionKey: string,
  message: unknown,
): void {
  const cacheKey = normalizeCacheSessionKey(sessionKey);
  const messages = getSessionCacheValue(cache, cacheKey) ?? [];
  cacheChatMessages(cache, cacheKey, [...messages, message]);
}

export function readChatMessagesFromCache(cache: ChatMessageCache, sessionKey: string): unknown[] {
  const cacheKey = normalizeCacheSessionKey(sessionKey);
  return [...(getSessionCacheValue(cache, cacheKey) ?? [])];
}
