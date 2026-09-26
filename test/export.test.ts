import assert from 'node:assert/strict';
import { test } from 'node:test';
import { weekdayStats } from '../src/calendar.js';
import { formatReport } from '../src/export.js';
import type { RenderOptions } from '../src/render.js';
import type { Report } from '../src/types.js';

const options: RenderOptions = {
  width: 80,
  ascii: false,
  color: true,
  source: 'fixture',
  limit: 1,
};

function toolsReport(names: readonly string[]): Report {
  return {
    totalEntries: names.length,
    totalInvocations: names.length,
    uniqueTools: names.length,
    timestampedEntries: names.length,
    tools: names.map((name) => ({ name, count: 1, share: 1 / names.length })),
    days: [{ date: '2026-09-26', count: names.length }],
  };
}

await test('CSV quotes commas, double quotes, and embedded line endings using CRLF records', () => {
  const report = toolsReport(['a,b', 'say"hi', 'line\nbreak', 'line\r\nbreak']);
  assert.equal(
    formatReport(report, 'csv', 'tools', options),
    '"tool","count","share"\r\n"a,b",1,0.25\r\n"say""hi",1,0.25\r\n"line\nbreak",1,0.25\r\n"line\r\nbreak",1,0.25\r\n',
  );
});

await test('CSV neutralizes every spreadsheet formula prefix without changing JSON names', () => {
  for (const prefix of ['=', '+', '-', '@', '\t', '\r', '\n']) {
    const name = `${prefix}SUM(1,2)`;
    const report = toolsReport([name]);
    assert.equal(
      formatReport(report, 'csv', 'tools', options),
      `"tool","count","share"\r\n"'${name}",1,1\r\n`,
    );
    const decoded: unknown = JSON.parse(formatReport(report, 'json', 'tools', options));
    assert.deepEqual(decoded, { ...report, weekdays: weekdayStats(report) });
  }
});

await test('machine formats export all rows independently of --top and terminal styling', () => {
  const report = toolsReport(['git', 'npm', 'docker']);
  const csv = formatReport(report, 'csv', 'tools', options);
  assert.equal(csv.split('\r\n').filter(Boolean).length, 4);
  assert.match(csv, /"docker",1,/u);
  assert.ok(!csv.includes('\u001b'));
  const decoded: unknown = JSON.parse(formatReport(report, 'json', 'weekdays', options));
  assert.deepEqual(decoded, { ...report, weekdays: weekdayStats(report) });
});

await test('calendar and weekday CSV have explicit schemas and retain zero weekdays', () => {
  const report = toolsReport(['git']);
  assert.equal(
    formatReport(report, 'csv', 'calendar', options),
    '"date_utc","count"\r\n"2026-09-26",1\r\n',
  );
  const weekdays = formatReport(report, 'csv', 'weekdays', options);
  assert.ok(weekdays.startsWith('"weekday_utc","count","days","mean","score"\r\n'));
  assert.equal(weekdays.split('\r\n').filter(Boolean).length, 8);
  assert.match(weekdays, /"Sat",1,1,1,100\r\n/u);
  assert.match(weekdays, /"Sun",0,0,0,0\r\n/u);
});

await test('text output dispatches the selected view', () => {
  const report = toolsReport(['git']);
  assert.match(formatReport(report, 'text', 'tools', options), /Top 1 tool/u);
  assert.match(formatReport(report, 'text', 'calendar', options), /Calendar \(UTC\)/u);
  assert.match(formatReport(report, 'text', 'weekdays', options), /Weekday usage \(UTC\)/u);
});
