import { existsSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const androidDir = join(root, 'android');

function readLocalEnvironment() {
  const envFile = join(root, '.env.local');
  if (!existsSync(envFile)) return {};

  const values = {};
  for (const line of readFileSync(envFile, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;

    const name = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[name] = value;
  }
  return values;
}

const localEnvironment = readLocalEnvironment();
const javaHome = localEnvironment.JAVA_HOME || process.env.JAVA_HOME;

const env = { ...process.env, ...localEnvironment };
if (javaHome) {
  env.JAVA_HOME = javaHome;
  env.PATH = `${join(javaHome, 'bin')}${delimiter}${env.PATH || ''}`;
  console.log(`Using JAVA_HOME: ${javaHome}`);
}

const gradleCommand = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
const gradleArgs = ['assembleDebug'];

const result = spawnSync(gradleCommand, gradleArgs, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const apkPath = join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!existsSync(apkPath)) {
  console.error(`APK not found at ${apkPath}`);
  process.exit(1);
}

const outputDir = join(root, 'dist', 'android');
mkdirSync(outputDir, { recursive: true });
const outputPath = join(outputDir, 'ereader-japanese-vertical-debug.apk');
copyFileSync(apkPath, outputPath);
console.log(`Android APK copied to ${outputPath}`);
