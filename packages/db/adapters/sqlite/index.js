// Wires the singleton DB into each module's pure functions.
// External code imports from here; tests import the modules directly.

import { getDb } from './connection.js';
import {
  saveAttempt as _saveAttempt,
  getResults as _getResults,
  getResultsCount as _getResultsCount,
  getLeaderboard as _getLeaderboard,
  getInsights as _getInsights,
  deleteRunGroup as _deleteRunGroup,
  getCompletedTargetIds as _getCompletedTargetIds,
  getExistingAttempts as _getExistingAttempts,
  deleteRunById as _deleteRunById,
  saveRunStart as _saveRunStart,
  saveRunEnd as _saveRunEnd,
  getRunMeta as _getRunMeta,
  upsertRuns as _upsertRuns,
  upsertRunStates as _upsertRunStates,
} from './runs.js';
import {
  upsertBattleTarget as _upsertBattleTarget,
  upsertDailyTarget as _upsertDailyTarget,
  getBattleTargets as _getBattleTargets,
  getDailyTargets as _getDailyTargets,
} from './targets.js';
import {
  getRunQueue as _getRunQueue,
  getRunHistory as _getRunHistory,
  retryAttempt as _retryAttempt,
  resetErrors as _resetErrors,
  pauseRun as _pauseRun,
  resumeRun as _resumeRun,
  requeueStaleRunningAttempts as _requeueStaleRunningAttempts,
} from './queue.js';

export const saveAttempt           = (data)          => _saveAttempt(getDb(), data);
export const getCompletedTargetIds = (runId)         => _getCompletedTargetIds(getDb(), runId);
export const getExistingAttempts   = (opts)          => _getExistingAttempts(getDb(), opts);
export const deleteRunById         = (runId)         => _deleteRunById(getDb(), runId);
export const getResults            = (opts)          => _getResults(getDb(), opts);
export const getResultsCount       = (opts)          => _getResultsCount(getDb(), opts);
export const getLeaderboard        = (promptVersion) => _getLeaderboard(getDb(), promptVersion);
export const getInsights           = (promptVersion) => _getInsights(getDb(), promptVersion);
export const deleteRunGroup        = (filters)       => _deleteRunGroup(getDb(), filters);
export const saveRunStart          = (data)          => _saveRunStart(getDb(), data);
export const saveRunEnd            = (data)          => _saveRunEnd(getDb(), data);
export const upsertRuns            = (rows)          => _upsertRuns(getDb(), rows);
export const upsertRunStates       = (rows)          => _upsertRunStates(getDb(), rows);
export const getRunMeta            = ()              => _getRunMeta(getDb());
export const upsertBattleTarget    = (t)             => _upsertBattleTarget(getDb(), t);
export const upsertDailyTarget     = (t)             => _upsertDailyTarget(getDb(), t);
export const getBattleTargets      = ()              => _getBattleTargets(getDb());
export const getDailyTargets       = ()              => _getDailyTargets(getDb());
export const getRunQueue           = ()              => _getRunQueue(getDb());
export const getRunHistory         = ()              => _getRunHistory(getDb());
export const retryAttempt          = (id)            => _retryAttempt(getDb(), id);
export const resetErrors           = (runId)         => _resetErrors(getDb(), runId);
export const pauseRun              = (runId)         => _pauseRun(getDb(), runId);
export const resumeRun             = (runId)         => _resumeRun(getDb(), runId);
export const requeueStaleRunningAttempts = ()        => _requeueStaleRunningAttempts(getDb());
