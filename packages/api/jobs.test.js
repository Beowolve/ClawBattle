import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createJob,
  listActiveJobs,
  cancelJob,
  getJob,
  isJobActive,
  pushEvent,
  subscribe,
  unsubscribe,
  getAttemptRequests,
  __setJobsConfigForTests,
  __resetJobsForTests,
} from './jobs.js';

function createMockSubscriber() {
  return {
    writes: [],
    ended: false,
    write(line) {
      this.writes.push(line);
    },
    end() {
      this.ended = true;
    },
  };
}

function parseSseLines(lines) {
  return lines.map(line => JSON.parse(line.replace(/^data:\s*/, '').trim()));
}

afterEach(() => {
  // Each test must start with a clean in-memory store so assertions stay local
  // and do not depend on ordering or hidden shared state.
  __resetJobsForTests();
});

test('createJob stores metadata, marks the job as running, and returns a live abort signal', () => {
  const signal = createJob('run-1', {
    model: 'gpt-5',
    provider: 'openai',
    promptVersion: 'v2',
    reasoningEffort: 'high',
  });

  const job = getJob('run-1');
  assert.ok(job);
  assert.equal(job.status, 'running');
  assert.equal(job.model, 'gpt-5');
  assert.equal(job.provider, 'openai');
  assert.equal(job.promptVersion, 'v2');
  assert.equal(job.reasoningEffort, 'high');
  assert.equal(job.events.length, 0);
  assert.equal(job.subscribers.size, 0);
  assert.equal(signal.aborted, false);
});

test('listActiveJobs returns only running jobs with the public dashboard metadata', () => {
  createJob('run-1', { model: 'gpt-5', provider: 'openai' });
  createJob('run-2', { model: 'gpt-4.1', provider: 'openrouter' });
  pushEvent('run-2', { type: 'done' });

  assert.deepEqual(listActiveJobs(), [
    { runId: 'run-1', model: 'gpt-5', provider: 'openai', status: 'running' },
  ]);
});

test('isJobActive distinguishes between running jobs and finished jobs still retained for replay', () => {
  createJob('run-1', { model: 'gpt-5', provider: 'openai' });
  assert.equal(isJobActive('run-1'), true);

  pushEvent('run-1', { type: 'done' });
  assert.ok(getJob('run-1'));
  assert.equal(isJobActive('run-1'), false);
});

test('cancelJob aborts running jobs and refuses missing or finished jobs', () => {
  const signal = createJob('run-1', { model: 'gpt-5', provider: 'openai' });

  assert.equal(cancelJob('missing'), false);
  assert.equal(cancelJob('run-1'), true);
  assert.equal(signal.aborted, true);

  pushEvent('run-1', { type: 'cancelled' });
  assert.equal(cancelJob('run-1'), false);
});

test('pushEvent stores events, broadcasts them, and closes finished subscribers', () => {
  createJob('run-1', { model: 'gpt-5', provider: 'openai' });
  const subscriber = createMockSubscriber();
  assert.equal(subscribe('run-1', subscriber), true);

  pushEvent('run-1', { type: 'target_started', targetId: 1 });
  pushEvent('run-1', { type: 'done' });

  const job = getJob('run-1');
  assert.deepEqual(job.events, [
    { type: 'target_started', targetId: 1 },
    { type: 'done' },
  ]);
  assert.equal(job.status, 'done');
  assert.equal(job.subscribers.size, 0);
  assert.deepEqual(parseSseLines(subscriber.writes), [
    { type: 'target_started', targetId: 1 },
    { type: 'done' },
  ]);
  assert.equal(subscriber.ended, true);
});

test('pushEvent maps terminal event types to the expected stored status', () => {
  createJob('done-job', {});
  pushEvent('done-job', { type: 'done' });
  assert.equal(getJob('done-job').status, 'done');

  createJob('cancelled-job', {});
  pushEvent('cancelled-job', { type: 'cancelled' });
  assert.equal(getJob('cancelled-job').status, 'cancelled');

  createJob('error-job', {});
  pushEvent('error-job', { type: 'fatal_error' });
  assert.equal(getJob('error-job').status, 'error');
});

test('subscribe replays buffered events for running jobs and keeps the subscriber attached', () => {
  createJob('run-1', { model: 'gpt-5', provider: 'openai' });
  pushEvent('run-1', { type: 'start' });
  pushEvent('run-1', { type: 'attempt', attempt: 1 });

  const subscriber = createMockSubscriber();
  assert.equal(subscribe('run-1', subscriber), true);

  assert.deepEqual(parseSseLines(subscriber.writes), [
    { type: 'start' },
    { type: 'attempt', attempt: 1 },
  ]);
  assert.equal(subscriber.ended, false);
  assert.equal(getJob('run-1').subscribers.has(subscriber), true);
});

test('subscribe to a finished job replays buffered events and ends immediately', () => {
  createJob('run-1', { model: 'gpt-5', provider: 'openai' });
  pushEvent('run-1', { type: 'start' });
  pushEvent('run-1', { type: 'done' });

  const subscriber = createMockSubscriber();
  assert.equal(subscribe('run-1', subscriber), true);

  assert.deepEqual(parseSseLines(subscriber.writes), [
    { type: 'start' },
    { type: 'done' },
  ]);
  assert.equal(subscriber.ended, true);
  assert.equal(getJob('run-1').subscribers.size, 0);
});

test('subscribe returns false for unknown jobs and unsubscribe is a safe no-op', () => {
  const subscriber = createMockSubscriber();

  assert.equal(subscribe('missing', subscriber), false);
  assert.doesNotThrow(() => unsubscribe('missing', subscriber));
});

test('unsubscribe detaches the subscriber so later events are not written to it', () => {
  createJob('run-1', { model: 'gpt-5', provider: 'openai' });
  const subscriber = createMockSubscriber();
  subscribe('run-1', subscriber);

  unsubscribe('run-1', subscriber);
  pushEvent('run-1', { type: 'attempt', attempt: 1 });

  assert.deepEqual(subscriber.writes, []);
});

test('pushEvent keeps only the configured ring buffer of recent events', () => {
  __setJobsConfigForTests({ maxEvents: 2 });
  createJob('run-1', { model: 'gpt-5', provider: 'openai' });

  pushEvent('run-1', { type: 'start' });
  pushEvent('run-1', { type: 'attempt', attempt: 1 });
  pushEvent('run-1', { type: 'attempt', attempt: 2 });

  const subscriber = createMockSubscriber();
  assert.equal(subscribe('run-1', subscriber), true);

  assert.deepEqual(getJob('run-1').events, [
    { type: 'attempt', attempt: 1 },
    { type: 'attempt', attempt: 2 },
  ]);
  assert.deepEqual(parseSseLines(subscriber.writes), [
    { type: 'attempt', attempt: 1 },
    { type: 'attempt', attempt: 2 },
  ]);
});

test('llm_request events keep full request in-memory while SSE gets only preview metadata', () => {
  createJob('run-1', { model: 'kimi', provider: 'openrouter' });
  const subscriber = createMockSubscriber();
  assert.equal(subscribe('run-1', subscriber), true);

  pushEvent('run-1', {
    type: 'llm_request',
    attemptId: 123,
    attempt: 2,
    targetId: '7',
    model: 'moonshotai/kimi-k2.6',
    provider: 'openrouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    method: 'POST',
    requestAttempt: 1,
    requestBody: {
      model: 'moonshotai/kimi-k2.6',
      provider: { order: ['io.net'], allow_fallbacks: false },
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    },
  });

  const stored = getAttemptRequests('run-1', 123);
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0].requestBody, {
    model: 'moonshotai/kimi-k2.6',
    provider: { order: ['io.net'], allow_fallbacks: false },
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
  });

  const streamed = parseSseLines(subscriber.writes);
  assert.equal(streamed.length, 1);
  assert.equal(streamed[0].type, 'llm_request');
  assert.equal(streamed[0].requestBody, undefined);
  assert.deepEqual(streamed[0].requestPreview, {
    provider: { order: ['io.net'], allow_fallbacks: false },
    reasoning: null,
    max_tokens: null,
    content_parts: 1,
    image_parts: 0,
  });
});

test('finished jobs are evicted after the configured cleanup TTL fires', () => {
  const scheduled = [];
  __setJobsConfigForTests({
    completedTtlMs: 1234,
    scheduleCleanupFn(callback, delay) {
      scheduled.push({ callback, delay });
      return { callback, delay };
    },
    cancelCleanupFn() {},
  });

  createJob('run-1', { model: 'gpt-5', provider: 'openai' });
  pushEvent('run-1', { type: 'done' });

  assert.ok(getJob('run-1'));
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1234);

  scheduled[0].callback();
  assert.equal(getJob('run-1'), undefined);
});

test('creating a new job with the same run id cancels stale cleanup from the previous finished job', () => {
  const scheduled = [];
  const cancelled = [];
  __setJobsConfigForTests({
    completedTtlMs: 1,
    scheduleCleanupFn(callback, delay) {
      const handle = { callback, delay };
      scheduled.push(handle);
      return handle;
    },
    cancelCleanupFn(handle) {
      cancelled.push(handle);
    },
  });

  createJob('run-1', { model: 'gpt-5', provider: 'openai' });
  pushEvent('run-1', { type: 'done' });
  assert.equal(scheduled.length, 1);

  const replacementSignal = createJob('run-1', { model: 'gpt-4.1', provider: 'openrouter' });

  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0], scheduled[0]);
  assert.equal(getJob('run-1').status, 'running');
  assert.equal(getJob('run-1').model, 'gpt-4.1');
  assert.equal(replacementSignal.aborted, false);

  // A stale cleanup callback from the old finished job must not delete the new job.
  scheduled[0].callback();
  assert.ok(getJob('run-1'));
  assert.equal(getJob('run-1').status, 'running');
});
