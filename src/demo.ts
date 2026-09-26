import type { HistoryEntry } from './types.js';

/** Deterministic synthetic data; never includes the user's actual history. */
export function demoHistory(): readonly HistoryEntry[] {
  const tools = [
    ['git', 142],
    ['npm', 86],
    ['docker', 61],
    ['rg', 48],
    ['codex', 35],
    ['bun', 29],
    ['gh', 24],
    ['python', 18],
    ['curl', 12],
    ['ls', 9],
    ['ssh', 6],
    ['jq', 4],
  ] as const;
  const start = Date.UTC(2026, 8, 1);
  return tools.flatMap(([command, count], toolIndex) =>
    Array.from({ length: count }, (_, index) => ({
      command,
      timestamp: start + ((index * 7 + toolIndex * 3) % 28) * 86_400_000 + index * 1000,
    })),
  );
}
