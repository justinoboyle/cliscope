#!/usr/bin/env bun
import { writeFile } from 'node:fs/promises';
import metadata from '../package.json' with { type: 'json' };
import { analyze } from './analyze.js';
import { demoHistory } from './demo.js';
import { formatReport, type OutputFormat } from './export.js';
import { parseHistory } from './history.js';
import { loadHistory } from './io.js';
import { HELP, parseOptions, type Options } from './options.js';
import { safeText, type RenderOptions } from './render.js';
import type { Report } from './types.js';

function errorMessage(error: unknown): string {
  return safeText(error instanceof Error ? error.message : 'unexpected error');
}

function outputFormat(options: Options): OutputFormat {
  if (options.json) return 'json';
  return options.csv ? 'csv' : 'text';
}

function renderOptions(options: Options, source: string): RenderOptions {
  const color =
    process.stdout.isTTY &&
    !options['no-color'] &&
    process.env['NO_COLOR'] === undefined &&
    process.env['TERM'] !== 'dumb' &&
    options.output === undefined;
  return {
    width: process.stdout.columns || 80,
    color,
    ascii: options.ascii || process.env['TERM'] === 'dumb',
    limit: options.top,
    view: options.view,
    source,
  };
}

async function writeReport(
  report: Report,
  options: Options,
  rendering: RenderOptions,
): Promise<void> {
  if (options.interactive) {
    const { runInteractive } = await import('./interactive.js');
    await runInteractive(report, rendering);
    return;
  }
  const output = formatReport(report, outputFormat(options), options.view, rendering);
  if (options.output && options.output !== '-') {
    await writeFile(options.output, output, { flag: 'wx', mode: 0o600 });
    return;
  }
  process.stdout.write(output);
}

async function run(options: Options): Promise<void> {
  if (options.interactive && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error('interactive mode requires a terminal; omit -i to print a report');
  }
  const source = options.demo ? undefined : await loadHistory(options);
  const entries = source ? parseHistory(source.text, source.shell) : demoHistory();
  const report = analyze(entries, options.since === undefined ? {} : { since: options.since });
  const label = source ? `${source.shell}: ${source.path}` : 'sample history';
  await writeReport(report, options, renderOptions(options, label));
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
    case 'analyze':
      await run(command.options);
  }
}

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  process.stderr.write(`cliscope: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});

main().catch((error: unknown) => {
  process.stderr.write(`cliscope: ${errorMessage(error)}\n`);
  process.exitCode = 1;
});
