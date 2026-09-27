import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import * as fc from 'fast-check';
import stringWidth from 'string-width';
import { renderCalendar, renderWeekdays, weekdayStats } from '../src/calendar.js';
import type { DayStat, Report } from '../src/types.js';

const dayMs = 86_400_000;
const weekdayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' });

function reportFor(days: readonly DayStat[]): Report {
  const total = days.reduce((sum, day) => sum + day.count, 0);
  return {
    totalEntries: total,
    totalInvocations: total,
    uniqueTools: 0,
    timestampedEntries: total,
    tools: [],
    days,
  };
}

await test('weekday scores normalize mean usage and include missing days in partial weeks', () => {
  const report = reportFor([
    { date: '2026-09-21', count: 40 },
    { date: '2026-09-23', count: 30 },
    { date: '2026-09-29', count: 20 },
  ]);
  const stats = weekdayStats(report);
  assert.deepEqual(
    stats.map((day) => [day.name, day.count, day.days, day.average]),
    [
      ['Mon', 40, 2, 20],
      ['Tue', 20, 2, 10],
      ['Wed', 30, 1, 30],
      ['Thu', 0, 1, 0],
      ['Fri', 0, 1, 0],
      ['Sat', 0, 1, 0],
      ['Sun', 0, 1, 0],
    ],
  );
  assert.equal(stats.find((day) => day.name === 'Wed')?.score, 100);
  assert.ok((stats.find((day) => day.name === 'Mon')?.score ?? 100) < 100);
  assert.equal(
    stats.reduce((sum, day) => sum + day.count, 0),
    90,
  );
});

await test('UTC opportunity counts include leap day and cross year boundaries', () => {
  const leap = weekdayStats(
    reportFor([
      { date: '2024-02-28', count: 1 },
      { date: '2024-03-01', count: 2 },
    ]),
  );
  assert.deepEqual(
    leap.filter((day) => day.days > 0).map((day) => [day.name, day.days]),
    [
      ['Wed', 1],
      ['Thu', 1],
      ['Fri', 1],
    ],
  );
  const year = weekdayStats(
    reportFor([
      { date: '2023-12-31', count: 1 },
      { date: '2024-01-02', count: 2 },
    ]),
  );
  assert.deepEqual(
    year.filter((day) => day.days > 0).map((day) => [day.name, day.days]),
    [
      ['Mon', 1],
      ['Tue', 1],
      ['Sun', 1],
    ],
  );
});

await test('all-zero dated history has zero scores and zero peak; missing timestamps have no statistics', () => {
  const zeros = reportFor([
    { date: '2024-02-28', count: 0 },
    { date: '2024-03-01', count: 0 },
  ]);
  const stats = weekdayStats(zeros);
  assert.equal(stats.length, 7);
  for (const day of stats) assert.equal(day.score, 0);
  assert.match(renderCalendar(zeros, 80, false), /peak 0 invocations\/day/u);
  assert.doesNotMatch(renderWeekdays(zeros, 80, false), /NaN|Infinity/u);
  assert.deepEqual(weekdayStats(reportFor([])), []);
  assert.match(renderCalendar(reportFor([]), 80, false), /No dated history/u);
});

await test('calendar aligns quiet dates and out-of-range cells to Monday-based weeks', () => {
  const output = renderCalendar(
    reportFor([
      { date: '2026-09-01', count: 1 },
      { date: '2026-09-03', count: 4 },
    ]),
    80,
    true,
  );
  assert.match(output, /^Mon  $/mu);
  assert.match(output, /^Tue 1$/mu);
  assert.match(output, /^Wed \.$/mu);
  assert.match(output, /^Thu 4$/mu);
  assert.match(output, /^Fri  $/mu);
  assert.doesNotMatch(output, /[░▒▓█]/u);
});

await test('calendar peak and quiet cells use only the visible date window', () => {
  const days = [
    { date: '2000-01-01', count: 999_999 },
    { date: '2026-09-01', count: 1 },
    { date: '2026-09-03', count: 4 },
  ];
  const output = renderCalendar(reportFor(days), 80, true);
  assert.match(output, /peak 4 invocations\/day/u);
  assert.doesNotMatch(output, /999/u);
  assert.match(output, /^Wed (?:\. ){11}\.$/mu);
  assert.match(output, /^Thu (?:\. ){11}4$/mu);
});

await test('older dated rows do not affect calendar output after its visible window is full', () => {
  fc.assert(
    fc.property(
      fc.array(fc.nat({ max: 1_000 }), { minLength: 100, maxLength: 1_000 }),
      fc.integer({ min: 1, max: 240 }),
      fc.boolean(),
      (counts, width, ascii) => {
        const days = counts.map((count, index) => ({
          date: new Date((18_000 + index * 2) * dayMs).toISOString().slice(0, 10),
          count,
        }));
        const first = days[0];
        assert.ok(first);
        const recent = [first, ...days.slice(-84)];
        assert.equal(
          renderCalendar(reportFor(days), width, ascii),
          renderCalendar(reportFor(recent), width, ascii),
        );
      },
    ),
    { numRuns: 300 },
  );
});

await test('weekday totals and opportunities agree with an independent bounded calendar oracle', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 30_000 }),
      fc.array(fc.nat({ max: 100 }), { minLength: 1, maxLength: 90 }),
      (start, counts) => {
        const expected = new Map<string, { count: number; days: number }>();
        const days = counts
          .map((count, index) => {
            const instant = new Date((start + index) * dayMs);
            const name = weekdayName.format(instant);
            const previous = expected.get(name) ?? { count: 0, days: 0 };
            expected.set(name, { count: previous.count + count, days: previous.days + 1 });
            return { date: instant.toISOString().slice(0, 10), count };
          })
          .filter((day, index) => day.count > 0 || index === 0 || index === counts.length - 1);
        const stats = weekdayStats(reportFor(days));
        assert.equal(
          stats.reduce((sum, day) => sum + day.days, 0),
          counts.length,
        );
        for (const day of stats) {
          const reference = expected.get(day.name) ?? { count: 0, days: 0 };
          assert.equal(day.count, reference.count);
          assert.equal(day.days, reference.days);
          assert.ok(Number.isFinite(day.score) && day.score >= 0 && day.score <= 100);
        }
      },
    ),
    { numRuns: 300 },
  );
});

await test('calendar and weekday text honor terminal width even for empty reports', () => {
  const dated = reportFor([
    { date: '2026-01-01', count: 20 },
    { date: '2026-09-26', count: 5 },
  ]);
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 300 }), fc.boolean(), (width, ascii) => {
      for (const report of [dated, reportFor([])]) {
        for (const render of [renderCalendar, renderWeekdays]) {
          for (const line of render(report, width, ascii).split('\n'))
            assert.ok(stringWidth(line) <= Math.min(width, 240));
        }
      }
    }),
    { numRuns: 300 },
  );
});

await test('millennia of sparse history produce bounded output without expanding the date span', () => {
  const report = reportFor([
    { date: '0001-01-01', count: 1 },
    { date: '9999-12-31', count: 2 },
  ]);
  const started = performance.now();
  const stats = weekdayStats(report);
  const calendar = renderCalendar(report, 240, false);
  assert.equal(
    stats.reduce((sum, day) => sum + day.days, 0),
    3_652_059,
  );
  assert.equal(
    stats.reduce((sum, day) => sum + day.count, 0),
    3,
  );
  assert.ok(calendar.length < 1000);
  assert.ok(performance.now() - started < 1000, 'Sparse-span rendering must remain bounded');
});
