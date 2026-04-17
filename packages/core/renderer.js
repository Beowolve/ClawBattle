// Core renderer – wraps Puppeteer
// Browser is reused across renders; call closeBrowser() when done.

import puppeteer from 'puppeteer';

const WIDTH = 400;
const HEIGHT = 300;

let browser;

async function getBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    });
  }
  return browser;
}

export async function getChromeVersion() {
  const b = await getBrowser();
  const version = await b.version(); // e.g. "HeadlessChrome/136.0.7103.93"
  return version.split('/')[1] ?? version;
}

export async function closeBrowser() {
  if (browser) {
    await browser.close();
    browser = undefined;
  }
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
