import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadHistory, MAX_HISTORY_BYTES, readHistoryFile } from '../src/io.js';

await test(
  'a FIFO is rejected without waiting for a writer',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cliscope-fifo-'));
    try {
      const path = join(directory, 'history');
      const fifo = spawnSync('mkfifo', [path]);
      assert.equal(fifo.status, 0);
      const result = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          "import { readHistoryFile } from './src/io.ts'; await readHistoryFile(process.argv[1]);",
          path,
        ],
        { encoding: 'utf8', timeout: 3000 },
      );
      assert.equal(result.error, undefined, 'reading a FIFO must not block');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /regular file/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

await test('discovery respects active shell, explicit format, HISTFILE and XDG paths', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cliscope-'));
  try {
    await writeFile(join(home, '.bash_history'), 'git status\n');
    await writeFile(join(home, '.zsh_history'), ': 1700000000:0;npm test\n');
    const environment = { home, shell: '/bin/bash', histfile: undefined, dataHome: undefined };
    const bash = await loadHistory({ shell: 'auto' }, environment);
    assert.equal(bash.shell, 'bash');
    assert.equal(bash.text, 'git status\n');
    const zsh = await loadHistory({ shell: 'zsh' }, environment);
    assert.equal(zsh.shell, 'zsh');
    const custom = await loadHistory(
      { shell: 'auto' },
      { ...environment, histfile: '~/.zsh_history' },
    );
    assert.equal(custom.shell, 'zsh');
    await mkdir(join(home, 'data', 'fish'), { recursive: true });
    await writeFile(
      join(home, 'data', 'fish', 'fish_history'),
      '- cmd: docker ps\n  when: 1700000000\n',
    );
    const fish = await loadHistory(
      { shell: 'fish' },
      { ...environment, dataHome: join(home, 'data') },
    );
    assert.equal(fish.shell, 'fish');
    await assert.rejects(
      loadHistory({ shell: 'auto', history: join(home, 'absent') }, environment),
      /ENOENT/,
    );
    await assert.rejects(readHistoryFile(home), /regular file|EISDIR/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

await test('missing histories are actionable and oversized files fail before allocation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'cliscope-'));
  try {
    await assert.rejects(
      loadHistory(
        { shell: 'auto' },
        {
          home,
          shell: undefined,
          histfile: undefined,
          dataHome: undefined,
        },
      ),
      /--history/,
    );
    const path = join(home, 'large');
    await writeFile(path, '');
    await truncate(path, MAX_HISTORY_BYTES + 1);
    await assert.rejects(readHistoryFile(path), /64 MiB/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
