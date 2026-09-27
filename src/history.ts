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

function* yieldEntry(command: string, time: number | null): IterableIterator<HistoryEntry> {
  const parsed = entry(command, time);
  if (parsed !== undefined) yield parsed;
}

/** Join fixed batches so tiny lines do not each retain a slot for the whole record. */
class RecordFragments {
  private readonly chunks: string[] = [];
  private readonly fragments: string[] = [];

  get empty(): boolean {
    return this.chunks.length === 0 && this.fragments.length === 0;
  }

  append(fragment: string): void {
    this.fragments.push(fragment);
    if (this.fragments.length === 1024) {
      this.chunks.push(this.fragments.join(''));
      this.fragments.length = 0;
    }
  }

  take(): string {
    const tail = this.fragments.join('');
    this.fragments.length = 0;
    if (this.chunks.length === 0) return tail;
    this.chunks.push(tail);
    const command = this.chunks.join('');
    this.chunks.length = 0;
    return command;
  }
}

function* parseFish(lines: Iterable<string>): IterableIterator<HistoryEntry> {
  let command: string | undefined;
  let time: number | null = null;
  for (const line of lines) {
    const start = /^- cmd: (.*)$/.exec(line);
    if (start !== null) {
      if (command !== undefined) yield* yieldEntry(command, time);
      command = decodeFish(start[1] ?? '');
      time = null;
    } else if (command !== undefined) {
      const when = /^\s+when:\s*(-?\d+)\s*$/.exec(line);
      if (when !== null) time = timestamp(when[1] ?? '');
    }
  }
  if (command !== undefined) yield* yieldEntry(command, time);
}

function* parseBash(lines: Iterable<string>): IterableIterator<HistoryEntry> {
  let pending: RecordFragments | undefined;
  let time: number | null = null;
  for (const line of lines) {
    const marker = /^#(\d+)\s*$/.exec(line);
    if (marker !== null) {
      if (pending !== undefined) yield* yieldEntry(pending.take(), time);
      pending = new RecordFragments();
      time = timestamp(marker[1] ?? '');
    } else if (pending !== undefined) {
      pending.append(pending.empty ? line : `\n${line}`);
    } else {
      yield* yieldEntry(line, null);
    }
  }
  if (pending !== undefined) yield* yieldEntry(pending.take(), time);
}

function continuesZsh(line: string): boolean {
  let index = line.length;
  while (index > 0 && line[index - 1] === '\\') index--;
  return (line.length - index) % 2 === 1;
}

function* parseZsh(lines: Iterable<string>): IterableIterator<HistoryEntry> {
  // Inspect each physical line once; fixed batches keep record assembly linear.
  const pending = new RecordFragments();
  let pendingTime: number | null = null;
  for (const line of lines) {
    let fragment = line;
    if (pending.empty) {
      const extended = /^: (\d+):\d+;(.*)$/.exec(line);
      fragment = extended?.[2] ?? line;
      pendingTime = extended === null ? null : timestamp(extended[1] ?? '');
    }
    // Zsh stores embedded newlines as a backslash followed by a physical newline.
    if (continuesZsh(fragment)) {
      pending.append(`${fragment.slice(0, -1)}\n`);
    } else {
      pending.append(fragment);
      yield* yieldEntry(pending.take(), pendingTime);
      pendingTime = null;
    }
  }
  if (!pending.empty) yield* yieldEntry(pending.take(), pendingTime);
}

/** Match splitting on CRLF or LF without retaining an array of physical lines. */
function* historyLines(text: string): IterableIterator<string> {
  let start = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let end = text.indexOf('\n', start);
  while (end !== -1) {
    yield text.slice(start, end > start && text[end - 1] === '\r' ? end - 1 : end);
    start = end + 1;
    end = text.indexOf('\n', start);
  }
  yield text.slice(start);
}

/**
 * Parse inert text, preserving unknown/invalid timestamps as null. Bash multiline
 * records require timestamp delimiters; undated bash/zsh records are line based.
 */
export function iterateHistory(text: string, shell: Shell): IterableIterator<HistoryEntry> {
  const lines = historyLines(text);
  const parsers = { fish: parseFish, bash: parseBash, zsh: parseZsh };
  return parsers[shell](lines);
}

/** Collect parsed records for callers that need indexed access or repeated traversal. */
export function parseHistory(text: string, shell: Shell): readonly HistoryEntry[] {
  return [...iterateHistory(text, shell)];
}
