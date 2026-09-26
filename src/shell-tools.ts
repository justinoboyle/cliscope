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

function unwrapOptions(
  words: readonly Word[],
  start: number,
  wrapper: string,
  takesValue: ReadonlySet<string>,
): number | undefined {
  let index = start;
  while (index < words.length) {
    const option = words[index]?.text ?? '';
    if (option === '--') return index + 1;
    if (!option.startsWith('-') || option === '-') return index;
    if (stopsUnwrapping(wrapper, option)) return undefined;
    const key = option.split('=')[0] ?? option;
    index += takesValue.has(key) && !option.includes('=') ? 2 : 1;
  }
  return index;
}

type InvocationStep =
  | { readonly kind: 'done'; readonly name: string | undefined }
  | { readonly kind: 'next'; readonly index: number };

function resolveInvocation(words: readonly Word[], index: number): InvocationStep {
  const word = words[index];
  if (word === undefined) return { kind: 'done', name: undefined };
  if (isPrefix(word)) return { kind: 'next', index: index + 1 };
  if (!isCommand(word)) return { kind: 'done', name: undefined };
  const name = baseName(word.text);
  const takesValue = Object.hasOwn(wrapperOptions, name) ? wrapperOptions[name] : undefined;
  if (takesValue === undefined) return { kind: 'done', name: name || undefined };
  const optionEnd = unwrapOptions(words, index + 1, name, takesValue);
  if (optionEnd === undefined) return { kind: 'done', name };
  // timeout's duration precedes the wrapped command.
  const next = optionEnd + (name === 'timeout' ? 1 : 0);
  return next >= words.length ? { kind: 'done', name } : { kind: 'next', index: next };
}

function toolFromWords(words: readonly Word[]): string | undefined {
  let index = 0;
  while (index < words.length) {
    const step = resolveInvocation(words, index);
    if (step.kind === 'done') return step.name;
    index = step.index;
  }
  return undefined;
}

function unsupportedSyntax(tokens: readonly Token[]): boolean {
  return tokens.some((token, index) => {
    if (token.kind === 'operator') return token.text === '<<';
    if (tokens[index + 1]?.text === '(' && tokens[index + 2]?.text === ')') return true;
    const commandPosition = index === 0 || tokens[index - 1]?.kind === 'operator';
    return !token.quoted && commandPosition && ['function', 'case', 'switch'].includes(token.text);
  });
}

/**
 * Extract lexical top-level command invocations, never execute shell input.
 * Aliases/functions cannot be resolved from history. Substitutions and dynamic
 * command names are not expanded. Function definitions and heredocs are skipped
 * conservatively; this is intentionally not a full shell-program interpreter.
 */
export function extractTools(command: string): readonly string[] {
  const tokens = tokenize(command);
  if (unsupportedSyntax(tokens)) return [];
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
