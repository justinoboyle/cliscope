import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  canonicalContract,
  classifyContracts,
  contractSchema,
  generateContract,
  hashContract,
  nextVersion,
  stampVersion,
} from '../scripts/release-contract.js';
import type { Contract } from '../scripts/release-contract.js';

const empty: Contract = {
  format: 1,
  flags: {},
  outputs: {},
  csv: {},
  binaries: {},
  platforms: ['linux-x64'],
  runtime: {},
  behavior: {},
};

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cliscope-contract-test-'));
  const files: Readonly<Record<string, string>> = {
    'tsconfig.json': '{ "compilerOptions": { "target": "ES2023" } }',
    'package.json': JSON.stringify({
      name: 'cliscope',
      version: '0.0.0-development',
      bin: { cliscope: 'dist/launcher.js' },
      engines: { node: '>=20.13.1' },
      dependencies: { bun: '1.4.2' },
      optionalDependencies: {},
      devDependencies: { zod: '4.6.5' },
    }),
    'package-lock.json': JSON.stringify({
      name: 'cliscope',
      version: '0.0.0-development',
      lockfileVersion: 3,
      packages: {
        '': { name: 'cliscope', version: '0.0.0-development' },
        'node_modules/bun': {
          version: '1.4.2',
          resolved: 'https://example.invalid/bun.tgz',
          integrity: 'sha512-fixture-bun',
        },
        'node_modules/zod': {
          version: '4.6.5',
          resolved: 'https://example.invalid/zod.tgz',
          integrity: 'sha512-fixture-zod',
        },
      },
    }),
    'src/options.ts': `import { parseArgs } from 'node:util'; import { z } from 'zod';
const optionsSchema = z.object({ demo: z.boolean().default(false) });
export const HELP = 'Demo help';
export function parseOptions() { return parseArgs({ options: { demo: { type: 'boolean' } } }); }`,
    'src/types.ts':
      'export interface Report { totalEntries: number; tools: readonly ToolStat[]; days: readonly DayStat[]; } export interface ToolStat { name: string; count: number; } export interface DayStat { date: string; count: number; }',
    'src/calendar.ts':
      'export interface WeekdayStat { name: string; count: number; } export function weekdayStats() { return []; }',
    'src/export.ts': `function csvRows(view: string) { switch (view) { case 'tools': return [['tool', 'count'], ['demo', 1]]; } }
export function formatReport(report: object) { return JSON.stringify({ ...report, weekdays: weekdayStats(report) }); }`,
    'scripts/build-package.ts': 'const target = "bun";',
    'scripts/build-binary.ts': 'const native = true;',
    '.github/workflows/ci.yml': `jobs:
  verify:
    strategy:
      matrix:
        include: [{ target: linux-x64 }, { target: darwin-arm64 }]
    steps: [{ run: tar -czf native.tar.gz cliscope }]
  package:
    steps: [{ run: npm pack }]
`,
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

async function replace(root: string, file: string, before: string, after: string): Promise<void> {
  const path = join(root, file);
  const text = await readFile(path, 'utf8');
  assert.ok(text.includes(before));
  await writeFile(path, text.replace(before, after));
}

await test('contracts classify additions, removals, changed behavior, and zero-major SemVer', () => {
  assert.deepEqual(classifyContracts(empty, empty), {
    bump: 'patch',
    reasons: ['No detected public-contract or runtime behavior change'],
  });
  const added = {
    ...empty,
    outputs: { 'Report.extra': 'string' },
    platforms: ['linux-x64', 'darwin-arm64'],
  };
  assert.equal(classifyContracts(empty, added).bump, 'minor');
  assert.equal(classifyContracts(added, empty).bump, 'major');
  assert.equal(
    classifyContracts(empty, { ...empty, behavior: { 'src/new.ts': 'hash' } }).bump,
    'major',
  );
  for (const [version, bump, expected] of [
    ['0.2.1', 'major', '0.3.0'],
    ['0.2.1', 'minor', '0.3.0'],
    ['0.2.1', 'patch', '0.2.2'],
    ['1.2.3', 'major', '2.0.0'],
    ['1.2.3', 'minor', '1.3.0'],
    ['1.2.3', 'patch', '1.2.4'],
  ] as const)
    assert.equal(nextVersion(version, bump), expected);
  for (const version of ['v1.2.3', '01.2.3', '1.2.3-alpha', '9007199254740992.0.0'])
    assert.throws(() => nextVersion(version, 'patch'));
  assert.throws(() => nextVersion('1.0.9007199254740991', 'patch'), /overflow/);
});

await test('canonical contracts ignore record insertion order and reject version fields or malformed data', () => {
  const a = { ...empty, outputs: { z: 'number', a: 'string' } };
  const b = { ...empty, outputs: { a: 'string', z: 'number' } };
  assert.equal(canonicalContract(a), canonicalContract(b));
  assert.equal(hashContract(a), hashContract(b));
  const left = contractSchema.parse({
    ...empty,
    flags: { demo: { type: 'boolean', short: null, validation: 'boolean', default: 'false' } },
  });
  const right = contractSchema.parse({
    ...empty,
    flags: { demo: { default: 'false', validation: 'boolean', short: null, type: 'boolean' } },
  });
  assert.equal(canonicalContract(left), canonicalContract(right));
  assert.equal(classifyContracts(left, right).bump, 'patch');
  assert.match(hashContract(a), /^[a-f0-9]{64}$/);
  assert.throws(() => contractSchema.parse({ ...empty, version: '1.2.3' }));
  assert.throws(() => contractSchema.parse({ ...empty, platforms: [null] }));
  assert.throws(() => contractSchema.parse({ ...empty, flags: { demo: { type: 'unknown' } } }));
});

await test('source extraction derives defaults, types, CSV columns, binaries, platforms and runtime', async () => {
  const root = await fixture();
  try {
    const contract = await generateContract(root);
    assert.deepEqual(contract.flags['demo'], {
      type: 'boolean',
      short: null,
      validation: 'z . boolean (  ) . default ( false )',
      default: 'false',
    });
    assert.equal(contract.outputs['Report.tools'], 'readonly ToolStat [ ]');
    assert.match(contract.outputs['JSON.expression'] ?? '', /\.\.\.\s+report/);
    assert.deepEqual(contract.csv['tools'], ['tool', 'count']);
    assert.deepEqual(contract.platforms, ['darwin-arm64', 'linux-x64']);
    assert.equal(contract.binaries['cliscope'], 'dist/launcher.js');
    assert.equal(contract.runtime['dependency:zod'], '4.6.5');
    assert.equal(contract.runtime['dependency:bun'], '1.4.2');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('formatting, comments, help prose and placeholder versions do not request a contract bump', async () => {
  const root = await fixture();
  try {
    const before = await generateContract(root);
    await replace(root, 'src/options.ts', "'Demo help'", '"Different help"');
    await replace(
      root,
      'src/calendar.ts',
      'return [];',
      '\n/* explanatory comment */ return  [ ];',
    );
    await replace(root, 'scripts/build-package.ts', '"bun"', "'bun'");
    await replace(root, 'package.json', '0.0.0-development', '9.9.9');
    assert.deepEqual(classifyContracts(before, await generateContract(root)), {
      bump: 'patch',
      reasons: ['No detected public-contract or runtime behavior change'],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('build configuration captures semantic changes and ignores JSONC presentation', async () => {
  const root = await fixture();
  const path = join(root, 'tsconfig.json');
  try {
    const before = await generateContract(root);
    await writeFile(path, '{ /* explanation */ "compilerOptions": { "target": "ES2023", }, }');
    assert.equal(classifyContracts(before, await generateContract(root)).bump, 'patch');
    await writeFile(
      path,
      '{ "compilerOptions": { "target": "ES2023", "paths": { "string-width": ["./src/demo.ts"] } } }',
    );
    const changed = await generateContract(root);
    assert.equal(classifyContracts(before, changed).bump, 'major');
    assert.ok(
      classifyContracts(before, changed).reasons.includes(
        'runtime: changed configuration:tsconfig.json',
      ),
    );
    await writeFile(
      path,
      '{ "compilerOptions": { "paths": { "string-width": ["./src/demo.ts"] }, "target": "ES2023" } }',
    );
    assert.equal(hashContract(changed), hashContract(await generateContract(root)));
    await writeFile(path, '{ "extends": "../external.json" }');
    await assert.rejects(generateContract(root), /inherited configuration is not captured/);
    await writeFile(path, '{');
    await assert.rejects(generateContract(root), /invalid JSONC/);
    await rm(path);
    await assert.rejects(generateContract(root), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('required runtime dependencies cannot become optional without a breaking classification', async () => {
  const root = await fixture();
  try {
    const before = await generateContract(root);
    await replace(
      root,
      'package.json',
      '"dependencies":{"bun":"1.4.2"},"optionalDependencies":{}',
      '"dependencies":{},"optionalDependencies":{"bun":"1.4.2"}',
    );
    const after = await generateContract(root);
    assert.equal(before.runtime['dependency:bun'], after.runtime['dependency:bun']);
    assert.equal(classifyContracts(before, after).bump, 'major');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('native archive assembly changes request a breaking contract classification', async () => {
  const root = await fixture();
  try {
    const before = await generateContract(root);
    await replace(root, '.github/workflows/ci.yml', 'tar -czf', 'tar -cJf');
    const change = classifyContracts(before, await generateContract(root));
    assert.equal(change.bump, 'major');
    assert.ok(change.reasons.includes('runtime: changed workflow:ci-artifacts'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('new flags are additive; changed defaults or executable behavior are breaking', async () => {
  const root = await fixture();
  try {
    const before = await generateContract(root);
    await replace(
      root,
      'src/options.ts',
      'demo: z.boolean().default(false)',
      'demo: z.boolean().default(false), ascii: z.boolean().default(false)',
    );
    await replace(
      root,
      'src/options.ts',
      "demo: { type: 'boolean' }",
      "demo: { type: 'boolean' }, ascii: { type: 'boolean' }",
    );
    const additive = await generateContract(root);
    assert.equal(classifyContracts(before, additive).bump, 'minor');
    await replace(
      root,
      'src/options.ts',
      'demo: z.boolean().default(false)',
      'demo: z.boolean().default(true)',
    );
    assert.equal(classifyContracts(additive, await generateContract(root)).bump, 'major');
    await replace(root, 'src/calendar.ts', 'return [];', 'return [1];');
    assert.ok(
      classifyContracts(additive, await generateContract(root)).reasons.includes(
        'behavior: changed src/calendar.ts',
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('unsupported extraction fails explicitly instead of omitting contract properties', async () => {
  const root = await fixture();
  try {
    await replace(root, 'src/options.ts', "demo: { type: 'boolean' }", '...externalOptions');
    await assert.rejects(generateContract(root), /Unsupported spread/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('public aliases and dynamic module expressions fail closed rather than disappearing with types', async () => {
  const root = await fixture();
  try {
    await replace(root, 'src/types.ts', 'totalEntries: number', 'totalEntries: CustomCount');
    await assert.rejects(generateContract(root), /Unsupported public output type reference/);
    await replace(root, 'src/types.ts', 'totalEntries: CustomCount', 'totalEntries: number');
    await replace(root, 'package.json', '"zod":"4.6.5"', '"zod":"4.6.5","extra":"1.0.0"');
    await replace(
      root,
      'package-lock.json',
      '"node_modules/zod":',
      '"node_modules/extra":{"version":"1.0.0","integrity":"sha512-extra","resolved":"https://example.invalid/extra.tgz"},"node_modules/zod":',
    );
    await replace(root, 'src/calendar.ts', 'return [];', "return import('extra');");
    const contract = await generateContract(root);
    assert.equal(contract.runtime['dependency:extra'], '1.0.0');
    assert.ok(contract.runtime['lock:node_modules/extra']);
    await replace(root, 'src/calendar.ts', "import('extra')", 'import(variableModule)');
    await assert.rejects(generateContract(root), /Unsupported nonliteral runtime module import/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('executable HELP and runtime imports outside the supported source tree fail closed', async () => {
  const root = await fixture();
  try {
    await replace(
      root,
      'src/options.ts',
      "'Demo help'",
      "(() => { process.env['SIDE_EFFECT'] = '1'; return 'Demo help'; })()",
    );
    await assert.rejects(generateContract(root), /Unsupported executable HELP initializer/);
    await replace(
      root,
      'src/options.ts',
      "(() => { process.env['SIDE_EFFECT'] = '1'; return 'Demo help'; })()",
      "'Demo help'",
    );
    await replace(
      root,
      'src/calendar.ts',
      'export interface',
      "import '../runtime-probe.js'; export interface",
    );
    await assert.rejects(generateContract(root), /Unsupported runtime import outside src/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

await test('stamping updates disposable manifest roots while preserving dependency versions', async () => {
  const root = await fixture();
  try {
    await stampVersion(root, '0.3.0');
    const packageText = await readFile(join(root, 'package.json'), 'utf8');
    const lockText = await readFile(join(root, 'package-lock.json'), 'utf8');
    assert.match(packageText, /"version": "0.3.0"/);
    assert.equal((lockText.match(/"version": "0.3.0"/g) ?? []).length, 2);
    assert.match(lockText, /"version": "1.4.2"/);
    await assert.rejects(stampVersion(root, '0.3.0-beta'));
    await assert.rejects(stampVersion(root, '9007199254740992.0.0'));
    await writeFile(join(root, 'package-lock.json'), '{}');
    await assert.rejects(stampVersion(root, '0.4.0'));
    assert.equal(await readFile(join(root, 'package.json'), 'utf8'), packageText);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
