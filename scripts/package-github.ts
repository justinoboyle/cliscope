import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { t, x } from 'tar';
import { z } from 'zod';

const execute = promisify(execFile);
export const githubPackageName = '@justinoboyle/cliscope';
const manifestSchema = z.looseObject({
  name: z.literal('cliscope'),
  version: z.string().regex(/^(?:(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)|0\.0\.0-development)$/),
  bin: z.strictObject({ cliscope: z.literal('dist/launcher.js') }),
});

/** Only the registry identity changes; executable names and dependencies remain intact. */
export function githubManifest(input: unknown): Record<string, unknown> {
  return { ...manifestSchema.parse(input), name: githubPackageName };
}

async function unpack(archive: string, directory: string): Promise<void> {
  const errors: string[] = [];
  await t({
    file: archive,
    strict: true,
    onReadEntry(entry) {
      const path = entry.path;
      if (!path.startsWith('package/') || path.split('/').includes('..') || path.includes('\\'))
        errors.push(`Unexpected package archive path: ${path}`);
      if (entry.type !== 'File' && entry.type !== 'Directory')
        errors.push(`Package contains a non-regular entry: ${path}`);
    },
  });
  if (errors.length > 0) throw new Error(errors.join('\n'));
  await mkdir(directory, { recursive: true });
  await x({ file: archive, cwd: directory, strict: true, preservePaths: false });
}

async function payload(directory: string, prefix = ''): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      for (const [child, digest] of await payload(path, `${name}/`)) result.set(child, digest);
    } else if (entry.isFile()) {
      if (name !== 'package.json') {
        result.set(
          name,
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex'),
        );
      }
    } else {
      throw new Error(`Package contains a non-regular entry: ${name}`);
    }
  }
  return result;
}

/** Derive a scoped distribution from the already built npm archive, without rebuilding code. */
export async function createGitHubPackage(archive: string, output: string): Promise<string> {
  const npmCli = process.env['npm_execpath'];
  if (!npmCli) throw new Error('Run this command through npm run package:github.');
  const temporary = await mkdtemp(join(tmpdir(), 'cliscope-registry-'));
  try {
    const source = join(temporary, 'source');
    const target = resolve(output);
    await unpack(resolve(archive), source);
    const root = join(source, 'package');
    const original = await payload(root);
    const manifest = githubManifest(JSON.parse(await readFile(join(root, 'package.json'), 'utf8')));
    await writeFile(join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await mkdir(target, { recursive: true });
    const { stdout } = await execute(process.execPath, [
      npmCli,
      'pack',
      root,
      '--ignore-scripts',
      '--json',
      '--cache',
      join(temporary, 'npm-cache'),
      '--pack-destination',
      target,
    ]);
    const packages = z
      .array(z.object({ filename: z.string() }))
      .length(1)
      .parse(JSON.parse(stdout));
    const filename = packages[0]?.filename;
    assert.ok(filename && !filename.includes('/') && !filename.includes('\\'));
    const result = join(target, filename);
    const verification = join(temporary, 'verification');
    await unpack(result, verification);
    assert.deepEqual(
      await payload(join(verification, 'package')),
      original,
      'Registry conversion changed package files',
    );
    assert.deepEqual(
      JSON.parse(await readFile(join(verification, 'package/package.json'), 'utf8')),
      manifest,
    );
    return result;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const archive = process.argv[2];
  const output = process.argv[3];
  if (!archive || !output)
    throw new Error('Usage: npm run package:github -- ARCHIVE OUTPUT_DIRECTORY');
  console.log(await createGitHubPackage(archive, output));
}
