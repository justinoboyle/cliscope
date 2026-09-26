#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stripVTControlCharacters } from 'node:util';
import metadata from '../package.json' with { type: 'json' };
import { analyze } from './analyze.js';
import { demoHistory } from './demo.js';
import { parseHistory } from './history.js';
import { loadHistory } from './io.js';
import { HELP, parseOptions } from './options.js';
import { renderReport } from './render.js';

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';
  return Array.from(stripVTControlCharacters(message), (character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 32 || (code >= 127 && code <= 159) ? ' ' : character;
  }).join('');
}

async function main(): Promise<void> {
  const command = parseOptions(process.argv.slice(2));
  switch (command.kind) {
    case 'help':
      process.stdout.write(HELP);
      return;
    case 'version':
      process.stdout.write(`${metadata.version}\n`);
      return;
    case 'analyze': {
      const { options } = command;
      if (options.interactive && (!process.stdin.isTTY || !process.stdout.isTTY)) {
        throw new Error('Interactive mode requires a terminal. Omit -i for a printable graph.');
      }
      // OpenTUI's native renderer needs FFI on Node. The standalone Bun binary does not.
      if (
        options.interactive &&
        !process.versions['bun'] &&
        !process.execArgv.includes('--experimental-ffi')
      ) {
        const child = spawn(
          process.execPath,
          [
            ...process.execArgv,
            '--experimental-ffi',
            fileURLToPath(import.meta.url),
            ...process.argv.slice(2),
          ],
          { stdio: 'inherit' },
        );
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject);
          child.once('exit', (code, signal) => {
            process.exitCode = code ?? (signal ? 130 : 1);
            resolve();
          });
        });
        return;
      }
      const source = options.demo ? undefined : await loadHistory(options);
      const entries = source ? parseHistory(source.text, source.shell) : demoHistory();
      const report = analyze(entries, options.since === undefined ? {} : { since: options.since });
      const renderOptions = {
        width: process.stdout.columns || 80,
        color:
          process.stdout.isTTY &&
          !options['no-color'] &&
          process.env['NO_COLOR'] === undefined &&
          process.env['TERM'] !== 'dumb',
        ascii: options.ascii || process.env['TERM'] === 'dumb',
        limit: options.top,
        source: source ? `${source.shell} · ${source.path}` : 'synthetic demo · September 2026',
      };
      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      } else if (options.interactive) {
        const { runInteractive } = await import('./interactive.js');
        await runInteractive(report, renderOptions);
      } else {
        process.stdout.write(renderReport(report, renderOptions));
      }
      return;
    }
  }
}

// A closed pipe is a successful consumer exit (e.g. cliscope | head).
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  process.stderr.write(`cliscope: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});

main().catch((error: unknown) => {
  process.stderr.write(`cliscope: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
