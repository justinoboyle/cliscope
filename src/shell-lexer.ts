export interface Word {
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

export type Token = Word | Operator;

const assignments = /^[A-Za-z_][A-Za-z0-9_]*=/;
const pairedOperators = new Set(['&&', '||', '|&', '<<', '>>', '<&', '>&', '<|', '>|', '&>']);

/** Skip balanced substitutions without interpreting their contents as tools. */
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

function backtickEnd(command: string, start: number): number {
  let index = start;
  for (; index < command.length; index += 1) {
    if (command[index] === '\\') index += 1;
    else if (command[index] === '`') break;
  }
  return index;
}

/** A local cursor owns all mutable lexical state; no input is ever evaluated. */
class ShellLexer {
  private readonly command: string;
  private readonly tokens: Token[] = [];
  private index = 0;
  private buffer = '';
  private started = false;
  private dynamic = false;
  private quoted = false;
  private assignmentPrefix = false;
  private quote: string | undefined;

  constructor(command: string) {
    this.command = command;
  }

  scan(): readonly Token[] {
    for (; this.index < this.command.length; this.index += 1) this.readCharacter();
    // Unterminated quotes make the command incomplete.
    if (this.quote !== undefined) return [];
    this.flush();
    return this.tokens;
  }

  private flush(): void {
    if (this.started)
      this.tokens.push({
        kind: 'word',
        text: this.buffer,
        dynamic: this.dynamic,
        quoted: this.quoted,
        assignment: assignments.test(this.buffer) && (!this.quoted || this.assignmentPrefix),
      });
    this.buffer = '';
    this.started = false;
    this.dynamic = false;
    this.quoted = false;
    this.assignmentPrefix = false;
  }

  private readCharacter(): void {
    const character = this.command[this.index] ?? '';
    const next = this.command[this.index + 1];
    if (this.readEscape(character, next)) return;
    if (this.quote === "'") {
      this.readQuoted(character);
      return;
    }
    if (this.readSubstitution(character, next)) return;
    if (character === '$') this.dynamic = true;
    if (this.quote === '"') {
      this.readQuoted(character);
      return;
    }
    if (character === '"' || character === "'") {
      this.openQuote(character);
      return;
    }
    this.readUnquoted(character, next);
  }

  private readEscape(character: string, next: string | undefined): boolean {
    if (character !== '\\' || this.quote === "'" || next === undefined) return false;
    if (this.quote === '"' && !'$`"\\\n'.includes(next)) return false;
    if (next !== '\n') {
      this.buffer += next;
      this.started = true;
    }
    this.index += 1;
    return true;
  }

  private readQuoted(character: string): void {
    if (character === this.quote) this.quote = undefined;
    else this.buffer += character;
  }

  private openQuote(character: string): void {
    if (assignments.test(this.buffer) && !this.quoted) this.assignmentPrefix = true;
    this.quote = character;
    this.started = true;
    this.quoted = true;
  }

  private readSubstitution(character: string, next: string | undefined): boolean {
    const processSubstitution =
      this.quote === undefined && (character === '<' || character === '>');
    if (next === '(' && (character === '$' || processSubstitution)) {
      this.buffer += `${character}(…)`;
      this.index = substitutionEnd(this.command, this.index + 2);
    } else if (character === '`') {
      this.buffer += '`…`';
      this.index = backtickEnd(this.command, this.index + 1);
    } else return false;
    this.dynamic = true;
    this.started = true;
    return true;
  }

  private readUnquoted(character: string, next: string | undefined): void {
    if (character === '#' && !this.started) {
      this.readComment();
    } else if (this.isOperator(character, next)) {
      this.readOperator(character, next);
    } else if (/\s/.test(character)) {
      this.flush();
    } else {
      this.buffer += character;
      this.started = true;
      if ('*?[{'.includes(character)) this.dynamic = true;
    }
  }

  private readComment(): void {
    while (this.index < this.command.length && this.command[this.index] !== '\n') this.index += 1;
    this.flush();
    this.tokens.push({ kind: 'operator', text: '\n' });
  }

  private isOperator(character: string, next: string | undefined): boolean {
    const braceOperator =
      (character === '{' || character === '}') &&
      !this.started &&
      (next === undefined || /[\s;]/.test(next));
    return ';\n|&()<>'.includes(character) || braceOperator;
  }

  private readOperator(character: string, next: string | undefined): void {
    // Adjacent unquoted digits denote a file descriptor, not a command.
    if ((character === '>' || character === '<') && /^\d+$/.test(this.buffer) && !this.quoted) {
      this.buffer = '';
      this.started = false;
    }
    this.flush();
    let operator = character;
    if (next !== undefined && pairedOperators.has(character + next)) {
      operator += next;
      this.index += 1;
      if (operator === '<<' && this.command[this.index + 1] === '<') {
        operator += '<';
        this.index += 1;
      }
    }
    this.tokens.push({ kind: 'operator', text: operator });
  }
}

export function tokenize(command: string): readonly Token[] {
  return new ShellLexer(command).scan();
}
