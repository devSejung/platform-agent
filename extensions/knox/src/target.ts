export type KnoxTarget = {
  kind: "direct" | "room";
  id: string;
  target: string;
};

export function normalizeKnoxTarget(raw: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return undefined;
  }
  const withoutChannelPrefix = trimmed.replace(/^(knox|knox-messenger):/i, "").trim();
  return withoutChannelPrefix || undefined;
}

export function parseKnoxTarget(raw: string): KnoxTarget {
  const normalized = normalizeKnoxTarget(raw);
  if (!normalized) {
    throw new Error("Knox target is required.");
  }
  const direct = normalized.match(/^(?:dm|direct|user):(.+)$/i);
  if (direct?.[1]?.trim()) {
    const id = direct[1].trim();
    return { kind: "direct", id, target: `dm:${id}` };
  }
  const room = normalized.match(/^(?:room|group|channel):(.+)$/i);
  if (room?.[1]?.trim()) {
    const id = room[1].trim();
    return { kind: "room", id, target: `room:${id}` };
  }
  return { kind: "room", id: normalized, target: `room:${normalized}` };
}
