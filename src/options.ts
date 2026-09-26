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
    ascii: z.boolean().default(false),
    'no-color': z.boolean().default(false),
    demo: z.boolean().default(false),
  })
  .strict()
  .refine((options) => !(options.json && options.interactive), {
    message: '--json and --interactive cannot be combined',
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

export const HELP = `cliscope — a clearer picture of your command line

Usage: cliscope [options]

Prints a usage chart from local shell history. Commands are never executed.

  -i, --interactive     Open the interactive OpenTUI dashboard
  -f, --history PATH    Read a specific history file
  -s, --shell SHELL     History format: auto, bash, zsh, fish (default: auto)
  -n, --top NUMBER      Show 1–100 tools (default: 10)
      --since DATE     Include dated entries on/after YYYY-MM-DD (UTC)
      --json           Print the complete report as JSON
      --ascii          Draw graphs with ASCII characters
      --no-color       Disable ANSI colors (also respects NO_COLOR)
      --demo           Explore a built-in synthetic history
  -h, --help           Show this help
  -v, --version        Show the version

Examples:
  cliscope
  cliscope -i
  cliscope --history ~/.zsh_history --top 15
  cliscope --since 2026-09-01 --json
  cliscope --demo -i

Auto-discovery uses HISTFILE, then the active shell's standard history path.
With --since, undated entries are excluded. JSON includes all tools.
`;
