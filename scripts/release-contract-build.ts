import { readFile, realpath } from 'node:fs/promises';
import { join, posix, sep } from 'node:path';
import ts from 'typescript';
import { moduleSpecifier, nodes, parseSource } from './release-contract-ast.js';
import type { Source } from './release-contract-ast.js';

function localImports(source: Source): readonly string[] {
  return nodes(
    source.file,
    (node) =>
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isCallExpression(node),
  )
    .map(moduleSpecifier)
    .filter((name): name is string => name !== undefined && name.startsWith('.'));
}

async function readContained(root: string, path: string): Promise<Source> {
  const base = await realpath(root);
  const file = await realpath(join(root, path));
  if (!file.startsWith(`${base}${sep}`))
    throw new Error(`Build import escapes source tree: ${path}`);
  return parseSource(path, await readFile(file, 'utf8'));
}

async function readLocal(
  root: string,
  from: string,
  specifier: string,
): Promise<readonly [string, Source]> {
  const path = posix.join(posix.dirname(from), specifier);
  if (path.startsWith('../') || posix.isAbsolute(path))
    throw new Error(`Build import escapes source tree: ${specifier}`);
  const candidates = path.endsWith('.js') ? [path.slice(0, -3) + '.ts', path] : [path];
  for (const candidate of candidates) {
    if (!/\.(?:[cm]?[jt]s)$/.test(candidate))
      throw new Error(`Unsupported build import: ${specifier}`);
    try {
      return [candidate, await readContained(root, candidate)];
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error(`Missing local build import: ${specifier} from ${from}`);
}

/** Fingerprint artifact-mutating local helpers, without importing their code. */
export async function addBuildSources(
  root: string,
  sources: Map<string, Source>,
  commandFiles: readonly string[] = [],
): Promise<void> {
  const queue = ['scripts/build-package.ts', 'scripts/build-binary.ts', ...commandFiles];
  const visited = new Set<string>();
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index];
    if (!path || visited.has(path)) continue;
    visited.add(path);
    let source = sources.get(path);
    if (!source) {
      source = await readContained(root, path);
      sources.set(path, source);
    }
    for (const specifier of localImports(source)) {
      const [dependency, parsed] = await readLocal(root, path, specifier);
      sources.set(dependency, parsed);
      queue.push(dependency);
    }
  }
}
