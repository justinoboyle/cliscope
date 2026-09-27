import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateContract, hashContract } from '../scripts/release-contract.js';
import {
  assertSameRelease,
  assertReleaseAssets,
  checksumFile,
  compareTags,
  digestArchive,
  latestStableTag,
  nextQueuedSource,
  parseReservation,
  publicationAction,
  releaseIdentity,
  requiredArchives,
  validatePlan,
  verifyArchive,
  type Reservation,
} from '../scripts/release-model.js';
import {
  assertLatestCanAdvance,
  assertPublishSource,
  confirmPublication,
} from '../scripts/release-publish.js';

const contract = await generateContract(process.cwd());
const plan = validatePlan({
  kind: 'release',
  sourceSha: 'a'.repeat(40),
  previousTag: 'v0.2.1',
  tag: 'v0.3.0',
  contract,
  contractHash: hashContract(contract),
  reasons: ['Runtime behavior changed'],
  resume: false,
});
const bytes = Buffer.from('Synthetic tested archive');
const digest = digestArchive(bytes);
const reservation: Reservation = {
  kind: 'cliscope-release',
  ...releaseIdentity(plan),
  runId: '123',
  archives: Object.fromEntries(requiredArchives(plan.tag).map((name) => [name, digest])),
};

await test('tag annotations round-trip the actual contract and reject malformed or divergent state', () => {
  assert.deepEqual(parseReservation(JSON.stringify(reservation)), reservation);
  assertSameRelease({ ...plan, resume: true }, reservation);
  assert.throws(() => parseReservation('Release v0.3.0'));
  assert.throws(() => parseReservation(JSON.stringify({ ...reservation, version: '0.3.0' })));
  assert.throws(() => validatePlan({ ...plan, contractHash: 'b'.repeat(64) }), /digest/);
  assert.throws(() => validatePlan({ ...plan, sourceSha: '--bad-ref' }));
  assert.throws(() => validatePlan({ ...plan, tag: 'v0.2.0' }), /advance/);
  assert.throws(
    () => assertSameRelease({ ...plan, sourceSha: 'b'.repeat(40) }, reservation),
    /diverges/,
  );
  assert.throws(() => assertSameRelease({ ...plan, tag: 'v0.4.0' }, reservation), /diverges/);
});

await test('reservation requires every native and registry archive and forbids injected paths', () => {
  assert.equal(requiredArchives(plan.tag).length, 7);
  assert.throws(() => requiredArchives('v01.0.0'));
  assert.throws(
    () => parseReservation(JSON.stringify({ ...reservation, archives: {} })),
    /archive set/,
  );
  assert.throws(
    () =>
      parseReservation(
        JSON.stringify({
          ...reservation,
          archives: {
            ...reservation.archives,
            '../outside': digest,
          },
        }),
      ),
    /archive set/,
  );
  verifyArchive('fixture', bytes, digest);
  assert.throws(() => verifyArchive('fixture', Buffer.from('changed'), digest), /integrity/);
  assert.throws(
    () => verifyArchive('fixture', bytes, { ...digest, integrity: 'sha512-different' }),
    /integrity/,
  );
});

await test('publication is idempotent only for matching immutable bytes', () => {
  assert.equal(publicationAction(digest.integrity, undefined), 'publish');
  assert.equal(publicationAction(digest.integrity, digest.integrity), 'skip');
  assert.throws(() => publicationAction(digest.integrity, 'sha512-other'), /differs/);
  assertLatestCanAdvance(undefined, plan.tag);
  assertLatestCanAdvance('0.2.1', plan.tag);
  assertLatestCanAdvance('0.3.0', plan.tag);
  assert.throws(() => assertLatestCanAdvance('0.4.0', plan.tag), /backwards/);
});

await test('finalization verifies binary, package, checksum, and contract asset digests', () => {
  const assets = Object.entries(reservation.archives).map(([name, value]) => ({
    name,
    digest: `sha256:${value.sha256}`,
  }));
  assets.push({ name: 'release-contract.json', digest: `sha256:${reservation.contractHash}` });
  assets.push({
    name: 'SHA256SUMS',
    digest: `sha256:${digestArchive(Buffer.from(checksumFile(reservation))).sha256}`,
  });
  assertReleaseAssets(reservation, assets);
  assert.throws(() => assertReleaseAssets(reservation, assets.slice(1)), /digest/);
  assert.throws(
    () =>
      assertReleaseAssets(
        reservation,
        assets.map((asset) => ({ ...asset, digest: 'sha256:changed' })),
      ),
    /digest/,
  );
  assert.throws(
    () =>
      assertReleaseAssets(
        reservation,
        assets.map(({ name }) => ({ name, digest: null })),
      ),
    /digest/,
  );
});

await test('publication provenance requires both the reserved source and its immutable tag ref', () => {
  assertPublishSource(plan, { GITHUB_SHA: plan.sourceSha, GITHUB_REF: `refs/tags/${plan.tag}` });
  assert.throws(
    () => assertPublishSource(plan, { GITHUB_SHA: plan.sourceSha, GITHUB_REF: 'refs/heads/main' }),
    /provenance/,
  );
  assert.throws(
    () =>
      assertPublishSource(plan, {
        GITHUB_SHA: 'b'.repeat(40),
        GITHUB_REF: `refs/tags/${plan.tag}`,
      }),
    /provenance/,
  );
});

await test('stable tags and first-parent history choose the oldest unprocessed merge', () => {
  assert.equal(
    latestStableTag(['v0.1.0', 'v0.2.1', 'v0.2.0', 'v9.0.0-beta.1', 'random']),
    'v0.2.1',
  );
  assert.equal(compareTags('v1.10.0', 'v1.9.99'), 1);
  assert.equal(compareTags('v9007199254740993.0.0', 'v9007199254740992.0.0'), 1);
  const history = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
  assert.equal(nextQueuedSource(history, 'a'.repeat(40)), 'b'.repeat(40));
  assert.equal(nextQueuedSource(history, 'b'.repeat(40)), 'c'.repeat(40));
  assert.equal(nextQueuedSource(history, 'c'.repeat(40)), undefined);
  assert.throws(() => nextQueuedSource(history, 'd'.repeat(40)), /first-parent/);
  assert.throws(() => nextQueuedSource([...history, 'a'.repeat(40)], 'a'.repeat(40)), /duplicate/);
});

await test('registry visibility retries absence, but never masks conflicts or authorization errors', async () => {
  let attempts = 0;
  let pauses = 0;
  await confirmPublication(
    digest.integrity,
    async () => (++attempts < 3 ? undefined : digest.integrity),
    async () => {
      pauses++;
    },
  );
  assert.equal(attempts, 3);
  assert.equal(pauses, 2);
  let conflictReads = 0;
  await assert.rejects(
    confirmPublication(digest.integrity, async () => {
      conflictReads++;
      return 'sha512-conflict';
    }),
    /differs/,
  );
  assert.equal(conflictReads, 1);
  await assert.rejects(
    confirmPublication(digest.integrity, async () => {
      throw new Error('E401');
    }),
    /E401/,
  );
  let missingReads = 0;
  await assert.rejects(
    confirmPublication(
      digest.integrity,
      async () => {
        missingReads++;
        return undefined;
      },
      async () => {},
    ),
    /two minutes/,
  );
  assert.equal(missingReads, 13);
});
