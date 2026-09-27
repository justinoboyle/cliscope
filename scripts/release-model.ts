import { createHash } from 'node:crypto';
import { z } from 'zod';
import { contractSchema, hashContract } from './release-contract.js';

const sourceSha = z.string().regex(/^[a-f0-9]{40}$/);
const tagName = z.string().regex(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const archiveSchema = z.strictObject({
  sha256,
  integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+={0,2}$/),
});
const identity = {
  sourceSha,
  previousTag: tagName,
  tag: tagName,
  contract: contractSchema,
  contractHash: sha256,
  reasons: z.array(z.string()).min(1),
};
export const releasePlanSchema = z.strictObject({
  kind: z.literal('release'),
  ...identity,
  resume: z.boolean(),
});
export const planSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('idle') }),
  releasePlanSchema,
]);
export const reservationSchema = z.strictObject({
  kind: z.literal('cliscope-release'),
  ...identity,
  runId: z.string().regex(/^\d+$/),
  archives: z.record(z.string(), archiveSchema),
});
export type ReleasePlan = z.infer<typeof releasePlanSchema>;
export type Plan = z.infer<typeof planSchema>;
export type Reservation = z.infer<typeof reservationSchema>;
export type Archive = z.infer<typeof archiveSchema>;

/** The selected source must also supply the running build workflow. */
export function assertBuildSource(plan: ReleasePlan, environment: NodeJS.ProcessEnv): void {
  if (
    environment['GITHUB_SHA'] !== plan.sourceSha ||
    environment['GITHUB_WORKFLOW_SHA'] !== plan.sourceSha
  )
    throw new Error('Release source and build workflow must match the selected commit');
}

export function digestArchive(bytes: Uint8Array): Archive {
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  };
}

export function requiredArchives(
  release: Pick<ReleasePlan, 'tag' | 'contract'>,
): readonly string[] {
  const tag = tagName.parse(release.tag);
  const platforms = contractSchema.shape.platforms.parse(release.contract.platforms);
  return [
    ...platforms.map((target) => `cliscope-${target}.tar.gz`),
    `cliscope-${tag.slice(1)}.tgz`,
    `justinoboyle-cliscope-${tag.slice(1)}.tgz`,
  ].toSorted();
}

export function validatePlan(input: unknown): ReleasePlan {
  const plan = releasePlanSchema.parse(input);
  if (hashContract(plan.contract) !== plan.contractHash)
    throw new Error('Release contract does not match its recorded digest');
  if (compareTags(plan.tag, plan.previousTag) <= 0)
    throw new Error('Release tag must advance its predecessor');
  return plan;
}

export function parseReservation(message: string): Reservation {
  const reservation = reservationSchema.parse(JSON.parse(message));
  validatePlan({ ...releaseIdentity(reservation), kind: 'release', resume: true });
  const actual = Object.keys(reservation.archives).toSorted();
  if (JSON.stringify(actual) !== JSON.stringify(requiredArchives(reservation)))
    throw new Error('Release annotation has an unexpected archive set');
  return reservation;
}

export function releaseIdentity(
  value: ReleasePlan | Reservation,
): Omit<ReleasePlan, 'kind' | 'resume'> {
  return {
    sourceSha: value.sourceSha,
    previousTag: value.previousTag,
    tag: value.tag,
    contract: value.contract,
    contractHash: value.contractHash,
    reasons: value.reasons,
  };
}

export function assertSameRelease(plan: ReleasePlan, reservation: Reservation): void {
  if (
    plan.sourceSha !== reservation.sourceSha ||
    plan.tag !== reservation.tag ||
    plan.previousTag !== reservation.previousTag ||
    plan.contractHash !== reservation.contractHash ||
    JSON.stringify(plan.reasons) !== JSON.stringify(reservation.reasons)
  )
    throw new Error('Release plan diverges from its immutable tag');
}

export function publicationAction(
  expected: string,
  existing: string | undefined,
): 'publish' | 'skip' {
  if (existing === undefined) return 'publish';
  if (existing !== expected)
    throw new Error('Published package integrity differs from the reserved archive');
  return 'skip';
}

export function compareTags(left: string, right: string): number {
  tagName.parse(left);
  tagName.parse(right);
  const a = left.slice(1).split('.').map(BigInt);
  const b = right.slice(1).split('.').map(BigInt);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0n) - (b[index] ?? 0n);
    if (difference !== 0n) return difference > 0n ? 1 : -1;
  }
  return 0;
}

export function latestStableTag(tags: readonly string[]): string {
  const latest = tags
    .filter((tag) => tagName.safeParse(tag).success)
    .toSorted(compareTags)
    .at(-1);
  if (!latest) throw new Error('Automatic releases require an existing stable release tag');
  return latest;
}

export function verifyArchive(
  name: string,
  bytes: Uint8Array,
  expected: Archive | undefined,
): void {
  const actual = digestArchive(bytes);
  if (!expected || actual.sha256 !== expected.sha256 || actual.integrity !== expected.integrity)
    throw new Error(`Release archive failed integrity verification: ${name}`);
}

export function checksumFile(reservation: Reservation): string {
  return `${requiredArchives(reservation)
    .map((name) => {
      const digest = reservation.archives[name];
      if (!digest) throw new Error(`Reservation has no digest for ${name}`);
      return `${digest.sha256}  ${name}`;
    })
    .join('\n')}\n`;
}

export function assertReleaseAssets(
  reservation: Reservation,
  assets: readonly { readonly name: string; readonly digest?: string | null | undefined }[],
): void {
  const expected = new Map(
    Object.entries(reservation.archives).map(([name, value]) => [name, value.sha256]),
  );
  expected.set('release-contract.json', reservation.contractHash);
  expected.set('SHA256SUMS', digestArchive(Buffer.from(checksumFile(reservation))).sha256);
  for (const [name, hash] of expected) {
    if (assets.find((asset) => asset.name === name)?.digest !== `sha256:${hash}`)
      throw new Error(`GitHub Release asset has no matching reserved digest: ${name}`);
  }
}

/** Git supplies oldest-first first-parent history, independently of event arrival order. */
export function nextQueuedSource(
  history: readonly string[],
  completed: string,
): string | undefined {
  sourceSha.parse(completed);
  for (const source of history) sourceSha.parse(source);
  if (new Set(history).size !== history.length)
    throw new Error('Main history contains duplicate commits');
  const index = history.indexOf(completed);
  if (index < 0) throw new Error('Last release source is not on the main first-parent history');
  return history[index + 1];
}

export function validateReleaseTag(tag: string): string {
  return tagName.parse(tag);
}
