import { z } from 'zod';

const roots = [
  'build',
  'build:binary',
  'prepack',
  'postpack',
  'prepare',
  'preinstall',
  'install',
  'postinstall',
  'package:github',
] as const;

function references(command: string): readonly string[] {
  const runs = [
    ...command.matchAll(/\bnpm\s+(?:run|run-script)\s+(["']?)([\w:.-]+)\1(?=\s|$|[;&|])/g),
  ];
  const starts = [...command.matchAll(/\bnpm\s+(?:run|run-script)\b/g)];
  if (runs.length !== starts.length)
    throw new Error('Unsupported npm script reference in artifact command');
  return [
    ...runs.map((match) => match[2]),
    ...[...command.matchAll(/\bnpm\s+(test|start|restart|stop)(?=\s|$|[;&|])/g)].map(
      (match) => match[1],
    ),
  ].filter((name) => name !== undefined);
}

/** Preserve shell text conservatively; follow npm command and implicit hook edges. */
export function artifactCommands(
  manifest: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, string | null> {
  const scripts = z.record(z.string(), z.string()).parse(manifest['scripts'] ?? {});
  const result = new Map<string, string | null>();
  const queue: string[] = [...roots];
  for (let index = 0; index < queue.length; index++) {
    const name = queue[index];
    if (name === undefined || result.has(name)) continue;
    const command = scripts[name] ?? null;
    result.set(name, command);
    if (command === null) continue;
    for (const target of references(command)) {
      if (!Object.hasOwn(scripts, target)) throw new Error(`Missing artifact script: ${target}`);
      queue.push(target);
    }
    for (const hook of [`pre${name}`, `post${name}`])
      if (Object.hasOwn(scripts, hook)) queue.push(hook);
  }
  return result;
}

/** Explicit script paths complement local import traversal for executable command roots. */
export function artifactScriptFiles(
  commands: ReadonlyMap<string, string | null>,
): readonly string[] {
  const files = new Set<string>();
  for (const command of commands.values()) {
    if (command === null) continue;
    for (const match of command.matchAll(/\bscripts\/[\w./-]+\.(?:[cm]?[jt]s)\b/g))
      files.add(match[0]);
  }
  return [...files].toSorted();
}
