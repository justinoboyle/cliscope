import { fitText, formatCount, terminalWidth } from './render.js';
import type { Report } from './types.js';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export interface WeekdayStat {
  readonly name: string;
  readonly count: number;
  readonly days: number;
  readonly average: number;
  /** Mean daily count relative to the busiest weekday, from 0 to 100. */
  readonly score: number;
}

function dateNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / DAY_MS;
}

function weekday(day: number): number {
  return (new Date(day * DAY_MS).getUTCDay() + 6) % 7;
}

function dateLabel(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Count calendar opportunities arithmetically, including quiet days in the span. */
export function weekdayStats(report: Report): readonly WeekdayStat[] {
  const first = report.days[0];
  const last = report.days.at(-1);
  if (!first || !last) return [];
  const start = dateNumber(first.date);
  const span = dateNumber(last.date) - start + 1;
  const completeWeeks = Math.floor(span / 7);
  const remainder = span % 7;
  const counts = Array.from({ length: 7 }, () => 0);
  for (const day of report.days) {
    const index = weekday(dateNumber(day.date));
    counts[index] = (counts[index] ?? 0) + day.count;
  }
  const stats = WEEKDAYS.map((name, index) => {
    const days = completeWeeks + ((index - weekday(start) + 7) % 7 < remainder ? 1 : 0);
    const count = counts[index] ?? 0;
    return { name, count, days, average: days === 0 ? 0 : count / days };
  });
  const peak = Math.max(...stats.map((stat) => stat.average));
  return stats.map((stat) => ({ ...stat, score: peak === 0 ? 0 : (stat.average / peak) * 100 }));
}

export function renderWeekdays(report: Report, width: number, ascii: boolean): string {
  const stats = weekdayStats(report);
  const columns = terminalWidth(width);
  if (stats.length === 0)
    return `${fitText('No dated history. Weekday statistics unavailable.', columns, ascii)}\n`;
  const lines = ['Weekday usage (UTC)', 'Day   Count    Days   Mean/day   Score'];
  for (const stat of stats) {
    const bar = (ascii ? '#' : '█').repeat(Math.round(stat.score / 10));
    lines.push(
      `${stat.name} ${formatCount(stat.count).padStart(7)} ${String(stat.days).padStart(7)} ${stat.average.toFixed(1).padStart(10)} ${stat.score.toFixed(0).padStart(6)} ${bar}`,
    );
  }
  lines.push(
    '',
    'Mean includes quiet days between the first and last dated entries.',
    'Score: mean / highest weekday mean × 100.',
  );
  return `${lines.map((line) => fitText(line, columns, ascii)).join('\n')}\n`;
}

function intensity(count: number, peak: number, ascii: boolean): string {
  if (count === 0) return ascii ? '.' : '·';
  const index = Math.min(3, Math.ceil((count / peak) * 4) - 1);
  return (ascii ? '1234' : '░▒▓█')[index] ?? '.';
}

/** Render at most twelve weeks; each column is a UTC week starting Monday. */
export function renderCalendar(report: Report, width: number, ascii: boolean): string {
  const first = report.days[0];
  const last = report.days.at(-1);
  const columns = terminalWidth(width);
  if (!first || !last)
    return `${fitText('No dated history. Calendar unavailable.', columns, ascii)}\n`;
  const end = dateNumber(last.date);
  const firstDay = dateNumber(first.date);
  const endWeek = end - weekday(end);
  const weeks = Math.min(
    12,
    Math.max(1, Math.floor((columns - 4) / 2)),
    Math.floor((endWeek - firstDay + 6) / 7) + 1,
  );
  const start = endWeek - (weeks - 1) * 7;
  const counts = new Map(report.days.map((day) => [dateNumber(day.date), day.count]));
  const visibleCounts = report.days
    .filter((day) => dateNumber(day.date) >= start)
    .map((day) => day.count);
  const peak = Math.max(0, ...visibleCounts);
  const lines = ['Calendar (UTC)', `${dateLabel(Math.max(firstDay, start))} to ${last.date}`];
  for (const [index, name] of WEEKDAYS.entries()) {
    const cells = Array.from({ length: weeks }, (_, week) => {
      const day = start + week * 7 + index;
      return day < firstDay || day > end ? ' ' : intensity(counts.get(day) ?? 0, peak, ascii);
    });
    lines.push(`${name} ${cells.join(' ')}`);
  }
  lines.push('', `Each column is one week; peak ${formatCount(peak)} invocations/day.`);
  return `${lines.map((line) => fitText(line, columns, ascii)).join('\n')}\n`;
}
