// Wires the singleton DB into each module's pure functions.
// External code imports from here; tests import the modules directly.

import { getDb } from './connection.js';
import { saveAttempt as _saveAttempt, getResults as _getResults, deleteRunsByModel as _deleteRunsByModel, getCompletedTargetIds as _getCompletedTargetIds, saveRunMeta as _saveRunMeta, getRunMeta as _getRunMeta } from './runs.js';
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
export const saveRunMeta             = (data)    => _saveRunMeta(getDb(), data);
export const getRunMeta              = ()        => _getRunMeta(getDb());
export const upsertBattleTarget      = (t)       => _upsertBattleTarget(getDb(), t);
export const upsertDailyTarget       = (t)       => _upsertDailyTarget(getDb(), t);
export const getBattleTargets        = ()        => _getBattleTargets(getDb());
export const getDailyTargets         = ()        => _getDailyTargets(getDb());
