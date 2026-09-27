import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fc from 'fast-check';
import { tokenize } from '../src/shell-lexer.js';
import { extractTools } from '../src/shell-tools.js';

await test('lexer yields a prefix without scanning or retaining the remaining argument tokens', () => {
  const tokens = tokenize(`git ${'argument '.repeat(100_000)}`);
  const iterator = tokens[Symbol.iterator]();
  assert.deepEqual(iterator.next().value, {
    kind: 'word',
    text: 'git',
    dynamic: false,
    quoted: false,
    assignment: false,
  });
  assert.equal(tokens.complete, false);
  iterator.return();
});

await test('streaming preserves wrapper fallback, option values, and incomplete prefixes', () => {
  const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['sudo -u', ['sudo']],
    ['sudo -u root', ['sudo']],
    ['sudo --', ['sudo']],
    ['sudo A=1', []],
    ['timeout -- 5s', ['timeout']],
    ['timeout -s TERM 5s A=1', []],
    ['timeout -s TERM 5s sudo -u root git status', ['git']],
    ['sudo -u >file root git status', ['git']],
    ['sudo >file --help ignored', ['sudo']],
    ['env -u HOME A=1 command -- /usr/bin/git ignored', ['git']],
    ['command -v git && env -S "git status"', ['command', 'env']],
  ];
  for (const [command, expected] of cases) assert.deepEqual(extractTools(command), expected);
});

await test('late unsupported syntax or unterminated quotes discard already resolved invocations', () => {
  const prefix = `git ${'x '.repeat(100_000)}; npm test; `;
  for (const suffix of ['function f { echo x; }', 'f() { echo x; }', 'cat <<EOF', 'echo "open'])
    assert.deepEqual(extractTools(prefix + suffix), []);
  assert.deepEqual(extractTools(`${prefix}echo function case switch`), ['git', 'npm', 'echo']);
});

await test('dense separators and argument lists preserve every subsequent invocation', () => {
  assert.deepEqual(extractTools(`${';'.repeat(100_000)}git ${'x '.repeat(100_000)}; npm test`), [
    'git',
    'npm',
  ]);
  assert.deepEqual(extractTools(`${'A=1 '.repeat(100_000)}env -i git`), ['git']);
});

await test('generated wrappers, quoted arguments, and separators preserve independently known tools', () => {
  const tool = fc.constantFrom('git', 'npm', 'make', 'printf');
  const prefix = fc.constantFrom('', 'A=1 ', 'sudo -u root ', 'env -u HOME ', 'timeout -- 5s ');
  const invocation = fc.tuple(tool, prefix, fc.array(fc.string(), { maxLength: 8 }));
  fc.assert(
    fc.property(fc.array(invocation, { maxLength: 15 }), (commands) => {
      const source = commands
        .map(([name, wrapper, args]) => {
          const quoted = args.map((argument) => `'${argument.replace(/'/g, "'\\''")}'`).join(' ');
          return `${wrapper}${name} ${quoted}`;
        })
        .join(' && ');
      assert.deepEqual(
        extractTools(source),
        commands.map(([name]) => name),
      );
    }),
    { numRuns: 1_000 },
  );
});
