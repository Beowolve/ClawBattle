// DB Adapter – Supabase (results: runs table)
// Uses SUPABASE_RESULTS_URL + SUPABASE_RESULTS_KEY from environment.

const SB_URL = process.env.SUPABASE_RESULTS_URL;
const SB_KEY = process.env.SUPABASE_RESULTS_KEY;

async function sbFetch(path, { method = 'GET', body, prefer } = {}) {
  if (!SB_URL || !SB_KEY) {
    throw new Error('SUPABASE_RESULTS_URL and SUPABASE_RESULTS_KEY must be set');
  }
  const headers = {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`Supabase ${method} ${path}: HTTP ${res.status} – ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

function toRunRow(data) {
  return {
    run_id: data.runId,
    benchmark_version: data.benchmarkVersion,
    model: data.model,
    provider: data.provider,
    prompt_version: data.promptVersion ?? null,
    temperature: data.temperature ?? null,
    attempts_per_target: data.attemptsPerTarget ?? null,
    started_at: data.startedAt ?? null,
    target_id: data.targetId,
    target_type: data.targetType,
    attempt: data.attempt,
    match: data.match ?? null,
    score: data.score ?? null,
    tokens_used: data.tokensUsed ?? null,
    code: data.code ?? null,
    code_length: data.codeLength ?? null,
    cost: data.cost ?? null,
    duration_ms: data.durationMs ?? null,
    reasoning_effort: data.reasoningEffort ?? null,
  };
}

export async function saveAttempt(data) {
  await sbFetch('runs', { method: 'POST', body: toRunRow(data), prefer: 'return=minimal' });
}

// run_state lifecycle tracking is local-only; Supabase is used for result uploads only.
export async function saveRunStart(_data) {}
export async function saveRunEnd(_data) {}

export async function getResults() {
  const PAGE_SIZE = 1000;
  const rows = [];
  let offset = 0;
  while (true) {
    const page = await sbFetch(`runs?select=*&order=created_at.desc&limit=${PAGE_SIZE}&offset=${offset}`);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return rows;
}

export async function getRunMeta() {
  return sbFetch('run_state?select=*&order=started_at.desc');
}

export async function getBattleTargets() {
  const rows = await sbFetch('battle_targets?select=*&order=battle_number.asc');
  return rows.map(t => ({ ...t, colors: t.colors ?? [] }));
}

export async function getDailyTargets() {
  const rows = await sbFetch('daily_targets?select=*&order=date.desc');
  return rows.map(t => ({ ...t, colors: t.colors ?? [] }));
}

export async function upsertBattleTarget(t) {
  await sbFetch('battle_targets', {
    method: 'POST',
    body: t,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

export async function upsertDailyTarget(t) {
  await sbFetch('daily_targets', {
    method: 'POST',
    body: t,
    prefer: 'resolution=merge-duplicates,return=minimal',
  });
}

export async function getCompletedTargetIds(runId) {
  const rows = await sbFetch(`runs?select=target_id&run_id=eq.${encodeURIComponent(runId)}`);
  return new Set(rows.map(r => String(Math.round(Number(r.target_id)))));
}

export async function deleteRunsByModel(model) {
  const rows = await sbFetch(`runs?select=run_id&model=eq.${encodeURIComponent(model)}`);
  const count = rows.length;
  await sbFetch(`runs?model=eq.${encodeURIComponent(model)}`, { method: 'DELETE', prefer: 'return=minimal' });
  return { deleted: count };
}
