// Builds compact human baseline statistics per target from leaderboard rows.
// Percentiles are computed via nearest-rank on score-ascending order so each
// percentile keeps a real (score, charCount) pair from the source rows.

function toFiniteNumber(value) {
  if (value == null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function nearestRankIndex(length, percentile) {
  if (length <= 0) throw new Error('nearestRankIndex: length must be > 0');
  const p = Math.max(0, Math.min(1, percentile));
  return Math.min(length - 1, Math.max(0, Math.ceil(p * length) - 1));
}

function sortDescByScoreThenChars(rows) {
  return [...rows].sort((a, b) => (b.score - a.score) || (a.charCount - b.charCount));
}

function sortAscByScoreThenChars(rows) {
  return [...rows].sort((a, b) => (a.score - b.score) || (b.charCount - a.charCount));
}

function avgPair(rows) {
  const n = rows.length;
  if (n === 0) throw new Error('avgPair: rows must not be empty');
  const scoreSum = rows.reduce((sum, row) => sum + row.score, 0);
  const charSum = rows.reduce((sum, row) => sum + row.charCount, 0);
  return {
    score: round(scoreSum / n, 2),
    charCount: round(charSum / n, 1),
  };
}

function percentilePair(rowsAsc, percentile) {
  const idx = nearestRankIndex(rowsAsc.length, percentile);
  const row = rowsAsc[idx];
  return {
    score: round(row.score, 2),
    charCount: round(row.charCount, 1),
  };
}

function sortTargetIds(a, b) {
  const an = Number(a);
  const bn = Number(b);
  const aNum = Number.isFinite(an);
  const bNum = Number.isFinite(bn);
  if (aNum && bNum) return an - bn;
  if (aNum) return -1;
  if (bNum) return 1;
  return String(a).localeCompare(String(b));
}

export function buildHumanStats(rows, {
  schemaVersion = '2.2.0',
  updatedAt = new Date().toISOString(),
  targetIdField = 'target_id',
  scoreField = 'score',
  charCountField = 'char_count',
  topN = 10,
  maxPerTarget = 100,
} = {}) {
  if (!Array.isArray(rows)) throw new Error('buildHumanStats: rows must be an array');
  if (!Number.isInteger(topN) || topN <= 0) throw new Error('buildHumanStats: topN must be a positive integer');
  if (!Number.isInteger(maxPerTarget) || maxPerTarget <= 0) throw new Error('buildHumanStats: maxPerTarget must be a positive integer');

  const grouped = new Map();
  for (const row of rows) {
    const targetRaw = row?.[targetIdField];
    if (targetRaw == null) continue;
    const targetId = String(targetRaw).trim();
    if (!targetId) continue;

    const score = toFiniteNumber(row?.[scoreField]);
    const charCount = toFiniteNumber(row?.[charCountField]);
    if (score == null || charCount == null) continue;

    if (!grouped.has(targetId)) grouped.set(targetId, []);
    grouped.get(targetId).push({ score, charCount });
  }

  const targets = {};
  for (const targetId of [...grouped.keys()].sort(sortTargetIds)) {
    const desc = sortDescByScoreThenChars(grouped.get(targetId)).slice(0, maxPerTarget);
    if (desc.length === 0) continue;
    const asc = sortAscByScoreThenChars(desc);
    const topSlice = desc.slice(0, Math.min(topN, desc.length));
    const top1 = desc[0];
    const rank100 = desc[Math.min(maxPerTarget, desc.length) - 1];

    targets[targetId] = {
      n: desc.length,
      top1: { score: round(top1.score, 2), charCount: round(top1.charCount, 1) },
      top10Avg: avgPair(topSlice),
      rank100: { score: round(rank100.score, 2), charCount: round(rank100.charCount, 1) },
      p50: percentilePair(asc, 0.5),
      p90: percentilePair(asc, 0.9),
    };
  }

  return {
    schemaVersion,
    updatedAt,
    targets,
  };
}

export async function fetchSupabaseRows({
  url,
  key,
  source,
  fields,
  filters = [],
  order = [],
  pageSize = 1000,
}) {
  if (!url || !key) throw new Error('fetchSupabaseRows: url and key are required');
  if (!source) throw new Error('fetchSupabaseRows: source is required');
  if (!Array.isArray(fields) || fields.length === 0) throw new Error('fetchSupabaseRows: fields must be a non-empty array');
  if (!Number.isInteger(pageSize) || pageSize <= 0) throw new Error('fetchSupabaseRows: pageSize must be a positive integer');

  const allRows = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams();
    params.set('select', fields.join(','));
    if (order.length) params.set('order', order.join(','));
    params.set('limit', String(pageSize));
    params.set('offset', String(offset));
    for (const [keyName, value] of filters) params.set(keyName, value);

    const res = await fetch(`${url}/rest/v1/${source}?${params.toString()}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'count=none',
      },
    });
    if (!res.ok) {
      const responseBody = await res.text();
      let parsedBody = null;
      try { parsedBody = JSON.parse(responseBody); } catch {}
      const err = new Error(`Supabase fetch (${source}) failed at offset ${offset}: HTTP ${res.status} – ${responseBody}`);
      err.status = res.status;
      err.source = source;
      err.offset = offset;
      err.responseBody = responseBody;
      err.code = parsedBody?.code ?? null;
      throw err;
    }

    const page = await res.json();
    if (!Array.isArray(page)) {
      throw new Error(`Supabase fetch (${source}) returned a non-array payload at offset ${offset}`);
    }

    allRows.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return allRows;
}
