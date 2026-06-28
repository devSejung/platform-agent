import path from "node:path";
import { resolveRotatedGeneratedSessionFilePath, resolveSessionFilePath } from "./paths.js";
import { updateSessionStore } from "./store.js";
import type { SessionEntry } from "./types.js";

export async function resolveAndPersistSessionFile(params: {
  sessionId: string;
  sessionKey: string;
  sessionStore: Record<string, SessionEntry>;
  storePath: string;
  sessionEntry?: SessionEntry;
  agentId?: string;
  sessionsDir?: string;
  fallbackSessionFile?: string;
  activeSessionKey?: string;
}): Promise<{ sessionFile: string; sessionEntry: SessionEntry }> {
  const { sessionId, sessionKey, sessionStore, storePath } = params;
  const baseEntry = params.sessionEntry ??
    sessionStore[sessionKey] ?? { sessionId, updatedAt: Date.now() };
  const fallbackSessionFile = params.fallbackSessionFile?.trim();
  const entryForResolve =
    !baseEntry.sessionFile && fallbackSessionFile
      ? { ...baseEntry, sessionFile: fallbackSessionFile }
      : baseEntry;
  const sessionPathOptions = {
    agentId: params.agentId,
    sessionsDir: params.sessionsDir,
  };
  const sessionsDirForRotation = params.sessionsDir ?? path.dirname(storePath);
  const rotatedSessionFile = resolveRotatedGeneratedSessionFilePath({
    previousSessionId: baseEntry.sessionId,
    nextSessionId: sessionId,
    previousSessionFile: baseEntry.sessionFile,
    sessionsDir: sessionsDirForRotation,
    agentId: params.agentId,
  });
  const sessionFile =
    rotatedSessionFile ?? resolveSessionFilePath(sessionId, entryForResolve, sessionPathOptions);
  const persistedEntry: SessionEntry = {
    ...baseEntry,
    sessionId,
    updatedAt: Date.now(),
    sessionFile,
  };
  if (baseEntry.sessionId !== sessionId || baseEntry.sessionFile !== sessionFile) {
    sessionStore[sessionKey] = persistedEntry;
    await updateSessionStore(
      storePath,
      (store) => {
        store[sessionKey] = {
          ...store[sessionKey],
          ...persistedEntry,
        };
      },
      params.activeSessionKey ? { activeSessionKey: params.activeSessionKey } : undefined,
    );
    return { sessionFile, sessionEntry: persistedEntry };
  }
  sessionStore[sessionKey] = persistedEntry;
  return { sessionFile, sessionEntry: persistedEntry };
}
