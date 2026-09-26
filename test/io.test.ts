import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadHistory, MAX_HISTORY_BYTES, readHistoryFile } from '../src/io.js';

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
