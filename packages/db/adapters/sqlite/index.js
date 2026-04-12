// Wires the singleton DB into each module's pure functions.
// External code imports from here; tests import the modules directly.

import { getDb } from './connection.js';
import { saveAttempt as _saveAttempt, getResults as _getResults, deleteRunsByModel as _deleteRunsByModel, getCompletedTargetIds as _getCompletedTargetIds, saveRunStart as _saveRunStart, saveRunEnd as _saveRunEnd, getRunMeta as _getRunMeta, upsertRuns as _upsertRuns, upsertRunStates as _upsertRunStates } from './runs.js';
import {
  upsertBattleTarget as _upsertBattleTarget,
  upsertDailyTarget as _upsertDailyTarget,
  getBattleTargets as _getBattleTargets,
  getDailyTargets as _getDailyTargets,
} from './targets.js';

export const saveAttempt             = (data)    => _saveAttempt(getDb(), data);
export const getCompletedTargetIds   = (runId)   => _getCompletedTargetIds(getDb(), runId);
export const getResults              = ()         => _getResults(getDb());
export const deleteRunsByModel       = (model)   => _deleteRunsByModel(getDb(), model);
export const saveRunStart            = (data)    => _saveRunStart(getDb(), data);
export const saveRunEnd              = (data)    => _saveRunEnd(getDb(), data);
export const upsertRuns              = (rows)    => _upsertRuns(getDb(), rows);
export const upsertRunStates         = (rows)    => _upsertRunStates(getDb(), rows);
export const getRunMeta              = ()        => _getRunMeta(getDb());
export const upsertBattleTarget      = (t)       => _upsertBattleTarget(getDb(), t);
export const upsertDailyTarget       = (t)       => _upsertDailyTarget(getDb(), t);
export const getBattleTargets        = ()        => _getBattleTargets(getDb());
export const getDailyTargets         = ()        => _getDailyTargets(getDb());
