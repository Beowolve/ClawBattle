import { useQuery } from '@tanstack/react-query';
import humanStats from '../../../../baselines/human_stats.json';

// ─── Local API (default) ──────────────────────────────────────────────────────

const API = '/api';

async function fetchJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// ─── Public mode (Supabase REST, read-only) ───────────────────────────────────

export const IS_PUBLIC = import.meta.env.VITE_PUBLIC_MODE === 'true';
const SB_URL = import.meta.env.VITE_SUPABASE_URL;
const SB_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const PAGE_SIZE = 1000;

// filter: optional Supabase column filter string, e.g. 'prompt_version=eq.v1'
async function fetchAllFromSupabase(table, order = '', filter = '') {
  const rows = [];
  let offset = 0;
  while (true) {
    const url = [
      `${SB_URL}/rest/v1/${table}?select=*`,
      `limit=${PAGE_SIZE}`,
      `offset=${offset}`,
      order  ? `order=${order}`   : '',
      filter ? filter             : '',
    ].filter(Boolean).join('&');
    const res = await fetch(url, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!res.ok) throw new Error(`Supabase/${table}: ${res.status}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

// ─── Public mode: leaderboard transform ──────────────────────────────────────

// Converts rows from the `leaderboard` or `leaderboard_by_version` Supabase view
// into the shape expected by Leaderboard.jsx and App.jsx KPI cards.
const HUMAN_BASELINES = [
  { model: 'human/top1', statKey: 'top1' },
  { model: 'human/top10', statKey: 'top10Avg' },
  { model: 'human/rank100', statKey: 'rank100' },
  { model: 'human/expert-player', statKey: 'p90' },
  { model: 'human/avg-player', statKey: 'p50' },
];

function mean(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function buildHumanBaselineRows(viewRows) {
  const maxTargetId = Math.max(0, ...viewRows.map(r => Number(r.targets ?? 0)));
  if (maxTargetId <= 0) return [];

  return HUMAN_BASELINES.map(({ model, statKey }) => {
    const values = [];
    for (let targetId = 1; targetId <= maxTargetId; targetId += 1) {
      const score = humanStats.targets?.[String(targetId)]?.[statKey]?.score;
      if (Number.isFinite(Number(score))) values.push(Number(score));
    }
    if (!values.length) return null;

    return {
      model,
      rawModel: model,
      reasoningEffort: 'baseline',
      provider: 'human',
      promptVersions: [],
      targets: values.length,
      avgScore: mean(values),
      avgMatch: 100,
      avgDuration: null,
      perfectCount: values.length,
      perfectRate: 1,
      totalCost: null,
      avgCost: null,
      isBaseline: true,
      baselineSource: 'human',
      baselineStat: statKey,
      baselineTargetMax: maxTargetId,
    };
  }).filter(Boolean);
}

function transformLeaderboard(viewRows, allVersionRows = null) {
  const rows = viewRows.map(r => ({
    model:          r.model,
    reasoningEffort: r.reasoning_effort ?? null,
    provider:       r.provider,
    // leaderboard view has prompt_versions[]; leaderboard_by_version has prompt_version
    promptVersions: r.prompt_versions ?? (r.prompt_version ? [r.prompt_version] : []),
    targets:        Number(r.targets),
    avgScore:       r.avg_score   != null ? Number(r.avg_score)   : null,
    avgMatch:       r.avg_match   != null ? Number(r.avg_match)   : null,
    avgDuration:    r.avg_duration_ms != null ? Number(r.avg_duration_ms) : null,
    perfectCount:   Number(r.perfect_count ?? 0),
    perfectRate:    r.perfect_rate != null ? Number(r.perfect_rate) : null,
    totalCost:      r.total_cost  != null ? Number(r.total_cost)  : null,
    avgCost:        r.avg_cost    != null ? Number(r.avg_cost)    : null,
    isBaseline:     false,
  }));

  const totalAttempts = viewRows.reduce((a, r) => a + Number(r.attempt_count ?? 0), 0);
  const totalCost     = viewRows.reduce((a, r) => a + Number(r.total_cost    ?? 0), 0);

  // Collect all known prompt versions — prefer the unfiltered leaderboard rows
  // (which carry prompt_versions[]) so the dropdown is always complete.
  const source = allVersionRows ?? viewRows;
  const promptVersions = [...new Set(
    source.flatMap(r => r.prompt_versions ?? (r.prompt_version ? [r.prompt_version] : []))
  )].sort();

  return {
    rows: [...rows, ...buildHumanBaselineRows(viewRows)],
    totalAttempts,
    totalCost,
    models: rows.length,
    promptVersions,
  };
}

// ─── Public mode: insights transform ─────────────────────────────────────────

// Bucket order matches the JS build in runs.js / the old buildInsights.
const BUCKET_ORDER = [
  '0–9','10–19','20–29','30–39','40–49',
  '50–59','60–69','70–79','80–89','90–99','100',
];

function modelConfigKey(row) {
  return `${row.model}__${row.reasoning_effort ?? ''}`;
}

function modelConfigLabel(model, reasoningEffort) {
  return reasoningEffort ? `${model} [${reasoningEffort}]` : model;
}

function transformInsights(diffRows, consistRows, costRows, distRows) {
  // ── difficulty ──────────────────────────────────────────────────────────────
  // Multiple rows per target when prompt_version is in group-by (or no filter).
  // Average avg_match across versions per target; keep first name/image_url.
  const diffByTarget = {};
  for (const r of diffRows) {
    const rawId = r.target_type === 'battle'
      ? String(Math.round(Number(r.target_id)))
      : r.target_id;
    const key = `${r.target_type}__${rawId}`;
    if (!diffByTarget[key]) {
      diffByTarget[key] = {
        key,
        label:      `#${rawId}`,
        name:       r.name      ?? `#${rawId}`,
        imgUrl:     r.image_url ?? null,
        targetType: r.target_type,
        rawId,
        sum:        0,
        count:      0,
      };
    }
    diffByTarget[key].sum   += Number(r.avg_match ?? 0);
    diffByTarget[key].count += 1;
  }
  const difficulty = Object.values(diffByTarget)
    .map(t => ({ ...t, avgMatch: +(t.sum / t.count).toFixed(1) }))
    .sort((a, b) => a.avgMatch - b.avgMatch);

  // ── consistency ─────────────────────────────────────────────────────────────
  // Average avg_match and std_dev across versions per model reasoning config (unweighted approx).
  const consistByModel = {};
  for (const r of consistRows) {
    const key = modelConfigKey(r);
    if (!consistByModel[key]) {
      consistByModel[key] = {
        model: r.model,
        reasoningEffort: r.reasoning_effort ?? null,
        avgMatches: [],
        stdDevs: [],
        totalN: 0,
      };
    }
    const m = consistByModel[key];
    m.avgMatches.push(Number(r.avg_match ?? 0));
    m.stdDevs.push(Number(r.std_dev   ?? 0));
    m.totalN  += Number(r.n ?? 0);
  }
  const consistency = Object.values(consistByModel)
    .map(m => ({
      model:    m.model,
      reasoningEffort: m.reasoningEffort,
      label:    modelConfigLabel(m.model, m.reasoningEffort),
      avgMatch: +(m.avgMatches.reduce((a, b) => a + b, 0) / m.avgMatches.length).toFixed(1),
      stdDev:   +(m.stdDevs.reduce((a, b) => a + b, 0)   / m.stdDevs.length).toFixed(1),
      n:        m.totalN,
    }))
    .sort((a, b) => a.stdDev - b.stdDev);

  // ── cost efficiency ──────────────────────────────────────────────────────────
  const costByModel = {};
  for (const r of costRows) {
    const key = modelConfigKey(r);
    if (!costByModel[key]) {
      costByModel[key] = {
        model: r.model,
        reasoningEffort: r.reasoning_effort ?? null,
        scores: [],
        costs: [],
      };
    }
    costByModel[key].scores.push(Number(r.avg_score ?? 0));
    if (r.avg_cost != null) costByModel[key].costs.push(Number(r.avg_cost));
  }
  const costEfficiency = Object.values(costByModel)
    .map(m => {
      const avgScore = m.scores.reduce((a, b) => a + b, 0) / m.scores.length;
      const avgCost  = m.costs.length
        ? m.costs.reduce((a, b) => a + b, 0) / m.costs.length
        : 0;
      const ratio = avgCost > 0 ? avgScore / (avgCost * 1000) : null;
      return {
        model: m.model,
        reasoningEffort: m.reasoningEffort,
        label: modelConfigLabel(m.model, m.reasoningEffort),
        avgScore: +avgScore.toFixed(1),
        avgCost,
        ratio,
      };
    })
    .sort((a, b) => (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity));

  // ── distributions ────────────────────────────────────────────────────────────
  // Sum counts across versions per (model, bucket); also build '' (all models).
  const distByModelBucket = {};
  for (const r of distRows) {
    const key = `${r.model}__${r.bucket}`;
    distByModelBucket[key] = (distByModelBucket[key] ?? 0) + Number(r.count ?? 0);
  }

  const modelSet = new Set(distRows.map(r => r.model));
  const distributions = {};

  for (const model of ['', ...modelSet]) {
    distributions[model] = BUCKET_ORDER.map(range => ({
      range,
      count: model === ''
        // all models: sum across every model for this bucket
        ? [...modelSet].reduce((a, m) => a + (distByModelBucket[`${m}__${range}`] ?? 0), 0)
        : (distByModelBucket[`${model}__${range}`] ?? 0),
    }));
  }

  const models = [...modelSet].sort();

  return { difficulty, consistency, costEfficiency, distributions, models };
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useLeaderboard(promptFilter) {
  const pv = promptFilter && promptFilter !== 'all' ? promptFilter : null;
  return useQuery({
    queryKey: ['leaderboard', pv ?? ''],
    queryFn: IS_PUBLIC
      ? async () => {
          if (pv) {
            // Filtered: use leaderboard_by_version view.
            // Also fetch the unfiltered leaderboard to get the full promptVersions list.
            const [filtered, all] = await Promise.all([
              fetchAllFromSupabase('leaderboard_by_version', '', `prompt_version=eq.${encodeURIComponent(pv)}`),
              fetchAllFromSupabase('leaderboard'),
            ]);
            return transformLeaderboard(filtered, all);
          }
          const rows = await fetchAllFromSupabase('leaderboard');
          return transformLeaderboard(rows);
        }
      : () => fetchJson(`/leaderboard${pv ? `?prompt_version=${encodeURIComponent(pv)}` : ''}`),
  });
}

export function useInsights(promptFilter) {
  const pv = promptFilter && promptFilter !== 'all' ? promptFilter : null;
  const pvFilter = pv ? `prompt_version=eq.${encodeURIComponent(pv)}` : '';
  return useQuery({
    queryKey: ['insights', pv ?? ''],
    queryFn: IS_PUBLIC
      ? async () => {
          const [diffRows, consistRows, costRows, distRows] = await Promise.all([
            fetchAllFromSupabase('target_difficulty',  '', pvFilter),
            fetchAllFromSupabase('model_consistency',  '', pvFilter),
            fetchAllFromSupabase('cost_efficiency',    '', pvFilter),
            fetchAllFromSupabase('match_distribution', '', pvFilter),
          ]);
          return transformInsights(diffRows, consistRows, costRows, distRows);
        }
      : () => fetchJson(`/insights${pv ? `?prompt_version=${encodeURIComponent(pv)}` : ''}`),
  });
}

const RESULTS_PAGE_SIZE = 100;

export function useResultsPage({ page = 0, sort = 'created_at', dir = 'desc', runId = '', model = '' } = {}) {
  return useQuery({
    queryKey: ['results', 'page', page, sort, dir, runId, model],
    queryFn: () => {
      const params = new URLSearchParams({
        limit:  RESULTS_PAGE_SIZE,
        offset: page * RESULTS_PAGE_SIZE,
        sort,
        dir,
      });
      if (runId) params.set('run_id', runId);
      if (model) params.set('model', model);
      return fetchJson(`/results?${params}`);
    },
    // Keep previous page data visible while fetching next page
    placeholderData: prev => prev,
  });
}

export function useResultsCount({ runId = '', model = '' } = {}) {
  return useQuery({
    queryKey: ['results', 'count', runId, model],
    queryFn: () => {
      const params = new URLSearchParams();
      if (runId) params.set('run_id', runId);
      if (model) params.set('model', model);
      const qs = params.toString();
      return fetchJson(`/results/count${qs ? `?${qs}` : ''}`);
    },
  });
}

export function useResults({ enabled = true } = {}) {
  return useQuery({
    queryKey: ['results'],
    queryFn: IS_PUBLIC
      ? () => fetchAllFromSupabase('runs', 'created_at.asc')
      : () => fetchJson('/results'),
    enabled,
  });
}

// DB-backed queue of all non-done runs (with attempts[] nested) — used by the
// Run tab to show pending/running/waiting/paused/error rows inline.
// Refetch interval is short because this is effectively a live queue view.
export function useRunQueue({ refetchInterval = 2000 } = {}) {
  return useQuery({
    queryKey: ['runs', 'queue'],
    queryFn: () => fetchJson('/runs/queue'),
    refetchInterval,
    enabled: !IS_PUBLIC, // queue state isn't synced to Supabase
  });
}

// DB-backed history of fully-done runs only. Source of truth for RunHistory.
// In public mode Supabase only stores done attempts (no runs_summary view yet),
// so we fetch the raw rows and aggregate one entry per run_id client-side —
// matching the shape the local /runs/history endpoint returns.
export function useRunHistory() {
  return useQuery({
    queryKey: ['runs', 'history'],
    queryFn: IS_PUBLIC
      ? async () => {
          const rows = await fetchAllFromSupabase('runs', 'created_at.desc');
          const byRun = new Map();
          for (const r of rows) {
            const existing = byRun.get(r.run_id);
            if (!existing) {
              byRun.set(r.run_id, {
                run_id: r.run_id,
                model: r.model,
                provider: r.provider,
                prompt_version: r.prompt_version ?? null,
                reasoning_effort: r.reasoning_effort ?? null,
                started_at: r.started_at,
                finished_at: r.finished_at,
                total: 1,
              });
            } else {
              existing.total += 1;
              if (r.started_at && (!existing.started_at || r.started_at < existing.started_at)) existing.started_at = r.started_at;
              if (r.finished_at && (!existing.finished_at || r.finished_at > existing.finished_at)) existing.finished_at = r.finished_at;
            }
          }
          return [...byRun.values()].sort(
            (a, b) => String(b.finished_at ?? b.started_at ?? '').localeCompare(a.finished_at ?? a.started_at ?? '')
          );
        }
      : () => fetchJson('/runs/history'),
  });
}

export function useBattleTargets() {
  return useQuery({
    queryKey: ['targets', 'battle'],
    queryFn: IS_PUBLIC
      ? () => fetchAllFromSupabase('battle_targets', 'battle_number.asc')
      : () => fetchJson('/targets/battle'),
  });
}

export function useDailyTargets() {
  return useQuery({
    queryKey: ['targets', 'daily'],
    queryFn: IS_PUBLIC
      ? () => fetchAllFromSupabase('daily_targets', 'date.desc')
      : () => fetchJson('/targets/daily'),
  });
}

export function useConfig() {
  return useQuery({
    queryKey: ['config'],
    // Config (available prompt versions etc.) is local-only — not needed in public mode
    queryFn: IS_PUBLIC
      ? () => Promise.resolve({ promptVersion: '', availablePromptVersions: [] })
      : () => fetchJson('/config'),
  });
}
