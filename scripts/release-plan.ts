import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { x } from 'tar';
import {
  classifyContracts,
  generateContract,
  hashContract,
  nextVersion,
  type Contract,
} from './release-contract.js';
import { findRelease, repository, run } from './release-io.js';
import {
  latestStableTag,
  nextQueuedSource,
  parseReservation,
  releaseIdentity,
  validatePlan,
  type Plan,
} from './release-model.js';

/** Extract tracked source; the controller supplies the same compiler for both revisions. */
async function contractAt(source: string): Promise<Contract> {
  const temporary = await mkdtemp(join(tmpdir(), 'cliscope-contract-'));
  try {
    const archive = join(temporary, 'source.tar');
    const directory = join(temporary, 'source');
    await mkdir(directory);
    await run('git', ['archive', '--format=tar', '--output', archive, source]);
    await x({ file: archive, cwd: directory, strict: true });
    await symlink(resolve('node_modules'), join(directory, 'node_modules'), 'dir');
    return await generateContract(directory);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** First-parent traversal makes merge commits and squash merges one release unit each. */
export async function planRelease(): Promise<Plan> {
  await run('git', ['fetch', 'origin', 'main', '--tags']);
  const tags = (await run('git', ['tag', '--list'])).split('\n');
  const previousTag = latestStableTag(tags);
  const previousSource = await run('git', ['rev-parse', `${previousTag}^{commit}`]);
  await run('git', ['merge-base', '--is-ancestor', previousSource, 'origin/main']);
  const message = await run('git', [
    'for-each-ref',
    '--format=%(contents)',
    `refs/tags/${previousTag}`,
  ]);
  // This is the sole legacy baseline. Future malformed annotations fail closed.
  const reservation = previousTag === 'v0.2.1' ? undefined : parseReservation(message);
  if (reservation && reservation.sourceSha !== previousSource)
    throw new Error('Release tag source diverges from its contract annotation');
  const published = await findRelease(await repository(), previousTag);
  if (reservation && (!published || published.draft))
    return validatePlan({ kind: 'release', ...releaseIdentity(reservation), resume: true });
  if (!published || published.draft)
    throw new Error('Legacy release baseline must already be published');
  const commits = await run('git', ['rev-list', '--first-parent', '--reverse', 'origin/main']);
  const sourceSha = nextQueuedSource(commits.split('\n'), previousSource);
  if (!sourceSha) return { kind: 'idle' };
  const previous = reservation?.contract ?? (await contractAt(previousSource));
  const contract = await contractAt(sourceSha);
  const classification = classifyContracts(previous, contract);
  return validatePlan({
    kind: 'release',
    sourceSha,
    previousTag,
    tag: `v${nextVersion(previousTag.slice(1), classification.bump)}`,
    contract,
    contractHash: hashContract(contract),
    reasons: classification.reasons,
    resume: false,
  });
}
