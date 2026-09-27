import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fc from 'fast-check';
import { analyze } from '../src/analyze.js';
import { iterateHistory, parseHistory } from '../src/history.js';
import type { HistoryEntry, Shell } from '../src/types.js';

await test('history iterators retain format state across partial consumption', () => {
  const histories: Readonly<Record<Shell, string>> = {
    bash: '#0\necho one\ntwo\n#1\ngit status',
    zsh: ': 0:0;echo one\\\ntwo\n: 1:0;git status',
    fish: '- cmd: echo one\\ntwo\n  when: 0\n- cmd: git status\n  when: 1',
  };
  for (const shell of ['bash', 'zsh', 'fish'] as const) {
    const iterator = iterateHistory(histories[shell], shell);
    assert.deepEqual(iterator.next(), {
      value: { command: 'echo one\ntwo', timestamp: 0 },
      done: false,
    });
    assert.deepEqual(iterator.next(), {
      value: { command: 'git status', timestamp: 1_000 },
      done: false,
    });
    assert.equal(iterator.next().done, true);
  }
});

await test('multiline batches preserve blank boundaries, timestamps, and iterator resumption', () => {
  for (const count of [1023, 1024, 1025, 2048, 4097]) {
    const fragments = ['echo first', ...Array.from({ length: count }, () => ''), 'last'];
    const expected = [
      { command: fragments.join('\n'), timestamp: 0 },
      { command: 'git', timestamp: 1_000 },
    ];
    const histories = {
      bash: `#0\n${fragments.join('\n')}\n#1\ngit`,
      zsh: `: 0:0;${fragments.join('\\\n')}\n: 1:0;git`,
    };
    for (const shell of ['bash', 'zsh'] as const) {
      assert.deepEqual(parseHistory(histories[shell], shell), expected);
      const iterator = iterateHistory(histories[shell], shell);
      assert.deepEqual(iterator.next().value, expected[0]);
      assert.deepEqual(iterator.next().value, expected[1]);
      assert.equal(iterator.next().done, true);
    }
  }
});

await test('whitespace-only multiline records are discarded across batches and at EOF', () => {
  const blank = '\n'.repeat(100_000);
  assert.deepEqual(parseHistory(`#0\n${blank}#1\ngit`, 'bash'), [
    { command: 'git', timestamp: 1_000 },
  ]);
  assert.deepEqual(parseHistory(`#0\n${blank}`, 'bash'), []);
  assert.deepEqual(parseHistory(`: 0:0;${'\\\n'.repeat(100_000)}`, 'zsh'), []);
  assert.deepEqual(parseHistory(`: 0:0;${'\\\n'.repeat(100_000)}\\`, 'zsh'), []);
});

await test('aggregation consumes a single-use iterable exactly once', () => {
  const entries: readonly HistoryEntry[] = [
    { command: 'git status; git diff', timestamp: 0 },
    { command: 'npm test', timestamp: null },
    { command: 'echo "unfinished', timestamp: 86_400_000 },
  ];
  let traversals = 0;
  const once: Iterable<HistoryEntry> = {
    [Symbol.iterator]() {
      assert.equal(traversals++, 0);
      return entries[Symbol.iterator]();
    },
  };
  assert.deepEqual(analyze(once), analyze(entries));
  assert.equal(traversals, 1);
});

await test('generated streamed histories produce the report of their original records', () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          command: fc.constantFrom('git status', 'npm test', 'echo one; git diff', '$unknown'),
          seconds: fc.integer({ min: 0, max: 2_000_000_000 }),
        }),
        { maxLength: 100 },
      ),
      fc.constantFrom('\n', '\r\n'),
      (records, separator) => {
        const entries = records.map(({ command, seconds }) => ({
          command,
          timestamp: seconds * 1_000,
        }));
        const text = records
          .map(({ command, seconds }) => `: ${seconds}:0;${command}`)
          .join(separator);
        assert.deepEqual(analyze(iterateHistory(text, 'zsh')), analyze(entries));
      },
    ),
    { numRuns: 1_000 },
  );
});
