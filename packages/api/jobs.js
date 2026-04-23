// In-memory store for active benchmark jobs and their SSE subscribers.
// Finished jobs are retained briefly for event replay and then evicted.

const DEFAULT_MAX_JOB_EVENTS = 200;
const DEFAULT_COMPLETED_JOB_TTL_MS = 5 * 60 * 1000;

const jobs = new Map(); // runId -> { status, model, provider, promptVersion, reasoningEffort, events, requestsByAttempt, subscribers, controller, cleanupHandle }

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

function summarizeRequestBody(body) {
  if (!body || typeof body !== 'object') return null;
  const content = body.messages?.[0]?.content;
  const contentParts = Array.isArray(content) ? content.length : 1;
  const imageParts = Array.isArray(content)
    ? content.filter((part) => part?.type === 'image_url').length
    : 0;
  return {
    provider: body.provider ?? null,
    reasoning: body.reasoning ?? null,
    max_tokens: body.max_tokens ?? null,
    content_parts: contentParts,
    image_parts: imageParts,
  };
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
    requestsByAttempt: new Map(),
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

  let eventForStream = event;
  if (event?.type === 'llm_request' && Number.isInteger(Number(event.attemptId))) {
    const attemptId = Number(event.attemptId);
    if (!job.requestsByAttempt.has(attemptId) && job.requestsByAttempt.size >= maxJobEvents) {
      const oldestAttemptId = job.requestsByAttempt.keys().next().value;
      if (oldestAttemptId != null) job.requestsByAttempt.delete(oldestAttemptId);
    }
    const history = job.requestsByAttempt.get(attemptId) ?? [];
    history.push({
      requestAttempt: event.requestAttempt ?? null,
      provider: event.provider ?? null,
      endpoint: event.endpoint ?? null,
      method: event.method ?? null,
      requestBody: event.requestBody ?? null,
    });
    if (history.length > 10) history.splice(0, history.length - 10);
    job.requestsByAttempt.set(attemptId, history);
    eventForStream = {
      ...event,
      requestBody: undefined,
      requestPreview: summarizeRequestBody(event.requestBody),
    };
  }

  appendJobEvent(job, eventForStream);
  if (event.type === 'done' || event.type === 'fatal_error' || event.type === 'cancelled') {
    job.status = event.type === 'done' ? 'done' : event.type === 'cancelled' ? 'cancelled' : 'error';
  }

  const line = `data: ${JSON.stringify(eventForStream)}\n\n`;
  for (const subscriber of job.subscribers) {
    subscriber.write(line);
    if (job.status !== 'running') subscriber.end();
  }

  if (job.status !== 'running') {
    job.subscribers.clear();
    scheduleJobCleanup(runId, job);
  }
}

export function getAttemptRequests(runId, attemptId) {
  const job = jobs.get(runId);
  if (!job) return [];
  return [...(job.requestsByAttempt.get(Number(attemptId)) ?? [])];
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
