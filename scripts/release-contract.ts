import { readFile, readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';
import ts from 'typescript';
import { z } from 'zod';
import { behaviorHash, moduleSpecifier, nodes, parseSource } from './release-contract-ast.js';
import type { Source } from './release-contract-ast.js';
import { artifactCommands, artifactScriptFiles } from './release-contract-commands.js';
import { addBuildSources } from './release-contract-build.js';
import { manifestContract } from './release-contract-manifest.js';
import { buildConfiguration } from './release-contract-config.js';
import { artifactWorkflow } from './release-contract-workflow.js';
import { runtimeLock } from './release-contract-lock.js';
import { extractFlags } from './release-contract-inputs.js';
import { extractCsv, extractOutputs } from './release-contract-outputs.js';
import { contractSchema } from './release-contract-schema.js';
import type { Contract } from './release-contract-schema.js';

export {
  canonicalContract,
  classifyContracts,
  contractSchema,
  hashContract,
} from './release-contract-schema.js';
export type { Contract, ContractChange, ReleaseBump } from './release-contract-schema.js';
export { nextVersion, stampVersion } from './release-contract-version.js';

const manifestSchema = z.looseObject({
  name: z.string(),
  bin: z.record(z.string(), z.string()),
  engines: z.record(z.string(), z.string()),
  dependencies: z.record(z.string(), z.string()),
  optionalDependencies: z.record(z.string(), z.string()),
  devDependencies: z.record(z.string(), z.string()),
});

async function sourceFiles(root: string, prefix = 'src'): Promise<readonly string[]> {
  const files: string[] = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await sourceFiles(root, path)));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(path);
    else throw new Error(`Unsupported runtime source entry: ${path}`);
  }
  return files.toSorted();
}

function requiredSource(sources: ReadonlyMap<string, Source>, name: string): Source {
  const source = sources.get(name);
  if (!source) throw new Error(`Missing contract source: ${name}`);
  return source;
}

function packageName(name: string): string | undefined {
  if (name.startsWith('.') || name.startsWith('node:')) return undefined;
  return name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0];
}

function checkRuntimeImport(name: string | undefined, filename: string): string | undefined {
  if (name?.startsWith('.')) {
    const resolved = posix.join(posix.dirname(filename), name);
    if (!resolved.startsWith('src/') && resolved !== 'package.json')
      throw new Error(`Unsupported runtime import outside src: ${name}`);
  }
  return name;
}

function packageImports(source: Source, filename: string): readonly string[] {
  return nodes(
    source.file,
    (node) =>
      ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isCallExpression(node),
  )
    .map(moduleSpecifier)
    .map((name) => checkRuntimeImport(name, filename))
    .filter((name) => name !== undefined)
    .map(packageName)
    .filter((name) => name !== undefined);
}

async function runtimeContract(
  manifest: z.infer<typeof manifestSchema>,
  sources: ReadonlyMap<string, Source>,
  sourceRoot: string,
): Promise<Contract['runtime']> {
  const runtime: Contract['runtime'] = { package: manifest.name, ...manifest.engines };
  const dependencies = {
    ...manifest.devDependencies,
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
  };
  const names = new Set([
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.optionalDependencies),
    ...[...sources]
      .filter(([name]) => name.startsWith('src/'))
      .flatMap(([name, source]) => packageImports(source, name)),
  ]);
  for (const name of names) {
    const version = dependencies[name];
    if (!version) throw new Error(`Runtime import has no pinned dependency: ${name}`);
    runtime[`dependency:${name}`] = version;
  }
  return {
    ...runtime,
    ...manifestContract(manifest),
    ...(await buildConfiguration(sourceRoot)),
    ...(await runtimeLock(sourceRoot, [...names])),
  };
}

/** Read source without importing or executing either the baseline or current application. */
export async function generateContract(sourceRoot: string): Promise<Contract> {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8')),
  );
  const filenames = await sourceFiles(sourceRoot);
  const sources = new Map<string, Source>();
  for (const filename of filenames)
    sources.set(
      filename,
      parseSource(filename, await readFile(join(sourceRoot, filename), 'utf8')),
    );
  await addBuildSources(sourceRoot, sources, artifactScriptFiles(artifactCommands(manifest)));
  const flags = extractFlags(requiredSource(sources, 'src/options.ts'));
  const exports = requiredSource(sources, 'src/export.ts');
  const csv = extractCsv(exports);
  const outputs = extractOutputs(
    requiredSource(sources, 'src/types.ts'),
    requiredSource(sources, 'src/calendar.ts'),
    exports,
  );
  const workflow = artifactWorkflow(
    await readFile(join(sourceRoot, '.github/workflows/ci.yml'), 'utf8'),
  );
  return contractSchema.parse({
    format: 1,
    flags,
    outputs,
    csv,
    binaries: manifest.bin,
    platforms: workflow.platforms,
    runtime: {
      ...(await runtimeContract(manifest, sources, sourceRoot)),
      'workflow:ci-artifacts': workflow.configuration,
    },
    behavior: Object.fromEntries(
      [...sources].map(([name, source]) => [name, behaviorHash(source)]),
    ),
  });
}
