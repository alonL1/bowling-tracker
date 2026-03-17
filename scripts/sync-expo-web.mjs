import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const mobileDir = join(rootDir, 'mobile');
const mobileNodeModulesDir = join(mobileDir, 'node_modules');
const mobileExpoPackage = join(mobileNodeModulesDir, 'expo', 'package.json');
const mobileDistDir = join(mobileDir, 'dist');
const publicDir = join(rootDir, 'public');
const expoWebPublicDir = join(publicDir, 'expo-web');

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      APP_VARIANT: process.env.APP_VARIANT || 'production',
    },
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function patchExpoHtml(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      patchExpoHtml(fullPath);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith('.html')) {
      continue;
    }

    const nextContents = readFileSync(fullPath, 'utf8').replaceAll('/_expo/', '/expo-web/_expo/');
    writeFileSync(fullPath, nextContents);
  }
}

if (!existsSync(mobileExpoPackage)) {
  run('npm', ['ci'], mobileDir);
}

run('npm', ['run', 'export:web'], mobileDir);

rmSync(expoWebPublicDir, { recursive: true, force: true });
mkdirSync(expoWebPublicDir, { recursive: true });
cpSync(mobileDistDir, expoWebPublicDir, { recursive: true });
patchExpoHtml(expoWebPublicDir);

const exportedFavicon = join(mobileDistDir, 'favicon.ico');
if (existsSync(exportedFavicon)) {
  mkdirSync(publicDir, { recursive: true });
  cpSync(exportedFavicon, join(publicDir, 'favicon.ico'));
}
