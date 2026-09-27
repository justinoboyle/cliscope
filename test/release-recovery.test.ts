import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { z } from 'zod';
import { generateContract, hashContract } from '../scripts/release-contract.js';
import {
  digestArchive,
  releaseIdentity,
  requiredArchives,
  type Reservation,
} from '../scripts/release-model.js';

const execute = promisify(execFile);
// Release orchestration runs on Ubuntu. This fixture replaces gh, so no network mutation occurs.
const fakeGh = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const fixture = JSON.parse(readFileSync(process.env.RELEASE_FIXTURE, 'utf8'));
appendFileSync(process.env.RELEASE_CALLS, JSON.stringify(args) + '\\n');
const { reservation } = fixture;
if (args[0] === 'api') {
  const path = args[1];
  if (path.includes('/git/ref/')) console.log(JSON.stringify({ object: { type: 'tag', sha: 'tagobject' } }));
  else if (path.includes('/git/tags/')) console.log(JSON.stringify({ message: JSON.stringify(reservation), object: { type: 'commit', sha: reservation.sourceSha } }));
  else if (path.includes('/releases/tags/')) { console.error('gh: Not Found (HTTP 404)'); process.exit(1); }
  else if (path.includes('/releases?')) console.log(JSON.stringify([{ id: 1, draft: true, tag_name: reservation.tag, assets: fixture.assets ?? [] }]));
  else throw Error('Unexpected API call: ' + path);
} else if (args[0] === 'run' && args[1] === 'download') {
  if (args[2] !== reservation.runId) throw Error('Attempted recovery from a different workflow run');
  const group = args[args.indexOf('--name') + 1];
  const directory = args[args.indexOf('--dir') + 1];
  const version = reservation.tag.slice(1);
  const name = group === 'npm-package' ? 'cliscope-' + version + '.tgz'
    : group === 'github-package' ? 'justinoboyle-cliscope-' + version + '.tgz' : group + '.tar.gz';
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name), fixture.bytes);
} else if (!(args[0] === 'release' && args[1] === 'upload')) throw Error('Unexpected gh call');
`;

const fakeNpm = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const fixture = JSON.parse(readFileSync(process.env.RELEASE_FIXTURE, 'utf8'));
appendFileSync(process.env.RELEASE_NPM_CALLS, JSON.stringify(args) + '\\n');
if (process.env.RELEASE_DENY === 'true') {
  console.log(JSON.stringify({ error: { code: 'E401' } })); process.exit(1);
}
if (args[0] === 'publish') {
  if (!args.includes('--provenance') || !args.includes('--ignore-scripts')) throw Error('Unsafe publish flags');
  if (readFileSync(args[1], 'utf8') !== fixture.bytes) throw Error('Wrong archive bytes');
  writeFileSync(process.env.RELEASE_PUBLISHED, 'yes');
} else if (args[0] === 'view' && args[2] === 'dist-tags.latest') console.log(JSON.stringify('0.2.1'));
else if (args[0] === 'view' && args[2] === 'dist.integrity') {
  if (!existsSync(process.env.RELEASE_PUBLISHED)) {
    console.log(JSON.stringify({ error: { code: 'E404' } })); process.exit(1);
  }
  console.log(JSON.stringify(fixture.reservation.archives['cliscope-0.3.0.tgz'].integrity));
} else throw Error('Unexpected npm call');
`;

async function readCalls(path: string): Promise<string[][]> {
  return (await readFile(path, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => z.array(z.string()).parse(JSON.parse(line)));
}

async function checkRepeatedPublication(
  planPath: string,
  artifacts: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const args = [
    '--import',
    'tsx',
    'scripts/release.ts',
    'publish',
    '--plan',
    planPath,
    '--registry',
    'npm',
    '--artifacts',
    artifacts,
  ];
  await execute(process.execPath, args, { env });
  await execute(process.execPath, args, { env });
  await assert.rejects(
    execute(process.execPath, args, { env: { ...env, RELEASE_DENY: 'true' } }),
    /E401/,
  );
  const callsPath = env['RELEASE_NPM_CALLS'];
  assert.ok(callsPath);
  const calls = await readCalls(callsPath);
  assert.equal(calls.filter((entry) => entry[0] === 'publish').length, 1);
}

async function checkExistingAssets(
  planPath: string,
  artifacts: string,
  env: NodeJS.ProcessEnv,
  fixture: { readonly reservation: Reservation; readonly bytes: string },
): Promise<void> {
  const fixturePath = env['RELEASE_FIXTURE'];
  const callsPath = env['RELEASE_CALLS'];
  assert.ok(fixturePath && callsPath);
  const before = (await readCalls(callsPath)).length;
  const names = [...requiredArchives(fixture.reservation), 'SHA256SUMS', 'release-contract.json'];
  const assets = await Promise.all(
    names.map(async (name) => ({
      name,
      digest: `sha256:${digestArchive(await readFile(join(artifacts, name))).sha256}`,
    })),
  );
  await writeFile(
    planPath,
    JSON.stringify({ kind: 'release', ...releaseIdentity(fixture.reservation), resume: false }),
  );
  const args = [
    '--import',
    'tsx',
    'scripts/release.ts',
    'reserve',
    '--plan',
    planPath,
    '--artifacts',
    artifacts,
  ];
  await writeFile(fixturePath, JSON.stringify({ ...fixture, assets }));
  await execute(process.execPath, args, { env });
  for (const digest of [undefined, null, `sha256:${'0'.repeat(64)}`]) {
    const invalid = assets.map((asset, index) => (index === 0 ? { ...asset, digest } : asset));
    await writeFile(fixturePath, JSON.stringify({ ...fixture, assets: invalid }));
    await assert.rejects(
      execute(process.execPath, args, { env }),
      /Existing release asset differs/,
    );
  }
  const calls = (await readCalls(callsPath)).slice(before);
  assert.ok(
    calls.every((call) => call[0] === 'api'),
    'Existing assets must not download or upload',
  );
}

await test(
  'resume restores original run archives before reservation reads and never rebuilds',
  {
    skip:
      process.platform === 'win32' ? 'Release jobs use POSIX executable fixtures on Ubuntu' : false,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'cliscope-release-recovery-'));
    try {
      const contract = await generateContract(process.cwd());
      const plan = {
        kind: 'release',
        sourceSha: 'a'.repeat(40),
        previousTag: 'v0.2.1',
        tag: 'v0.3.0',
        contract,
        contractHash: hashContract(contract),
        reasons: ['Runtime behavior changed'],
        resume: true,
      };
      const bytes = 'Original tested archive';
      const { kind: _kind, resume: _resume, ...identity } = plan;
      const reservation: Reservation = {
        kind: 'cliscope-release',
        ...identity,
        runId: '123',
        archives: Object.fromEntries(
          requiredArchives(plan).map((name) => [name, digestArchive(Buffer.from(bytes))]),
        ),
      };
      const bin = join(directory, 'bin');
      await mkdir(bin);
      await writeFile(join(bin, 'gh'), fakeGh, { mode: 0o755 });
      await writeFile(join(bin, 'npm'), fakeNpm, { mode: 0o755 });
      const fixture = join(directory, 'fixture.json');
      const calls = join(directory, 'calls.jsonl');
      const planPath = join(directory, 'plan.json');
      const artifacts = join(directory, 'artifacts');
      await writeFile(fixture, JSON.stringify({ reservation, bytes }));
      await writeFile(planPath, JSON.stringify(plan));
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
        GH_REPO: 'justinoboyle/cliscope',
        GITHUB_RUN_ID: '999',
        GITHUB_SHA: plan.sourceSha,
        GITHUB_REF: `refs/tags/${plan.tag}`,
        RELEASE_FIXTURE: fixture,
        RELEASE_CALLS: calls,
        RELEASE_NPM_CALLS: join(directory, 'npm-calls.jsonl'),
        RELEASE_PUBLISHED: join(directory, 'published'),
      };
      await execute(
        process.execPath,
        [
          '--import',
          'tsx',
          'scripts/release.ts',
          'reserve',
          '--plan',
          planPath,
          '--artifacts',
          artifacts,
        ],
        { env },
      );
      for (const name of requiredArchives(plan))
        assert.equal(await readFile(join(artifacts, name), 'utf8'), bytes);
      const invocations = await readCalls(calls);
      const downloads = invocations.filter((args) => args[0] === 'run');
      assert.equal(downloads.length, 7);
      assert.ok(downloads.every((args) => args[2] === '123'));
      assert.equal(
        invocations.filter((args) => args[0] === 'release' && args[1] === 'upload').length,
        9,
      );
      assert.ok(invocations.every((args) => !args.includes('POST')));
      const restored = await readFile(join(artifacts, 'release-contract.json'));
      assert.equal(digestArchive(restored).sha256, plan.contractHash);
      await checkRepeatedPublication(planPath, artifacts, env);
      await checkExistingAssets(planPath, artifacts, env, { reservation, bytes });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
