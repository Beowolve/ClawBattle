// In-memory store for active benchmark jobs and their SSE subscribers.
// Finished jobs are retained briefly for event replay and then evicted.

const DEFAULT_MAX_JOB_EVENTS = 200;
const DEFAULT_COMPLETED_JOB_TTL_MS = 5 * 60 * 1000;

const jobs = new Map(); // runId -> { status, model, provider, promptVersion, reasoningEffort, events, subscribers, controller, cleanupHandle }

let maxJobEvents = DEFAULT_MAX_JOB_EVENTS;
let completedJobTtlMs = DEFAULT_COMPLETED_JOB_TTL_MS;
let scheduleCleanup = (callback, delay) => setTimeout(callback, delay);
let cancelCleanup = (handle) => clearTimeout(handle);

function clearJobCleanup(job) {
  if (!job?.cleanupHandle) return;
  cancelCleanup(job.cleanupHandle);
  job.cleanupHandle = null;
}

function scheduleJobCleanup(runId, job) {
  clearJobCleanup(job);
  job.cleanupHandle = scheduleCleanup(() => {
    const current = jobs.get(runId);
    if (current === job && current.status !== 'running') {
      jobs.delete(runId);
    }
  }, completedJobTtlMs);
}

function appendJobEvent(job, event) {
  job.events.push(event);
  if (job.events.length > maxJobEvents) {
    job.events.splice(0, job.events.length - maxJobEvents);
  }
}

export function createJob(runId, { model, provider, promptVersion, reasoningEffort, reasoningMaxTokens } = {}) {
  clearJobCleanup(jobs.get(runId));

  const controller = new AbortController();
  jobs.set(runId, {
    status: 'running',
    model,
    provider,
    promptVersion,
    reasoningEffort,
    reasoningMaxTokens,
    events: [],
    subscribers: new Set(),
    controller,
    cleanupHandle: null,
  });
  return controller.signal;
}

export function listActiveJobs() {
  return [...jobs.entries()]
    .filter(([, job]) => job.status === 'running')
    .map(([runId, job]) => ({
      runId,
      model: job.model,
      provider: job.provider,
      status: job.status,
    }));
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

export function isJobActive(runId) {
  return getJob(runId)?.status === 'running';
}

export function pushEvent(runId, event) {
  const job = jobs.get(runId);
  if (!job) return;

  appendJobEvent(job, event);
  if (event.type === 'done' || event.type === 'fatal_error' || event.type === 'cancelled') {
    job.status = event.type === 'done' ? 'done' : event.type === 'cancelled' ? 'cancelled' : 'error';
  }

  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const subscriber of job.subscribers) {
    subscriber.write(line);
    if (job.status !== 'running') subscriber.end();
  }

  if (job.status !== 'running') {
    job.subscribers.clear();
    scheduleJobCleanup(runId, job);
  }
}

export function subscribe(runId, res) {
  const job = jobs.get(runId);
  if (!job) return false;

  // Replay buffered events so late subscribers still receive the full visible progress.
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

export function __setJobsConfigForTests({
  maxEvents,
  completedTtlMs,
  scheduleCleanupFn,
  cancelCleanupFn,
} = {}) {
  if (maxEvents != null) maxJobEvents = maxEvents;
  if (completedTtlMs != null) completedJobTtlMs = completedTtlMs;
  if (scheduleCleanupFn) scheduleCleanup = scheduleCleanupFn;
  if (cancelCleanupFn) cancelCleanup = cancelCleanupFn;
}

export function __resetJobsForTests() {
  for (const job of jobs.values()) {
    clearJobCleanup(job);
  }
  jobs.clear();
  maxJobEvents = DEFAULT_MAX_JOB_EVENTS;
  completedJobTtlMs = DEFAULT_COMPLETED_JOB_TTL_MS;
  scheduleCleanup = (callback, delay) => setTimeout(callback, delay);
  cancelCleanup = (handle) => clearTimeout(handle);
}
