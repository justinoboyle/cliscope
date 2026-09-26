import type { HistoryEntry, Shell } from './types.js';

export { extractTools } from './shell-tools.js';

/** Keep activity dates within the report's four-digit ISO year contract. */
export function isHistoryTimestamp(value: number | null): value is number {
  return (
    value !== null &&
    Number.isSafeInteger(value) &&
    value >= -62_167_219_200_000 &&
    value <= 253_402_300_799_999
  );
}

function timestamp(seconds: string): number | null {
  const milliseconds = Number(seconds) * 1_000;
  return isHistoryTimestamp(milliseconds) ? milliseconds : null;
}

function entry(command: string, time: number | null): HistoryEntry | undefined {
  const trimmed = command.trim();
  return trimmed.length === 0 ? undefined : { command: trimmed, timestamp: time };
}

/** Decode fish's history-file escaping, which is deliberately not general YAML. */
function decodeFish(command: string): string {
  return command.replace(/\\([\\n])/g, (_, character: string) => (character === 'n' ? '\n' : '\\'));
}

type AppendEntry = (command: string, time: number | null) => void;

function entryCollector(): { entries: HistoryEntry[]; append: AppendEntry } {
  const entries: HistoryEntry[] = [];
  return {
    entries,
    append(command, time) {
      const parsed = entry(command, time);
      if (parsed !== undefined) entries.push(parsed);
    },
  };
}

function parseFish(lines: readonly string[]): readonly HistoryEntry[] {
  const { entries, append } = entryCollector();
  let command: string | undefined;
  let time: number | null = null;
  for (const line of lines) {
    const start = /^- cmd: (.*)$/.exec(line);
    if (start !== null) {
      if (command !== undefined) append(command, time);
      command = decodeFish(start[1] ?? '');
      time = null;
    } else if (command !== undefined) {
      const when = /^\s+when:\s*(-?\d+)\s*$/.exec(line);
      if (when !== null) time = timestamp(when[1] ?? '');
    }
  }
  if (command !== undefined) append(command, time);
  return entries;
}

function parseBash(lines: readonly string[]): readonly HistoryEntry[] {
  const { entries, append } = entryCollector();
  let pending: string[] | undefined;
  let time: number | null = null;
  for (const line of lines) {
    const marker = /^#(\d+)\s*$/.exec(line);
    if (marker !== null) {
      if (pending !== undefined) append(pending.join('\n'), time);
      pending = [];
      time = timestamp(marker[1] ?? '');
    } else if (pending !== undefined) {
      pending.push(line);
    } else {
      append(line, null);
    }
  }
  if (pending !== undefined) append(pending.join('\n'), time);
  return entries;
}

function parseZsh(lines: readonly string[]): readonly HistoryEntry[] {
  const { entries, append } = entryCollector();
  // Zsh stores embedded newlines as a backslash followed by a physical newline.
  let pending = '';
  let pendingTime: number | null = null;
  for (const line of lines) {
    if (pending.length === 0) {
      const extended = /^: (\d+):\d+;(.*)$/.exec(line);
      pending = extended?.[2] ?? line;
      pendingTime = extended === null ? null : timestamp(extended[1] ?? '');
    } else {
      pending += line;
    }
    const trailingSlashes = /\\+$/.exec(pending)?.[0].length ?? 0;
    if (trailingSlashes % 2 === 1) {
      pending = `${pending.slice(0, -1)}\n`;
    } else {
      append(pending, pendingTime);
      pending = '';
      pendingTime = null;
    }
  }
  if (pending.length > 0) append(pending, pendingTime);
  return entries;
}

/**
 * Parse inert text, preserving unknown/invalid timestamps as null. Bash multiline
 * records require timestamp delimiters; undated bash/zsh records are line based.
 */
export function parseHistory(text: string, shell: Shell): readonly HistoryEntry[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const parsers = { fish: parseFish, bash: parseBash, zsh: parseZsh };
  return parsers[shell](lines);
}
