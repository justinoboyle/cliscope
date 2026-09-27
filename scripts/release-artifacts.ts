import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalContract } from './release-contract.js';
import { api, findRelease, remoteReservation, repository, run } from './release-io.js';
import {
  assertSameRelease,
  assertBuildSource,
  checksumFile,
  digestArchive,
  latestStableTag,
  releaseIdentity,
  requiredArchives,
  verifyArchive,
  type Archive,
  type ReleasePlan,
  type Reservation,
} from './release-model.js';

async function archiveDigests(
  plan: ReleasePlan,
  directory: string,
): Promise<Record<string, Archive>> {
  const archives: Record<string, Archive> = {};
  for (const name of requiredArchives(plan))
    archives[name] = digestArchive(await readFile(join(directory, name)));
  return archives;
}

async function createTag(repo: string, reservation: Reservation): Promise<void> {
  const object = z
    .object({ sha: z.string() })
    .parse(
      await api(`repos/${repo}/git/tags`, [
        '--method',
        'POST',
        '-f',
        `tag=${reservation.tag}`,
        '-f',
        `object=${reservation.sourceSha}`,
        '-f',
        'type=commit',
        '-f',
        `message=${JSON.stringify(reservation)}`,
      ]),
    );
  await api(`repos/${repo}/git/refs`, [
    '--method',
    'POST',
    '-f',
    `ref=refs/tags/${reservation.tag}`,
    '-f',
    `sha=${object.sha}`,
  ]);
}

async function auxiliaryFiles(reservation: Reservation, directory: string): Promise<void> {
  await writeFile(join(directory, 'SHA256SUMS'), checksumFile(reservation));
  await writeFile(
    join(directory, 'release-contract.json'),
    canonicalContract(reservation.contract),
  );
}

async function ensureDraft(repo: string, reservation: Reservation): Promise<void> {
  if (await findRelease(repo, reservation.tag)) return;
  await run('gh', [
    'release',
    'create',
    reservation.tag,
    '--repo',
    repo,
    '--verify-tag',
    '--draft',
    '--title',
    reservation.tag,
    '--generate-notes',
    '--notes-start-tag',
    reservation.previousTag,
  ]);
}

/** Existing assets are checked, never overwritten, including during a retry. */
async function uploadAssets(
  repo: string,
  reservation: Reservation,
  directory: string,
): Promise<void> {
  const release = await findRelease(repo, reservation.tag);
  if (!release) throw new Error('Reserved GitHub Release is missing');
  const names = [...requiredArchives(reservation), 'SHA256SUMS', 'release-contract.json'];
  for (const name of names) {
    const asset = release.assets.find((entry) => entry.name === name);
    if (asset) {
      const expected = digestArchive(await readFile(join(directory, name))).sha256;
      if (asset.digest !== `sha256:${expected}`)
        throw new Error(`Existing release asset differs from the reservation: ${name}`);
    } else {
      await run('gh', [
        'release',
        'upload',
        reservation.tag,
        join(directory, name),
        '--repo',
        repo,
      ]);
    }
  }
}

export async function reserveRelease(plan: ReleasePlan, directory: string): Promise<void> {
  if (plan.resume) await recoverRelease(plan, directory);
  else assertBuildSource(plan, process.env);
  const repo = await repository();
  const archives = await archiveDigests(plan, directory);
  let reservation = await remoteReservation(repo, plan.tag);
  if (reservation) {
    assertSameRelease(plan, reservation);
    if (JSON.stringify(reservation.archives) !== JSON.stringify(archives))
      throw new Error('Rebuilt archives differ from the immutable release reservation');
  } else {
    if (plan.resume) throw new Error('Cannot resume a missing release tag');
    await run('git', ['fetch', 'origin', 'main', '--tags']);
    await run('git', ['merge-base', '--is-ancestor', plan.sourceSha, 'origin/main']);
    const latest = latestStableTag((await run('git', ['tag', '--list'])).split('\n'));
    if (latest !== plan.previousTag)
      throw new Error('Release plan is stale; replan from the latest tag');
    reservation = {
      kind: 'cliscope-release',
      ...releaseIdentity(plan),
      archives,
      runId: z.string().regex(/^\d+$/).parse(process.env['GITHUB_RUN_ID']),
    };
    await createTag(repo, reservation);
  }
  await auxiliaryFiles(reservation, directory);
  await ensureDraft(repo, reservation);
  await uploadAssets(repo, reservation, directory);
}

function artifactGroup(name: string): string {
  if (name.endsWith('.tar.gz')) return name.slice(0, -7);
  return name.startsWith('justinoboyle-') ? 'github-package' : 'npm-package';
}

export async function recoverRelease(plan: ReleasePlan, directory: string): Promise<void> {
  const repo = await repository();
  const reservation = await remoteReservation(repo, plan.tag);
  if (!reservation) throw new Error('Release reservation is missing');
  assertSameRelease(plan, reservation);
  const release = await findRelease(repo, plan.tag);
  await mkdir(directory, { recursive: true });
  for (const name of requiredArchives(plan)) {
    if (release?.assets.some((asset) => asset.name === name))
      await run('gh', [
        'release',
        'download',
        plan.tag,
        '--repo',
        repo,
        '--pattern',
        name,
        '--dir',
        directory,
      ]);
    else
      await run('gh', [
        'run',
        'download',
        reservation.runId,
        '--repo',
        repo,
        '--name',
        artifactGroup(name),
        '--dir',
        directory,
      ]);
    verifyArchive(name, await readFile(join(directory, name)), reservation.archives[name]);
  }
  await auxiliaryFiles(reservation, directory);
}
