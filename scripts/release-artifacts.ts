import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalContract } from './release-contract.js';
import {
  api,
  findRelease,
  releaseSchema,
  remoteReservation,
  repository,
  run,
  type GitHubRelease,
} from './release-io.js';
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

async function ensureDraft(repo: string, reservation: Reservation): Promise<GitHubRelease> {
  const existing = await findRelease(repo, reservation.tag);
  if (existing) return existing;
  const notes = z
    .object({ body: z.string() })
    .parse(
      await api(`repos/${repo}/releases/generate-notes`, [
        '--method',
        'POST',
        '-f',
        `tag_name=${reservation.tag}`,
        '-f',
        `previous_tag_name=${reservation.previousTag}`,
      ]),
    );
  return releaseSchema
    .extend({ tag_name: z.literal(reservation.tag), draft: z.literal(true) })
    .parse(
      await api(`repos/${repo}/releases`, [
        '--method',
        'POST',
        '-f',
        `tag_name=${reservation.tag}`,
        '-f',
        `target_commitish=${reservation.sourceSha}`,
        '-f',
        `name=${reservation.tag}`,
        '-f',
        `body=${notes.body}`,
        '-F',
        'draft=true',
      ]),
    );
}

/** Existing assets are checked, never overwritten, including during a retry. */
async function uploadAssets(
  repo: string,
  reservation: Reservation,
  directory: string,
  release: GitHubRelease,
): Promise<void> {
  const names = [...requiredArchives(reservation), 'SHA256SUMS', 'release-contract.json'];
  for (const name of names) {
    const asset = release.assets.find((entry) => entry.name === name);
    const expected = `sha256:${reservation.archives[name]?.sha256 ?? digestArchive(await readFile(join(directory, name))).sha256}`;
    if (asset) {
      if (asset.digest !== expected)
        throw new Error(`Existing release asset differs from the reservation: ${name}`);
    } else {
      z.object({ name: z.literal(name), digest: z.literal(expected) }).parse(
        await api(
          `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`,
          [
            '--method',
            'POST',
            '--header',
            'Content-Type: application/octet-stream',
            '--input',
            join(directory, name),
          ],
        ),
      );
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
  await uploadAssets(repo, reservation, directory, await ensureDraft(repo, reservation));
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
