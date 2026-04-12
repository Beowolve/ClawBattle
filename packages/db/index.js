// DB index – picks adapter based on DB_ADAPTER env var

const adapter = process.env.DB_ADAPTER ?? 'sqlite';

let mod;
if (adapter === 'supabase') {
  mod = await import('./adapters/supabase.js');
} else {
  mod = await import('./adapters/sqlite/index.js');
}

export const {
  saveAttempt, saveRunStart, saveRunEnd, getResults, getRunMeta,
  getBattleTargets, getDailyTargets,
  upsertBattleTarget, upsertDailyTarget,
  deleteRunsByModel, getCompletedTargetIds,
} = mod;
