import type { HistoryEntry, Shell } from './types.js';

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

/**
 * Parse history as inert text. Unknown dates remain null; malformed timestamps do
 * not become today's date. Bash multiline entries need timestamp delimiters to
 * be unambiguous. Untimestamped bash/zsh history is interpreted one line at a time.
 */
export function parseHistory(text: string, shell: Shell): readonly HistoryEntry[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const entries: HistoryEntry[] = [];
  const append = (command: string, time: number | null): void => {
    const parsed = entry(command, time);
    if (parsed !== undefined) entries.push(parsed);
  };

  if (shell === 'fish') {
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

  if (shell === 'bash') {
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

interface Word {
  readonly kind: 'word';
  readonly text: string;
  readonly dynamic: boolean;
  readonly quoted: boolean;
  readonly assignment: boolean;
}

interface Operator {
  readonly kind: 'operator';
  readonly text: string;
}

type Token = Word | Operator;

/** Skip balanced command substitutions without treating their content as tools. */
function substitutionEnd(command: string, start: number): number {
  let depth = 1;
  let quote: string | undefined;
  for (let index = start; index < command.length; index += 1) {
    const character = command[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')' && --depth === 0) return index;
  }
  return command.length;
}

function tokenize(command: string): readonly Token[] {
  const tokens: Token[] = [];
  let buffer = '';
  let started = false;
  let dynamic = false;
  let quoted = false;
  let assignmentPrefix = false;
  let quote: string | undefined;
  const flush = (): void => {
    if (started)
      tokens.push({
        kind: 'word',
        text: buffer,
        dynamic,
        quoted,
        assignment: assignments.test(buffer) && (!quoted || assignmentPrefix),
      });
    buffer = '';
    started = false;
    dynamic = false;
    quoted = false;
    assignmentPrefix = false;
  };
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index] ?? '';
    const next = command[index + 1];
    if (
      character === '\\' &&
      quote !== "'" &&
      (quote !== '"' || (next !== undefined && '$`"\\\n'.includes(next)))
    ) {
      if (next === '\n') {
        index += 1;
        continue;
      }
      if (next !== undefined) {
        buffer += next;
        index += 1;
        started = true;
        continue;
      }
    }
    if (quote === "'") {
      if (character === "'") quote = undefined;
      else buffer += character;
      continue;
    }
    if (character === '$' && next === '(') {
      dynamic = true;
      started = true;
      buffer += '$(…)';
      index = substitutionEnd(command, index + 2);
      continue;
    }
    if (quote === undefined && (character === '<' || character === '>') && next === '(') {
      dynamic = true;
      started = true;
      buffer += `${character}(…)`;
      index = substitutionEnd(command, index + 2);
      continue;
    }
    if (character === '`') {
      dynamic = true;
      started = true;
      buffer += '`…`';
      while (++index < command.length) {
        if (command[index] === '\\') index += 1;
        else if (command[index] === '`') break;
      }
      continue;
    }
    if (character === '$') dynamic = true;
    if (quote === '"') {
      if (character === '"') quote = undefined;
      else buffer += character;
      continue;
    }
    if (character === '"' || character === "'") {
      if (assignments.test(buffer) && !quoted) assignmentPrefix = true;
      quote = character;
      started = true;
      quoted = true;
      continue;
    }
    if (character === '#' && !started) {
      while (index < command.length && command[index] !== '\n') index += 1;
      flush();
      tokens.push({ kind: 'operator', text: '\n' });
      continue;
    }
    const braceOperator =
      (character === '{' || character === '}') &&
      !started &&
      (next === undefined || /[\s;]/.test(next));
    if (';\n|&()<>'.includes(character) || braceOperator) {
      // An adjacent numeric word is a file descriptor, not a command.
      if ((character === '>' || character === '<') && /^\d+$/.test(buffer) && !quoted) {
        buffer = '';
        started = false;
      }
      flush();
      let operator = character;
      if (
        (character === '&' && next === '&') ||
        (character === '|' && (next === '|' || next === '&')) ||
        ((character === '<' || character === '>') &&
          (next === character || next === '&' || next === '|')) ||
        (character === '&' && next === '>')
      ) {
        operator += next;
        index += 1;
        if (operator === '<<' && command[index + 1] === '<') {
          operator += '<';
          index += 1;
        }
      }
      tokens.push({ kind: 'operator', text: operator });
    } else if (/\s/.test(character)) {
      flush();
    } else {
      buffer += character;
      started = true;
      if ('*?[{'.includes(character)) dynamic = true;
    }
  }
  // An unterminated quoted command is incomplete; do not infer a tool from it.
  if (quote !== undefined) return [];
  flush();
  return tokens;
}

const assignments = /^[A-Za-z_][A-Za-z0-9_]*=/;
const controlPrefixes = new Set([
  'if',
  'then',
  'elif',
  'else',
  'while',
  'until',
  'do',
  '!',
  'and',
  'or',
  'not',
]);
const nonCommands = new Set([
  'fi',
  'done',
  'for',
  'select',
  'in',
  'case',
  'esac',
  'function',
  'switch',
  'end',
  'begin',
  'repeat',
  'foreach',
]);
const wrapperOptions: Readonly<Record<string, ReadonlySet<string>>> = {
  sudo: new Set([
    '-u',
    '--user',
    '-g',
    '--group',
    '-h',
    '--host',
    '-p',
    '--prompt',
    '-C',
    '--close-from',
    '-R',
    '--chroot',
    '-D',
    '--chdir',
    '-T',
    '--command-timeout',
  ]),
  env: new Set(['-u', '--unset', '-C', '--chdir', '--argv0']),
  nice: new Set(['-n', '--adjustment']),
  time: new Set(['-f', '--format', '-o', '--output']),
  timeout: new Set(['-s', '--signal', '-k', '--kill-after']),
  exec: new Set(['-a']),
  command: new Set(),
  builtin: new Set(),
  nohup: new Set(),
};

function baseName(word: string): string {
  return word.slice(word.lastIndexOf('/') + 1);
}

function toolFromWords(words: readonly Word[]): string | undefined {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (word === undefined) return undefined;
    if (word.assignment || (!word.quoted && controlPrefixes.has(word.text))) {
      index += 1;
      continue;
    }
    if (word.dynamic || word.text.length === 0 || (!word.quoted && nonCommands.has(word.text)))
      return undefined;
    const name = baseName(word.text);
    const takesValue = Object.hasOwn(wrapperOptions, name) ? wrapperOptions[name] : undefined;
    if (takesValue === undefined) return name.length === 0 ? undefined : name;
    const wrapper = name;
    index += 1;
    while (index < words.length) {
      const option = words[index]?.text ?? '';
      if (option === '--') {
        index += 1;
        break;
      }
      if (!option.startsWith('-') || option === '-') break;
      // These options inspect commands or parse their own command language.
      if (
        (wrapper === 'command' && /^-[^-]*[vV]/.test(option)) ||
        (wrapper === 'env' && (option.startsWith('-S') || option.startsWith('--split-string'))) ||
        ['--help', '--version'].includes(option) ||
        (wrapper === 'sudo' && /^-[^-]*[elLvV]/.test(option))
      )
        return wrapper;
      const key = option.split('=')[0] ?? option;
      index += takesValue.has(key) && !option.includes('=') ? 2 : 1;
    }
    if (wrapper === 'timeout') index += 1; // The duration precedes the actual command.
    if (index >= words.length) return wrapper;
  }
  return undefined;
}

/**
 * Extract lexical top-level command invocations, never execute shell input.
 * Aliases/functions cannot be resolved from history. Substitutions and dynamic
 * command names are not expanded. Function definitions and heredocs are skipped
 * conservatively; this is intentionally not a full shell-program interpreter.
 */
export function extractTools(command: string): readonly string[] {
  const tokens = tokenize(command);
  if (tokens.some((token) => token.kind === 'operator' && token.text === '<<')) return [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (
      tokens[index]?.kind === 'word' &&
      tokens[index + 1]?.text === '(' &&
      tokens[index + 2]?.text === ')'
    )
      return [];
    const token = tokens[index];
    if (
      token?.kind === 'word' &&
      !token.quoted &&
      (index === 0 || tokens[index - 1]?.kind === 'operator') &&
      ['function', 'case', 'switch'].includes(token.text)
    )
      return [];
  }
  const tools: string[] = [];
  let words: Word[] = [];
  let redirect = false;
  const flush = (): void => {
    const tool = toolFromWords(words);
    if (tool !== undefined) tools.push(tool);
    words = [];
    redirect = false;
  };
  for (const token of tokens) {
    if (token.kind === 'operator') {
      if (/[<>]/.test(token.text)) redirect = true;
      else flush();
    } else if (redirect) {
      redirect = false;
    } else {
      words.push(token);
    }
  }
  flush();
  return tools;
}
