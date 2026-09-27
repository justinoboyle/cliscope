import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runtimeLock } from '../scripts/release-contract-lock.js';

function locked(version = '1.0.0'): { version: string; resolved: string; integrity: string } {
  return {
    version,
    resolved: `https://example.invalid/package-${version}.tgz`,
    integrity: `sha512-fixture-${version}`,
  };
}

async function writeLock(root: string, packages: Readonly<Record<string, unknown>>): Promise<void> {
  await writeFile(
    join(root, 'package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages }),
  );
}

await test('runtime lock follows nested resolution, optional dependencies and installed peers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cliscope-lock-test-'));
  try {
    await writeLock(root, {
      'node_modules/bun': {
        ...locked(),
        dependencies: { shared: '^1' },
        optionalDependencies: { native: '1' },
        peerDependencies: { peer: '1', absent: '1' },
        peerDependenciesMeta: { absent: { optional: true } },
      },
      'node_modules/bun/node_modules/shared': locked('1.2.0'),
      'node_modules/shared': locked('2.0.0'),
      'node_modules/native': locked(),
      'node_modules/peer': locked(),
      'node_modules/linter': locked(),
    });
    const result = await runtimeLock(root, ['bun']);
    assert.equal(result['edge:node_modules/bun:shared'], 'node_modules/bun/node_modules/shared');
    assert.equal(result['edge:node_modules/bun:absent'], 'absent optional peer');
    assert.ok(result['lock:node_modules/native']);
    assert.ok(result['lock:node_modules/peer']);
    assert.equal(result['lock:node_modules/shared'], undefined);
    assert.equal(result['lock:node_modules/linter'], undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('nested version and integrity changes alter runtime identity while unrelated tooling does not', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cliscope-lock-identity-'));
  const packages: Record<string, unknown> = {
    'node_modules/bun': { ...locked(), dependencies: { child: '1' } },
    'node_modules/bun/node_modules/child': locked(),
    'node_modules/linter': locked(),
  };
  try {
    await writeLock(root, packages);
    const original = await runtimeLock(root, ['bun']);
    packages['node_modules/linter'] = locked('9.0.0');
    await writeLock(root, packages);
    assert.deepEqual(await runtimeLock(root, ['bun']), original);
    packages['node_modules/bun/node_modules/child'] = { ...locked(), integrity: 'sha512-changed' };
    await writeLock(root, packages);
    assert.notDeepEqual(await runtimeLock(root, ['bun']), original);
    packages['node_modules/bun/node_modules/child'] = locked('1.1.0');
    await writeLock(root, packages);
    assert.notDeepEqual(await runtimeLock(root, ['bun']), original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('missing dependencies, links and incomplete runtime integrity fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cliscope-lock-invalid-'));
  try {
    for (const entry of [
      { ...locked(), dependencies: { missing: '1' } },
      { ...locked(), optionalDependencies: { missing: '1' } },
      { ...locked(), peerDependencies: { missing: '1' } },
      { ...locked(), link: true },
      { version: '1.0.0' },
    ]) {
      await writeLock(root, { 'node_modules/bun': entry });
      await assert.rejects(
        runtimeLock(root, ['bun']),
        /Missing runtime lock dependency|Unsupported runtime lock entry/,
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
