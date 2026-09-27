import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderCalendar, renderWeekdays } from '../src/calendar.js';
import { createInteractiveData } from '../src/interactive-data.js';
import { activityLines, fitText } from '../src/render.js';
import type { Report } from '../src/types.js';

const report: Report = {
  totalEntries: 5,
  totalInvocations: 5,
  uniqueTools: 1,
  timestampedEntries: 5,
  tools: [{ name: 'git', count: 5, share: 1 }],
  days: [{ date: '2026-09-26', count: 5 }],
};

await test('derived views reuse width-specific results across selection and view changes', () => {
  const data = createInteractiveData(report, false);
  const activity = data.lines('tools', 80);
  const calendar = data.lines('calendar', 80);
  const weekdays = data.lines('weekdays', 80);
  assert.equal(data.lines('tools', 80), activity);
  assert.equal(data.lines('calendar', 80), calendar);
  assert.equal(data.lines('weekdays', 80), weekdays);
  assert.deepEqual(calendar, renderCalendar(report, 80, false).trimEnd().split('\n'));
  assert.deepEqual(weekdays, renderWeekdays(report, 80, false).trimEnd().split('\n'));
  assert.deepEqual(
    activity,
    activityLines(report, 80, false).map((line, index) =>
      fitText(index === 0 ? `All tools: ${line}` : line, 80),
    ),
  );
  assert.equal(data.tools(''), report.tools);
});

await test('resize invalidates derived views and caches belong to one immutable report', () => {
  const data = createInteractiveData(report, true);
  const before = data.lines('calendar', 80);
  const narrow = data.lines('calendar', 20);
  assert.notDeepEqual(before, narrow);
  assert.equal(data.lines('calendar', 20), narrow);
  const restored = data.lines('calendar', 80);
  assert.notEqual(restored, before);
  assert.deepEqual(restored, before);
  const empty = createInteractiveData({ ...report, days: [] }, true);
  assert.notDeepEqual(empty.lines('tools', 80), data.lines('tools', 80));
});
