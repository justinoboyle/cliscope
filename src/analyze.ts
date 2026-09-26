import { extractTools, isHistoryTimestamp } from './history.js';
import type { AnalyzeOptions, HistoryEntry, Report } from './types.js';

/** Deterministic aggregation. Dates and the inclusive `since` boundary use UTC. */
export function analyze(entries: readonly HistoryEntry[], options: AnalyzeOptions = {}): Report {
  if (options.since !== undefined && !Number.isFinite(options.since)) {
    throw new RangeError('since must be a finite Unix timestamp in milliseconds');
  }
  const counts = new Map<string, number>();
  const days = new Map<string, number>();
  let totalEntries = 0;
  let totalInvocations = 0;
  let timestampedEntries = 0;
  for (const entry of entries) {
    const time = entry.timestamp;
    const validTime = isHistoryTimestamp(time);
    if (options.since !== undefined && (!validTime || (time ?? -Infinity) < options.since))
      continue;
    totalEntries += 1;
    const tools = extractTools(entry.command);
    totalInvocations += tools.length;
    for (const tool of tools) counts.set(tool, (counts.get(tool) ?? 0) + 1);
    if (validTime && time !== null) {
      timestampedEntries += 1;
      const day = new Date(time).toISOString().split('T')[0] ?? '';
      days.set(day, (days.get(day) ?? 0) + tools.length);
    }
  }
  return {
    totalEntries,
    totalInvocations,
    uniqueTools: counts.size,
    timestampedEntries,
    tools: [...counts]
      .toSorted(([a, ac], [b, bc]) => bc - ac || (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, count]) => ({ name, count, share: count / totalInvocations })),
    days: [...days]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, count]) => ({ date, count })),
  };
}
