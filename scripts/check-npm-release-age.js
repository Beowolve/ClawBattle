import { glob, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const registry = 'https://registry.npmjs.org';
const minimumAgeDays = 7;
const cutoff = Date.now() - minimumAgeDays * 24 * 60 * 60 * 1000;
const versionsByPackage = new Map();

const lockfiles = glob(['package-lock.json', 'packages/*/package-lock.json'], { cwd: root });
for await (const filename of lockfiles) {
  const lock = JSON.parse(await readFile(resolve(root, filename), 'utf8'));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path === '') continue;
    if (!entry.resolved?.startsWith(`${registry}/`) || !entry.version) {
      throw new Error(`${filename}: cannot verify publication date for ${path}`);
    }

    const name = entry.name ?? path.split('node_modules/').at(-1);
    if (!versionsByPackage.has(name)) versionsByPackage.set(name, new Set());
    versionsByPackage.get(name).add(entry.version);
  }
}

if (versionsByPackage.size === 0) throw new Error('No locked npm packages found');

async function checkPackage([name, versions]) {
  const response = await fetch(`${registry}/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${name}: npm registry returned HTTP ${response.status}`);

  const { time } = await response.json();
  for (const version of versions) {
    const published = Date.parse(time?.[version]);
    if (!Number.isFinite(published) || published > cutoff) {
      console.error(`${name}@${version}: publication date ${time?.[version] ?? 'unknown'}, cutoff ${new Date(cutoff).toISOString()}`);
      process.exitCode = 1;
    }
  }
}

const packages = [...versionsByPackage];
const batchSize = 12;
for (let start = 0; start < packages.length; start += batchSize) {
  await Promise.all(packages.slice(start, start + batchSize).map(checkPackage));
}

if (!process.exitCode) {
  console.log(`Checked ${packages.length} npm packages. All locked versions are at least ${minimumAgeDays} days old.`);
}
