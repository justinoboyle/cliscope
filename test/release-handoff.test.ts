import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { parse } from 'yaml';
import { z } from 'zod';
import { hashContract, type Contract } from '../scripts/release-contract.js';
import { assertBuildSource, validatePlan, type ReleasePlan } from '../scripts/release-model.js';

const contract: Contract = {
  format: 1,
  flags: {},
  outputs: {},
  csv: {},
  binaries: {},
  platforms: ['linux-x64'],
  runtime: {},
  behavior: {},
};
const plan = validatePlan({
  kind: 'release',
  sourceSha: 'a'.repeat(40),
  previousTag: 'v0.2.1',
  tag: 'v0.3.0',
  contract,
  contractHash: hashContract(contract),
  reasons: ['Synthetic handoff'],
  resume: false,
});
const execute = promisify(execFile);
const posixOnly = {
  skip: process.platform === 'win32' ? 'Privileged release jobs use POSIX tools on Ubuntu' : false,
};

// This executable is outside the checkout; every GitHub operation is synthetic.
const fakeGh = `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const path = process.env.HANDOFF_FIXTURE;
const state = JSON.parse(readFileSync(path, 'utf8'));
appendFileSync(process.env.HANDOFF_CALLS, JSON.stringify(args) + '\\n');
if (args[0] === 'workflow') {
  if (args[1] !== 'run' || args[2] !== 'release.yml') throw Error('Unexpected dispatch');
} else if (args[0] === 'api' && args[1].includes('/git/ref/tags/')) {
  if (state.mode === 'missing') { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
  if (state.mode === 'forbidden') { console.error('gh: Forbidden (HTTP 403)'); process.exit(1); }
  console.log(JSON.stringify({ object: {
    type: state.mode === 'annotated' ? 'tag' : 'commit',
    sha: state.mode === 'wrong-sha' ? 'b'.repeat(40) : state.sourceSha
  } }));
} else if (args[0] === 'api' && args[1].endsWith('/git/refs') && args.includes('POST')) {
  if (!args.includes('ref=refs/tags/release-build/' + state.sourceSha) || !args.includes('sha=' + state.sourceSha)) throw Error('Wrong source ref');
  state.mode = 'match'; writeFileSync(path, JSON.stringify(state)); console.log('{}');
} else throw Error('Unexpected GitHub operation');
`;

interface HandoffFixture {
  readonly directory: string;
  readonly calls: string;
  readonly planPath: string;
  readonly env: NodeJS.ProcessEnv;
}

async function withFixture(
  mode: string,
  operation: (fixture: HandoffFixture) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'cliscope-handoff-'));
  try {
    const bin = join(directory, 'bin');
    await mkdir(bin);
    const calls = join(directory, 'calls.jsonl');
    const fixture = join(directory, 'fixture.json');
    const planPath = join(directory, 'plan.json');
    await writeFile(join(bin, 'gh'), fakeGh, { mode: 0o755 });
    await writeFile(calls, '');
    await writeFile(fixture, JSON.stringify({ mode, sourceSha: plan.sourceSha }));
    await writeFile(planPath, JSON.stringify(plan));
    await operation({
      directory,
      calls,
      planPath,
      env: {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
        GH_REPO: 'justinoboyle/cliscope',
        HANDOFF_FIXTURE: fixture,
        HANDOFF_CALLS: calls,
      },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function callsFrom(fixture: HandoffFixture): Promise<readonly string[][]> {
  return (await readFile(fixture.calls, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => z.array(z.string()).parse(JSON.parse(line)));
}

async function dispatch(fixture: HandoffFixture): Promise<void> {
  await execute(
    process.execPath,
    ['--import', 'tsx', 'scripts/release.ts', 'dispatch-build', '--plan', fixture.planPath],
    { env: fixture.env },
  );
}

await test('both checkout and workflow revisions must match the planned build source', () => {
  assertBuildSource(plan, { GITHUB_SHA: plan.sourceSha, GITHUB_WORKFLOW_SHA: plan.sourceSha });
  for (const environment of [
    {},
    { GITHUB_SHA: plan.sourceSha },
    { GITHUB_SHA: 'b'.repeat(40), GITHUB_WORKFLOW_SHA: plan.sourceSha },
    { GITHUB_SHA: plan.sourceSha, GITHUB_WORKFLOW_SHA: 'b'.repeat(40) },
  ])
    assert.throws(() => assertBuildSource(plan, environment), /build workflow must match/);
});

await test('main pushes use the release matrix once; PR and merge queue CI remain enabled', async () => {
  const schema = z.object({ on: z.record(z.string(), z.unknown()) });
  const ciRaw: unknown = parse(await readFile('.github/workflows/ci.yml', 'utf8'));
  const releaseRaw: unknown = parse(await readFile('.github/workflows/release.yml', 'utf8'));
  const ci = schema.parse(ciRaw).on;
  const release = schema.parse(releaseRaw).on;
  assert.equal(Object.hasOwn(ci, 'push'), false);
  for (const trigger of ['pull_request', 'merge_group', 'workflow_call'])
    assert.ok(Object.hasOwn(ci, trigger));
  assert.deepEqual(z.object({ branches: z.array(z.string()) }).parse(release['push']).branches, [
    'main',
  ]);
  const callable = z
    .object({ inputs: z.record(z.string(), z.unknown()) })
    .parse(ci['workflow_call']);
  assert.equal(Object.hasOwn(callable.inputs, 'source-ref'), false);
});

await test(
  'handoff creates the source ref once and reuses it without moving it',
  posixOnly,
  async () => {
    await withFixture('missing', async (fixture) => {
      await dispatch(fixture);
      await dispatch(fixture);
      const calls = await callsFrom(fixture);
      assert.equal(calls.filter((args) => args.includes('POST')).length, 1);
      assert.equal(calls.filter((args) => args.includes('PATCH')).length, 0);
      assert.deepEqual(
        calls.filter((args) => args[0] === 'workflow'),
        Array.from({ length: 2 }, () => [
          'workflow',
          'run',
          'release.yml',
          '--repo',
          'justinoboyle/cliscope',
          '--ref',
          `release-build/${plan.sourceSha}`,
          '-f',
          'phase=plan',
        ]),
      );
    });
  },
);

await test(
  'conflicting, annotated, or inaccessible source refs fail without mutation or dispatch',
  posixOnly,
  async () => {
    for (const mode of ['wrong-sha', 'annotated', 'forbidden']) {
      await withFixture(mode, async (fixture) => {
        await assert.rejects(dispatch(fixture));
        const calls = await callsFrom(fixture);
        assert.equal(calls.length, 1);
        assert.equal(calls[0]?.[0], 'api');
        assert.ok(calls.every((args) => !args.includes('POST') && !args.includes('PATCH')));
      });
    }
  },
);

await test(
  'resume refuses rebuilding and wrong-source reservation stops before any GitHub call',
  posixOnly,
  async () => {
    await withFixture('match', async (fixture) => {
      const resumed: ReleasePlan = { ...plan, resume: true };
      await writeFile(fixture.planPath, JSON.stringify(resumed));
      await assert.rejects(dispatch(fixture), /recover their original build/);
      await writeFile(fixture.planPath, JSON.stringify(plan));
      await assert.rejects(
        execute(
          process.execPath,
          [
            '--import',
            'tsx',
            'scripts/release.ts',
            'reserve',
            '--plan',
            fixture.planPath,
            '--artifacts',
            join(fixture.directory, 'missing-archives'),
          ],
          {
            env: {
              ...fixture.env,
              GITHUB_SHA: plan.sourceSha,
              GITHUB_WORKFLOW_SHA: 'b'.repeat(40),
            },
          },
        ),
        /build workflow must match/,
      );
      assert.deepEqual(await callsFrom(fixture), []);
    });
  },
);
