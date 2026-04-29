import type { OpenClawApp } from "./app.ts";
import { loadEmployeeHeartbeat } from "./controllers/heartbeat.ts";
import { loadEmployeeBootstrap } from "./controllers/employee-bootstrap.ts";
import { loadDebug } from "./controllers/debug.ts";
import { loadLogs } from "./controllers/logs.ts";
import { loadNodes } from "./controllers/nodes.ts";

type PollingHost = {
  employeeBootstrapPollInterval: number | null;
  nodesPollInterval: number | null;
  logsPollInterval: number | null;
  debugPollInterval: number | null;
  heartbeatPollInterval: number | null;
  requestStatusPollInterval: number | null;
  tab: string;
};

export function startEmployeeBootstrapPolling(host: PollingHost) {
  if (host.employeeBootstrapPollInterval != null) {
    return;
  }
  host.employeeBootstrapPollInterval = window.setInterval(() => {
    if (typeof document !== "undefined" && document.hidden) {
      return;
    }
    void loadEmployeeBootstrap(host as unknown as OpenClawApp, { background: true });
  }, 60_000);
}

export function stopEmployeeBootstrapPolling(host: PollingHost) {
  if (host.employeeBootstrapPollInterval == null) {
    return;
  }
  clearInterval(host.employeeBootstrapPollInterval);
  host.employeeBootstrapPollInterval = null;
}

export function startNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval != null) {
    return;
  }
  host.nodesPollInterval = window.setInterval(
    () => void loadNodes(host as unknown as OpenClawApp, { quiet: true }),
    5000,
  );
}

export function stopNodesPolling(host: PollingHost) {
  if (host.nodesPollInterval == null) {
    return;
  }
  clearInterval(host.nodesPollInterval);
  host.nodesPollInterval = null;
}

export function startLogsPolling(host: PollingHost) {
  if (host.logsPollInterval != null) {
    return;
  }
  host.logsPollInterval = window.setInterval(() => {
    if (host.tab !== "logs") {
      return;
    }
    void loadLogs(host as unknown as OpenClawApp, { quiet: true });
  }, 2000);
}

export function stopLogsPolling(host: PollingHost) {
  if (host.logsPollInterval == null) {
    return;
  }
  clearInterval(host.logsPollInterval);
  host.logsPollInterval = null;
}

export function startDebugPolling(host: PollingHost) {
  if (host.debugPollInterval != null) {
    return;
  }
  host.debugPollInterval = window.setInterval(() => {
    if (host.tab !== "debug") {
      return;
    }
    void loadDebug(host as unknown as OpenClawApp);
  }, 3000);
}

export function stopDebugPolling(host: PollingHost) {
  if (host.debugPollInterval == null) {
    return;
  }
  clearInterval(host.debugPollInterval);
  host.debugPollInterval = null;
}

export function startHeartbeatPolling(host: PollingHost) {
  if (host.heartbeatPollInterval != null) {
    return;
  }
  host.heartbeatPollInterval = window.setInterval(() => {
    if (host.tab !== "heartbeat") {
      return;
    }
    void loadEmployeeHeartbeat(host as unknown as OpenClawApp);
  }, 5000);
}

export function stopHeartbeatPolling(host: PollingHost) {
  if (host.heartbeatPollInterval == null) {
    return;
  }
  clearInterval(host.heartbeatPollInterval);
  host.heartbeatPollInterval = null;
}

type RequestStatusPollingHost = PollingHost & {
  chatSending?: boolean;
  chatRunId?: string | null;
  chatStream?: string | null;
  requestUpdate: () => void;
};

export function startRequestStatusPolling(host: RequestStatusPollingHost) {
  if (host.requestStatusPollInterval != null) {
    return;
  }
  host.requestStatusPollInterval = window.setInterval(() => {
    if (!host.chatSending && !host.chatRunId && host.chatStream == null) {
      stopRequestStatusPolling(host);
      return;
    }
    host.requestUpdate();
  }, 1000);
}

export function stopRequestStatusPolling(host: PollingHost) {
  if (host.requestStatusPollInterval == null) {
    return;
  }
  clearInterval(host.requestStatusPollInterval);
  host.requestStatusPollInterval = null;
}
