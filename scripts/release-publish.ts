import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { api, findRelease, remoteReservation, repository, run } from './release-io.js';
import {
  assertSameRelease,
  assertReleaseAssets,
  compareTags,
  publicationAction,
  verifyArchive,
  type ReleasePlan,
} from './release-model.js';

export type Registry = 'npm' | 'github';
function registryDetails(registry: Registry): { name: string; url: string } {
  return registry === 'npm'
    ? { name: 'cliscope', url: 'https://registry.npmjs.org' }
    : { name: '@justinoboyle/cliscope', url: 'https://npm.pkg.github.com' };
}

/** Only an explicit missing-version response permits a new publication. */
async function registryValue(
  registry: Registry,
  selector: string,
  field: string,
): Promise<unknown> {
  const { url } = registryDetails(registry);
  try {
    return JSON.parse(await run('npm', ['view', selector, field, '--json', '--registry', url]));
  } catch (error) {
    const failure = z.object({ stdout: z.string() }).safeParse(error);
    if (!failure.success) throw error;
    const payload: unknown = JSON.parse(failure.data.stdout);
    if (z.object({ error: z.object({ code: z.literal('E404') }) }).safeParse(payload).success)
      return undefined;
    throw error;
  }
}

export async function registryIntegrity(
  registry: Registry,
  tag: string,
): Promise<string | undefined> {
  const { name } = registryDetails(registry);
  const value = await registryValue(registry, `${name}@${tag.slice(1)}`, 'dist.integrity');
  return value === undefined
    ? undefined
    : z
        .string()
        .regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/)
        .parse(value);
}

async function checkLatest(registry: Registry, tag: string): Promise<void> {
  const { name } = registryDetails(registry);
  const value = await registryValue(registry, name, 'dist-tags.latest');
  assertLatestCanAdvance(value === undefined ? undefined : z.string().parse(value), tag);
}

/** npm metadata can lag publication; absence is retried, conflicting bytes are not. */
export async function confirmPublication(
  expected: string,
  read: () => Promise<string | undefined>,
  pause: () => Promise<void> = async () => {
    await delay(10_000);
  },
): Promise<void> {
  for (let attempt = 0; attempt < 13; attempt++) {
    if (publicationAction(expected, await read()) === 'skip') return;
    if (attempt < 12) await pause();
  }
  throw new Error('Published registry metadata did not become visible within two minutes');
}

export function assertPublishSource(plan: ReleasePlan, environment: NodeJS.ProcessEnv): void {
  if (
    environment['GITHUB_SHA'] !== plan.sourceSha ||
    environment['GITHUB_REF'] !== `refs/tags/${plan.tag}`
  )
    throw new Error(
      'Publication must run at the reserved tag so provenance identifies the tested source',
    );
}

function registryArchive(registry: Registry, tag: string): string {
  return `${registry === 'npm' ? 'cliscope' : 'justinoboyle-cliscope'}-${tag.slice(1)}.tgz`;
}

export async function publishRegistry(
  plan: ReleasePlan,
  registry: Registry,
  directory: string,
): Promise<void> {
  assertPublishSource(plan, process.env);
  const reservation = await remoteReservation(await repository(), plan.tag);
  if (!reservation) throw new Error('Cannot publish without an immutable release reservation');
  assertSameRelease(plan, reservation);
  const name = registryArchive(registry, plan.tag);
  const path = join(directory, name);
  const expected = reservation.archives[name];
  verifyArchive(name, await readFile(path), expected);
  if (!expected) throw new Error('Registry archive is not reserved');
  const action = publicationAction(expected.integrity, await registryIntegrity(registry, plan.tag));
  if (action === 'publish') {
    await checkLatest(registry, plan.tag);
    const { url } = registryDetails(registry);
    const args = ['publish', path, '--ignore-scripts', '--registry', url, '--tag', 'latest'];
    if (registry === 'npm') args.push('--access', 'public', '--provenance');
    else args.push('--provenance=false');
    await run('npm', args);
  }
  await confirmPublication(expected.integrity, async () => registryIntegrity(registry, plan.tag));
  console.log(
    `${registry}: ${action === 'skip' ? 'verified existing publication' : 'published and verified'} ${plan.tag}`,
  );
}

export async function dispatchPublication(plan: ReleasePlan): Promise<void> {
  await run('gh', [
    'workflow',
    'run',
    'release.yml',
    '--repo',
    await repository(),
    '--ref',
    plan.tag,
    '-f',
    'phase=publish',
  ]);
}

async function queueNext(repo: string, source: string): Promise<void> {
  await run('git', ['fetch', 'origin', 'main']);
  const remaining = await run('git', [
    'rev-list',
    '--first-parent',
    '--count',
    `${source}..origin/main`,
  ]);
  if (Number(remaining) > 0)
    await run('gh', [
      'workflow',
      'run',
      'release.yml',
      '--repo',
      repo,
      '--ref',
      'main',
      '-f',
      'phase=plan',
    ]);
}

/** Finalization follows verification at both registries; retrying does not republish. */
export async function finalizeRelease(plan: ReleasePlan): Promise<void> {
  assertPublishSource(plan, process.env);
  const repo = await repository();
  const reservation = await remoteReservation(repo, plan.tag);
  if (!reservation) throw new Error('Release reservation is missing');
  assertSameRelease(plan, reservation);
  for (const registry of ['npm', 'github'] satisfies readonly Registry[]) {
    const expected = reservation.archives[registryArchive(registry, plan.tag)];
    if (!expected || (await registryIntegrity(registry, plan.tag)) !== expected.integrity)
      throw new Error(`${registry}: reserved version is not published with matching integrity`);
  }
  const release = await findRelease(repo, plan.tag);
  if (!release) throw new Error('GitHub Release draft is missing');
  assertReleaseAssets(reservation, release.assets);
  if (release.draft)
    await api(`repos/${repo}/releases/${release.id}`, [
      '--method',
      'PATCH',
      '-F',
      'draft=false',
      '-f',
      'make_latest=true',
    ]);
  await queueNext(repo, plan.sourceSha);
}

/** Prevent a delayed retry from moving a registry's latest tag backwards. */
export function assertLatestCanAdvance(current: string | undefined, target: string): void {
  if (current !== undefined && compareTags(`v${current}`, target) > 0)
    throw new Error('A newer registry version is already latest; refusing to move it backwards');
}
