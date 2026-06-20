import {
  garbageCollectSkillHubIconAssets,
  skillHubIconGcDefaults,
} from "../agents/skill-hub-icon-maintenance.js";
import { listReferencedSkillHubIconAssetIds } from "../agents/skill-hub.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function startSkillHubIconGcScheduler(params?: {
  env?: NodeJS.ProcessEnv;
  log?: { info: (message: string) => void; warn: (message: string) => void };
  loadReferencedAssetIds?: () => Promise<string[]>;
  runGc?: typeof garbageCollectSkillHubIconAssets;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}): () => void {
  const settings = skillHubIconGcDefaults(params?.env);
  if (!settings.enabled) {
    return () => {};
  }
  const log = params?.log ?? console;
  const loadReferencedAssetIds =
    params?.loadReferencedAssetIds ?? listReferencedSkillHubIconAssetIds;
  const runGc = params?.runGc ?? garbageCollectSkillHubIconAssets;
  const setTimer = params?.setTimer ?? setTimeout;
  const clearTimer = params?.clearTimer ?? clearTimeout;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;

  const schedule = (delayMs: number) => {
    if (stopped) {
      return;
    }
    timer = setTimer(() => void tick(), delayMs);
    timer.unref?.();
  };
  const tick = async () => {
    if (stopped || running) {
      return;
    }
    running = true;
    try {
      const referencedAssetIds = await loadReferencedAssetIds();
      const result = await runGc({
        referencedAssetIds,
        dryRun: false,
        graceDays: settings.graceDays,
      });
      log.info(
        `Skill Hub icon GC completed: deleted=${result.deletedAssetIds.length} orphan=${result.orphanAssets.length} missing=${result.missingAssetIds.length}`,
      );
    } catch (error) {
      log.warn(
        `Skill Hub icon GC skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      running = false;
      schedule(settings.intervalDays * DAY_MS);
    }
  };

  schedule(settings.initialDelayMs);
  return () => {
    stopped = true;
    if (timer) {
      clearTimer(timer);
      timer = null;
    }
  };
}
