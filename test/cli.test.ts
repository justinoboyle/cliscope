import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { z } from 'zod';

function run(args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

await test('CLI produces ranked JSON from a real file without exposing arguments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cliscope-cli-'));
  try {
    const history = join(directory, 'history');
    await writeFile(
      history,
      'git status\ngit push\ncurl --header secret-value https://example.invalid\n',
    );
    const result = run(['--history', history, '--shell', 'bash', '--json']);
    assert.equal(result.status, 0, result.stderr);
    const report = z
      .object({
        totalInvocations: z.number(),
        tools: z.array(z.object({ name: z.string(), count: z.number() })),
      })
      .parse(JSON.parse(result.stdout));
    assert.equal(report.totalInvocations, 3);
    assert.deepEqual(report.tools, [
      { name: 'git', count: 2 },
      { name: 'curl', count: 1 },
    ]);
    assert.ok(!result.stdout.includes('secret-value'));
    assert.equal(result.stderr, '');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('CLI demo is printable and failure modes are nonzero and actionable', () => {
  const chart = run(['--demo', '--ascii']);
  assert.equal(chart.status, 0, chart.stderr);
  assert.match(chart.stdout, /474 invocations/);
  assert.match(chart.stdout, /git/);
  assert.ok(!chart.stdout.includes('\u001b'));
  const interactive = run(['--demo', '-i']);
  assert.equal(interactive.status, 1);
  assert.match(interactive.stderr, /requires a terminal/);
  const invalid = run(['--top', '900']);
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: cliscope/);
});
