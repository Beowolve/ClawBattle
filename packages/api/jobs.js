// In-memory store for active benchmark jobs and their SSE subscribers.
// Jobs are kept in memory only — no persistence needed for live progress.

const jobs = new Map(); // runId → { status, model, provider, promptVersion, reasoningEffort, events, subscribers, controller }

export function createJob(runId, { model, provider, promptVersion, reasoningEffort } = {}) {
  const controller = new AbortController();
  jobs.set(runId, { status: 'running', model, provider, promptVersion, reasoningEffort, events: [], subscribers: new Set(), controller });
  return controller.signal;
}

export function listActiveJobs() {
  return [...jobs.entries()]
    .filter(([, j]) => j.status === 'running')
    .map(([runId, j]) => ({ runId, model: j.model, provider: j.provider, status: j.status }));
}

export function cancelJob(runId) {
  const job = jobs.get(runId);
  if (!job || job.status !== 'running') return false;
  job.controller.abort();
  return true;
}

export function getJob(runId) {
  return jobs.get(runId);
}

export function pushEvent(runId, event) {
  const job = jobs.get(runId);
  if (!job) return;
  job.events.push(event);
  if (event.type === 'done' || event.type === 'fatal_error' || event.type === 'cancelled') {
    job.status = event.type === 'done' ? 'done' : event.type === 'cancelled' ? 'cancelled' : 'error';
  }
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of job.subscribers) {
    res.write(line);
    if (job.status !== 'running') res.end();
  }
  if (job.status !== 'running') job.subscribers.clear();
}

export function subscribe(runId, res) {
  const job = jobs.get(runId);
  if (!job) return false;
  // Replay events the subscriber missed
  for (const event of job.events) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  if (job.status !== 'running') {
    res.end();
    return true;
  }
  job.subscribers.add(res);
  return true;
}

export function unsubscribe(runId, res) {
  const job = jobs.get(runId);
  if (job) job.subscribers.delete(res);
}
