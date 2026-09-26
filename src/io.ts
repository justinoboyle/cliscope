import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { Options } from './options.js';
import type { Shell } from './types.js';

export const MAX_HISTORY_BYTES = 64 * 1024 * 1024;

export interface HistorySource {
  readonly path: string;
  readonly shell: Shell;
  readonly text: string;
}

export interface HistoryEnvironment {
  readonly home: string;
  readonly shell: string | undefined;
  readonly histfile: string | undefined;
  readonly dataHome: string | undefined;
}

function shellFromName(value: string): Shell | undefined {
  if (value.includes('fish')) return 'fish';
  if (value.includes('zsh')) return 'zsh';
  if (value.includes('bash')) return 'bash';
  return undefined;
}

function inferShell(text: string, path: string, fallback: Shell): Shell {
  if (/^- cmd: /m.test(text)) return 'fish';
  if (/^: \d+:\d+;/m.test(text)) return 'zsh';
  return shellFromName(basename(path)) ?? fallback;
}

/** Bound both the initial size and bytes actually read, even if a file grows. */
export async function readHistoryFile(path: string): Promise<string> {
  // Nonblocking open lets fstat reject FIFOs without waiting for a writer.
  const handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('history path must refer to a regular file');
    if (stat.size > MAX_HISTORY_BYTES) throw new Error('history exceeds the 64 MiB size limit');
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const buffer = Buffer.allocUnsafe(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_HISTORY_BYTES) throw new Error('history exceeds the 64 MiB size limit');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await handle.close();
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

export async function loadHistory(
  options: Pick<Options, 'history' | 'shell'>,
  environment: HistoryEnvironment = {
    home: homedir(),
    shell: process.env['SHELL'],
    histfile: process.env['HISTFILE'],
    dataHome: process.env['XDG_DATA_HOME'],
  },
): Promise<HistorySource> {
  const activeShell = shellFromName(basename(environment.shell ?? '')) ?? 'zsh';
  const selectedShell = options.shell === 'auto' ? activeShell : options.shell;
  const paths: Record<Shell, string> = {
    bash: join(environment.home, '.bash_history'),
    zsh: join(environment.home, '.zsh_history'),
    fish: join(
      environment.dataHome || join(environment.home, '.local', 'share'),
      'fish',
      'fish_history',
    ),
  };
  const explicit = options.history ?? environment.histfile;
  const candidates = explicit
    ? [explicit.startsWith('~/') ? join(environment.home, explicit.slice(2)) : resolve(explicit)]
    : options.shell === 'auto'
      ? [...new Set([paths[selectedShell], paths.zsh, paths.bash, paths.fish])]
      : [paths[selectedShell]];

  for (const path of candidates) {
    try {
      const text = await readHistoryFile(path);
      return {
        path,
        text,
        shell: options.shell === 'auto' ? inferShell(text, path, selectedShell) : options.shell,
      };
    } catch (error) {
      if (!explicit && isMissing(error)) continue;
      throw error;
    }
  }
  throw new Error('no shell history found; use --history PATH --shell bash|zsh|fish');
}
