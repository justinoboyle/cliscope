import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { analyze } from '../src/analyze.js';
import { renderCalendar, weekdayStats } from '../src/calendar.js';
import { parseHistory, extractTools } from '../src/history.js';
import { renderReport } from '../src/render.js';

interface Measurement {
  readonly name: string;
  readonly medianMs: number;
  readonly budgetMs: number;
  readonly samplesMs: readonly number[];
}

const SIZE = 100_000;
const commands = [
  'git status',
  'npm test',
  'docker ps',
  'rg needle src',
  'curl https://example.invalid',
];
const history = Array.from(
  { length: SIZE },
  (_, index) => `: ${1_700_000_000 + index}:0;${commands[index % commands.length] ?? 'git status'}`,
).join('\n');
const entries = parseHistory(history, 'zsh');
const report = analyze(entries);
const distinctEntries = entries.map((entry, index) => ({
  ...entry,
  command: `${entry.command} item-${index}`,
}));
assert.equal(report.totalInvocations, SIZE);
const measurements: Measurement[] = [];

function measure(name: string, budgetMs: number, operation: () => void): void {
  operation();
  const samplesMs = Array.from({ length: 5 }, () => {
    const start = performance.now();
    operation();
    return performance.now() - start;
  }).toSorted((a, b) => a - b);
  const medianMs = samplesMs[2] ?? Infinity;
  measurements.push({ name, medianMs, budgetMs, samplesMs });
  console.log(`${name}: ${medianMs.toFixed(1)} ms median (limit ${budgetMs} ms)`);
}

measure('parse 100k zsh records', 500, () => {
  assert.equal(parseHistory(history, 'zsh').length, SIZE);
});
measure('extract 100k command chains', 1500, () => {
  let count = 0;
  for (let index = 0; index < SIZE; index++)
    count += extractTools('sudo -u root git status && npm test | head -n 2').length;
  assert.equal(count, SIZE * 3);
});
measure('analyze 100k repeated records', 300, () => {
  assert.equal(analyze(entries).totalInvocations, SIZE);
});
measure('analyze 100k distinct records', 1000, () => {
  assert.equal(analyze(distinctEntries).totalInvocations, SIZE);
});
measure('render 100 reports', 100, () => {
  for (let index = 0; index < 100; index++)
    renderReport(report, { width: 80, ascii: true, color: false, limit: 10, source: 'benchmark' });
});
measure('calendar and weekday 100 reports', 50, () => {
  for (let index = 0; index < 100; index++) {
    renderCalendar(report, 80, true);
    weekdayStats(report);
  }
});

if (process.argv.includes('--startup')) {
  measure('packaged command startup', 750, () => {
    const child = spawnSync(process.execPath, ['dist/launcher.js', '--demo', '--json'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /"totalInvocations": 474/);
  });
}

if (process.argv.includes('--binary')) {
  measure('standalone command startup', 500, () => {
    const executable = process.platform === 'win32' ? 'cliscope.exe' : 'cliscope';
    const child = spawnSync(resolve('artifacts', executable), ['--demo', '--json'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /"totalInvocations": 474/);
  });
}

const phase = process.argv.includes('--binary')
  ? 'binary'
  : process.argv.includes('--startup')
    ? 'package'
    : 'test';
const result = `${JSON.stringify(
  {
    runtime: process.version,
    platform: process.platform,
    arch: process.arch,
    records: SIZE,
    rssBytes: process.memoryUsage().rss,
    measurements,
  },
  null,
  2,
)}\n`;
await mkdir('artifacts', { recursive: true });
await Promise.all([
  writeFile('artifacts/performance.json', result),
  writeFile(`artifacts/performance-${phase}.json`, result),
]);
assert.ok(
  measurements.every((measurement) => measurement.medianMs <= measurement.budgetMs),
  'performance budget exceeded; see artifacts/performance.json',
);
