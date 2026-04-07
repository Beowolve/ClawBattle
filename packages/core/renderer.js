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

export async function render(code) {
  const b = await getBrowser();
  const page = await b.newPage();

  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await page.setContent(code || '', { waitUntil: 'networkidle0' });

  const screenshot = await page.screenshot({
    clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
  });

  await page.close();
  return screenshot;
}
