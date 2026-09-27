import { z } from 'zod';
import { artifactCommands } from './release-contract-commands.js';
import { canonicalJson } from './release-contract-schema.js';

/** These fields affect installed entry points, package contents or supported consumers. */
const artifactFields = [
  'type',
  'files',
  'exports',
  'imports',
  'main',
  'module',
  'browser',
  'os',
  'cpu',
  'libc',
  'bin',
  'bundleDependencies',
  'bundledDependencies',
  'config',
] as const;

function manifestValue(key: string, value: unknown): string {
  // Conditional export/import keys are evaluated in insertion order by Node.
  if (key === 'exports' || key === 'imports') return JSON.stringify(z.json().parse(value));
  return canonicalJson(value).trim();
}

export function manifestContract(
  manifest: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries([
    ...artifactFields.map(
      (key) => [`manifest:${key}`, manifestValue(key, manifest[key] ?? null)] as const,
    ),
    ...[...artifactCommands(manifest)].map(
      ([key, command]) => [`command:${key}`, canonicalJson(command).trim()] as const,
    ),
  ]);
}
