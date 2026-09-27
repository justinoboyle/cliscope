import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { releasePath } from '../scripts/release-io.js';

const execute = promisify(execFile);

await test('release PATH rejects relative, workspace, dependency, and symlinked workspace directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cliscope-release-path-'));
  try {
    const workspace = join(directory, 'workspace');
    const nested = join(workspace, 'bin');
    const dependencies = join(directory, 'node_modules', '.bin');
    const trusted = join(directory, 'trusted');
    const working = join(directory, 'working');
    const alias = join(directory, 'workspace-alias');
    for (const path of [nested, dependencies, trusted, working])
      await mkdir(path, { recursive: true });
    await symlink(nested, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const path = [
      '',
      '.',
      'relative/bin',
      workspace,
      nested,
      dependencies,
      alias,
      working,
      trusted,
    ];
    assert.equal(
      await releasePath(path.join(delimiter), workspace, working),
      await realpath(trusted),
    );
    await assert.rejects(
      releasePath(['', '.', workspace, dependencies].join(delimiter), workspace),
      /no trusted external directories/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test(
  'release subprocess ignores an npm-injected hostile tool and executes the trusted tool',
  {
    skip: process.platform === 'win32' ? 'Privileged release orchestration runs on Ubuntu' : false,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cliscope-release-command-'));
    try {
      const hostile = join(directory, 'node_modules', '.bin');
      const trusted = join(directory, 'trusted');
      const marker = join(directory, 'executed.txt');
      await mkdir(hostile, { recursive: true });
      await mkdir(trusted);
      const shim = '#!/bin/sh\nprintf "%s" "$RELEASE_TOOL_ID" >> "$RELEASE_TOOL_MARKER"\n';
      await writeFile(join(hostile, 'gh'), shim.replace('$RELEASE_TOOL_ID', 'hostile'), {
        mode: 0o755,
      });
      await writeFile(join(trusted, 'gh'), shim.replace('$RELEASE_TOOL_ID', 'trusted'), {
        mode: 0o755,
      });
      await execute(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          "import {run} from './scripts/release-io.ts'; await run('gh', []);",
        ],
        {
          env: {
            ...process.env,
            PATH: [hostile, trusted, process.env['PATH'] ?? ''].join(delimiter),
            RELEASE_TOOL_MARKER: marker,
          },
        },
      );
      assert.equal(await readFile(marker, 'utf8'), 'trusted');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
