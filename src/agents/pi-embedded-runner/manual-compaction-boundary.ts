import fs from "node:fs/promises";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { SessionManager } from "@mariozechner/pi-coding-agent";

type SessionManagerLike = ReturnType<typeof SessionManager.open>;
type SessionEntry = ReturnType<SessionManagerLike["getEntries"]>[number];
type SessionHeader = NonNullable<ReturnType<SessionManagerLike["getHeader"]>>;
type CompactionEntry = Extract<SessionEntry, { type: "compaction" }>;

export type HardenedManualCompactionBoundary = {
  applied: boolean;
  firstKeptEntryId?: string;
  leafId?: string;
  messages: AgentMessage[];
};

function serializeSessionFile(header: SessionHeader, entries: SessionEntry[]): string {
  return (
    [JSON.stringify(header), ...entries.map((entry) => JSON.stringify(entry))].join("\n") + "\n"
  );
}

function replaceLatestCompactionBoundary(params: {
  entries: SessionEntry[];
  compactionEntryId: string;
}): SessionEntry[] {
  return params.entries.map((entry) => {
    if (entry.type !== "compaction" || entry.id !== params.compactionEntryId) {
      return entry;
    }
    return {
      ...entry,
      // Manual /compact is an explicit checkpoint request, so make the
      // rebuilt context start from the summary itself instead of preserving
      // an upstream "recent tail" that can keep large prior turns alive.
      firstKeptEntryId: entry.id,
    } satisfies CompactionEntry;
  });
}

function entryCreatesCompactionInputMessage(entry: SessionEntry): boolean {
  return (
    entry.type === "message" || entry.type === "custom_message" || entry.type === "branch_summary"
  );
}

function hasMessagesToSummarizeBeforeKeptTail(params: {
  entries: SessionEntry[];
  compaction: CompactionEntry;
}): boolean {
  const compactionIndex = params.entries.findIndex((entry) => entry.id === params.compaction.id);
  const firstKeptIndex = params.entries.findIndex(
    (entry) => entry.id === params.compaction.firstKeptEntryId,
  );
  if (compactionIndex <= 0 || firstKeptIndex < 0 || firstKeptIndex >= compactionIndex) {
    return false;
  }

  let boundaryStartIndex = 0;
  for (let i = compactionIndex - 1; i >= 0; i -= 1) {
    const entry = params.entries[i];
    if (entry?.type !== "compaction") {
      continue;
    }
    const previousFirstKeptIndex = params.entries.findIndex(
      (candidate) => candidate.id === entry.firstKeptEntryId,
    );
    boundaryStartIndex = previousFirstKeptIndex >= 0 ? previousFirstKeptIndex : i + 1;
    break;
  }

  return params.entries
    .slice(boundaryStartIndex, firstKeptIndex)
    .some((entry) => entryCreatesCompactionInputMessage(entry));
}

export async function hardenManualCompactionBoundary(params: {
  sessionFile: string;
}): Promise<HardenedManualCompactionBoundary> {
  const sessionManager = SessionManager.open(params.sessionFile) as Partial<SessionManagerLike>;
  if (
    typeof sessionManager.getHeader !== "function" ||
    typeof sessionManager.getLeafEntry !== "function" ||
    typeof sessionManager.buildSessionContext !== "function" ||
    typeof sessionManager.getEntries !== "function"
  ) {
    return {
      applied: false,
      messages: [],
    };
  }

  const header = sessionManager.getHeader();
  const leaf = sessionManager.getLeafEntry();
  if (!header || leaf?.type !== "compaction") {
    const sessionContext = sessionManager.buildSessionContext();
    return {
      applied: false,
      leafId:
        typeof sessionManager.getLeafId === "function"
          ? (sessionManager.getLeafId() ?? undefined)
          : undefined,
      messages: sessionContext.messages,
    };
  }

  const sessionContext = sessionManager.buildSessionContext();
  if (leaf.firstKeptEntryId === leaf.id) {
    return {
      applied: false,
      firstKeptEntryId: leaf.id,
      leafId:
        typeof sessionManager.getLeafId === "function"
          ? (sessionManager.getLeafId() ?? undefined)
          : undefined,
      messages: sessionContext.messages,
    };
  }

  const entries = sessionManager.getEntries();
  if (
    !leaf.summary.trim() ||
    !hasMessagesToSummarizeBeforeKeptTail({
      entries,
      compaction: leaf,
    })
  ) {
    return {
      applied: false,
      firstKeptEntryId: leaf.firstKeptEntryId,
      leafId:
        typeof sessionManager.getLeafId === "function"
          ? (sessionManager.getLeafId() ?? undefined)
          : undefined,
      messages: sessionContext.messages,
    };
  }

  const content = serializeSessionFile(
    header,
    replaceLatestCompactionBoundary({
      entries,
      compactionEntryId: leaf.id,
    }),
  );
  const tmpFile = `${params.sessionFile}.manual-compaction-tmp`;
  await fs.writeFile(tmpFile, content, "utf-8");
  await fs.rename(tmpFile, params.sessionFile);

  const refreshed = SessionManager.open(params.sessionFile);
  const refreshedContext = refreshed.buildSessionContext();
  return {
    applied: true,
    firstKeptEntryId: leaf.id,
    leafId: refreshed.getLeafId() ?? undefined,
    messages: refreshedContext.messages,
  };
}
