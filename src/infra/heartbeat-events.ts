import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../shared/listeners.js";

export type HeartbeatIndicatorType = "ok" | "alert" | "error";

export type HeartbeatEventPayload = {
  ts: number;
  agentId?: string;
  sessionKey?: string;
  status: "sent" | "ok-empty" | "ok-token" | "skipped" | "failed";
  to?: string;
  accountId?: string;
  preview?: string;
  durationMs?: number;
  hasMedia?: boolean;
  reason?: string;
  /** The channel this heartbeat was sent to. */
  channel?: string;
  /** Whether the message was silently suppressed (showOk: false). */
  silent?: boolean;
  /** Indicator type for UI status display. */
  indicatorType?: HeartbeatIndicatorType;
};

export function resolveIndicatorType(
  status: HeartbeatEventPayload["status"],
): HeartbeatIndicatorType | undefined {
  switch (status) {
    case "ok-empty":
    case "ok-token":
      return "ok";
    case "sent":
      return "alert";
    case "failed":
      return "error";
    case "skipped":
      return undefined;
  }
}

type HeartbeatEventState = {
  lastHeartbeat: HeartbeatEventPayload | null;
  lastHeartbeatByAgent: Map<string, HeartbeatEventPayload>;
  listeners: Set<(evt: HeartbeatEventPayload) => void>;
};

const HEARTBEAT_EVENT_STATE_KEY = Symbol.for("openclaw.heartbeatEvents.state");

const state = resolveGlobalSingleton<HeartbeatEventState>(HEARTBEAT_EVENT_STATE_KEY, () => ({
  lastHeartbeat: null,
  lastHeartbeatByAgent: new Map<string, HeartbeatEventPayload>(),
  listeners: new Set<(evt: HeartbeatEventPayload) => void>(),
}));

export function emitHeartbeatEvent(evt: Omit<HeartbeatEventPayload, "ts">) {
  const enriched: HeartbeatEventPayload = { ts: Date.now(), ...evt };
  state.lastHeartbeat = enriched;
  const agentId = typeof enriched.agentId === "string" ? enriched.agentId.trim() : "";
  if (agentId) {
    state.lastHeartbeatByAgent.set(agentId, enriched);
  }
  notifyListeners(state.listeners, enriched);
}

export function onHeartbeatEvent(listener: (evt: HeartbeatEventPayload) => void): () => void {
  return registerListener(state.listeners, listener);
}

export function getLastHeartbeatEvent(): HeartbeatEventPayload | null {
  return state.lastHeartbeat;
}

export function getLastHeartbeatEventForAgent(agentId: string): HeartbeatEventPayload | null {
  const normalized = agentId.trim();
  if (!normalized) {
    return null;
  }
  return state.lastHeartbeatByAgent.get(normalized) ?? null;
}

export function resetHeartbeatEventsForTest(): void {
  state.lastHeartbeat = null;
  state.lastHeartbeatByAgent.clear();
  state.listeners.clear();
}
