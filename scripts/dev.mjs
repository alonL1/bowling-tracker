import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { watch } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const mobileDir = join(rootDir, 'mobile');
const watchedPaths = [
  join(mobileDir, 'src'),
  join(mobileDir, 'assets'),
  join(mobileDir, 'app.config.ts'),
  join(mobileDir, 'package.json'),
  join(mobileDir, '.env.local'),
];
const syncScript = join(rootDir, 'scripts', 'sync-expo-web.mjs');
const ignoredSegments = new Set(['dist', 'web-build', '.expo', 'node_modules']);

let syncInFlight = false;
let syncQueued = false;
let syncTimer = null;
let shuttingDown = false;

function runSync() {
  if (syncInFlight) {
    syncQueued = true;
    return;
  }

  syncInFlight = true;
  console.log('\n[sync:expo-web] exporting mobile web and syncing into Next public/');

  const result = spawnSync('node', [syncScript], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32',
  });

  syncInFlight = false;

  if (result.status !== 0) {
    console.error(`[sync:expo-web] failed with exit code ${result.status ?? 1}`);
  } else {
    console.log('[sync:expo-web] complete');
  }

  if (syncQueued && !shuttingDown) {
    syncQueued = false;
    queueSync();
  }
}

function queueSync() {
  if (syncTimer) {
    clearTimeout(syncTimer);
  }

  syncTimer = setTimeout(() => {
    syncTimer = null;
    runSync();
  }, 250);
}

function normalizeParts(filename) {
  return String(filename)
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean);
}

function shouldIgnore(parts) {
  return parts.some((part) => ignoredSegments.has(part));
}

runSync();

const nextDev = spawn('npm', ['run', 'dev:next'], {
  cwd: rootDir,
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});

const watchers = watchedPaths
  .filter((target) => existsSync(target))
  .map((target) => {
    const isDirectory = !/\.[^/\\]+$/.test(target);
    const watchTarget = isDirectory ? target : dirname(target);
    const watchedFileName = isDirectory ? null : basename(target);

    return watch(watchTarget, { recursive: isDirectory }, (_eventType, filename) => {
      if (!filename) {
        if (isDirectory) {
          queueSync();
        }
        return;
      }

      const parts = normalizeParts(filename);
      if (shouldIgnore(parts)) {
        return;
      }

      if (!isDirectory) {
        if (parts.length !== 1 || parts[0] !== watchedFileName) {
          return;
        }
      }

      queueSync();
    });
  });

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  for (const watcher of watchers) {
    watcher.close();
  }

  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }

  if (!nextDev.killed) {
    nextDev.kill('SIGINT');
  }

  process.exit(exitCode);
}

nextDev.on('exit', (code) => {
  shutdown(code ?? 0);
});

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
