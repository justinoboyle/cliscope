#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { constants } from 'node:os';
import { fileURLToPath } from 'node:url';

const resolve = createRequire(import.meta.url).resolve;

function usesMusl(): boolean {
  if (process.platform !== 'linux') return false;
  const report = process.report.getReport();
  if (typeof report !== 'object' || !('header' in report)) return false;
  const header = report.header;
  return typeof header === 'object' && header !== null && !('glibcVersionRuntime' in header);
}

/** Resolve the installed runtime; never download or execute a global command. */
function bunExecutable(): string {
  // bun/bin/bun.exe is a placeholder when npm install scripts are disabled.
  // Resolve the native dependency directly, including nested package layouts.
  const runtime = createRequire(resolve('bun/package.json'));
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const arch = process.arch === 'arm64' ? 'aarch64' : process.arch;
  const libc = usesMusl() ? '-musl' : '';
  const executable = process.platform === 'win32' ? 'bun.exe' : 'bun';
  try {
    return runtime.resolve(`@oven/bun-${platform}-${arch}${libc}/bin/${executable}`);
  } catch {
    // Bun's install script moves the native executable to this location.
    return resolve('bun/bin/bun.exe');
  }
}

function launch(): void {
  const child = spawn(
    bunExecutable(),
    [
      '--no-env-file',
      '--no-install',
      `--config=${fileURLToPath(new URL('./bunfig.toml', import.meta.url))}`,
      fileURLToPath(new URL('./app.js', import.meta.url)),
      ...process.argv.slice(2),
    ],
    { stdio: 'inherit' },
  );
  const forward = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  child.once('error', (error) => {
    process.stderr.write(`cliscope: cannot start runtime: ${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('close', (code, signal) => {
    process.off('SIGINT', forward);
    process.off('SIGTERM', forward);
    process.exitCode = code ?? (signal ? 128 + constants.signals[signal] : 1);
  });
}

try {
  launch();
} catch {
  process.stderr.write(
    'cliscope: runtime not found; reinstall with optional dependencies enabled\n',
  );
  process.exitCode = 1;
}
