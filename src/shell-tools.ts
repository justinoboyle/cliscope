import { tokenize } from './shell-lexer.js';
import type { Token, Word } from './shell-lexer.js';

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

function isPrefix(word: Word): boolean {
  return word.assignment || (!word.quoted && controlPrefixes.has(word.text));
}

function isCommand(word: Word): boolean {
  return !word.dynamic && word.text.length > 0 && (word.quoted || !nonCommands.has(word.text));
}

/** These options inspect commands or parse their own command language. */
function stopsUnwrapping(wrapper: string, option: string): boolean {
  if (['--help', '--version'].includes(option)) return true;
  if (wrapper === 'command') return /^-[^-]*[vV]/.test(option);
  if (wrapper === 'env') return option.startsWith('-S') || option.startsWith('--split-string');
  return wrapper === 'sudo' && /^-[^-]*[elLvV]/.test(option);
}

/** Resolve only the command prefix; argument words never accumulate. */
class Invocation {
  private phase: 'command' | 'options' | 'value' | 'duration' | 'done' = 'command';
  private wrapper = '';
  private takesValue: ReadonlySet<string> = new Set();
  name: string | undefined;

  read(word: Word): void {
    switch (this.phase) {
      case 'done':
        return;
      case 'value':
        this.phase = 'options';
        return;
      case 'duration':
        this.phase = 'command';
        return;
      case 'options':
        this.readOption(word);
        return;
      case 'command':
        this.readCommand(word);
    }
  }

  private readCommand(word: Word): void {
    this.name = undefined;
    if (isPrefix(word)) return;
    this.phase = 'done';
    if (!isCommand(word)) return;
    const name = baseName(word.text);
    this.name = name || undefined;
    const takesValue = Object.hasOwn(wrapperOptions, name) ? wrapperOptions[name] : undefined;
    if (takesValue === undefined) return;
    this.wrapper = name;
    this.takesValue = takesValue;
    this.phase = 'options';
  }

  private readOption(word: Word): void {
    const option = word.text;
    if (option === '--') {
      this.phase = this.wrapper === 'timeout' ? 'duration' : 'command';
    } else if (!option.startsWith('-') || option === '-') {
      this.phase = 'command';
      if (this.wrapper !== 'timeout') this.readCommand(word);
    } else if (stopsUnwrapping(this.wrapper, option)) {
      this.phase = 'done';
    } else {
      const key = option.split('=')[0] ?? option;
      if (this.takesValue.has(key) && !option.includes('=')) this.phase = 'value';
    }
  }
}

/** Keep only the lookbehind needed to reject unsupported record syntax. */
class SyntaxGuard {
  private previous: Token | undefined;
  private beforePrevious: Token | undefined;

  accepts(token: Token): boolean {
    const functionDefinition =
      this.beforePrevious?.kind === 'word' && this.previous?.text === '(' && token.text === ')';
    const commandPosition = this.previous === undefined || this.previous.kind === 'operator';
    const unsupported =
      token.kind === 'operator'
        ? token.text === '<<'
        : !token.quoted && commandPosition && ['function', 'case', 'switch'].includes(token.text);
    this.beforePrevious = this.previous;
    this.previous = token;
    return !functionDefinition && !unsupported;
  }
}

/**
 * Extract lexical top-level command invocations, never execute shell input.
 * Aliases/functions cannot be resolved from history. Substitutions and dynamic
 * command names are not expanded. Function definitions and heredocs are skipped
 * conservatively; this is intentionally not a full shell-program interpreter.
 */
function scanTools(command: string, onTool: (name: string) => void): boolean {
  const tokens = tokenize(command);
  const syntax = new SyntaxGuard();
  let invocation = new Invocation();
  let redirect = false;
  const flush = (): void => {
    if (invocation.name !== undefined) onTool(invocation.name);
    invocation = new Invocation();
    redirect = false;
  };
  for (const token of tokens) {
    if (!syntax.accepts(token)) return false;
    if (token.kind === 'operator') {
      if (/[<>]/.test(token.text)) redirect = true;
      else flush();
    } else if (redirect) {
      redirect = false;
    } else {
      invocation.read(token);
    }
  }
  if (!tokens.complete) return false;
  if (invocation.name !== undefined) onTool(invocation.name);
  return true;
}

export function extractTools(command: string): readonly string[] {
  const tools: string[] = [];
  const valid = scanTools(command, (name) => tools.push(name));
  return valid ? tools : [];
}

export interface ToolCounts {
  readonly totalInvocations: number;
  readonly counts: ReadonlyMap<string, number>;
}

/** Publish counts only after the complete record passes syntax validation. */
export function countTools(command: string): ToolCounts {
  const counts = new Map<string, number>();
  let totalInvocations = 0;
  const valid = scanTools(command, (name) => {
    counts.set(name, (counts.get(name) ?? 0) + 1);
    totalInvocations++;
  });
  return valid ? { totalInvocations, counts } : { totalInvocations: 0, counts: new Map() };
}
