// Core renderer – wraps Puppeteer.
// Browser ownership lives at the process entrypoint, not inside a benchmark run.

import puppeteer from 'puppeteer';

const WIDTH = 400;
const HEIGHT = 300;

let browser;
let launchPromise;
let shutdownPromise;
let browserLauncher = launchBrowser;

function isBrowserUsable(candidate) {
  return candidate && candidate.connected !== false;
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
  });
}

function handleBrowserDisconnected(instance) {
  if (browser === instance) {
    browser = undefined;
  }
}

function attachDisconnectHandler(instance) {
  const onDisconnected = () => handleBrowserDisconnected(instance);
  if (typeof instance.once === 'function') {
    instance.once('disconnected', onDisconnected);
  } else if (typeof instance.on === 'function') {
    instance.on('disconnected', onDisconnected);
  }
}

async function getBrowser() {
  if (isBrowserUsable(browser)) {
    return browser;
  }

  if (!launchPromise) {
    launchPromise = (async () => {
      const instance = await browserLauncher();
      attachDisconnectHandler(instance);
      browser = instance;
      return instance;
    })().finally(() => {
      launchPromise = undefined;
    });
  }

  return launchPromise;
}

export async function getChromeVersion() {
  const b = await getBrowser();
  const version = await b.version(); // e.g. "HeadlessChrome/136.0.7103.93"
  return version.split('/')[1] ?? version;
}

export async function closeBrowser() {
  if (shutdownPromise) {
    return shutdownPromise;
  }

  shutdownPromise = (async () => {
    const instance = launchPromise
      ? await launchPromise.catch(() => null)
      : browser;

    browser = undefined;
    if (instance && typeof instance.close === 'function') {
      await instance.close();
    }
  })().finally(() => {
    browser = undefined;
    launchPromise = undefined;
    shutdownPromise = undefined;
  });

  return shutdownPromise;
}

function abortPromise(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
}

export async function render(code, { signal } = {}) {
  const b = await getBrowser();
  const page = await b.newPage();

  try {
    const work = (async () => {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
      await page.setContent(code || '', { waitUntil: 'networkidle0' });
      return page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    })();

    if (signal) {
      return await Promise.race([work, abortPromise(signal)]);
    }
    return await work;
  } finally {
    // Fire-and-forget: on abort, don't block returning to the worker.
    page.close().catch(() => {});
  }
}

export function __setBrowserLauncherForTests(launcher) {
  browserLauncher = launcher;
}

export async function __resetRendererForTests() {
  await closeBrowser().catch(() => {});
  browser = undefined;
  launchPromise = undefined;
  shutdownPromise = undefined;
  browserLauncher = launchBrowser;
}
