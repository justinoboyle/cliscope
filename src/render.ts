import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import type { Report, ToolStat, View } from './types.js';

export interface RenderOptions {
  readonly width: number;
  readonly color: boolean;
  readonly ascii: boolean;
  readonly limit: number;
  readonly source: string;
  readonly view?: View;
}

const numberFormat = new Intl.NumberFormat('en-US');
const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

/** Remove terminal instructions, line breaks, and invisible direction controls. */
export function safeText(value: string): string {
  return stripVTControlCharacters(value).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '');
}

/** Truncate by terminal cells without splitting a Unicode grapheme. */
export function fitText(value: string, width: number, ascii = false): string {
  const clean = safeText(value);
  const available = Math.max(0, Math.floor(width));
  if (stringWidth(clean) <= available) return clean;
  if (available === 0) return '';
  const suffix = ascii ? '~' : '…';
  let result = '';
  let used = 0;
  for (const { segment } of graphemes.segment(clean)) {
    const size = stringWidth(segment);
    if (used + size > available - 1) break;
    result += segment;
    used += size;
  }
  return result + suffix;
}

export function terminalWidth(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(240, Math.floor(value))) : 80;
}

export function formatCount(value: number): string {
  return numberFormat.format(value);
}

function pad(value: string, width: number): string {
  return value + ' '.repeat(Math.max(0, width - stringWidth(value)));
}

/** One fixed-width ranking row. Bars are scaled against the leading tool. */
export function renderToolRow(
  tool: ToolStat,
  rank: number,
  maximum: number,
  width: number,
  ascii: boolean,
): string {
  const count = formatCount(tool.count);
  const share = `${(tool.share * 100).toFixed(1)}%`;
  if (width < 36) return fitText(`${tool.name}  ${count}  ${share}`, width, ascii);
  const rankText = String(rank).padStart(2);
  const nameWidth = Math.min(22, Math.max(6, Math.floor(width * 0.24)));
  const name = pad(fitText(tool.name, nameWidth, ascii), nameWidth);
  const countWidth = Math.max(5, formatCount(maximum).length, count.length);
  const barWidth = Math.max(1, width - rankText.length - nameWidth - countWidth - 6 - 8);
  const length =
    maximum > 0
      ? Math.min(barWidth, Math.max(1, Math.round((tool.count / maximum) * barWidth)))
      : 0;
  const bar = (ascii ? '#' : '█').repeat(length).padEnd(barWidth);
  return fitText(
    `${rankText}  ${name}  ${bar}  ${count.padStart(countWidth)}  ${share.padStart(6)}`,
    width,
    ascii,
  );
}

/** Calendar gaps are zero-filled; only the final 56 UTC days are displayed. */
export function activityLines(report: Report, width: number, ascii: boolean): readonly string[] {
  const last = report.days.at(-1);
  if (!last) return ['Activity unavailable: this history has no timestamps.'];
  const lastTime = Date.parse(`${last.date}T00:00:00.000Z`);
  const first = report.days[0];
  if (!first || !Number.isFinite(lastTime)) return [];
  const firstTime = Date.parse(`${first.date}T00:00:00.000Z`);
  const dayMs = 86_400_000;
  const dayCount = Math.min(56, Math.max(1, width), Math.floor((lastTime - firstTime) / dayMs) + 1);
  if (!Number.isFinite(dayCount) || dayCount < 1) return [];
  const counts = new Map(report.days.map((day) => [day.date, day.count]));
  const start = lastTime - (dayCount - 1) * dayMs;
  const values = Array.from(
    { length: dayCount },
    (_, index) => counts.get(new Date(start + index * dayMs).toISOString().slice(0, 10)) ?? 0,
  );
  const maximum = Math.max(1, ...values);
  const levels = ascii ? '12345678' : '▁▂▃▄▅▆▇█';
  const line = values
    .map((count) =>
      count === 0 ? (ascii ? '.' : '·') : levels[Math.min(7, Math.ceil((count / maximum) * 8) - 1)],
    )
    .join('');
  return [
    `Daily activity (UTC, ${dayCount} ${dayCount === 1 ? 'day' : 'days'})`,
    line,
    `${new Date(start).toISOString().slice(0, 10)} - ${last.date}  |  peak ${formatCount(maximum)} invocations/day`,
  ];
}

export function renderReport(report: Report, options: RenderOptions): string {
  const width = terminalWidth(options.width);
  const limit = Number.isFinite(options.limit) ? Math.max(0, Math.floor(options.limit)) : 10;
  const tools = report.tools.slice(0, limit);
  const lines: string[] = [];
  const add = (text: string, style?: 'title' | 'muted' | 'bar'): void => {
    const line = fitText(text, width, options.ascii);
    const code = style === 'title' ? '1;36' : style === 'muted' ? '2' : '36';
    lines.push(options.color && style ? `\u001b[${code}m${line}\u001b[0m` : line);
  };
  add(
    `${formatCount(report.totalInvocations)} invocations  |  ${formatCount(report.uniqueTools)} tools  |  ${formatCount(report.totalEntries)} history entries`,
    'title',
  );
  add(`Source: ${options.source}`, 'muted');
  add('');
  if (report.tools.length === 0) {
    add('No tools found in this history.');
    add('Use --history PATH --shell bash|zsh|fish.', 'muted');
  } else {
    add(`Top ${tools.length} ${tools.length === 1 ? 'tool' : 'tools'} (count, share)`, 'muted');
    const maximum = report.tools[0]?.count ?? 0;
    for (const [index, tool] of tools.entries()) {
      add(
        renderToolRow(tool, index + 1, maximum, width, options.ascii),
        index === 0 ? 'bar' : undefined,
      );
    }
    const represented = tools.reduce((sum, tool) => sum + tool.count, 0);
    const coverage =
      report.totalInvocations > 0
        ? ((represented / report.totalInvocations) * 100).toFixed(1)
        : '0.0';
    add('');
    add(`Shown: ${coverage}% of invocations. Bars scale to the leading tool.`, 'muted');
  }
  add('');
  for (const line of activityLines(report, width, options.ascii)) add(line, 'muted');
  return `${lines.join('\n')}\n`;
}
