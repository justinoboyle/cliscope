import { parseArgs } from 'node:util';
import { z } from 'zod';

const positiveInteger = z
  .string()
  .regex(/^[1-9]\d*$/, 'must be a positive integer')
  .transform(Number)
  .pipe(z.number().int().min(1).max(100))
  .brand<'TopLimit'>();

const utcDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'must be a valid calendar date')
  .transform((value) => Date.parse(`${value}T00:00:00.000Z`));

const optionsSchema = z
  .object({
    interactive: z.boolean().default(false),
    history: z.string().min(1).optional(),
    shell: z.enum(['auto', 'bash', 'zsh', 'fish']).default('auto'),
    top: positiveInteger.prefault('10'),
    since: utcDate.optional(),
    json: z.boolean().default(false),
    csv: z.boolean().default(false),
    view: z.enum(['tools', 'calendar', 'weekdays']).default('tools'),
    output: z.string().min(1).optional(),
    ascii: z.boolean().default(false),
    'no-color': z.boolean().default(false),
    demo: z.boolean().default(false),
  })
  .strict()
  .refine((options) => !(options.json && options.csv), {
    message: '--json and --csv cannot be combined',
  })
  .refine((options) => !(options.interactive && (options.json || options.csv || options.output)), {
    message: '--interactive cannot be combined with --json, --csv, or --output',
  })
  .refine((options) => !(options.demo && options.history !== undefined), {
    message: '--demo and --history cannot be combined',
  });

export type Options = z.infer<typeof optionsSchema>;

export type Command =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'analyze'; readonly options: Options };

/** Convert untrusted argv to a closed command model before performing any I/O. */
export function parseOptions(args: readonly string[]): Command {
  const { values } = parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      interactive: { type: 'boolean', short: 'i' },
      history: { type: 'string', short: 'f' },
      shell: { type: 'string', short: 's' },
      top: { type: 'string', short: 'n' },
      since: { type: 'string' },
      json: { type: 'boolean' },
      csv: { type: 'boolean' },
      view: { type: 'string' },
      output: { type: 'string', short: 'o' },
      ascii: { type: 'boolean' },
      'no-color': { type: 'boolean' },
      demo: { type: 'boolean' },
    },
  });
  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };
  const { help: _help, version: _version, ...raw } = values;
  const parsed = optionsSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'options'}: ${issue.message}`)
        .join('; '),
    );
  }
  return { kind: 'analyze', options: parsed.data };
}

export const HELP = `cliscope - report shell command usage

Usage: cliscope [options]

Read local shell history and write usage statistics to standard output.

  -i, --interactive     Display an interactive report
  -f, --history PATH    Read history from PATH
  -s, --shell SHELL     Select auto, bash, zsh, or fish format (default: auto)
  -n, --top NUMBER      Print up to NUMBER tools (1–100; default: 10)
      --since DATE     Include entries on or after DATE (YYYY-MM-DD, UTC)
      --json           Print the complete report as JSON
      --csv            Print the selected view as CSV
      --view VIEW      Select tools, calendar, or weekdays (default: tools)
  -o, --output PATH    Create an output file; fail if it already exists
      --ascii          Draw graphs with ASCII characters
      --no-color       Disable ANSI colors (also respects NO_COLOR)
      --demo           Use sample history
  -h, --help           Show this help
  -v, --version        Show the version

Examples:
  cliscope
  cliscope -i
  cliscope --history ~/.zsh_history --top 15
  cliscope --since 2026-09-01 --json
  cliscope --view weekdays --csv > weekdays.csv
  cliscope --view calendar
  cliscope --demo -i

Without --history, read HISTFILE or the shell's standard history file.
With --since, undated entries are excluded. JSON includes all views.
CSV includes every row in the selected view; --top affects text output only.
Use --output - to write to standard output.
Exit status: 0 on success, 1 on error.
`;
