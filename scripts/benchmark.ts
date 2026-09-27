import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { analyze } from '../src/analyze.js';
import { renderCalendar, weekdayStats } from '../src/calendar.js';
import { parseHistory, extractTools } from '../src/history.js';
import { createInteractiveData } from '../src/interactive-data.js';
import { createToolFilter } from '../src/interactive-state.js';
import { activityLines, fitText, renderReport } from '../src/render.js';

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
const denseRecordPeakRssKiB: Record<string, number[]> = {};

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
const continuedHistory = `: 0:0;${'x\\\n'.repeat(SIZE)}done`;
const continuedCommand = `${'x\n'.repeat(SIZE)}done`;
measure('parse 100k continued zsh lines', 300, () => {
  assert.deepEqual(parseHistory(continuedHistory, 'zsh'), [
    { command: continuedCommand, timestamp: 0 },
  ]);
});
const slashRun = `echo ${'\\'.repeat(SIZE)}x`;
measure('parse a 100k backslash run', 300, () => {
  assert.deepEqual(parseHistory(slashRun, 'zsh'), [{ command: slashRun, timestamp: null }]);
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
  for (let index = 0; index < 100; index++) {
    const output = renderReport(report, {
      width: 80,
      ascii: true,
      color: false,
      limit: 10,
      source: 'benchmark',
    });
    assert.match(output, /100,000 invocations  \|  5 tools/);
    assert.match(output, /Shown: 100\.0%/);
  }
});
measure('calendar and weekday 100 reports', 50, () => {
  for (let index = 0; index < 100; index++) {
    assert.match(renderCalendar(report, 80, true), /peak 86,400 invocations\/day/);
    assert.deepEqual(
      weekdayStats(report).map((day) => day.count),
      [0, 6400, 86400, 7200, 0, 0, 0],
    );
  }
});

const datedReport = analyze(
  Array.from({ length: 50_000 }, (_, index) => ({ command: 'git', timestamp: index * 86_400_000 })),
);
measure('render 100 calendars from 50k dated days', 300, () => {
  for (let index = 0; index < 100; index++) {
    const output = renderCalendar(datedReport, 80, true);
    assert.match(output, /2106-09-06 to 2106-11-23/);
    assert.match(output, /Tue 4 4 4 4 4 4 4 4 4 4 4 4/);
    assert.match(output, /peak 1 invocations\/day/);
  }
});
measure('render 20 activity charts from 50k dated days', 30, () => {
  for (let index = 0; index < 20; index++)
    assert.deepEqual(activityLines(datedReport, 80, true), [
      'Daily activity (UTC, 56 days)',
      '8'.repeat(56),
      '2106-09-29 - 2106-11-23  |  peak 1 invocations/day',
    ]);
});
const longLabel = '界'.repeat(500_000);
measure('truncate a 500k-character Unicode label', 50, () => {
  assert.equal(fitText(longLabel, 22), `${'界'.repeat(10)}…`);
});
const combiningLabel = `e${'\u0301'.repeat(500_000)}`;
measure('truncate a 500k-mark grapheme', 50, () => {
  assert.equal(fitText(combiningLabel, 22), '…');
});
const manyTools = Array.from({ length: 50_000 }, (_, index) => ({
  name: `tool_${index}`,
  count: 1,
  share: 1 / 50_000,
}));
const filter = createToolFilter(manyTools);
measure('prepare and search 50k tools', 100, () => {
  assert.equal(createToolFilter(manyTools)('49999').length, 1);
});
measure('change a query 20 times across 50k tools', 250, () => {
  for (let index = 0; index < 20; index++)
    assert.equal(filter(index % 2 === 0 ? '49999' : 'missing').length, index % 2 === 0 ? 1 : 0);
});
measure('reuse a query 20 times across 50k tools', 5, () => {
  for (let index = 0; index < 20; index++) assert.equal(filter('49999').length, 1);
});
const interactive = createInteractiveData(datedReport, true);
measure('prepare an interactive weekday view from 50k dated days', 100, () => {
  const lines = createInteractiveData(datedReport, true).lines('weekdays', 80);
  assert.equal(lines[2], 'Mon   7,143    7143        1.0    100 ##########');
});
measure('reuse 100 interactive views from 50k dated days', 10, () => {
  const lines = interactive.lines('weekdays', 80);
  assert.equal(lines[2], 'Mon   7,143    7143        1.0    100 ##########');
  for (let index = 0; index < 100; index++) assert.equal(interactive.lines('weekdays', 80), lines);
});

for (const name of [
  'operators',
  'arguments',
  'blank lines',
  'multiline blank lines',
  'continued blank lines',
  'command chains',
  'history entries',
]) {
  measure(`4 MiB ${name} with a 64 MiB heap`, 3000, () => {
    const child = spawnSync(
      process.execPath,
      ['--max-old-space-size=64', '--import', 'tsx', 'scripts/benchmark-memory.ts', name],
      { encoding: 'utf8', timeout: 15_000 },
    );
    assert.equal(child.status, 0, child.stderr);
    const peakRssKiB = Number(child.stdout.trim());
    assert.ok(Number.isSafeInteger(peakRssKiB) && peakRssKiB > 0);
    (denseRecordPeakRssKiB[name] ??= []).push(peakRssKiB);
  });
}

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
    denseRecords: {
      bytesPerCase: 4 * 1024 * 1024,
      heapLimitMiB: 64,
      peakRssKiB: denseRecordPeakRssKiB,
    },
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
