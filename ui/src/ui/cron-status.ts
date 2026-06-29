import type { CronJob, CronRunStatus } from "./types.ts";

export type CronJobLastRunStatus = CronRunStatus | "unknown";

export function resolveCronJobLastRunStatus(job: CronJob): CronJobLastRunStatus {
  return job.state?.lastRunStatus ?? job.state?.lastStatus ?? "unknown";
}

export function isCronJobActiveFailure(job: CronJob): boolean {
  return job.enabled && resolveCronJobLastRunStatus(job) === "error";
}
