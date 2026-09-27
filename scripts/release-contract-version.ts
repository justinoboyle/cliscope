import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { ReleaseBump } from './release-contract-schema.js';

const stableVersion = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const manifest = z.looseObject({ name: z.string(), version: z.string() });
const lockSchema = z.looseObject({
  version: z.string(),
  packages: z.record(z.string(), z.looseObject({ version: z.string().optional() })),
});

function versionParts(version: string): readonly [number, number, number] {
  const [major, minor, patch] = stableVersion.parse(version).split('.').map(Number);
  if (
    major === undefined ||
    minor === undefined ||
    patch === undefined ||
    ![major, minor, patch].every(Number.isSafeInteger)
  )
    throw new Error('Version components must be safe integers');
  return [major, minor, patch];
}

export function nextVersion(previousVersion: string, bump: ReleaseBump): string {
  const [major, minor, patch] = versionParts(previousVersion);
  const selected = bump === 'major' && major === 0 ? 'minor' : bump;
  const parts =
    selected === 'major'
      ? [major + 1, 0, 0]
      : selected === 'minor'
        ? [major, minor + 1, 0]
        : [major, minor, patch + 1];
  if (!parts.every(Number.isSafeInteger)) throw new Error('Version component overflow');
  return parts.join('.');
}

/** Stamp only a disposable build checkout; tags remain the release-version authority. */
export async function stampVersion(sourceRoot: string, version: string): Promise<void> {
  versionParts(version);
  const packagePath = join(sourceRoot, 'package.json');
  const lockPath = join(sourceRoot, 'package-lock.json');
  const [packageText, lockText] = await Promise.all([
    readFile(packagePath, 'utf8'),
    readFile(lockPath, 'utf8'),
  ]);
  const packageData = manifest.parse(JSON.parse(packageText));
  const lock = lockSchema.parse(JSON.parse(lockText));
  const root = lock.packages[''];
  if (!root) throw new Error('package-lock.json has no root package');
  const versions = [packageData.version, lock.version, root.version];
  if (!versions.every((value) => value === '0.0.0-development'))
    throw new Error(
      'Source manifest versions must all be 0.0.0-development; release tags choose versions',
    );
  if ((await readdir(sourceRoot)).some((name) => name.toLowerCase() === 'changelog.md'))
    throw new Error(
      'Remove the manual CHANGELOG.md; commits and generated release notes provide release history',
    );
  const stampedLock = {
    ...lock,
    version,
    packages: { ...lock.packages, '': { ...root, version } },
  };
  await writeFile(packagePath, `${JSON.stringify({ ...packageData, version }, null, 2)}\n`);
  await writeFile(lockPath, `${JSON.stringify(stampedLock, null, 2)}\n`);
}
