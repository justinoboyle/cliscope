import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { behaviorHash } from '../scripts/release-contract-ast.js';
import type { Source } from '../scripts/release-contract-ast.js';
import { addBuildSources } from '../scripts/release-contract-build.js';
import { artifactCommands, artifactScriptFiles } from '../scripts/release-contract-commands.js';
import { manifestContract } from '../scripts/release-contract-manifest.js';

await test('artifact manifest fields and install hooks are covered; development scripts and versions are excluded', () => {
  const original = manifestContract({
    type: 'module',
    files: ['dist'],
    scripts: { test: 'old test' },
  });
  for (const change of [
    { type: 'commonjs', files: ['dist'] },
    { type: 'module', files: ['other'] },
    { type: 'module', files: ['dist'], exports: './other.js' },
    { type: 'module', files: ['dist'], scripts: { postinstall: 'node install.js' } },
  ])
    assert.notDeepEqual(manifestContract(change), original);
  assert.equal(original['manifest:exports'], 'null');
  assert.deepEqual(
    manifestContract({
      type: 'module',
      files: ['dist'],
      version: '99.0.0',
      scripts: { test: 'new test', lint: 'new lint' },
    }),
    original,
  );
  assert.notDeepEqual(
    manifestContract({ exports: { default: './fallback.js', import: './esm.js' } }),
    manifestContract({ exports: { import: './esm.js', default: './fallback.js' } }),
  );
});

await test('artifact fingerprints include local build helpers transitively and reject missing helpers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cliscope-build-contract-'));
  try {
    await mkdir(join(root, 'scripts'));
    await writeFile(join(root, 'scripts/build-package.ts'), "import './helper.js';");
    await writeFile(join(root, 'scripts/build-binary.ts'), 'export const native = true;');
    await writeFile(
      join(root, 'scripts/helper.ts'),
      "void import('./nested.js'); export const output = 'original';",
    );
    await writeFile(join(root, 'scripts/nested.ts'), 'export const suffix = 1;');
    const first = new Map<string, Source>();
    await addBuildSources(root, first);
    const original = first.get('scripts/nested.ts');
    assert.ok(original);
    await writeFile(join(root, 'scripts/nested.ts'), 'export const suffix = 2;');
    const second = new Map<string, Source>();
    await addBuildSources(root, second);
    const changed = second.get('scripts/nested.ts');
    assert.ok(changed);
    assert.notEqual(behaviorHash(original), behaviorHash(changed));
    await rm(join(root, 'scripts/nested.ts'));
    await assert.rejects(addBuildSources(root, new Map()), /Missing local build import/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('artifact command graph tracks custom npm targets and implicit hooks', () => {
  const commands = artifactCommands({
    scripts: {
      build: 'npm run custom',
      custom: 'node scripts/custom.mjs',
      precustom: 'node scripts/before.mjs',
      postpack: 'node scripts/after.mjs',
      'package:github': 'node --import tsx scripts/package-github.ts',
      unused: 'node scripts/unrelated.mjs',
    },
  });
  assert.equal(commands.get('custom'), 'node scripts/custom.mjs');
  assert.equal(commands.get('precustom'), 'node scripts/before.mjs');
  assert.equal(commands.has('unused'), false);
  assert.deepEqual(artifactScriptFiles(commands), [
    'scripts/after.mjs',
    'scripts/before.mjs',
    'scripts/custom.mjs',
    'scripts/package-github.ts',
  ]);
  assert.throws(
    () => artifactCommands({ scripts: { build: 'npm run missing' } }),
    /Missing artifact script/,
  );
  assert.throws(
    () => artifactCommands({ scripts: { build: 'npm run "$TARGET"' } }),
    /Unsupported npm script reference/,
  );
  assert.notDeepEqual(
    manifestContract({ scripts: { build: 'bun original.ts' } }),
    manifestContract({ scripts: { build: 'bun changed.ts' } }),
  );
  assert.notDeepEqual(
    manifestContract({ scripts: { prepack: 'echo original' } }),
    manifestContract({ scripts: { prepack: 'echo changed' } }),
  );
});
