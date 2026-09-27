import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { stampVersion } from '../scripts/release-contract.js';

const development = '0.0.0-development';

async function manifests(
  directory: string,
  versions: readonly [string, string, string],
): Promise<readonly [string, string]> {
  await mkdir(directory, { recursive: true });
  const packageText = JSON.stringify({ name: 'cliscope', version: versions[0] });
  const lockText = JSON.stringify({
    version: versions[1],
    packages: {
      '': { name: 'cliscope', version: versions[2] },
      'node_modules/bun': { version: '1.4.2' },
    },
  });
  await writeFile(join(directory, 'package.json'), packageText);
  await writeFile(join(directory, 'package-lock.json'), lockText);
  return [packageText, lockText];
}

async function contents(directory: string): Promise<readonly [string, string]> {
  return Promise.all([
    readFile(join(directory, 'package.json'), 'utf8'),
    readFile(join(directory, 'package-lock.json'), 'utf8'),
  ]);
}

await test('stamping rejects manual or inconsistent source versions without changing either file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cliscope-stamp-source-'));
  try {
    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['0.3.0', '0.3.0', '0.3.0'],
      ['0.3.0', development, development],
      [development, '0.3.0', development],
      [development, development, '0.3.0'],
    ];
    for (const versions of cases) {
      const before = await manifests(directory, versions);
      await assert.rejects(stampVersion(directory, '0.4.0'), /must all be 0\.0\.0-development/);
      assert.deepEqual(await contents(directory), before);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('manual changelogs cannot enter an automatically versioned release', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cliscope-stamp-changelog-'));
  try {
    const before = await manifests(directory, [development, development, development]);
    await writeFile(join(directory, 'CHANGELOG.md'), '# Manually selected release\n');
    await assert.rejects(stampVersion(directory, '0.3.0'), /manual CHANGELOG/);
    assert.deepEqual(await contents(directory), before);
    await rm(join(directory, 'CHANGELOG.md'));
    await stampVersion(directory, '0.3.0');
    const [packageText, lockText] = await contents(directory);
    assert.match(packageText, /"version": "0.3.0"/);
    assert.equal((lockText.match(/"version": "0.3.0"/g) ?? []).length, 2);
    assert.match(lockText, /"version": "1.4.2"/);
    await assert.rejects(stampVersion(directory, '0.4.0'), /must all be/);
    assert.deepEqual(await contents(directory), [packageText, lockText]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
