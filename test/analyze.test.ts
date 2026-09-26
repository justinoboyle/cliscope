import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fc from 'fast-check';
import { analyze } from '../src/analyze.js';
import type { HistoryEntry } from '../src/types.js';

await test('cache rollover and long commands preserve counts across UTC epoch boundaries', () => {
  const entries = Array.from({ length: 2050 }, (_, index) => ({
    command: `git status item-${index}`,
    timestamp: index % 2 === 0 ? -1 : 0,
  }));
  entries.push({ command: `git ${'x'.repeat(5000)}`, timestamp: 0 });
  const report = analyze(entries);
  assert.equal(report.totalInvocations, 2051);
  assert.deepEqual(report.tools, [{ name: 'git', count: 2051, share: 1 }]);
  assert.deepEqual(report.days, [
    { date: '1969-12-31', count: 1025 },
    { date: '1970-01-01', count: 1026 },
  ]);
});

await test('aggregates invocations, deterministic ties and UTC activity', () => {
  const result = analyze([
    { command: 'git status && npm test', timestamp: Date.parse('2024-01-01T23:59:59Z') },
    { command: 'git diff | cat', timestamp: Date.parse('2024-01-02T00:00:00Z') },
    { command: 'npm install', timestamp: null },
  ]);
  assert.deepEqual(result, {
    totalEntries: 3,
    totalInvocations: 5,
    uniqueTools: 3,
    timestampedEntries: 2,
    tools: [
      { name: 'git', count: 2, share: 0.4 },
      { name: 'npm', count: 2, share: 0.4 },
      { name: 'cat', count: 1, share: 0.2 },
    ],
    days: [
      { date: '2024-01-01', count: 2 },
      { date: '2024-01-02', count: 2 },
    ],
  });
});

await test('since is inclusive and excludes unknown or invalid timestamps', () => {
  const entries = [
    { command: 'before', timestamp: 999 },
    { command: 'boundary', timestamp: 1_000 },
    { command: 'unknown', timestamp: null },
    { command: 'invalid', timestamp: NaN },
  ];
  const report = analyze(entries, { since: 1_000 });
  assert.equal(report.totalEntries, 1);
  assert.equal(report.timestampedEntries, 1);
  assert.equal(report.tools[0]?.name, 'boundary');
  assert.throws(() => analyze(entries, { since: NaN }), RangeError);
  assert.throws(() => analyze(entries, { since: Infinity }), RangeError);
});

await test('empty and non-command histories produce no invalid shares', () => {
  assert.deepEqual(analyze([]), {
    totalEntries: 0,
    totalInvocations: 0,
    uniqueTools: 0,
    timestampedEntries: 0,
    tools: [],
    days: [],
  });
  assert.equal(analyze([{ command: '# comment', timestamp: 0 }]).totalInvocations, 0);
  assert.equal(analyze([{ command: 'git', timestamp: Infinity }]).timestampedEntries, 0);
});

await test('activity dates obey the four-digit ISO year contract', () => {
  const report = analyze([
    { command: 'git', timestamp: -62_167_219_200_000 },
    { command: 'git', timestamp: 253_402_300_799_999 },
    { command: 'git', timestamp: -62_167_219_200_001 },
    { command: 'git', timestamp: 253_402_300_800_000 },
    { command: 'git', timestamp: 0.5 },
  ]);
  assert.equal(report.timestampedEntries, 2);
  assert.deepEqual(report.days, [
    { date: '0000-01-01', count: 1 },
    { date: '9999-12-31', count: 1 },
  ]);
  assert.equal(report.totalInvocations, 5);
});

await test('aggregation obeys count conservation, order independence and does not mutate input', () => {
  fc.assert(
    fc.property(
      fc.array(fc.constantFrom('git', 'npm', 'cargo', 'ls', 'rg'), { maxLength: 300 }),
      (commands) => {
        const entries: readonly HistoryEntry[] = Object.freeze(
          commands.map((command) => Object.freeze({ command, timestamp: 0 })),
        );
        const report = analyze(entries);
        assert.equal(report.totalEntries, commands.length);
        assert.equal(report.totalInvocations, commands.length);
        assert.equal(report.uniqueTools, new Set(commands).size);
        assert.equal(
          report.tools.reduce((sum, tool) => sum + tool.count, 0),
          report.totalInvocations,
        );
        assert.equal(
          report.days.reduce((sum, day) => sum + day.count, 0),
          report.totalInvocations,
        );
        assert.deepEqual(report, analyze(entries.toReversed()));
        for (const tool of report.tools) {
          assert.equal(tool.count, commands.filter((command) => command === tool.name).length);
          assert.ok(tool.share > 0 && tool.share <= 1);
        }
        if (commands.length > 0)
          assert.ok(Math.abs(report.tools.reduce((sum, tool) => sum + tool.share, 0) - 1) < 1e-12);
      },
    ),
    { numRuns: 1_000 },
  );
});
