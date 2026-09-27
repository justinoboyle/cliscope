import { createHash } from 'node:crypto';
import { z } from 'zod';

const fields = z.record(z.string(), z.string());
export const contractSchema = z.strictObject({
  format: z.literal(1),
  flags: z.record(
    z.string(),
    z.strictObject({
      type: z.enum(['string', 'boolean']),
      short: z.string().nullable(),
      validation: z.string().nullable(),
      default: z.string().nullable(),
    }),
  ),
  outputs: fields,
  csv: z.record(z.string(), z.array(z.string())),
  binaries: fields,
  platforms: z
    .array(z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/))
    .min(1)
    .refine((platforms) => new Set(platforms).size === platforms.length, 'Duplicate platforms'),
  runtime: fields,
  behavior: fields,
});
export type Contract = z.infer<typeof contractSchema>;
export type ReleaseBump = 'patch' | 'minor' | 'major';
export interface ContractChange {
  readonly bump: ReleaseBump;
  readonly reasons: readonly string[];
}

type Json = null | string | number | boolean | readonly Json[] | { readonly [key: string]: Json };

function sorted(value: Json): Json {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, sorted(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sorted(z.json().parse(value)), null, 2)}\n`;
}

export function canonicalContract(contract: Contract): string {
  return canonicalJson(contractSchema.parse(contract));
}

export function hashContract(contract: Contract): string {
  return createHash('sha256').update(canonicalContract(contract)).digest('hex');
}

function difference(
  previous: Readonly<Record<string, unknown>>,
  current: Readonly<Record<string, unknown>>,
  section: string,
): ContractChange {
  const removed = Object.keys(previous).filter((key) => !Object.hasOwn(current, key));
  const changed = Object.keys(previous).filter(
    (key) =>
      Object.hasOwn(current, key) && JSON.stringify(previous[key]) !== JSON.stringify(current[key]),
  );
  const added = Object.keys(current).filter((key) => !Object.hasOwn(previous, key));
  return {
    bump: removed.length || changed.length ? 'major' : added.length ? 'minor' : 'patch',
    reasons: [
      ...removed.map((key) => `${section}: removed ${key}`),
      ...changed.map((key) => `${section}: changed ${key}`),
      ...added.map((key) => `${section}: added ${key}`),
    ],
  };
}

/** Unknown executable behavior changes fail conservatively toward a breaking release. */
export function classifyContracts(previous: Contract, current: Contract): ContractChange {
  const old = contractSchema.parse(previous);
  const next = contractSchema.parse(current);
  const sections = ['flags', 'outputs', 'csv', 'binaries', 'runtime'] as const;
  const changes = sections.map((section) => difference(old[section], next[section], section));
  changes.push(
    difference(
      Object.fromEntries(old.platforms.map((name) => [name, true])),
      Object.fromEntries(next.platforms.map((name) => [name, true])),
      'platforms',
    ),
  );
  const behavior = difference(old.behavior, next.behavior, 'behavior');
  if (behavior.reasons.length) changes.push({ ...behavior, bump: 'major' });
  const reasons = changes.flatMap((change) => change.reasons).toSorted();
  return {
    bump: changes.some((change) => change.bump === 'major')
      ? 'major'
      : changes.some((change) => change.bump === 'minor')
        ? 'minor'
        : 'patch',
    reasons: reasons.length ? reasons : ['No detected public-contract or runtime behavior change'],
  };
}
