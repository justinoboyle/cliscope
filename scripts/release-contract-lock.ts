import { readFile } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { z } from 'zod';

const dependencies = z.record(z.string(), z.string()).default({});
const packageSchema = z.looseObject({
  version: z.string().optional(),
  integrity: z.string().optional(),
  resolved: z.string().optional(),
  link: z.boolean().optional(),
  dependencies,
  optionalDependencies: dependencies,
  peerDependencies: dependencies,
  peerDependenciesMeta: z
    .record(z.string(), z.looseObject({ optional: z.boolean().optional() }))
    .default({}),
  engines: dependencies,
  os: z.array(z.string()).default([]),
  cpu: z.array(z.string()).default([]),
  hasInstallScript: z.boolean().default(false),
});
const lockSchema = z.looseObject({
  lockfileVersion: z.literal(3),
  packages: z.record(z.string(), packageSchema),
});
type LockedPackage = z.infer<typeof packageSchema>;
type Packages = Readonly<Record<string, LockedPackage>>;

/** Follow Node's nearest node_modules lookup, including scoped/nested installs. */
function resolvePackage(packages: Packages, from: string, name: string): string | undefined {
  let directory = from;
  while (true) {
    const path = posix.join(directory, 'node_modules', name);
    if (posix.basename(directory) !== 'node_modules' && Object.hasOwn(packages, path)) return path;
    if (directory === '' || directory === '.') return undefined;
    directory = posix.dirname(directory);
  }
}

function packageIdentity(entry: LockedPackage, path: string): string {
  if (entry.link || !entry.version || !entry.integrity || !entry.resolved)
    throw new Error(
      `Unsupported runtime lock entry: ${path}; require registry version, integrity, and resolved URL`,
    );
  return JSON.stringify({
    version: entry.version,
    integrity: entry.integrity,
    resolved: entry.resolved,
    engines: Object.fromEntries(
      Object.entries(entry.engines).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
    os: entry.os.toSorted(),
    cpu: entry.cpu.toSorted(),
    hasInstallScript: entry.hasInstallScript,
  });
}

interface Edge {
  readonly name: string;
  readonly optionalPeer: boolean;
}
function edges(entry: LockedPackage): readonly Edge[] {
  const direct = new Set([
    ...Object.keys(entry.dependencies),
    ...Object.keys(entry.optionalDependencies),
  ]);
  return [...new Set([...direct, ...Object.keys(entry.peerDependencies)])].map((name) => ({
    name,
    optionalPeer: !direct.has(name) && entry.peerDependenciesMeta[name]?.optional === true,
  }));
}

function enqueue(
  packages: Packages,
  from: string,
  edge: Edge,
  queue: string[],
  result: Record<string, string>,
): void {
  const resolved = resolvePackage(packages, from, edge.name);
  if (!resolved && !edge.optionalPeer)
    throw new Error(`Missing runtime lock dependency: ${edge.name} from ${from || 'root'}`);
  result[`edge:${from}:${edge.name}`] = resolved ?? 'absent optional peer';
  if (resolved) queue.push(resolved);
}

/** Include only installed runtime roots and their resolved dependency graph. */
export async function runtimeLock(
  sourceRoot: string,
  roots: readonly string[],
): Promise<Readonly<Record<string, string>>> {
  const lock = lockSchema.parse(
    JSON.parse(await readFile(join(sourceRoot, 'package-lock.json'), 'utf8')),
  );
  const queue: string[] = [];
  const result: Record<string, string> = {};
  const visited = new Set<string>();
  for (const name of roots)
    enqueue(lock.packages, '', { name, optionalPeer: false }, queue, result);
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    if (path === undefined || visited.has(path)) continue;
    visited.add(path);
    const entry = lock.packages[path];
    if (!entry) throw new Error(`Missing runtime lock entry: ${path}`);
    result[`lock:${path}`] = packageIdentity(entry, path);
    for (const edge of edges(entry)) enqueue(lock.packages, path, edge, queue, result);
  }
  return result;
}
