import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const androidDir = join(root, 'android');
const gradleCommand = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
const gradleArgs = ['assembleDebug'];

const result = spawnSync(gradleCommand, gradleArgs, {
  cwd: androidDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
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
