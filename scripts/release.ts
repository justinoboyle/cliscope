import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { stampVersion } from './release-contract.js';
import { recoverRelease, reserveRelease } from './release-artifacts.js';
import { output, readJson, remoteReservation, repository } from './release-io.js';
import {
  assertBuildSource,
  releaseIdentity,
  validatePlan,
  type Plan,
  type ReleasePlan,
} from './release-model.js';
import { planRelease } from './release-plan.js';
import {
  dispatchBuild,
  dispatchPublication,
  finalizeRelease,
  publishRegistry,
} from './release-publish.js';

function required(value: string | undefined, flag: string): string {
  if (!value) throw new Error(`Missing --${flag}`);
  return value;
}

async function savePlan(plan: Plan, path: string): Promise<void> {
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`);
  await output({
    has_release: String(plan.kind === 'release'),
    source_sha: plan.kind === 'release' ? plan.sourceSha : '',
    version: plan.kind === 'release' ? plan.tag.slice(1) : '',
    tag: plan.kind === 'release' ? plan.tag : '',
    resume: String(plan.kind === 'release' && plan.resume),
  });
}

async function taggedPlan(tag: string): Promise<ReleasePlan> {
  const reservation = await remoteReservation(await repository(), tag);
  if (!reservation) throw new Error('Tag has no release reservation');
  return validatePlan({ kind: 'release', ...releaseIdentity(reservation), resume: true });
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      plan: { type: 'string' },
      output: { type: 'string' },
      artifacts: { type: 'string' },
      registry: { type: 'string' },
      tag: { type: 'string' },
      version: { type: 'string' },
    },
  });
  const command = z
    .enum([
      'plan',
      'reserve',
      'recover',
      'dispatch',
      'dispatch-build',
      'publish',
      'finalize',
      'stamp',
    ])
    .parse(positionals[0]);
  if (positionals.length !== 1) throw new Error('Expected one release command');
  if (command === 'stamp') {
    await stampVersion(process.cwd(), required(values.version, 'version'));
    return;
  }
  if (command === 'plan') {
    const plan = await planRelease();
    if (plan.kind === 'release' && !plan.resume && plan.sourceSha === process.env['GITHUB_SHA'])
      assertBuildSource(plan, process.env);
    await savePlan(plan, required(values.output, 'output'));
    return;
  }
  const plan =
    command === 'recover' && values.tag
      ? await taggedPlan(values.tag)
      : validatePlan(await readJson(required(values.plan, 'plan')));
  switch (command) {
    case 'reserve':
      await reserveRelease(plan, resolve(required(values.artifacts, 'artifacts')));
      return;
    case 'recover':
      await recoverRelease(plan, resolve(required(values.artifacts, 'artifacts')));
      if (values.output) await savePlan(plan, values.output);
      return;
    case 'dispatch':
      await dispatchPublication(plan);
      return;
    case 'dispatch-build':
      await dispatchBuild(plan);
      return;
    case 'publish':
      await publishRegistry(
        plan,
        z.enum(['npm', 'github']).parse(values.registry),
        resolve(required(values.artifacts, 'artifacts')),
      );
      return;
    case 'finalize':
      await finalizeRelease(plan);
  }
}

await main();
