import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { z } from 'zod';

const packageSchema = z.object({
  name: z.string(),
  version: z.string(),
  dependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
});

function packageRoot(path: string): string | undefined {
  const marker = `${sep}node_modules${sep}`;
  const offset = path.lastIndexOf(marker);
  if (offset < 0) return undefined;
  const parts = path.slice(offset + marker.length).split(sep);
  const count = parts[0]?.startsWith('@') ? 2 : 1;
  return join(path.slice(0, offset + marker.length), ...parts.slice(0, count));
}

async function licenseText(directory: string): Promise<string> {
  const names = (await readdir(directory))
    .filter((name) => /^(?:licen[sc]e|notice)(?:[.-].*)?$/i.test(name))
    .toSorted();
  if (names.length === 0) throw new Error(`Missing license text in bundled package: ${directory}`);
  return (await Promise.all(names.map((name) => readFile(join(directory, name), 'utf8')))).join(
    '\n\n',
  );
}

async function collectPackage(
  directory: string,
  visited: Set<string>,
  notices: string[],
): Promise<void> {
  if (visited.has(directory)) return;
  visited.add(directory);
  const metadata = packageSchema.parse(
    JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')),
  );
  notices.push(
    `${metadata.name}@${metadata.version}\n${'='.repeat(72)}\n${await licenseText(directory)}`,
  );

  // OpenTUI's published JS already contains several dependencies. Include their
  // notices too, even when the bundler cannot see those original source modules.
  const dependencies = Object.keys({
    ...metadata.dependencies,
    ...metadata.peerDependencies,
  }).toSorted();
  for (const dependency of dependencies) {
    if (dependency.startsWith('@types/') || dependency === 'typescript') continue;
    const root = packageRoot(Bun.resolveSync(dependency, directory));
    if (root !== undefined) await collectPackage(root, visited, notices);
  }
}

export async function writeBundleLicenses(
  metafile: Bun.BuildMetafile,
  root: string,
  output: string,
): Promise<void> {
  const packages = new Set<string>();
  for (const input of Object.keys(metafile.inputs)) {
    const directory = packageRoot(resolve(root, input));
    if (directory !== undefined) packages.add(directory);
  }
  const notices: string[] = [];
  const visited = new Set<string>();
  for (const directory of [...packages].toSorted())
    await collectPackage(directory, visited, notices);
  await writeFile(join(dirname(output), 'THIRD_PARTY_NOTICES.txt'), notices.join('\n\n\n'));
}
