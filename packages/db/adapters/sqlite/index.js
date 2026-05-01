// Wires the singleton DB into each module's pure functions.
// External code imports from here; tests import the modules directly.

import { getDb } from './connection.js';
import {
  getResults as _getResults,
  getTargetResults as _getTargetResults,
  getTargetResultsSummary as _getTargetResultsSummary,
  getResultsCount as _getResultsCount,
  getLeaderboard as _getLeaderboard,
  getInsights as _getInsights,
  deleteRunGroup as _deleteRunGroup,
  getCompletedTargetIds as _getCompletedTargetIds,
  getExistingAttempts as _getExistingAttempts,
  upsertRuns as _upsertRuns,
} from './runs.js';
import { getPreviousAttempt as _getPreviousAttempt } from './previous-attempt.js';
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
  hasRunPendingWork as _hasRunPendingWork,
  requeueStaleRunningAttempts as _requeueStaleRunningAttempts,
  deleteRun as _deleteRun,
  deleteAttempt as _deleteAttempt,
  getAttemptById as _getAttemptById,
} from './queue.js';

export const getCompletedTargetIds = (runId)         => _getCompletedTargetIds(getDb(), runId);
export const getExistingAttempts   = (opts)          => _getExistingAttempts(getDb(), opts);
export const getResults            = (opts)          => _getResults(getDb(), opts);
export const getTargetResults      = (opts)          => _getTargetResults(getDb(), opts);
export const getTargetResultsSummary = (opts)        => _getTargetResultsSummary(getDb(), opts);
export const getResultsCount       = (opts)          => _getResultsCount(getDb(), opts);
export const getLeaderboard        = (promptVersion) => _getLeaderboard(getDb(), promptVersion);
export const getInsights           = (promptVersion) => _getInsights(getDb(), promptVersion);
export const deleteRunGroup        = (filters)       => _deleteRunGroup(getDb(), filters);
export const upsertRuns            = (rows)          => _upsertRuns(getDb(), rows);
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
export const hasRunPendingWork     = (runId)         => _hasRunPendingWork(getDb(), runId);
export const requeueStaleRunningAttempts = ()        => _requeueStaleRunningAttempts(getDb());
export const deleteRun             = (runId)         => _deleteRun(getDb(), runId);
export const deleteAttempt         = (id)            => _deleteAttempt(getDb(), id);
export const getAttemptById        = (id)            => _getAttemptById(getDb(), id);
export const getPreviousAttempt    = (runId, targetId, attempt) => _getPreviousAttempt(getDb(), runId, targetId, attempt);
