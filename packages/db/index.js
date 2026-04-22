// DB index – picks adapter based on DB_ADAPTER env var

const adapter = process.env.DB_ADAPTER ?? 'sqlite';

let mod;
if (adapter === 'supabase') {
  mod = await import('./adapters/supabase.js');
} else {
  mod = await import('./adapters/sqlite/index.js');
}

export const {
  getResults, getResultsCount, getLeaderboard, getInsights,
  getBattleTargets, getDailyTargets,
  upsertBattleTarget, upsertDailyTarget,
  deleteRunGroup, getCompletedTargetIds,
  getExistingAttempts,
  upsertRuns,
  getRunQueue, getRunHistory,
  retryAttempt, resetErrors,
  pauseRun, resumeRun, hasRunPendingWork,
  requeueStaleRunningAttempts,
  deleteRun, deleteAttempt,
} = mod;
