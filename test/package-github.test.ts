import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { c, Header, x } from 'tar';
import { createGitHubPackage, githubManifest } from '../scripts/package-github.js';

const metadata = {
  name: 'cliscope',
  version: '1.2.3',
  bin: { cliscope: 'dist/launcher.js' },
  files: ['dist', 'README.md', 'LICENSE'],
  license: 'MIT',
  dependencies: { bun: '1.4.2' },
  repository: { type: 'git', url: 'git+https://github.com/justinoboyle/cliscope.git' },
  scripts: { prepack: 'exit 91', prepare: 'exit 92' },
};

await test('GitHub manifest changes only the package name and preserves its input', () => {
  const snapshot = structuredClone(metadata);
  assert.deepEqual(githubManifest(metadata), { ...metadata, name: '@justinoboyle/cliscope' });
  assert.deepEqual(metadata, snapshot);
  for (const value of [
    null,
    { ...metadata, name: 'another-package' },
    { ...metadata, version: '1.2.3-beta.1' },
    { ...metadata, bin: { cliscope: '../outside.js' } },
  ])
    assert.throws(() => githubManifest(value));
});

await test('registry repacking preserves payload bytes and does not run lifecycle scripts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cliscope-package-test-'));
  try {
    const root = join(directory, 'package');
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify(metadata));
    await writeFile(join(root, 'README.md'), 'Synthetic package fixture\n');
    await writeFile(join(root, 'LICENSE'), 'Synthetic license fixture\n');
    await writeFile(
      join(root, 'dist/launcher.js'),
      '#!/usr/bin/env node\nconsole.log("fixture");\n',
    );
    const archive = join(directory, 'original.tgz');
    await c({ file: archive, cwd: directory, gzip: true }, ['package']);
    const result = await createGitHubPackage(archive, join(directory, 'output'));
    assert.equal(result, join(directory, 'output', 'justinoboyle-cliscope-1.2.3.tgz'));
    const extracted = join(directory, 'extracted');
    await mkdir(extracted);
    await x({ file: result, cwd: extracted });
    assert.equal(
      await readFile(join(extracted, 'package/dist/launcher.js'), 'utf8'),
      '#!/usr/bin/env node\nconsole.log("fixture");\n',
    );
    assert.deepEqual(JSON.parse(await readFile(join(extracted, 'package/package.json'), 'utf8')), {
      ...metadata,
      name: '@justinoboyle/cliscope',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('registry repacking rejects paths outside the npm package directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cliscope-package-path-test-'));
  try {
    await writeFile(join(directory, 'outside.txt'), 'Not an npm package entry');
    const archive = join(directory, 'invalid.tgz');
    await c({ file: archive, cwd: directory, gzip: true }, ['outside.txt']);
    await assert.rejects(
      createGitHubPackage(archive, join(directory, 'output')),
      /Unexpected package archive path/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('payload comparison detects a dropped file named __proto__', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cliscope-package-payload-test-'));
  try {
    const root = join(directory, 'package');
    await mkdir(join(root, 'dist'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify(metadata));
    await writeFile(join(root, 'dist/launcher.js'), 'console.log("fixture");\n');
    await writeFile(join(root, '__proto__'), 'This file must not be silently omitted');
    const archive = join(directory, 'original.tgz');
    await c({ file: archive, cwd: directory, gzip: true }, ['package']);
    await assert.rejects(
      createGitHubPackage(archive, join(directory, 'output')),
      /Registry conversion changed package files/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('registry repacking rejects links and device entries before extraction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cliscope-package-link-test-'));
  try {
    const entries = [
      new Header({ path: 'package/link', type: 'SymbolicLink', linkpath: '../../outside' }),
      new Header({ path: 'package/link', type: 'Link', linkpath: '../../outside' }),
      new Header({ path: 'package/device', type: 'CharacterDevice' }),
      new Header({ path: 'package/device', type: 'BlockDevice' }),
      new Header({ path: 'package/pipe', type: 'FIFO' }),
    ];
    for (const entry of entries) {
      const block = Buffer.alloc(512);
      entry.encode(block);
      const archive = join(directory, 'invalid.tgz');
      await writeFile(archive, gzipSync(Buffer.concat([block, Buffer.alloc(1024)])));
      await assert.rejects(
        createGitHubPackage(archive, join(directory, 'output')),
        /non-regular entry/,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
