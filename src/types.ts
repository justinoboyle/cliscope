/** History is data: commands are never evaluated or executed. */
export type Shell = 'bash' | 'zsh' | 'fish';

export interface HistoryEntry {
  readonly command: string;
  /** Unix epoch milliseconds, or null when the history format has no timestamp. */
  readonly timestamp: number | null;
}

export interface ToolStat {
  readonly name: string;
  readonly count: number;
  /** Fraction of all counted invocations, in [0, 1]. */
  readonly share: number;
}

export interface DayStat {
  /** UTC calendar date, YYYY-MM-DD. */
  readonly date: string;
  readonly count: number;
}

export interface Report {
  readonly totalEntries: number;
  readonly totalInvocations: number;
  readonly uniqueTools: number;
  readonly timestampedEntries: number;
  readonly tools: readonly ToolStat[];
  readonly days: readonly DayStat[];
}

export interface AnalyzeOptions {
  readonly since?: number;
}
