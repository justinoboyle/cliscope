import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const installationArgument = process.argv[2];
assert.ok(installationArgument, 'Usage: node smoke-package.mjs INSTALL_DIRECTORY');
const installation = resolve(installationArgument);
const packageDirectory = join(installation, 'node_modules', 'cliscope');
/** @type {unknown} */
const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
assert.ok(typeof manifest === 'object' && manifest !== null && 'bin' in manifest);
assert.ok('version' in manifest && typeof manifest.version === 'string');
assert.ok(typeof manifest.bin === 'object' && manifest.bin !== null && 'cliscope' in manifest.bin);
assert.ok(typeof manifest.bin.cliscope === 'string');
const executable = join(packageDirectory, manifest.bin.cliscope);
const fixtures = await mkdtemp(join(installation, 'smoke-fixtures-'));
const history = join(fixtures, 'history with spaces λ');
const unusedWeekdays = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((name) => ({
  name,
  count: 0,
  days: 0,
  average: 0,
  score: 0,
}));
await writeFile(
  history,
  '#1704067200\ngit status --password smoke-secret\n#1704153600\ngit diff\n#1704153601\nnpm test\n',
);

/**
 * @param {readonly string[]} args
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function run(args) {
  /** @type {NodeJS.ProcessEnv} */
  const environment = { ...process.env, NO_COLOR: '1', HISTFILE: history };
  delete environment['NODE_PATH'];
  return spawnSync(process.execPath, [executable, ...args], {
    cwd: installation,
    encoding: 'utf8',
    timeout: 15_000,
    env: environment,
  });
}

await test('installed package prints its version and usage on the consumer Node runtime', () => {
  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr || version.error?.message || 'Process failed');
  assert.equal(version.stdout.trim(), manifest.version);
  assert.equal(version.stderr, '');
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: cliscope/);
  assert.equal(help.stderr, '');
});

await test('installed package reads a spaced Unicode path and returns the complete report', () => {
  const result = run(['--history', history, '--shell', 'bash', '--json']);
  assert.equal(result.status, 0, result.stderr || result.error?.message || 'Process failed');
  /** @type {unknown} */
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report, {
    totalEntries: 3,
    totalInvocations: 3,
    uniqueTools: 2,
    timestampedEntries: 3,
    tools: [
      { name: 'git', count: 2, share: 2 / 3 },
      { name: 'npm', count: 1, share: 1 / 3 },
    ],
    days: [
      { date: '2024-01-01', count: 1 },
      { date: '2024-01-02', count: 2 },
    ],
    weekdays: [
      { name: 'Mon', count: 1, days: 1, average: 1, score: 50 },
      { name: 'Tue', count: 2, days: 1, average: 2, score: 100 },
      ...unusedWeekdays,
    ],
  });
  assert.ok(!result.stdout.includes('smoke-secret'));
  assert.equal(result.stderr, '');
});

await test('installed package discovers HISTFILE and filters at the inclusive UTC boundary', () => {
  const result = run(['--shell', 'bash', '--since', '2024-01-02', '--json']);
  assert.equal(result.status, 0, result.stderr);
  /** @type {unknown} */
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report, {
    totalEntries: 2,
    totalInvocations: 2,
    uniqueTools: 2,
    timestampedEntries: 2,
    tools: [
      { name: 'git', count: 1, share: 0.5 },
      { name: 'npm', count: 1, share: 0.5 },
    ],
    days: [{ date: '2024-01-02', count: 2 }],
    weekdays: [
      { name: 'Mon', count: 0, days: 0, average: 0, score: 0 },
      { name: 'Tue', count: 2, days: 1, average: 2, score: 100 },
      ...unusedWeekdays,
    ],
  });
});

await test('installed package writes an uncolored ASCII graph without command arguments', () => {
  const result = run(['--history', history, '--shell', 'bash', '--ascii', '--no-color']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\bgit\b/);
  assert.match(result.stdout, /\bnpm\b/);
  assert.match(result.stdout, /#/);
  assert.ok(!result.stdout.includes('\u001b'));
  assert.ok(!result.stdout.includes('smoke-secret'));
  assert.equal(result.stderr, '');
});

await test('installed package rejects interactive mode without a terminal', () => {
  const result = run(['--demo', '-i']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /terminal/i);
  assert.doesNotMatch(result.stderr, /bad option|experimental-ffi|MODULE_NOT_FOUND/);
});

await test('installed package reports invalid options and missing files on stderr', () => {
  for (const { args, message } of [
    { args: ['--top', '0'], message: /top/ },
    { args: ['--since', '2024-02-30'], message: /since/ },
    { args: ['--json', '-i'], message: /combined/ },
    { args: ['--json', '--csv'], message: /combined/ },
    { args: ['--view', 'invalid'], message: /view/ },
    { args: ['--unknown-flag'], message: /unknown-flag/ },
    { args: ['--history', join(fixtures, 'missing-history')], message: /ENOENT/ },
  ]) {
    const result = run(args);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /^cliscope:/);
    assert.match(result.stderr, message);
  }
});

await test('installed package handles empty history without NaN or a failure exit', async () => {
  const emptyHistory = join(fixtures, 'empty-history');
  await writeFile(emptyHistory, '');
  const result = run(['--history', emptyHistory, '--shell', 'bash', '--json']);
  assert.equal(result.status, 0, result.stderr);
  /** @type {unknown} */
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report, {
    totalEntries: 0,
    totalInvocations: 0,
    uniqueTools: 0,
    timestampedEntries: 0,
    tools: [],
    days: [],
    weekdays: [],
  });
});

await test('installed package renders calendar and weekday views from dated history', () => {
  const calendar = run(['--history', history, '--shell', 'bash', '--view', 'calendar', '--ascii']);
  assert.equal(calendar.status, 0, calendar.stderr);
  assert.match(calendar.stdout, /Calendar \(UTC\)/);
  assert.match(calendar.stdout, /2024-01-01 to 2024-01-02/);
  const weekdays = run(['--history', history, '--shell', 'bash', '--view', 'weekdays', '--ascii']);
  assert.equal(weekdays.status, 0, weekdays.stderr);
  assert.match(weekdays.stdout, /Mon\s+1\s+1\s+1\.0\s+50/);
  assert.match(weekdays.stdout, /Tue\s+2\s+1\s+2\.0\s+100/);
});

await test('installed package exports CSV to a new file and refuses to overwrite it', async () => {
  const output = join(fixtures, 'calendar export.csv');
  const args = [
    '--history',
    history,
    '--shell',
    'bash',
    '--view',
    'calendar',
    '--csv',
    '--output',
    output,
  ];
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  const expected = '"date_utc","count"\r\n"2024-01-01",1\r\n"2024-01-02",2\r\n';
  assert.equal(await readFile(output, 'utf8'), expected);
  if (process.platform !== 'win32') assert.equal((await stat(output)).mode & 0o777, 0o600);
  const retry = run(args);
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /EEXIST/);
  assert.equal(await readFile(output, 'utf8'), expected);
});

await rm(fixtures, { recursive: true, force: true });
