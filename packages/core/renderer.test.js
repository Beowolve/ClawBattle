import test from 'node:test';
import assert from 'node:assert/strict';
import { getChromeVersion, render, closeBrowser, __resetRendererForTests, __setBrowserLauncherForTests } from './renderer.js';

function createStubBrowser(version = 'HeadlessChrome/136.0.7103.93') {
  const listeners = new Map();
  return {
    connected: true,
    closeCalls: 0,
    versionCalls: 0,
    newPageCalls: 0,
    once(event, handler) {
      listeners.set(event, handler);
    },
    async version() {
      this.versionCalls++;
      return version;
    },
    async newPage() {
      this.newPageCalls++;
      return {
        emulateMediaFeaturesCalls: 0,
        setContentCalls: 0,
        screenshotCalls: 0,
        closeCalls: 0,
        async emulateMediaFeatures() {
          this.emulateMediaFeaturesCalls++;
        },
        async setContent() {
          this.setContentCalls++;
          await new Promise(resolve => setTimeout(resolve, 5));
        },
        async screenshot() {
          this.screenshotCalls++;
          return Buffer.from(`render-${this.screenshotCalls}`);
        },
        async close() {
          this.closeCalls++;
        },
      };
    },
    async close() {
      this.closeCalls++;
      this.connected = false;
      listeners.get('disconnected')?.();
    },
    emit(event) {
      listeners.get(event)?.();
    },
  };
}

test('getChromeVersion launches the browser only once across concurrent callers', async () => {
  const launches = [];
  __setBrowserLauncherForTests(async () => {
    const browser = createStubBrowser();
    launches.push(browser);
    await Promise.resolve();
    return browser;
  });

  const [a, b] = await Promise.all([getChromeVersion(), getChromeVersion()]);

  assert.equal(a, '136.0.7103.93');
  assert.equal(b, '136.0.7103.93');
  assert.equal(launches.length, 1);

  await __resetRendererForTests();
});

test('closeBrowser resets the singleton so the next caller relaunches cleanly', async () => {
  const launches = [];
  __setBrowserLauncherForTests(async () => {
    const browser = createStubBrowser();
    launches.push(browser);
    return browser;
  });

  await getChromeVersion();
  await closeBrowser();
  await getChromeVersion();

  assert.equal(launches.length, 2);
  assert.equal(launches[0].closeCalls, 1);

  await __resetRendererForTests();
});

test('browser disconnect clears the cached instance so a fresh browser is launched', async () => {
  const launches = [];
  __setBrowserLauncherForTests(async () => {
    const browser = createStubBrowser();
    launches.push(browser);
    return browser;
  });

  await getChromeVersion();
  launches[0].connected = false;
  launches[0].emit('disconnected');
  await getChromeVersion();

  assert.equal(launches.length, 2);

  await __resetRendererForTests();
});

test('parallel renders share one browser instance until process shutdown closes it', async () => {
  const launches = [];
  __setBrowserLauncherForTests(async () => {
    const browser = createStubBrowser();
    launches.push(browser);
    return browser;
  });

  const [first, second] = await Promise.all([
    render('<div>first</div>'),
    render('<div>second</div>'),
  ]);

  assert.equal(launches.length, 1);
  assert.equal(launches[0].newPageCalls, 2);
  assert.ok(Buffer.isBuffer(first));
  assert.ok(Buffer.isBuffer(second));
  assert.equal(launches[0].closeCalls, 0);

  await closeBrowser();
  assert.equal(launches[0].closeCalls, 1);

  await __resetRendererForTests();
});
