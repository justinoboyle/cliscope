import { renderCalendar, renderWeekdays, weekdayStats } from './calendar.js';
import { renderReport, safeText, type RenderOptions } from './render.js';
import type { Report, View } from './types.js';

export type OutputFormat = 'text' | 'json' | 'csv';

/** Sanitize terminal controls before quoting and checking spreadsheet formulas. */
function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const clean = safeText(value);
  const text = /^[=+@-]/.test(clean) ? `'${clean}` : clean;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvRows(report: Report, view: View): readonly (readonly (string | number)[])[] {
  switch (view) {
    case 'tools':
      return [
        ['tool', 'count', 'share'],
        ...report.tools.map((tool) => [tool.name, tool.count, tool.share]),
      ];
    case 'calendar':
      return [['date_utc', 'count'], ...report.days.map((day) => [day.date, day.count])];
    case 'weekdays':
      return [
        ['weekday_utc', 'count', 'days', 'mean', 'score'],
        ...weekdayStats(report).map((day) => [
          day.name,
          day.count,
          day.days,
          day.average,
          day.score,
        ]),
      ];
    default:
      throw new Error(`unsupported view: ${String(view satisfies never)}`);
  }
}

export function formatReport(
  report: Report,
  format: OutputFormat,
  view: View,
  options: RenderOptions,
): string {
  if (format === 'json')
    return `${JSON.stringify({ ...report, weekdays: weekdayStats(report) }, null, 2)}\n`;
  if (format === 'csv')
    return `${csvRows(report, view)
      .map((row) => row.map(csvCell).join(','))
      .join('\r\n')}\r\n`;
  switch (view) {
    case 'tools':
      return renderReport(report, options);
    case 'calendar':
      return renderCalendar(report, options.width, options.ascii);
    case 'weekdays':
      return renderWeekdays(report, options.width, options.ascii);
    default:
      throw new Error(`unsupported view: ${String(view satisfies never)}`);
  }
}
