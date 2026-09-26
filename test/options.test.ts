import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fc from 'fast-check';
import { parseOptions } from '../src/options.js';

await test('defaults are validated and short options enter the closed command model', () => {
  const command = parseOptions([]);
  assert.equal(command.kind, 'analyze');
  if (command.kind !== 'analyze') throw new Error('Expected analyze command');
  assert.equal(command.options.top, 10);
  assert.equal(command.options.shell, 'auto');
  assert.equal(command.options.interactive, false);
  assert.deepEqual(parseOptions(['-h']), { kind: 'help' });
  assert.deepEqual(parseOptions(['-v']), { kind: 'version' });
  const interactive = parseOptions(['-i', '-n', '12', '--shell', 'fish']);
  assert.equal(interactive.kind, 'analyze');
  if (interactive.kind !== 'analyze') throw new Error('Expected analyze command');
  assert.equal(interactive.options.top, 12);
  assert.equal(interactive.options.interactive, true);
});

await test('invalid flags, values, dates and conflicting modes fail at the boundary', () => {
  for (const args of [
    ['--unknown'],
    ['surprise'],
    ['--top', '0'],
    ['--top', '101'],
    ['--top', '1.5'],
    ['--top', '1e1'],
    ['--top', 'NaN'],
    ['--shell', 'powershell'],
    ['--history', ''],
    ['--since', '2026-02-30'],
    ['--since', 'yesterday'],
    ['--since', '2026-1-1'],
    ['--json', '-i'],
    ['--csv', '--json'],
    ['--csv', '-i'],
    ['--view', 'unknown'],
    ['--output', 'report.csv', '-i'],
    ['--output', ''],
    ['--demo', '--history', '/tmp/history'],
  ])
    assert.throws(() => parseOptions(args));
  const leap = parseOptions(['--since', '2024-02-29']);
  if (leap.kind !== 'analyze') throw new Error('Expected analyze command');
  assert.equal(leap.options.since, Date.UTC(2024, 1, 29));
});

await test('all accepted top limits preserve their validated integer value', () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 100 }), (top) => {
      const command = parseOptions(['--top', String(top)]);
      assert.equal(command.kind, 'analyze');
      if (command.kind === 'analyze') assert.equal(command.options.top, top);
    }),
  );
});
