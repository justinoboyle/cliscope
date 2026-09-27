import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fc from 'fast-check';
import { extractTools, parseHistory } from '../src/history.js';

await test('bash supports plain and timestamp-delimited multiline records', () => {
  assert.deepEqual(
    parseHistory(
      'git status\n#1704067200\necho hello\nprintf world\n#1704153600\nnpm test\n',
      'bash',
    ),
    [
      { command: 'git status', timestamp: null },
      { command: 'echo hello\nprintf world', timestamp: 1704067200000 },
      { command: 'npm test', timestamp: 1704153600000 },
    ],
  );
  assert.deepEqual(parseHistory('#999999999999999999999\ngit status', 'bash'), [
    { command: 'git status', timestamp: null },
  ]);
});

await test('zsh extended and plain history preserve multiline commands', () => {
  assert.deepEqual(
    parseHistory(': 1704067200:0;git status\n: 1704153600:3;echo one\\\ntwo\nnpm test\n', 'zsh'),
    [
      { command: 'git status', timestamp: 1704067200000 },
      { command: 'echo one\ntwo', timestamp: 1704153600000 },
      { command: 'npm test', timestamp: null },
    ],
  );
});

await test('zsh continuation preserves slash parity, timestamp ownership, and unfinished records', () => {
  const cases = [
    [
      'echo one\\\n: 2:0;two\n: 3:0;three',
      [
        { command: 'echo one\n: 2:0;two', timestamp: null },
        { command: 'three', timestamp: 3_000 },
      ],
    ],
    [
      ': 0:0;echo one\\\n\ntwo',
      [
        { command: 'echo one', timestamp: 0 },
        { command: 'two', timestamp: null },
      ],
    ],
    [
      'echo one\\\\\ntwo',
      [
        { command: 'echo one\\\\', timestamp: null },
        { command: 'two', timestamp: null },
      ],
    ],
    ['echo one\\\\\\\ntwo', [{ command: 'echo one\\\\\ntwo', timestamp: null }]],
    [': 0:0;echo one\\', [{ command: 'echo one', timestamp: 0 }]],
    [': 0:0;echo one\\\\', [{ command: 'echo one\\\\', timestamp: 0 }]],
    ['\\\n: 0:0;echo', [{ command: ': 0:0;echo', timestamp: null }]],
  ] as const;
  for (const [text, expected] of cases) assert.deepEqual(parseHistory(text, 'zsh'), expected);
});

await test('zsh joins large continuation records and leaves nonterminal slash runs intact', () => {
  const count = 100_000;
  assert.deepEqual(parseHistory(`: 0:0;${'x\\\n'.repeat(count)}done`, 'zsh'), [
    { command: `${'x\n'.repeat(count)}done`, timestamp: 0 },
  ]);
  const command = `echo ${'\\'.repeat(count)}x`;
  assert.deepEqual(parseHistory(command, 'zsh'), [{ command, timestamp: null }]);
});

await test('generated zsh continuations round-trip physical lines and even slash suffixes', () => {
  const fragment = fc
    .tuple(
      fc.array(fc.constantFrom('a', ' ', ':', ';', '界', '\t'), { maxLength: 20 }),
      fc.integer({ min: 0, max: 6 }),
    )
    .map(([characters, slashPairs]) => `${characters.join('')}x${'\\'.repeat(slashPairs * 2)}`);
  fc.assert(
    fc.property(
      fc.array(fragment, { minLength: 1, maxLength: 30 }),
      fc.boolean(),
      (parts, unfinished) => {
        const encoded = parts.join('\\\n') + (unfinished ? '\\' : '');
        assert.deepEqual(parseHistory(`: 0:0;${encoded}`, 'zsh'), [
          { command: parts.join('\n').trim(), timestamp: 0 },
        ]);
      },
    ),
    { numRuns: 1_000 },
  );
});

await test('fish parses escaped newlines and backslashes while ignoring path metadata', () => {
  const history =
    '- cmd: git status\n  when: 1704067200\n  paths:\n    - /tmp\n- cmd: echo a\\nb\\\\n\n  when: 1704153600\n- cmd: npm test\n';
  assert.deepEqual(parseHistory(history, 'fish'), [
    { command: 'git status', timestamp: 1704067200000 },
    { command: 'echo a\nb\\n', timestamp: 1704153600000 },
    { command: 'npm test', timestamp: null },
  ]);
});

await test('UTF-8 BOM, CRLF, empty history, epoch zero and invalid dates are handled', () => {
  assert.deepEqual(parseHistory('\uFEFF#0\r\ngit status\r\n', 'bash'), [
    { command: 'git status', timestamp: 0 },
  ]);
  for (const shell of ['bash', 'zsh', 'fish'] satisfies readonly ('bash' | 'zsh' | 'fish')[]) {
    assert.deepEqual(parseHistory('\n\n', shell), []);
  }
  assert.deepEqual(parseHistory(': 999999999999999999:0;ls', 'zsh'), [
    { command: 'ls', timestamp: null },
  ]);
});

await test('physical lines retain blank boundaries, lone carriage returns, and an initial BOM only', () => {
  assert.deepEqual(parseHistory('\uFEFF#0\r\necho one\r\n\r\n#1\r\necho two\r', 'bash'), [
    { command: 'echo one', timestamp: 0 },
    { command: 'echo two', timestamp: 1_000 },
  ]);
  assert.deepEqual(parseHistory('\uFEFF#0\nfirst\n\uFEFF#1\nsecond', 'bash'), [
    { command: 'first\n\uFEFF#1\nsecond', timestamp: 0 },
  ]);
  assert.deepEqual(parseHistory('echo one\recho two\n', 'zsh'), [
    { command: 'echo one\recho two', timestamp: null },
  ]);
  assert.deepEqual(parseHistory('- cmd: echo one\r\n  when: 0\r\n\r\n- cmd: echo two\n', 'fish'), [
    { command: 'echo one', timestamp: 0 },
    { command: 'echo two', timestamp: null },
  ]);
  for (const shell of ['bash', 'zsh', 'fish'] as const)
    assert.deepEqual(parseHistory('\n'.repeat(100_000), shell), []);
});

await test('generated timestamped records preserve line-ending and BOM variants in every format', () => {
  const record = fc.record({
    text: fc.array(fc.constantFrom('a', 'b', ' ', '界', ':', ';'), { maxLength: 40 }),
    seconds: fc.integer({ min: 0, max: 2_000_000_000 }),
  });
  fc.assert(
    fc.property(
      fc.array(record, { maxLength: 30 }),
      fc.constantFrom('\n', '\r\n'),
      fc.boolean(),
      fc.boolean(),
      (records, separator, bom, finalNewline) => {
        const expected = records.map(({ text, seconds }) => ({
          command: `echo ${text.join('')}`.trim(),
          timestamp: seconds * 1_000,
        }));
        for (const shell of ['bash', 'zsh', 'fish'] as const) {
          const lines = records.map(({ text, seconds }) => {
            const command = `echo ${text.join('')}`;
            if (shell === 'bash') return `#${seconds}${separator}${command}`;
            if (shell === 'fish') return `- cmd: ${command}${separator}  when: ${seconds}`;
            return `: ${seconds}:0;${command}`;
          });
          const input =
            (bom ? '\uFEFF' : '') + lines.join(separator) + (finalNewline ? separator : '');
          assert.deepEqual(parseHistory(input, shell), expected);
        }
      },
    ),
    { numRuns: 1_000 },
  );
});

await test('extracts commands across chains, pipelines, comments and grouping', () => {
  assert.deepEqual(
    extractTools('git status && npm test | tee log; (pwd; ls) & echo done # fake\nprintf ok'),
    ['git', 'npm', 'tee', 'pwd', 'ls', 'echo', 'printf'],
  );
  assert.deepEqual(extractTools('if test -f a; then cat a; else echo missing; fi'), [
    'test',
    'cat',
    'echo',
  ]);
  assert.deepEqual(extractTools('for f in *.txt; do cat "$f"; done'), ['cat']);
  assert.deepEqual(extractTools('echo function case switch; git status'), ['echo', 'git']);
});

await test('quotes, escape sequences and redirections cannot introduce commands', () => {
  assert.deepEqual(extractTools('echo "hello; fake | bad" && printf \'a && fake\' > output 2>&1'), [
    'echo',
    'printf',
  ]);
  assert.deepEqual(extractTools('echo hello\\;world | /usr/bin/sort 2> errors'), ['echo', 'sort']);
  assert.deepEqual(extractTools('echo a{b,c} ${HOME} && { git status; }'), ['echo', 'git']);
  assert.deepEqual(extractTools('2>/tmp/log git status >|out'), ['git']);
  assert.deepEqual(extractTools('echo \\\nhello'), ['echo']);
  assert.deepEqual(extractTools('echo "unterminated'), []);
  assert.deepEqual(extractTools('"a\\b"; "a\\$b"; \\$literal; \'$literal\''), [
    'a\\b',
    'a$b',
    '$literal',
    '$literal',
  ]);
});

await test('peels assignments and common wrappers without counting their arguments', () => {
  assert.deepEqual(
    extractTools('FOO="hello world" sudo -u root env -u HOME BAR=b /usr/bin/git status'),
    ['git'],
  );
  assert.deepEqual(
    extractTools('command -- npm test && nice -n 10 timeout -s TERM 5s nohup make'),
    ['npm', 'make'],
  );
  assert.deepEqual(extractTools('time -f "%e" env -i A=1 exec -a example node index.js'), ['node']);
  assert.deepEqual(extractTools('command -v git; env -S "git status"; sudo -l; sudo --help'), [
    'command',
    'env',
    'sudo',
    'sudo',
  ]);
  assert.deepEqual(extractTools('A=1 B=2'), []);
  assert.deepEqual(extractTools('"A=1"'), ['A=1']);
});

await test('dynamic names and nested substitutions are not expanded or executed', () => {
  assert.deepEqual(extractTools('echo "$(git status; printf bad)" | cat'), ['echo', 'cat']);
  assert.deepEqual(extractTools('echo $(echo $(whoami)) && pwd'), ['echo', 'pwd']);
  assert.deepEqual(extractTools('echo `rm dangerous`'), ['echo']);
  assert.deepEqual(extractTools('$COMMAND --version; $(which git) status; /bin/* --help'), []);
  assert.deepEqual(extractTools('diff <(git show main:a) <(git show HEAD:a)'), ['diff']);
  assert.deepEqual(extractTools('cat <<EOF\npretend-tool\nEOF'), []);
  assert.deepEqual(extractTools('greet() { echo hello; }; greet'), []);
  assert.deepEqual(extractTools('function greet { echo hello; }'), []);
});

await test('ordinary word runs preserve adjacent quotes, Unicode, expansions, and literal hashes', () => {
  assert.deepEqual(
    extractTools(
      'A=x+y g"it" --path=src/lib.ts && ./git界 status; $tool-name args; path#literal file',
    ),
    ['git', 'git界', 'path#literal'],
  );
});

await test('arbitrary text always parses and extracts without throwing', () => {
  fc.assert(
    fc.property(fc.string(), (text) => {
      for (const shell of ['bash', 'zsh', 'fish'] satisfies readonly ('bash' | 'zsh' | 'fish')[]) {
        for (const value of parseHistory(text, shell)) {
          assert.ok(value.command.length > 0);
          assert.ok(value.timestamp === null || Number.isFinite(value.timestamp));
          extractTools(value.command);
        }
      }
      extractTools(text);
    }),
    { numRuns: 1_000 },
  );
});

await test('quoted arbitrary arguments never create additional tools', () => {
  fc.assert(
    fc.property(fc.string(), (argument) => {
      const escaped = argument.replace(/'/g, "'\\''");
      assert.deepEqual(extractTools(`git '${escaped}'`), ['git']);
    }),
    { numRuns: 1_000 },
  );
});
