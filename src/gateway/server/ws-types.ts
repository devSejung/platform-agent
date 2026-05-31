import type { WebSocket } from "ws";
import type { ConnectParams } from "../protocol/index.js";
import type { VerifiedEmployeeAccess } from "../employee-auth.js";

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  requestedScopes?: string[];
  connId: string;
  usesSharedGatewayAuth: boolean;
  sharedGatewaySessionGeneration?: string;
  allowSharedOperatorScopesWithoutDeviceIdentity?: boolean;
  presenceKey?: string;
  clientIp?: string;
  canvasHostUrl?: string;
  canvasCapability?: string;
  canvasCapabilityExpiresAtMs?: number;
  internal?: {
    employee?: VerifiedEmployeeAccess;
  };
};
