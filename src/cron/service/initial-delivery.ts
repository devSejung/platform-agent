import type { CronDelivery, CronJobCreate } from "../types.js";

function hasOriginSession(input: CronJobCreate): boolean {
  return typeof input.sessionKey === "string" && input.sessionKey.trim().length > 0;
}

export function resolveInitialCronDelivery(input: CronJobCreate): CronDelivery | undefined {
  if (input.delivery) {
    return input.delivery;
  }
  if (input.sessionTarget === "isolated" && input.payload.kind === "agentTurn") {
    return hasOriginSession(input) ? { mode: "origin" } : { mode: "announce" };
  }
  return undefined;
}
