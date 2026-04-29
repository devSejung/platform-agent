import { connectGateway } from "./app-gateway.ts";
import {
  startEmployeeBootstrapPolling,
  startLogsPolling,
  startNodesPolling,
  stopEmployeeBootstrapPolling,
  stopLogsPolling,
  stopNodesPolling,
  startDebugPolling,
  stopDebugPolling,
  startHeartbeatPolling,
  stopHeartbeatPolling,
  startRequestStatusPolling,
  stopRequestStatusPolling,
} from "./app-polling.ts";
import { observeTopbar, scheduleChatScroll, scheduleLogsScroll } from "./app-scroll.ts";
import {
  applySettingsFromUrl,
  attachThemeListener,
  detachThemeListener,
  inferBasePath,
  syncTabWithLocation,
  syncThemeWithSettings,
} from "./app-settings.ts";
import { loadControlUiBootstrapConfig } from "./controllers/control-ui-bootstrap.ts";
import { loadEmployeeBootstrap } from "./controllers/employee-bootstrap.ts";
import type { Tab } from "./navigation.ts";

type LifecycleHost = {
  basePath: string;
  client?: { stop: () => void } | null;
  connectGeneration: number;
  connected?: boolean;
  tab: Tab;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  serverVersion: string | null;
  employeeMode: boolean;
  employeeBootstrapToken: string | null;
  employeeBootstrapReady: boolean;
  employeeBootstrapError: string | null;
  employeeProfile: {
    employeeId: string | null;
    name: string | null;
    department: string | null;
    agentId: string | null;
  };
  chatHasAutoScrolled: boolean;
  chatManualRefreshInFlight: boolean;
  chatLoading: boolean;
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStream: string | null;
  chatRunId: string | null;
  logsAutoFollow: boolean;
  logsAtBottom: boolean;
  logsEntries: unknown[];
  popStateHandler: () => void;
  topbarObserver: ResizeObserver | null;
};

export function handleConnected(host: LifecycleHost) {
  const connectGeneration = ++host.connectGeneration;
  host.basePath = inferBasePath();
  applySettingsFromUrl(host as unknown as Parameters<typeof applySettingsFromUrl>[0]);
  const bootstrapReady = host.employeeMode
    ? loadEmployeeBootstrap(host as unknown as Parameters<typeof loadEmployeeBootstrap>[0])
    : loadControlUiBootstrapConfig(host);
  syncTabWithLocation(host as unknown as Parameters<typeof syncTabWithLocation>[0], true);
  syncThemeWithSettings(host as unknown as Parameters<typeof syncThemeWithSettings>[0]);
  attachThemeListener(host as unknown as Parameters<typeof attachThemeListener>[0]);
  window.addEventListener("popstate", host.popStateHandler);
  void bootstrapReady.finally(() => {
    if (host.connectGeneration !== connectGeneration) {
      return;
    }
    if (host.employeeMode && !host.employeeBootstrapReady) {
      return;
    }
    connectGateway(host as unknown as Parameters<typeof connectGateway>[0]);
  });
  if (host.employeeMode) {
    startEmployeeBootstrapPolling(host as unknown as Parameters<typeof startEmployeeBootstrapPolling>[0]);
  }
  if (!host.employeeMode) {
    startNodesPolling(host as unknown as Parameters<typeof startNodesPolling>[0]);
  }
  if (host.tab === "logs") {
    startLogsPolling(host as unknown as Parameters<typeof startLogsPolling>[0]);
  }
  if (host.tab === "debug") {
    startDebugPolling(host as unknown as Parameters<typeof startDebugPolling>[0]);
  }
  if (host.employeeMode && host.tab === "heartbeat") {
    startHeartbeatPolling(host as unknown as Parameters<typeof startHeartbeatPolling>[0]);
  }
}

export function handleFirstUpdated(host: LifecycleHost) {
  observeTopbar(host as unknown as Parameters<typeof observeTopbar>[0]);
}

export function handleDisconnected(host: LifecycleHost) {
  host.connectGeneration += 1;
  window.removeEventListener("popstate", host.popStateHandler);
  stopEmployeeBootstrapPolling(
    host as unknown as Parameters<typeof stopEmployeeBootstrapPolling>[0],
  );
  stopNodesPolling(host as unknown as Parameters<typeof stopNodesPolling>[0]);
  stopLogsPolling(host as unknown as Parameters<typeof stopLogsPolling>[0]);
  stopDebugPolling(host as unknown as Parameters<typeof stopDebugPolling>[0]);
  stopHeartbeatPolling(host as unknown as Parameters<typeof stopHeartbeatPolling>[0]);
  stopRequestStatusPolling(host as unknown as Parameters<typeof stopRequestStatusPolling>[0]);
  host.client?.stop();
  host.client = null;
  host.connected = false;
  detachThemeListener(host as unknown as Parameters<typeof detachThemeListener>[0]);
  host.topbarObserver?.disconnect();
  host.topbarObserver = null;
}

export function handleUpdated(host: LifecycleHost, changed: Map<PropertyKey, unknown>) {
  if (host.tab === "chat" && host.chatManualRefreshInFlight) {
    return;
  }
  if (
    host.tab === "chat" &&
    (changed.has("chatMessages") ||
      changed.has("chatToolMessages") ||
      changed.has("chatStream") ||
      changed.has("chatRunId") ||
      changed.has("chatSending") ||
      changed.has("chatLoading") ||
      changed.has("tab"))
  ) {
    const forcedByTab = changed.has("tab");
    const forcedByLoad =
      changed.has("chatLoading") && changed.get("chatLoading") === true && !host.chatLoading;
    // Detect streaming start: chatStream changed from null/undefined to a string value
    const previousStream = changed.get("chatStream") as string | null | undefined;
    const streamJustStarted =
      changed.has("chatStream") &&
      (previousStream === null || previousStream === undefined) &&
      typeof host.chatStream === "string";
    scheduleChatScroll(
      host as unknown as Parameters<typeof scheduleChatScroll>[0],
      forcedByTab || forcedByLoad || streamJustStarted || !host.chatHasAutoScrolled,
    );
  }
  if (host.chatSending || host.chatRunId || host.chatStream !== null) {
    startRequestStatusPolling(host as unknown as Parameters<typeof startRequestStatusPolling>[0]);
  } else {
    stopRequestStatusPolling(host as unknown as Parameters<typeof stopRequestStatusPolling>[0]);
  }
  if (
    host.tab === "logs" &&
    (changed.has("logsEntries") || changed.has("logsAutoFollow") || changed.has("tab"))
  ) {
    if (host.logsAutoFollow && host.logsAtBottom) {
      scheduleLogsScroll(
        host as unknown as Parameters<typeof scheduleLogsScroll>[0],
        changed.has("tab") || changed.has("logsAutoFollow"),
      );
    }
  }
}
